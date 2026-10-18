import { getPublicNotes } from "@/lib/db";
import { siteConfig } from "@/config/site";
import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || siteConfig.url).replace(/\/$/, "");
  const notes = await getPublicNotes();
  return [
    { url: origin },
    { url: `${origin}/notes` },
    ...notes.map(note => ({ url: `${origin}/notes/${encodeURIComponent(note.slug)}`, lastModified: new Date(note.updated_at) })),
  ];
}
