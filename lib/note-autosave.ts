import type { Note, NoteUpdates } from "./types";

export type SaveStatus = "saved" | "saving" | "offline" | "error" | "conflict";
export interface SaveSnapshot {
  note: Note;
  status: SaveStatus;
  hasPending: boolean;
  error: string | null;
  storageError: string | null;
  conflict: Note | null;
  localDrafts: LocalDraft[];
}
export interface LocalDraft { key: string; title: string; content: string; savedAt: number; }

type Fields = Pick<Note, "title" | "content" | "emoji">;
type Flight = { revision: number; updates: NoteUpdates };
interface DraftRecord {
  version: 1;
  noteId: string;
  baseRevision: number;
  baseFields: Fields;
  updates: NoteUpdates;
  flight: Flight | null;
  savedAt?: number;
}
interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys?(): string[];
}
interface AutosaveOptions {
  storage: DraftStorage;
  fetcher: typeof fetch;
  isOnline?: () => boolean;
  debounceMs?: number;
  retryMs?: number;
  onSaved?: (note: Note) => void;
  onUnauthorized?: () => void;
  writerId?: string;
}

export const DRAFT_PREFIX = "notes:draft:v1:";
const fields = (note: Fields): Fields => ({ title: note.title, content: note.content, emoji: note.emoji });
const sameFields = (a: Fields, b: Fields) => a.title === b.title && a.content === b.content && a.emoji === b.emoji;
const editable = (note: Note) => note.can_edit && !note.public && !note.deleted_at;
const hasUpdates = (updates: NoteUpdates) => Object.keys(updates).length > 0;

function validUpdates(value: unknown): value is NoteUpdates {
  return !!value && typeof value === "object" && Object.entries(value).every(([key, item]) =>
    ["title", "content", "emoji"].includes(key) && typeof item === "string"
  );
}

function parseDraft(raw: string, id: string): DraftRecord | null {
  const value = JSON.parse(raw) as DraftRecord;
  if (value.version !== 1 || value.noteId !== id || !Number.isInteger(value.baseRevision) ||
    !validUpdates(value.baseFields) || typeof value.baseFields.title !== "string" ||
    typeof value.baseFields.content !== "string" || !validUpdates(value.updates) ||
    (value.flight && (!Number.isInteger(value.flight.revision) || !validUpdates(value.flight.updates)))) return null;
  return value;
}

/** One queue per note. Its lifetime is independent of React routes and subscriptions. */
export class NoteAutosave {
  private base: Note;
  private pending: NoteUpdates = {};
  private flight: Flight | null = null;
  private sending = false;
  private enabled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private listeners = new Set<() => void>();
  private snapshot: SaveSnapshot;
  private storageKey: string;
  private recoveredFrom: { key: string; raw: string } | null = null;

