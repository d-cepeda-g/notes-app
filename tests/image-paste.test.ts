import test from "node:test";
import assert from "node:assert/strict";
import { buildImagePaste, insertUploadedImage } from "../lib/image-paste";

const url = "/api/uploads/serve/note-images/note/image.webp";
const image = `![image](${url})`;

test("an unchanged note replaces only the selection captured at paste time", () => {
  const original = { value: "Before old text after", start: 7, end: 15 };
  const result = buildImagePaste(original.value, 0, original, url);
  assert.equal(result.content, `Before \n${image}\n after`);
  assert.equal(result.cursor, `Before \n${image}\n`.length);
});

test("newer text typed during upload is preserved, including a current selection", () => {
  const original = { value: "Before old text after", start: 7, end: 15 };
  const current = "Before important NEW text after";
  const result = buildImagePaste(current, current.length, original, url);
  assert.equal(result.content, `${current}\n${image}`);
  assert.ok(result.content.includes("important NEW text"));
});

test("changed text with the same length also collapses the stale replacement range", () => {
  const result = buildImagePaste("ABxyEF", 2, { value: "ABCDEF", start: 2, end: 4 }, url);
  assert.equal(result.content, `AB\n${image}\nxyEF`);
});

test("shortened text clamps the current caret and never revives a stale range", () => {
  const result = buildImagePaste("New", 20, { value: "Much longer original text", start: 4, end: 20 }, url);
  assert.equal(result.content, `New\n${image}`);
});

test("two upload completions preserve all intervening text and both images", () => {
  const original = { value: "Original", start: 8, end: 8 };
  const first = buildImagePaste("Original plus new typing", 24, original, url);
  const second = buildImagePaste(first.content, first.cursor, original, "/second.webp");
  assert.ok(second.content.startsWith("Original plus new typing"));
  assert.ok(second.content.includes(image));
  assert.ok(second.content.includes("![image](/second.webp)"));
});

test("the actual textarea insertion preserves a newly selected range", () => {
  const original = { value: "Original", start: 0, end: 8 };
  let focused = false;
  const textarea = {
    value: "Entirely newer text", selectionStart: 9, selectionEnd: 14,
    dispatchEvent: () => true,
    setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; },
    focus() { focused = true; },
  };
  const content = insertUploadedImage(textarea as unknown as HTMLTextAreaElement, original, url);
  assert.equal(content, `Entirely \n${image}\nnewer text`);
  assert.equal(textarea.value, content);
  assert.equal(textarea.selectionStart, textarea.selectionEnd);
  assert.equal(focused, true);
});
