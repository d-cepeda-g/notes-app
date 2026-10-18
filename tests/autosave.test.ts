import test from "node:test";
import assert from "node:assert/strict";
import { AutosaveManager, DRAFT_PREFIX, NoteAutosave } from "../lib/note-autosave";
import type { Note } from "../lib/types";

const original: Note = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", slug: "test-note", title: "Title", content: "Original",
  created_at: "2020-01-01T10:00:00.000Z", updated_at: "2020-01-01T10:00:00.000Z",
  deleted_at: null, revision: 1, public: false, can_edit: true, emoji: "📝",
};
const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, keys: () => Array.from(values.keys()) };
};
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const fetcher = (fn: (init: RequestInit) => Promise<Response>) => ((_url: unknown, init: RequestInit = {}) => fn(init)) as typeof fetch;
const key = (writer = "test") => `${DRAFT_PREFIX}${original.id}:${writer}`;
function setup(fn: (init: RequestInit) => Promise<Response>, storage = memory()) {
  const queue = new NoteAutosave(original, { storage, fetcher: fetcher(fn), debounceMs: 60_000, retryMs: 60_000, writerId: "test" });
  queue.start();
  return { queue, storage };
}

test("HTTP 500 keeps the durable draft and retry payload until acknowledged", async () => {
  let fail = true;
  const { queue, storage } = setup(async (init) => fail ? response({ error: "Unavailable" }, 500)
    : response({ ...original, ...JSON.parse(String(init.body)).updates, revision: 2 }));
  queue.update({ content: "Unsaved text" });
  await queue.flush();
  assert.equal(queue.getSnapshot().status, "error");
  assert.equal(JSON.parse(storage.getItem(key())!).updates.content, "Unsaved text");
  fail = false;
  await queue.flush();
  assert.equal(queue.getSnapshot().status, "saved");
  assert.equal(storage.getItem(key()), null);
});

test("only one request is in flight; subsequent edits use the acknowledged revision", async () => {
  const requests: { init: RequestInit; resolve: (value: Response) => void }[] = [];
  const { queue } = setup((init) => new Promise((resolve) => requests.push({ init, resolve })));
  queue.update({ content: "First edit" });
  const first = queue.flush();
  queue.update({ content: "Latest edit", title: "Latest title" });
  await queue.flush();
  assert.equal(requests.length, 1);
  requests[0].resolve(response({ ...original, content: "First edit", revision: 2 }));
  await first;
  const second = queue.flush();
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(String(requests[1].init.body)), { revision: 2, updates: { content: "Latest edit", title: "Latest title" } });
  requests[1].resolve(response({ ...original, content: "Latest edit", title: "Latest title", revision: 3 }));
  await second;
  assert.equal(queue.getSnapshot().note.content, "Latest edit");
  assert.equal(queue.getSnapshot().status, "saved");
});

test("a lost success response is recognized on retry without overwriting newer edits", async () => {
  let attempt = 0;
  const firstSaved = { ...original, content: "First edit", revision: 2 };
  const { queue } = setup(async (init) => {
    attempt++;
    if (attempt === 1) throw new Error("Connection closed after server commit");
    if (attempt === 2) return response({ error: "Conflict", note: firstSaved }, 409);
    assert.equal(JSON.parse(String(init.body)).revision, 2);
    return response({ ...firstSaved, content: "Latest edit", revision: 3 });
  });
  queue.update({ content: "First edit" });
  await queue.flush();
  queue.update({ content: "Latest edit" });
  await queue.flush();
  assert.equal(queue.getSnapshot().status, "saving");
  await queue.flush();
  assert.equal(queue.getSnapshot().status, "saved");
  assert.equal(queue.getSnapshot().note.content, "Latest edit");
});

