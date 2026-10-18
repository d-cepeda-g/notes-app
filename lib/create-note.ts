import { Note } from "./types";

export const SESSION_EXPIRED_MESSAGE = "Your notes session has expired. Copy any unsaved text, then reload this page to start a new session.";

export class SessionExpiredError extends Error {
  constructor() { super(SESSION_EXPIRED_MESSAGE); }
}

export async function createNote(): Promise<Note> {
  const response = await fetch("/api/notes", {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (response.status === 401) throw new SessionExpiredError();
  if (!response.ok) throw new Error("Could not create your note. Please try again.");
  return response.json();
}
