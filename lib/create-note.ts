import { v4 as uuidv4 } from "uuid";
import { toast } from "@/components/ui/use-toast";

export async function createNote(
  sessionId: string | null,
  router: any,
  addNewPinnedNote: (slug: string) => void,
  refreshSessionNotes: () => Promise<void>,
  setSelectedNoteSlug: (slug: string | null) => void,
  isMobile: boolean
) {
  const noteId = uuidv4();
  const slug = `new-note-${noteId}`;

  const note = {
    id: noteId,
    slug: slug,
    title: "",
    content: "",
    public: false,
    created_at: new Date().toISOString(),
    session_id: sessionId,
    category: "today",
    emoji: "👋🏼",
  };

  try {
    const response = await fetch("/api/notes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(note),
    });

    if (!response.ok) throw new Error("Failed to create note");

    if (!isMobile) {
      addNewPinnedNote(slug);
      refreshSessionNotes().then(() => {
        setSelectedNoteSlug(slug);
        router.push(`/notes/${slug}`);
        router.refresh();
      });
    } else {
      const storedPinnedNotes = localStorage.getItem("pinnedNotes");
      const pinnedNotes = storedPinnedNotes ? JSON.parse(storedPinnedNotes) : [];
      if (!pinnedNotes.includes(slug)) {
        pinnedNotes.push(slug);
        localStorage.setItem("pinnedNotes", JSON.stringify(pinnedNotes));
      }
      router.push(`/notes/${slug}`);
    }

    toast({
      description: "Private note created",
    });
  } catch (error) {
    console.error("Error creating note:", error);
  }
}
