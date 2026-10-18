import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import NoteContent from "../components/note-content";
import { sharedAttachmentSource } from "../lib/markdown-safety";
import { getNoteDate, groupNotesByCategory, sortGroupedNotes } from "../lib/note-utils";
import type { Note } from "../lib/types";

const note: Note = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", slug: "test", title: "Example", content: "", can_edit: false, public: true,
  revision: 1, created_at: "2020-01-01T10:00:00.000Z", updated_at: "2020-01-01T10:00:00.000Z", deleted_at: null,
};
const render = (content: string) => renderToStaticMarkup(createElement(NoteContent, { note: { ...note, content }, saveNote: () => { throw new Error("Read-only note must never save"); }, canEdit: false }));

test("raw iframe, script, form, image event handlers, and styles are not rendered", () => {
  const html = render('<iframe src="https://evil.example"></iframe>\n<script>alert(1)</script>\n<form action="https://evil.example"><input name="secret"></form>\n<img src="x" onerror="alert(1)">\n<style>body{display:none}</style>');
  assert.doesNotMatch(html, /<iframe|<script|<form|<input|onerror=|<style/i);
});

test("safe Markdown links, images, tables and read-only checklists still render", () => {
  const html = render('[Docs](https://example.com)\n\n![Photo](/api/uploads/serve/note-images/a/image.webp)\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- [ ] Same task\n- [ ] Same task');
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /<img/);
  assert.match(html, /<table>/);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2);
});

test("unsafe Markdown URL protocols cannot execute", () => {
  const html = render('[Danger](javascript:alert%281%29)\n\n![Danger](javascript:alert%281%29)');
  assert.doesNotMatch(html, /(?:href|src)="javascript:/i);
});

test("share tokens attach only to this note's local attachments", () => {
  const internal = `/api/uploads/serve/note-images/${note.id}/image.webp`;
  assert.equal(sharedAttachmentSource(internal, note.id, "token"), `${internal}?share=token`);
  assert.equal(sharedAttachmentSource(internal + "?size=small", note.id, "token"), `${internal}?size=small&share=token`);
  for (const source of ["https://evil.example/image.webp", "//evil.example/image.webp", "/api/uploads/serve/note-images/another/image.webp", "/api/uploads/serve/note-images/%2e%2e/secret", "data:image/png;base64,abc"]) {
    assert.equal(sharedAttachmentSource(source, note.id, "token"), source);
  }
  assert.equal(sharedAttachmentSource(internal, note.id), internal);
});

test("dates come from stored timestamps and sort by actual edit time", () => {
  assert.equal(getNoteDate(note).toISOString(), note.updated_at);
  const changed = { ...note, id: "changed", slug: "changed", updated_at: "2026-10-18T10:00:00.000Z" };
  const grouped = groupNotesByCategory([note], new Set());
  assert.equal(grouped.older[0], note);
  const sameGroup = { older: [note, changed] };
  sortGroupedNotes(sameGroup);
  assert.equal(sameGroup.older[0], changed);
  assert.equal(getNoteDate({ updated_at: "invalid", created_at: note.created_at }).toISOString(), note.created_at);
});

test("UTC initial grouping is identical across server and browser timezones", () => {
  const originalTimezone = process.env.TZ;
  const now = new Date("2026-10-18T00:15:00.000Z");
  const notes = [
    { ...note, id: "today", updated_at: "2026-10-18T00:01:00.000Z" },
    { ...note, id: "yesterday", updated_at: "2026-10-17T23:59:00.000Z" },
    { ...note, id: "week", updated_at: "2026-10-11T00:00:00.000Z" },
    { ...note, id: "month", updated_at: "2026-10-10T23:59:00.000Z" },
  ];
  const groupedIds = () => Object.fromEntries(Object.entries(
    groupNotesByCategory(notes, new Set(), { now, utc: true }),
  ).map(([category, items]) => [category, items.map((item) => item.id)]));
  try {
    process.env.TZ = "America/Los_Angeles";
    const server = groupedIds();
    process.env.TZ = "Asia/Tokyo";
    const browser = groupedIds();
    assert.deepEqual(server, browser);
    assert.deepEqual(server, { pinned: [], today: ["today"], yesterday: ["yesterday"], "7": ["week"], "30": ["month"] });
    assert.equal(now.toISOString(), "2026-10-18T00:15:00.000Z");
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});
