"use client";

import { Analytics } from "@vercel/analytics/react";
import { usePathname } from "next/navigation";
import { isSharedNoteUrl } from "@/lib/analytics-privacy";

/** Shared-note paths contain bearer tokens and must never enter page analytics. */
export default function NotesAnalytics() {
  const pathname = usePathname();
  if (isSharedNoteUrl(pathname || "")) return null;
  return <Analytics beforeSend={(event) => isSharedNoteUrl(event.url) ? null : event} />;
}
