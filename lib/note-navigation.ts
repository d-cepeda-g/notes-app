export function getAdjacentNote<T extends { slug: string }>(
  notes: readonly T[],
  selectedSlug: string | null,
  direction: "up" | "down"
): T | undefined {
  if (!notes.length) return undefined;
  const currentIndex = notes.findIndex((note) => note.slug === selectedSlug);
  if (currentIndex < 0) return direction === "up" ? notes[notes.length - 1] : notes[0];
  const offset = direction === "down" ? 1 : -1;
  return notes[(currentIndex + offset + notes.length) % notes.length];
}
