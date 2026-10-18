"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Note } from "@/lib/types";
import { SESSION_EXPIRED_MESSAGE, SessionExpiredError } from "@/lib/create-note";

export interface SessionNotes {
  ready: boolean;
  error: string | null;
  notes: Note[];
  deletedNotes: Note[];
  refreshSessionNotes: () => Promise<void>;
  upsertNote: (note: Note) => void;
  removeNote: (id: string) => void;
  expireSession: () => void;
}

export const SessionNotesContext = createContext<SessionNotes>({
  ready: false, error: null, notes: [], deletedNotes: [],
  refreshSessionNotes: async () => {}, upsertNote: () => {}, removeNote: () => {}, expireSession: () => {},
});

export function SessionNotesProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allNotes, setAllNotes] = useState<Record<string, Note>>({});
  const sessionRequest = useRef<Promise<void> | null>(null);
  const initialization = useRef<Promise<void> | null>(null);
  const mutationSequence = useRef(0);
  const refreshSequence = useRef(0);
  const expireSession = useCallback(() => {
    refreshSequence.current += 1;
    setReady(false);
    setError(SESSION_EXPIRED_MESSAGE);
  }, []);

  const ensureSession = useCallback(() => {
    if (!sessionRequest.current) {
      sessionRequest.current = fetch("/api/session", {
        method: "POST", credentials: "same-origin", cache: "no-store",
      }).then((response) => {
        if (!response.ok) throw new Error("Could not open your notes. Please try again.");
      }).catch((failure) => {
        sessionRequest.current = null;
        throw failure;
      });
    }
    return sessionRequest.current;
  }, []);

  const refreshSessionNotes = useCallback(async () => {
    const request = ++refreshSequence.current;
    try {
      await ensureSession();
      const startedAt = mutationSequence.current;
      const responses = await Promise.all([
        fetch("/api/notes", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/notes?deleted=true", { credentials: "same-origin", cache: "no-store" }),
      ]);
      if (responses.some((response) => response.status === 401)) throw new SessionExpiredError();
      if (responses.some((response) => !response.ok)) {
        throw new Error("Could not load your notes. Please try again.");
      }
      const [active, deleted] = await Promise.all(responses.map((response) => response.json()));
      if (!Array.isArray(active) || !Array.isArray(deleted)) {
        throw new Error("Could not load your notes. Please try again.");
      }
      if (request !== refreshSequence.current) return;
      const incoming: Record<string, Note> = Object.fromEntries(
        [...active, ...deleted].map((note: Note) => [note.id, note])
      );
      setAllNotes((current) => {
        if (request !== refreshSequence.current) return current;
        // List requests must not overwrite a save, creation, or deletion made while in flight.
        const next = startedAt === mutationSequence.current ? { ...incoming } : { ...current, ...incoming };
        for (const note of Object.values(current)) {
          if (next[note.id] && note.revision > next[note.id].revision) next[note.id] = note;
        }
        return next;
      });
      setError(null);
      setReady(true);
    } catch (failure) {
      if (request === refreshSequence.current) {
        if (failure instanceof SessionExpiredError) expireSession();
        else setError(failure instanceof Error ? failure.message : "Could not load your notes. Please try again.");
      }
      throw failure;
    }
  }, [ensureSession, expireSession]);

  useEffect(() => {
    // Reuse initialization during React's development effect replay.
    if (!initialization.current) initialization.current = refreshSessionNotes();
    void initialization.current.catch(() => {});
  }, [refreshSessionNotes]);

  const upsertNote = useCallback((note: Note) => {
    mutationSequence.current += 1;
    setAllNotes((current) => {
      if (current[note.id] && current[note.id].revision > note.revision) return current;
      return { ...current, [note.id]: note };
    });
  }, []);

  const removeNote = useCallback((id: string) => {
    mutationSequence.current += 1;
    setAllNotes((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const value = useMemo<SessionNotes>(() => ({
    ready, error,
    notes: Object.values(allNotes).filter((note) => !note.deleted_at),
    deletedNotes: Object.values(allNotes).filter((note) => Boolean(note.deleted_at)),
    refreshSessionNotes, upsertNote, removeNote, expireSession,
  }), [ready, error, allNotes, refreshSessionNotes, upsertNote, removeNote, expireSession]);

  return <SessionNotesContext.Provider value={value}>{children}</SessionNotesContext.Provider>;
}

export function useSessionNotes() {
  return useContext(SessionNotesContext);
}
