import { cache } from "react";
import Note from "@/components/note";
import { getNoteBySlug, getPublicNotes } from "@/lib/db";
import { redirect } from "next/navigation";
import { Metadata } from "next";
import { Note as NoteType } from "@/lib/types";

export const revalidate = 86400;

const getNote = cache(async (slug: string) => {
  const note = await getNoteBySlug(slug);
  return note as NoteType | null;
});

export async function generateStaticParams() {
  const notes = await getPublicNotes();
  return notes.map(({ slug }) => ({
    slug: slug || "",
  }));
}

export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const slug = params.slug.replace(/^notes\//, '');
  const note = await getNote(slug);

  if (!note) {
    return { title: "Note not found" };
  }

  const title = note.title || "new note";
  const emoji = note.emoji || "👋🏼";

  return {
    title: `david cepeda | ${title}`,
    openGraph: {
      images: [
        `/notes/api/og/?title=${encodeURIComponent(title)}&emoji=${encodeURIComponent(
          emoji
        )}`,
      ],
    },
  };
}

export default async function NotePage({
  params,
}: {
  params: { slug: string };
}) {
  const slug = params.slug.replace(/^notes\//, '');
  const note = await getNote(slug);

  if (!note) {
    return redirect("/notes/error");
  }

  return (
    <div className="w-full min-h-dvh p-4 md:p-3 overflow-x-hidden">
      <Note note={note} />
    </div>
  );
}
