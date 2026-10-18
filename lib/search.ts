import { Note } from "./types";

export function searchNotes(notes: Note[], searchTerm: string): Note[] {
  const query = searchTerm.trim().toLocaleLowerCase();
  return notes.filter((note) =>
    !note.deleted_at && (note.public || note.can_edit) &&
    ((note.title || "").toLocaleLowerCase().includes(query) ||
      (note.content || "").toLocaleLowerCase().includes(query))
  );
}
