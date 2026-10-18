/** A share token may travel only to this note's own attachment endpoint. */
export function sharedAttachmentSource(source: string, noteId: string, token?: string): string {
  if (!token || !source.startsWith("/api/uploads/serve/")) return source;
  try {
    const url = new URL(source, "https://notes.invalid");
    if (url.origin !== "https://notes.invalid") return source;
    const path = decodeURIComponent(url.pathname.slice("/api/uploads/serve/".length));
    if (!path.startsWith(`note-images/${noteId}/`) || path.split("/").some((segment) => segment === "." || segment === "..")) return source;
    url.searchParams.set("share", token);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return source; }
}
