"use client";

import React, { useState } from "react";
import NoteHeader from "./note-header";
import NoteContent from "./note-content";
import type { Note as NoteData } from "@/lib/types";
import { useNoteAutosave } from "@/lib/use-note-autosave";
import { useSessionNotes } from "@/app/notes/session-notes";

export default function Note({ note, shareToken }: { note: NoteData; shareToken?: string }) {
  return <NoteEditor key={note.id} initialNote={note} shareToken={shareToken} />;
}

function NoteEditor({ initialNote, shareToken }: { initialNote: NoteData; shareToken?: string }) {
  const save = useNoteAutosave(initialNote);
  const { ready, expireSession } = useSessionNotes();
  const { note } = save;
  const canEdit = note.can_edit && !note.public && !note.deleted_at;
  const [shareUrl, setShareUrl] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState("");

  async function changeShare(method: "POST" | "DELETE") {
    if (!ready || !canEdit) return;
    setShareBusy(true);
    setShareMessage("");
    try {
      const response = await fetch(`/api/notes/${note.id}/share`, { method });
      if (response.status === 401) expireSession();
      if (!response.ok) throw new Error("Sharing request failed");
      if (method === "POST") {
        const result = await response.json() as { url: string };
        if (!result.url) throw new Error("Missing share link");
        setShareUrl(result.url);
        setShareMessage("Anyone with this link can read this note and its images.");
      } else {
        setShareUrl("");
        setShareMessage("Shared access revoked. Previous links no longer open this note.");
      }
    } catch {
      setShareMessage(method === "POST" ? "Couldn't create a share link. Try again." : "Couldn't revoke the link. Try again.");
    } finally { setShareBusy(false); }
  }

  async function copyText(text: string, message: string) {
    try { await navigator.clipboard.writeText(text); setShareMessage(message); }
    catch { setShareMessage("Couldn't copy automatically. Select the text to copy it."); }
  }

  const status = save.status === "saved" ? "Saved" : save.status === "saving" ? "Saving…"
    : save.status === "offline" ? "Offline" : "Couldn't save";

  return (
    <div className="h-full overflow-y-auto bg-background">
      <NoteHeader note={note} saveNote={save.saveNote} canEdit={canEdit} />
      {note.deleted_at && (
        <p className="px-4 md:px-2 mb-3 text-sm text-muted-foreground" role="status">This note is in Recently Deleted and cannot be edited.</p>
      )}
      {(initialNote.can_edit && !initialNote.public) && (
        <div className="px-4 md:px-2 mb-3 text-xs text-muted-foreground space-y-2">
          <div className="flex flex-wrap items-center gap-3" role="status" aria-live="polite" aria-atomic="true">
            <span>{status}</span>
            {(save.status === "error" || save.status === "offline") && (
              <button type="button" className="underline" onClick={save.retry}>Retry save</button>
            )}
          </div>
          {save.error && <p>{save.error}</p>}
          {save.error?.startsWith("Your session expired.") && (
            <button type="button" className="underline" onClick={() => window.location.reload()}>Reload to check access</button>
          )}
          {save.hasPending && !save.conflict && (save.status === "error" || save.status === "offline") && (
            <button type="button" className="underline" onClick={() => copyText(`${note.title}\n\n${note.content}`, "Unsaved text copied.")}>Copy my unsaved text</button>
          )}
          {save.storageError && <p role="alert">{save.storageError}</p>}
          {save.localDrafts.length > 0 && (
            <div className="space-y-2">
              <p>Unsaved drafts are kept on this device. They may belong to another open tab.</p>
              {save.localDrafts.map((draft, index) => (
                <div key={draft.key} className="space-y-1">
                  <p className="truncate">Draft {index + 1}: {draft.title || "Untitled note"} · {draft.content.slice(0, 80)}</p>
                  <div className="flex gap-3">
                    <button type="button" className="underline disabled:opacity-50" disabled={save.hasPending} onClick={() => save.recoverDraft(draft.key)}>Recover draft {index + 1}</button>
                    <button type="button" className="underline" onClick={() => save.discardLocalDraft(draft.key)}>Discard draft {index + 1}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {save.conflict && (
            <div className="flex flex-wrap gap-3">
              <button type="button" className="underline" onClick={save.useSavedVersion}>Use saved version</button>
              {!save.conflict.deleted_at && save.conflict.can_edit && !save.conflict.public && (
                <button type="button" className="underline" onClick={save.keepMyChanges}>Replace saved version with my changes</button>
              )}
              <button type="button" className="underline" onClick={() => copyText(`${note.title}\n\n${note.content}`, "Unsaved text copied.")}>Copy my unsaved text</button>
            </div>
          )}
          {canEdit && (
            <div className="flex flex-wrap gap-3">
              <button type="button" className="underline disabled:opacity-50" disabled={shareBusy || !ready} onClick={() => changeShare("POST")}>{shareBusy ? "Updating link…" : "Create share link"}</button>
              <button type="button" className="underline disabled:opacity-50" disabled={shareBusy || !ready} onClick={() => changeShare("DELETE")}>Revoke shared access</button>
            </div>
          )}
          {shareUrl && (
            <div className="flex items-center gap-2">
              <input className="min-w-0 flex-1 bg-transparent border border-muted-foreground/30 rounded px-2 py-1" aria-label="Read-only share link" value={shareUrl} readOnly onFocus={(event) => event.target.select()} />
              <button type="button" className="underline" onClick={() => copyText(shareUrl, "Share link copied.")}>Copy link</button>
            </div>
          )}
          {shareMessage && <p role="status">{shareMessage}</p>}
        </div>
      )}
      <NoteContent note={note} saveNote={save.saveNote} canEdit={canEdit} shareToken={shareToken} />
    </div>
  );
}
