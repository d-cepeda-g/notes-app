import { cache } from "react";
import Note from "@/components/note";
import { getNoteBySlug } from "@/lib/db";
import { getSessionOwner } from "@/lib/auth";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const getNote = cache(async (slug: string, owner: string | null) => getNoteBySlug(slug, owner || undefined));
type Context = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Context): Promise<Metadata> {
  const { slug } = await params;
  const note = await getNote(slug, await getSessionOwner());
  if (!note) return { title: "Note not found", robots: { index: false, follow: false } };
  if (!note.public) return { title: "Private note", robots: { index: false, follow: false } };
  return {
    title: `david cepeda | ${note.title || "new note"}`,
    openGraph: { images: [`/notes/api/og/?title=${encodeURIComponent(note.title || "new note")}&emoji=${encodeURIComponent(note.emoji || "👋🏼")}`] },
  };
}

export default async function NotePage({ params }: Context) {
  const { slug } = await params;
  const note = await getNote(slug, await getSessionOwner());
  if (!note) notFound();
  return <div className="w-full min-h-dvh p-4 md:p-3 overflow-x-hidden"><Note key={note.id} note={note} /></div>;
}
