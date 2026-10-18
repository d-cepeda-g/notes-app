/** Safe browser-facing note data. Ownership credentials never belong here. */
export interface Note {
  id: string;
  slug: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  emoji?: string;
  public: boolean;
  can_edit: boolean;
  category?: string;
}

export type NoteUpdates = Partial<Pick<Note, "title" | "content" | "emoji">>;