test("409 preserves local work and never silently rebases a remote edit", async () => {
  let calls = 0;
  const remote = { ...original, content: "Remote edit", revision: 2 };
  const { queue, storage } = setup(async () => { calls++; return response({ error: "Conflict", note: remote }, 409); });
  queue.update({ content: "Local edit" });
  await queue.flush();
  await queue.flush();
  assert.equal(calls, 1);
  assert.equal(queue.getSnapshot().status, "conflict");
  assert.equal(queue.getSnapshot().note.content, "Local edit");
  assert.equal(queue.getSnapshot().conflict?.content, "Remote edit");
  assert.equal(JSON.parse(storage.getItem(key())!).updates.content, "Local edit");
  queue.useSavedVersion();
  assert.equal(queue.getSnapshot().note.content, "Remote edit");
  assert.equal(queue.getSnapshot().hasPending, false);
  assert.equal(storage.getItem(key()), null);
});

test("explicitly keeping local changes sends the latest revision", async () => {
  let calls = 0;
  const { queue } = setup(async (init) => {
    calls++;
    if (calls === 1) return response({ note: { ...original, content: "Remote edit", revision: 2 } }, 409);
    assert.deepEqual(JSON.parse(String(init.body)), { revision: 2, updates: { content: "Local edit" } });
    return response({ ...original, content: "Local edit", revision: 3 });
  });
  queue.update({ content: "Local edit" });
  await queue.flush();
  queue.keepMyChanges();
  await queue.flush();
  assert.equal(queue.getSnapshot().status, "saved");
  assert.equal(calls, 2);
});

test("deleted conflict retains a local draft but cannot overwrite or recreate the note", async () => {
  let calls = 0;
  const deleted = { ...original, revision: 2, deleted_at: "2026-10-18T09:00:00.000Z" };
  const { queue } = setup(async () => { calls++; return response({ note: deleted }, 409); });
  queue.update({ content: "Local edit" });
  await queue.flush();
  queue.keepMyChanges();
  queue.update({ content: "Must not be accepted" });
  await queue.flush();
  assert.equal(calls, 1);
  assert.equal(queue.getSnapshot().note.content, "Local edit");
  assert.equal(queue.getSnapshot().note.deleted_at, deleted.deleted_at);
});

test("a stale in-flight response cannot undo an explicit choice of a newer saved version", async () => {
  let resolve!: (response: Response) => void;
  const { queue } = setup(() => new Promise((done) => { resolve = done; }));
  queue.update({ content: "Local edit" });
  const saving = queue.flush();
  const remote = { ...original, content: "Newer remote edit", revision: 3 };
  queue.observe(remote);
  queue.useSavedVersion();
  resolve(response({ ...original, content: "Local edit", revision: 2 }));
  await saving;
  assert.equal(queue.getSnapshot().note.content, "Newer remote edit");
  assert.equal(queue.getSnapshot().note.revision, 3);
  assert.equal(queue.getSnapshot().status, "saved");
});

test("a deletion observed during a save wins over its older response", async () => {
  let resolve!: (response: Response) => void;
  const { queue } = setup(() => new Promise((done) => { resolve = done; }));
  queue.update({ content: "Local edit" });
  const saving = queue.flush();
  queue.observe({ ...original, revision: 3, deleted_at: "2026-10-18T09:00:00Z" });
  resolve(response({ ...original, content: "Local edit", revision: 2 }));
  await saving;
  assert.equal(queue.getSnapshot().status, "conflict");
  assert.equal(queue.getSnapshot().note.revision, 3);
  assert.ok(queue.getSnapshot().note.deleted_at);
  assert.equal(queue.getSnapshot().note.content, "Local edit");
});

