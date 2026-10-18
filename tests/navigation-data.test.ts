import assert from "node:assert/strict";
import test from "node:test";
import { createNote, SessionExpiredError } from "../lib/create-note";
import { searchNotes } from "../lib/search";
import { getAdjacentNote } from "../lib/note-navigation";
import type { Note } from "../lib/types";

const note: Note = {
  id: "server-note-id", slug: "server-assigned-slug", title: "Shopping", content: "Buy apples",
  public: false, can_edit: true, revision: 1, deleted_at: null,
  created_at: "2026-10-18T10:00:00Z", updated_at: "2026-10-18T10:00:00Z",
};

test("creation uses the server's note and cookie without generating browser ownership credentials", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "/api/notes");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.deepEqual(JSON.parse(options.body as string), {});
    return Response.json(note, { status: 201 });
  });
  assert.deepEqual(await createNote(), note);
});

test("failed creation cannot be treated as a successfully created note", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Unavailable" }, { status: 503 }));
  await assert.rejects(createNote(), /Could not create/);
});

test("search ignores deleted and inaccessible notes, and matches title or body without case sensitivity", () => {
  const deleted = { ...note, id: "deleted", deleted_at: "2026-10-18T11:00:00Z" };
  const inaccessible = { ...note, id: "other-owner", can_edit: false };
  const publicNote = { ...note, id: "public", title: "Recipe", content: "Apple pie", public: true, can_edit: false };
  assert.deepEqual(searchNotes([note, deleted, inaccessible, publicNote], "  APPLE  ").map((result) => result.id), [note.id, publicNote.id]);
  assert.deepEqual(searchNotes([note], "shopping"), [note]);
});


test("expired creation requires explicit session recovery instead of silently creating a new owner", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Session expired" }, { status: 401 }));
  await assert.rejects(createNote(), SessionExpiredError);
});

test("navigation without a selection starts at the appropriate end of the list", () => {
  const notes = [{ slug: "first" }, { slug: "middle" }, { slug: "last" }];
  assert.equal(getAdjacentNote(notes, null, "up"), notes[2]);
  assert.equal(getAdjacentNote(notes, null, "down"), notes[0]);
  assert.equal(getAdjacentNote(notes, "missing", "up"), notes[2]);
});

test("navigation wraps at both ends and safely handles an empty list", () => {
  const notes = [{ slug: "first" }, { slug: "last" }];
  assert.equal(getAdjacentNote(notes, "first", "up"), notes[1]);
  assert.equal(getAdjacentNote(notes, "last", "down"), notes[0]);
  assert.equal(getAdjacentNote([], null, "up"), undefined);
  assert.equal(getAdjacentNote([], null, "down"), undefined);
});
