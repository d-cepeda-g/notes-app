import assert from "node:assert/strict";
import test from "node:test";
import { isSharedNoteUrl } from "../lib/analytics-privacy";

test("keeps bearer sharing paths out of analytics across route changes", () => {
  assert.equal(isSharedNoteUrl("https://notes.example/shared/secret-token"), true);
  assert.equal(isSharedNoteUrl("/shared/secret-token?from=copy"), true);
  assert.equal(isSharedNoteUrl("/shared"), true);
  assert.equal(isSharedNoteUrl("https://notes.example/notes/projects"), false);
});