test("offline editing is persisted synchronously and saved when connectivity returns", async () => {
  let online = false, calls = 0;
  const storage = memory();
  const queue = new NoteAutosave(original, { storage, writerId: "test", isOnline: () => online,
    fetcher: fetcher(async () => { calls++; return response({ ...original, content: "Offline edit", revision: 2 }); }) });
  queue.start();
  queue.update({ content: "Offline edit" });
  assert.equal(JSON.parse(storage.getItem(key())!).updates.content, "Offline edit");
  await queue.flush();
  assert.equal(queue.getSnapshot().status, "offline");
  assert.equal(calls, 0);
  online = true;
  await queue.flush();
  assert.equal(queue.getSnapshot().status, "saved");
  assert.equal(calls, 1);
});

test("navigation unsubscribe does not destroy a note queue or its pending save", async () => {
  const manager = new AutosaveManager({ storage: memory(), writerId: "test", debounceMs: 60_000,
    fetcher: fetcher(async () => response({ ...original, content: "Before navigation", revision: 2 })) });
  const queue = manager.open(original);
  queue.start();
  const unsubscribe = queue.subscribe(() => {});
  queue.update({ content: "Before navigation" });
  unsubscribe();
  const other = { ...original, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", slug: "another-note" };
  manager.open(other).start();
  await queue.flush();
  assert.equal(manager.open({ ...original, content: "Before navigation", revision: 2 }), queue);
  assert.equal(queue.getSnapshot().status, "saved");
});

test("a closed tab's draft can be recovered without an automatic overwrite", async () => {
  const storage = memory();
  const first = new NoteAutosave(original, { storage, writerId: "closed-tab", isOnline: () => false, fetcher: fetcher(async () => { throw new Error("Offline"); }) });
  first.start(); first.update({ content: "Recovered edit" }); await first.flush();
  let calls = 0;
  const reopened = new NoteAutosave(original, { storage, writerId: "new-tab",
    fetcher: fetcher(async () => { calls++; return response({ ...original, content: "Recovered edit", revision: 2 }); }) });
  reopened.start();
  assert.equal(reopened.getSnapshot().localDrafts.length, 1);
  assert.equal(reopened.getSnapshot().note.content, "Original");
  assert.equal(calls, 0);
  reopened.recoverDraft(reopened.getSnapshot().localDrafts[0].key);
  assert.equal(reopened.getSnapshot().note.content, "Recovered edit");
  await reopened.flush();
  assert.equal(reopened.getSnapshot().status, "saved");
  assert.equal(storage.keys().length, 0);
});

test("separate tabs keep separate durable copies when one save conflicts", async () => {
  const storage = memory();
  const a = new NoteAutosave(original, { storage, writerId: "a", isOnline: () => false, fetcher: fetcher(async () => response({})) });
  const b = new NoteAutosave(original, { storage, writerId: "b", fetcher: fetcher(async () => response({ ...original, content: "Tab B", revision: 2 })) });
  a.start(); b.start();
  a.update({ content: "Tab A" }); b.update({ content: "Tab B" });
  await a.flush(); await b.flush();
  assert.equal(JSON.parse(storage.getItem(key("a"))!).updates.content, "Tab A");
  assert.equal(storage.getItem(key("b")), null);
  a.observe({ ...original, content: "Tab B", revision: 2 });
  assert.equal(a.getSnapshot().status, "conflict");
  assert.equal(JSON.parse(storage.getItem(key("a"))!).updates.content, "Tab A");
});

test("multiple earlier drafts remain independently recoverable", async () => {
  const storage = memory();
  for (const writerId of ["a", "b"]) {
    const queue = new NoteAutosave(original, { storage, writerId, isOnline: () => false, fetcher: fetcher(async () => response({})) });
    queue.start(); queue.update({ content: `Draft ${writerId}` }); await queue.flush();
  }
  const recovered = new NoteAutosave(original, { storage, writerId: "new", fetcher: fetcher(async () => response({ ...original, content: "Draft a", revision: 2 })) });
  recovered.start();
  assert.equal(recovered.getSnapshot().localDrafts.length, 2);
  recovered.recoverDraft(key("a"));
  await recovered.flush();
  assert.equal(storage.getItem(key("a")), null);
  assert.equal(JSON.parse(storage.getItem(key("b"))!).updates.content, "Draft b");
});

test("recovering a draft after another editor changed the note pauses for a conflict choice", async () => {
  const storage = memory();
  const earlier = new NoteAutosave(original, { storage, writerId: "earlier", isOnline: () => false, fetcher: fetcher(async () => response({})) });
  earlier.start(); earlier.update({ content: "Local draft" }); await earlier.flush();
  let calls = 0;
  const newer = { ...original, content: "Remote draft", revision: 2 };
  const recovered = new NoteAutosave(newer, { storage, writerId: "new", fetcher: fetcher(async () => { calls++; return response({}); }) });
  recovered.start(); recovered.recoverDraft(key("earlier")); await recovered.flush();
  assert.equal(calls, 0);
  assert.equal(recovered.getSnapshot().status, "conflict");
  assert.equal(recovered.getSnapshot().note.content, "Local draft");
});

test("storage quota failure is visible while in-memory work can still save", async () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); }, removeItem: () => {} };
  const queue = new NoteAutosave(original, { storage, writerId: "test", fetcher: fetcher(async () => response({ ...original, content: "In memory", revision: 2 })) });
  queue.start(); queue.update({ content: "In memory" });
  assert.match(queue.getSnapshot().storageError!, /Keep this tab open/);
  await queue.flush();
  assert.equal(queue.getSnapshot().status, "saved");
  assert.equal(queue.getSnapshot().storageError, null);
});