  constructor(note: Note, private options: AutosaveOptions) {
    this.base = note;
    this.storageKey = `${DRAFT_PREFIX}${note.id}:${options.writerId ?? crypto.randomUUID()}`;
    this.snapshot = { note, status: "saved", hasPending: false, error: null, storageError: null, conflict: null, localDrafts: [] };
    // Only fresh server data can grant edit access. A stored draft cannot grant it.
    if (note.can_edit) {
      try {
        const raw = options.storage.getItem(this.storageKey);
        const draft = raw ? parseDraft(raw, note.id) : null;
        if (draft && hasUpdates(draft.updates)) {
          this.base = { ...note, ...draft.baseFields, revision: draft.baseRevision };
          this.pending = draft.updates;
          this.flight = draft.flight;
          this.snapshot.status = "saving";
          this.observe(note);
        }
        this.refreshLocalDrafts();
      } catch {
        this.publish({ storageError: "This device could not load its saved draft. Keep this tab open until changes are saved." });
      }
    }
    this.publish({});
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  start() {
    this.enabled = true;
    if (hasUpdates(this.pending) && !this.snapshot.conflict) this.schedule(0);
  }
  pause() {
    this.enabled = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  refreshLocalDrafts() {
    if (!this.base.can_edit) return;
    try {
      const localDrafts: LocalDraft[] = [];
      for (const key of this.options.storage.keys?.() ?? []) {
        if (key === this.storageKey || key === this.recoveredFrom?.key ||
          !(key === DRAFT_PREFIX + this.base.id || key.startsWith(`${DRAFT_PREFIX}${this.base.id}:`))) continue;
        try {
          const raw = this.options.storage.getItem(key);
          const draft = raw ? parseDraft(raw, this.base.id) : null;
          if (draft && hasUpdates(draft.updates)) localDrafts.push({ key,
            title: draft.updates.title ?? draft.baseFields.title,
            content: draft.updates.content ?? draft.baseFields.content, savedAt: draft.savedAt ?? 0 });
        } catch { /* A corrupt old record must not prevent access to other drafts. */ }
      }
      this.publish({ localDrafts: localDrafts.sort((a, b) => b.savedAt - a.savedAt) });
    } catch {
      this.publish({ storageError: "This device could not load its saved drafts. Keep this tab open until changes are saved." });
    }
  }

  recoverDraft = (key: string) => {
    if (this.sending || hasUpdates(this.pending) || !this.snapshot.localDrafts.some((draft) => draft.key === key)) return;
    try {
      const raw = this.options.storage.getItem(key);
      const draft = raw ? parseDraft(raw, this.base.id) : null;
      if (!draft || !raw) return;
      const latest = this.base;
      this.base = { ...latest, ...draft.baseFields, revision: draft.baseRevision };
      this.pending = draft.updates;
      this.flight = draft.flight;
      this.recoveredFrom = { key, raw };
      this.persist();
      this.publish({ status: "saving", error: null, conflict: null });
      this.observe(latest);
      this.refreshLocalDrafts();
      if (!this.snapshot.conflict) this.schedule(0);
    } catch {
      this.publish({ storageError: "This device could not load that draft. Its stored copy has been kept." });
    }
  };

  discardLocalDraft = (key: string) => {
    if (!this.snapshot.localDrafts.some((draft) => draft.key === key)) return;
    try { this.options.storage.removeItem(key); this.refreshLocalDrafts(); }
    catch { this.publish({ storageError: "This device could not remove that local draft." }); }
  };

  observe(note: Note) {
    if (note.id !== this.base.id) return;
    if (this.snapshot.conflict && this.snapshot.conflict.revision >= note.revision &&
      this.snapshot.conflict.deleted_at === note.deleted_at) return;
    if (!editable(note)) {
      if (hasUpdates(this.pending)) this.conflict(note);
      else { this.base = note; this.publish({}); }
      return;
    }
    if (note.revision < this.base.revision) return;
    if (!hasUpdates(this.pending) && !this.sending) {
      this.base = note;
      this.publish({ status: "saved", conflict: null, error: null });
      return;
    }
    if (note.revision === this.base.revision) return;
    if (this.isAcknowledgement(note)) this.acknowledge(note);
    else this.conflict(note);
  }

  update(updates: NoteUpdates) {
    if (!editable(this.snapshot.note) || !validUpdates(updates)) return;
    this.pending = { ...this.pending, ...updates };
    this.persist();
    this.publish({ error: this.snapshot.conflict ? this.snapshot.error : null,
      status: this.snapshot.conflict ? "conflict" : this.online() ? "saving" : "offline" });
    if (!this.snapshot.conflict) this.schedule(this.snapshot.storageError ? 0 : this.options.debounceMs ?? 500);
  }

  retry = () => {
    this.failures = 0;
    if (!this.snapshot.conflict) void this.flush();
  };

  /** The persisted record survives a closed tab; in-memory requests survive navigation. */
  flush = async (keepalive = false): Promise<void> => {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.enabled || this.sending || !hasUpdates(this.pending) || this.snapshot.conflict || !editable(this.base)) return;
    if (!this.online()) {
      this.publish({ status: "offline", error: "Changes will save when you are back online." });
      return;
    }
    this.flight ??= { revision: this.base.revision, updates: { ...this.pending } };
    const flight = this.flight;
    this.persist();
    this.sending = true;
    this.publish({ status: "saving", error: null });
    let continueSaving = false;
    try {
      const body = JSON.stringify(flight);
      const response = await this.options.fetcher(`/api/notes/${this.base.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body,
        // Browsers cap keepalive payloads. Larger drafts remain in the durable outbox.
        keepalive: keepalive && new TextEncoder().encode(body).byteLength < 60_000,
      });
      if (response.status === 409) {
        const result = await response.json() as { note?: Note };
        if (result.note && this.isAcknowledgement(result.note)) {
          this.acknowledge(result.note);
          continueSaving = true;
        } else if (result.note) this.conflict(result.note);
        else this.publish({ status: "error", error: "The note changed. Reload it before retrying; your draft is kept on this device." });
      } else if (!response.ok) {
        if (response.status === 401) {
          this.pause();
          this.options.onUnauthorized?.();
        }
        if ([400, 413, 422].includes(response.status)) {
          // A rejected payload did not commit. A corrected edit can replace it.
          this.flight = null;
          this.persist();
        }
        this.failed(response.status >= 500, response.status === 401
          ? "Your session expired. Copy any unsaved text, then reload to check access. Your draft is kept on this device."
          : "Couldn't save. Your changes are still in this draft.");
      } else {
        const note = await response.json() as Note;
        if (note.id !== this.base.id || !Number.isInteger(note.revision) || !editable(note)) {
          this.publish({ status: "error", error: "The server returned an unexpected response. Your draft has been kept." });
        } else if (note.revision < this.base.revision) {
          // A response can arrive after the user explicitly kept a newer saved version.
        } else if (this.getSnapshot().conflict && this.getSnapshot().conflict!.revision > note.revision) {
          // A newer deletion or remote edit observed while this response was in transit wins.
          this.conflict(this.getSnapshot().conflict!);
        } else {
          this.acknowledge(note);
          continueSaving = true;
        }
      }
    } catch {
      this.failed(true, this.online() ? "Couldn't save. Your changes are still in this draft." : "Changes will save when you are back online.");
    } finally {
      this.sending = false;
      if (continueSaving && hasUpdates(this.pending) && !this.snapshot.conflict) this.schedule(0);
    }
  };

  useSavedVersion = () => {
    if (!this.snapshot.conflict) return;
    this.base = this.snapshot.conflict;
    this.pending = {};
    this.flight = null;
    this.persist();
    this.removeRecoveredCopy();
    this.publish({ status: "saved", error: null, conflict: null });
  };

  keepMyChanges = () => {
    const latest = this.snapshot.conflict;
    if (!latest || !editable(latest)) return;
    this.base = latest;
    this.flight = null;
    this.persist();
    this.publish({ status: "saving", error: null, conflict: null });
    this.schedule(0);
  };

  private online() { return this.options.isOnline?.() !== false; }

  private schedule(delay: number) {
    if (!this.enabled) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, delay);
  }

  private isAcknowledgement(note: Note) {
    return !!this.flight && editable(note) && note.revision === this.flight.revision + 1 &&
      sameFields(note, { ...fields(this.base), ...this.flight.updates });
  }

  private acknowledge(note: Note) {
    this.base = note;
    this.flight = null;
    for (const key of Object.keys(this.pending) as (keyof NoteUpdates)[]) {
      if (this.pending[key] === note[key]) delete this.pending[key];
    }
    this.failures = 0;
    this.persist();
    if (!hasUpdates(this.pending)) this.removeRecoveredCopy();
    this.publish({ status: hasUpdates(this.pending) ? "saving" : "saved", error: null, conflict: null });
    this.options.onSaved?.(note);
  }

  private conflict(note: Note) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.publish({ status: "conflict", conflict: note, error: note.deleted_at
      ? "This note was moved to Recently Deleted. Your unsaved draft is kept on this device."
      : "This note changed in another editor. Choose which version to keep; your draft is kept on this device." });
    this.options.onSaved?.(note);
  }

  private failed(retry: boolean, error: string) {
    this.publish({ status: this.online() ? "error" : "offline", error });
    if (retry && this.online()) this.schedule(Math.min((this.options.retryMs ?? 2_000) * 2 ** this.failures++, 30_000));
  }

  private persist() {
    try {
      if (!hasUpdates(this.pending)) this.options.storage.removeItem(this.storageKey);
      else {
        const record: DraftRecord = { version: 1, noteId: this.base.id, baseRevision: this.base.revision,
          baseFields: fields(this.base), updates: this.pending, flight: this.flight, savedAt: Date.now() };
        this.options.storage.setItem(this.storageKey, JSON.stringify(record));
      }
      this.publish({ storageError: null });
    } catch {
      this.publish({ storageError: "This device could not keep a local draft. Keep this tab open until Saved appears." });
    }
  }

  private removeRecoveredCopy() {
    if (!this.recoveredFrom) return;
    try {
      // Another open tab may still own this record. Never delete a newer edit from it.
      if (this.options.storage.getItem(this.recoveredFrom.key) === this.recoveredFrom.raw)
        this.options.storage.removeItem(this.recoveredFrom.key);
      this.recoveredFrom = null;
      this.refreshLocalDrafts();
    } catch { /* The acknowledged copy may remain available for recovery. */ }
  }

  private publish(changes: Partial<SaveSnapshot>) {
    const source = "conflict" in changes ? changes.conflict ?? this.base : this.snapshot.conflict ?? this.base;
    this.snapshot = { ...this.snapshot, ...changes, hasPending: hasUpdates(this.pending),
      note: { ...source, ...this.pending } };
    this.listeners.forEach((listener) => listener());
  }
}

export class AutosaveManager {
  private entries = new Map<string, NoteAutosave>();
  constructor(private options: AutosaveOptions) {}
  setOnSaved(callback: (note: Note) => void) { this.options.onSaved = callback; }
  setOnUnauthorized(callback: () => void) {
    this.options.onUnauthorized = () => {
      this.entries.forEach((entry) => entry.pause());
      callback();
    };
  }
  open(note: Note) {
    let entry = this.entries.get(note.id);
    if (!entry) { entry = new NoteAutosave(note, this.options); this.entries.set(note.id, entry); }
    else entry.observe(note);
    return entry;
  }
  flushAll(keepalive = false) { this.entries.forEach((entry) => { void entry.flush(keepalive); }); }
  retryAll() { this.entries.forEach((entry) => entry.retry()); }
  refreshLocalDrafts() { this.entries.forEach((entry) => entry.refreshLocalDrafts()); }
  hasUnprotectedDraft() { return Array.from(this.entries.values()).some((entry) => entry.getSnapshot().hasPending && !!entry.getSnapshot().storageError); }
}

let browserManager: AutosaveManager | undefined;
export function getAutosaveManager() {
  if (!browserManager) {
    const storage: DraftStorage = {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
      removeItem: (key) => window.localStorage.removeItem(key),
      keys: () => Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).filter((key): key is string => key !== null),
    };
    browserManager = new AutosaveManager({ storage, fetcher: (...args) => fetch(...args), isOnline: () => navigator.onLine, writerId: crypto.randomUUID() });
    window.addEventListener("online", () => browserManager?.retryAll());
    window.addEventListener("storage", (event) => { if (event.key?.startsWith(DRAFT_PREFIX)) browserManager?.refreshLocalDrafts(); });
    window.addEventListener("pagehide", () => browserManager?.flushAll(true));
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") browserManager?.flushAll(true); });
    window.addEventListener("beforeunload", (event) => {
      if (browserManager?.hasUnprotectedDraft()) { event.preventDefault(); event.returnValue = ""; }
    });
  }
  return browserManager;
}
