"use client";

import React, { useState, useEffect } from "react";
import { Input } from "./ui/input";
import dynamic from "next/dynamic";
import { useMobileDetect } from "./mobile-detector";
import { Lock } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Icons } from "./icons";
import { getNoteDate } from "@/lib/note-utils";
import type { Note, NoteUpdates } from "@/lib/types";

const NoteEmojiPicker = dynamic(() => import("./note-emoji-picker"), {
  ssr: false,
  loading: () => <p className="text-xs text-muted-foreground" role="status">Loading emoji…</p>,
});

export default function NoteHeader({ note, saveNote, canEdit }: {
  note: Note; saveNote: (updates: NoteUpdates) => void; canEdit: boolean;
}) {
  const isMobile = useMobileDetect();
  const pathname = usePathname();
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [formattedDate, setFormattedDate] = useState("");
  const { updated_at, created_at } = note;

  useEffect(() => {
    setFormattedDate(getNoteDate({ updated_at, created_at }).toLocaleString(undefined, { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }));
  }, [updated_at, created_at]);

  const handleEmojiSelect = (emojiObject: { native: string }) => {
    saveNote({ emoji: emojiObject.native });
    setShowEmojiPicker(false);
  };

  return (
    <>
      {isMobile && pathname !== "/notes" && (
        <Link href={note.deleted_at ? "/notes?view=trash" : "/notes"} className="pt-2 flex items-center">
          <Icons.back /><span className="text-[#e2a727] text-base ml-1">{note.deleted_at ? "Recently Deleted" : "Notes"}</span>
        </Link>
      )}
      <div className="px-4 md:px-2 mb-4 relative">
        <div className="flex justify-center items-center">
          <p className="text-muted-foreground text-xs">{formattedDate}</p>
          <div className="ml-2 h-6 flex items-center">
            {!note.public && <Badge className="text-xs justify-center items-center"><Lock className="w-3 h-3 mr-1" />{canEdit ? "Private" : "Read only"}</Badge>}
          </div>
        </div>
        <div className="flex items-center relative">
          {canEdit && !isMobile ? (
            <button type="button" onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="cursor-pointer mr-2" aria-label="Choose note emoji" aria-expanded={showEmojiPicker}>{note.emoji}</button>
          ) : <span className="mr-2">{note.emoji}</span>}
          {!canEdit ? (
            <h1 className="text-2xl font-bold flex-grow py-2 leading-normal min-h-[50px]">{note.title || "Untitled note"}</h1>
          ) : (
            <Input id="title" aria-label="Note title" value={note.title} className="bg-background placeholder:text-muted-foreground text-2xl font-bold flex-grow py-2 leading-normal min-h-[50px]" placeholder="Your title here..." onChange={(event) => saveNote({ title: event.target.value })} autoFocus={!note.title} />
          )}
        </div>
        {showEmojiPicker && !isMobile && canEdit && (
          <div className="absolute top-full left-0 z-10"><NoteEmojiPicker onEmojiSelect={handleEmojiSelect} onClickOutside={() => setShowEmojiPicker(false)} /></div>
        )}
      </div>
    </>
  );
}
