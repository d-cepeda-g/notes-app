import type { Note } from "./types";

/** Use persisted dates, including for notes imported from older versions. */
export function getNoteDate(note: Pick<Note, "updated_at" | "created_at">): Date {
  for (const value of [note.updated_at, note.created_at]) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  return new Date(0);
}

export function groupNotesByCategory(
  notes: Note[],
  pinnedNotes: Set<string>,
  options: { now?: Date; utc?: boolean } = {},
): Record<string, Note[]> {
  const grouped: Record<string, Note[]> = { pinned: [] };
  const today = new Date(options.now?.getTime() ?? Date.now());
  if (options.utc) today.setUTCHours(0, 0, 0, 0);
  else today.setHours(0, 0, 0, 0);
  const boundary = (days: number) => {
    const date = new Date(today);
    if (options.utc) date.setUTCDate(date.getUTCDate() - days);
    else date.setDate(date.getDate() - days);
    return date;
  };
  const yesterday = boundary(1);
  const week = boundary(7);
  const month = boundary(30);
  for (const note of notes) {
    const date = getNoteDate(note);
    const category = pinnedNotes.has(note.slug) ? "pinned"
      : date >= today ? "today" : date >= yesterday ? "yesterday"
      : date >= week ? "7" : date >= month ? "30" : "older";
    (grouped[category] ??= []).push(note);
  }
  return grouped;
}

export function sortGroupedNotes(grouped: Record<string, Note[]>) {
  Object.values(grouped).forEach((notes) => notes.sort((a, b) =>
    getNoteDate(b).getTime() - getNoteDate(a).getTime() || a.id.localeCompare(b.id)
  ));
}
