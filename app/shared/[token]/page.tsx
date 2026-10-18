import { notFound } from "next/navigation";
import Note from "@/components/note";
import { getSharedNote } from "@/lib/db";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Shared note", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function SharedNotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const note = await getSharedNote(token);
  if (!note) notFound();
  return <div className="w-full min-h-dvh p-4 md:p-3 overflow-x-hidden"><Note key={note.id} note={note} shareToken={token} /></div>;
}
