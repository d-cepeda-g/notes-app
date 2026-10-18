"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionNotes } from "@/app/notes/session-notes";
import { getAutosaveManager, type NoteAutosave, type SaveSnapshot } from "./note-autosave";
import type { Note, NoteUpdates } from "./types";

export function useNoteAutosave(note: Note) {
  const { ready, notes, deletedNotes, upsertNote, expireSession } = useSessionNotes();
  const entryRef = useRef<NoteAutosave | null>(null);
  const serverNoteRef = useRef(note);
  serverNoteRef.current = note;
  const [snapshot, setSnapshot] = useState<SaveSnapshot>({
    note, status: "saved", hasPending: false, error: null, storageError: null, conflict: null, localDrafts: [],
  });

  useEffect(() => {
    const serverNote = serverNoteRef.current;
    if (!serverNote.can_edit) { setSnapshot({ note: serverNote, status: "saved", hasPending: false, error: null, storageError: null, conflict: null, localDrafts: [] }); return; }
    const manager = getAutosaveManager();
    manager.setOnSaved(upsertNote);
    manager.setOnUnauthorized(expireSession);
    const entry = manager.open(serverNote);
    entryRef.current = entry;
    const update = () => setSnapshot(entry.getSnapshot());
    update();
    const unsubscribe = entry.subscribe(update);
    return () => {
      unsubscribe();
      // Flush pending debounce work, while leaving this note's queue alive.
      void entry.flush();
      entryRef.current = null;
    };
  }, [note.id, note.can_edit, upsertNote, expireSession]);

  useEffect(() => { entryRef.current?.observe(note); }, [note]);
  useEffect(() => {
    const latest = [...notes, ...deletedNotes].find((item) => item.id === note.id);
    if (latest) entryRef.current?.observe(latest);
  }, [notes, deletedNotes, note.id]);
  useEffect(() => {
    if (ready) entryRef.current?.start();
    else entryRef.current?.pause();
  }, [ready, note.id, note.can_edit]);

  const saveNote = useCallback((updates: NoteUpdates) => entryRef.current?.update(updates), []);
  const retry = useCallback(() => entryRef.current?.retry(), []);
  const useSavedVersion = useCallback(() => entryRef.current?.useSavedVersion(), []);
  const keepMyChanges = useCallback(() => entryRef.current?.keepMyChanges(), []);
  const recoverDraft = useCallback((key: string) => entryRef.current?.recoverDraft(key), []);
  const discardLocalDraft = useCallback((key: string) => entryRef.current?.discardLocalDraft(key), []);
  return { ...snapshot, note: note.can_edit ? snapshot.note : note,
    saveNote, retry, useSavedVersion, keepMyChanges, recoverDraft, discardLocalDraft };
}
