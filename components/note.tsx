"use client";

import { useRouter } from "next/navigation";
import NoteHeader from "./note-header";
import NoteContent from "./note-content";
import SessionId from "./session-id";
import { useState, useCallback, useRef, useContext } from "react";
import { SessionNotesContext } from "@/app/notes/session-notes";

export default function Note({ note: initialNote }: { note: any }) {
  const router = useRouter();
  const [note, setNote] = useState(initialNote);
  const [sessionId, setSessionId] = useState("");
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingUpdatesRef = useRef<Partial<typeof note>>({});
  const noteRef = useRef(initialNote);

  const { refreshSessionNotes } = useContext(SessionNotesContext);

  const saveNote = useCallback(
    async (updates: Partial<typeof note>) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      setNote((prevNote: typeof note) => {
        const updatedNote = { ...prevNote, ...updates };
        noteRef.current = updatedNote;
        return updatedNote;
      });

      pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates };

      saveTimeoutRef.current = setTimeout(async () => {
        try {
          if (noteRef.current.id && sessionId && Object.keys(pendingUpdatesRef.current).length > 0) {
            const updatesToSave = pendingUpdatesRef.current;
            const currentNote = noteRef.current;

            pendingUpdatesRef.current = {};

            const promises = [];

            if ('title' in updatesToSave) {
              promises.push(
                fetch(`/api/notes/${currentNote.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    session_id: sessionId,
                    field: "title",
                    value: updatesToSave.title,
                  }),
                })
              );
            }
            if ('emoji' in updatesToSave) {
              promises.push(
                fetch(`/api/notes/${currentNote.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    session_id: sessionId,
                    field: "emoji",
                    value: updatesToSave.emoji,
                  }),
                })
              );
            }
            if ('content' in updatesToSave) {
              promises.push(
                fetch(`/api/notes/${currentNote.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    session_id: sessionId,
                    field: "content",
                    value: updatesToSave.content,
                  }),
                })
              );
            }

            await Promise.all(promises);

            await fetch("/notes/revalidate", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-revalidate-token": process.env.NEXT_PUBLIC_REVALIDATE_TOKEN || '',
              },
              body: JSON.stringify({ slug: currentNote.slug }),
            });
            refreshSessionNotes();
            router.refresh();
          }
        } catch (error) {
          console.error("Save failed:", error);
        }
      }, 500);
    },
    [router, refreshSessionNotes, sessionId]
  );

  const canEdit = sessionId === note.session_id;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <SessionId setSessionId={setSessionId} />
      <NoteHeader note={note} saveNote={saveNote} canEdit={canEdit} />
      <NoteContent note={note} saveNote={saveNote} canEdit={canEdit} />
    </div>
  );
}