test("public, shared read-only, and trashed notes cannot initiate a save", async () => {
  let calls = 0;
  for (const note of [{ ...original, public: true }, { ...original, can_edit: false }, { ...original, deleted_at: "2026-10-18T09:00:00Z" }]) {
    const queue = new NoteAutosave(note, { storage: memory(), fetcher: fetcher(async () => { calls++; return response({}); }) });
    queue.start(); queue.update({ content: "Forbidden" }); await queue.flush();
    assert.equal(queue.getSnapshot().note.content, "Original");
  }
  assert.equal(calls, 0);
});

test("401 expires the shared client session and preserves drafts without retrying", async () => {
  let expired = 0, calls = 0;
  const storage = memory();
  const manager = new AutosaveManager({ storage, writerId: "test", fetcher: fetcher(async () => {
    calls++; return response({ error: "Unauthorized" }, 401);
  }) });
  manager.setOnUnauthorized(() => { expired++; });
  const queue = manager.open(original);
  queue.start(); queue.update({ content: "Protected draft" }); await queue.flush();
  manager.retryAll(); await queue.flush();
  assert.equal(calls, 1);
  assert.equal(expired, 1);
  assert.match(queue.getSnapshot().error!, /session expired/);
  assert.equal(JSON.parse(storage.getItem(key())!).updates.content, "Protected draft");
});

test("a rejected oversized payload can be corrected before retry", async () => {
  let calls = 0;
  const { queue } = setup(async (init) => {
    calls++;
    if (calls === 1) return response({ error: "Too large" }, 413);
    assert.equal(JSON.parse(String(init.body)).updates.content, "Smaller edit");
    return response({ ...original, content: "Smaller edit", revision: 2 });
  });
  queue.update({ content: "Oversized edit" }); await queue.flush();
  queue.update({ content: "Smaller edit" }); await queue.flush();
  assert.equal(queue.getSnapshot().status, "saved");
});

test("pausing an expired or unavailable session retains work until a safe restart", async () => {
  let calls = 0;
  const { queue, storage } = setup(async () => { calls++; return response({ ...original, content: "Wait for session", revision: 2 }); });
  queue.update({ content: "Wait for session" }); queue.pause(); await queue.flush();
  assert.equal(calls, 0);
  assert.ok(storage.getItem(key()));
  queue.start(); await queue.flush();
  assert.equal(calls, 1);
  assert.equal(queue.getSnapshot().status, "saved");
});
