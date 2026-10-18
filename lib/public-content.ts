import { PROJECTS_NOTE } from "@/content/projects";
import type { Note } from "./types";

/** Repository-managed public copy, kept separate from visitor-owned notes. */
export function getProjectsNote(existing?: Note): Note {
  return {
    id: existing?.id || "a4437184-c45f-41a3-a07c-2cc5ab7380b4",
    slug: "projects",
    created_at: existing?.created_at || PROJECTS_NOTE.updated_at,
    deleted_at: null,
    revision: existing?.revision || 1,
    public: true,
    can_edit: false,
    ...PROJECTS_NOTE,
  };
}

export function applyPublicContent(note: Note): Note {
  return note.public && !note.deleted_at && note.slug === "projects" ? getProjectsNote(note) : note;
}
