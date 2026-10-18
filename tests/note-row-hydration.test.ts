import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteItem } from "../components/note-item";
import type { Note } from "../lib/types";

const note: Note = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", slug: "projects", title: "Projects", content: "Current work",
  public: true, can_edit: false, revision: 1, deleted_at: null,
  created_at: "2026-10-17T23:30:00.000Z", updated_at: "2026-10-18T00:30:00.000Z",
};

function renderRow() {
  return renderToStaticMarkup(createElement("ul", null, createElement(NoteItem, {
    item: note, selectedNoteSlug: note.slug, onNoteSelect: () => {}, onNoteEdit: () => {},
    handlePinToggle: () => {}, isPinned: false, isHighlighted: false, isSearching: false,
    handleNoteDelete: async () => {}, openSwipeItemSlug: null, setOpenSwipeItemSlug: () => {},
  })));
}

test("note rows render an ISO date before effects, independently of the server locale", (t) => {
  const localDate = t.mock.method(Date.prototype, "toLocaleDateString", () => {
    throw new Error("Localized dates must wait until after hydration");
  });
  const html = renderRow();
  assert.match(html, />2026-10-18<\/span>/);
  assert.equal(localDate.mock.callCount(), 0);
});
