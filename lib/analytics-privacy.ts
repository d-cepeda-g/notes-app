export function isSharedNoteUrl(value: string): boolean {
  try {
    const path = new URL(value, "https://notes.invalid").pathname;
    return path === "/shared" || path.startsWith("/shared/");
  } catch { return true; }
}
