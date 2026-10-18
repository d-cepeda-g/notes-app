export interface PasteSnapshot {
  value: string;
  start: number;
  end: number;
}

/** An upload cannot safely apply an old selection to text edited while it was pending. */
export function buildImagePaste(currentValue: string, currentCaret: number, original: PasteSnapshot, imageUrl: string) {
  const unchanged = currentValue === original.value;
  const clamp = (position: number) => Math.max(0, Math.min(position, currentValue.length));
  const start = clamp(unchanged ? original.start : currentCaret);
  // After any edit, collapse the range. A current selection may contain newer work.
  const end = unchanged ? Math.max(start, clamp(original.end)) : start;
  const before = currentValue.slice(0, start);
  const after = currentValue.slice(end);
  const markdown = `${before && !before.endsWith("\n") ? "\n" : ""}![image](${imageUrl})${after && !after.startsWith("\n") ? "\n" : ""}`;
  return { content: before + markdown + after, cursor: before.length + markdown.length };
}

export function insertUploadedImage(textarea: HTMLTextAreaElement, original: PasteSnapshot, imageUrl: string) {
  const result = buildImagePaste(textarea.value, textarea.selectionStart, original, imageUrl);
  textarea.value = result.content;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.setSelectionRange(result.cursor, result.cursor);
  textarea.focus();
  return result.content;
}
