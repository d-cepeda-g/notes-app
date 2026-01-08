"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface SessionNotes {
  sessionId: string;
  notes: any[];
  setSessionId: (sessionId: string) => void;
  refreshSessionNotes: () => Promise<void>;
}

export const SessionNotesContext = createContext<SessionNotes>({
  sessionId: "",
  notes: [],
  setSessionId: () => {},
  refreshSessionNotes: async () => {},
});

export function SessionNotesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sessionId, setSessionId] = useState<string>("");
  const [notes, setNotes] = useState<any[]>([]);

  const refreshSessionNotes = useCallback(async () => {
    if (sessionId) {
      try {
        const response = await fetch(`/api/notes?session_id=${sessionId}`);
        if (response.ok) {
          const data = await response.json();
          setNotes(data || []);
        }
      } catch (error) {
        console.error("Error fetching session notes:", error);
      }
    }
  }, [sessionId]);

  useEffect(() => {
    refreshSessionNotes();
  }, [refreshSessionNotes, sessionId]);

  return (
    <SessionNotesContext.Provider
      value={{
        sessionId,
        notes,
        setSessionId,
        refreshSessionNotes,
      }}
    >
      {children}
    </SessionNotesContext.Provider>
  );
}
