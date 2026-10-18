"use client";

import React, { useCallback, useRef } from "react";
import { Textarea } from "./ui/textarea";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Note, NoteUpdates } from "@/lib/types";
import { getImageFromClipboard, uploadNoteImage } from "@/lib/image-upload";
import { insertUploadedImage } from "@/lib/image-paste";
import { sharedAttachmentSource } from "@/lib/markdown-safety";
import { toast } from "@/components/ui/use-toast";

export default function NoteContent({ note, saveNote, canEdit, shareToken }: {
  note: Note; saveNote: (updates: NoteUpdates) => void; canEdit: boolean; shareToken?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mayEdit = canEdit && note.can_edit && !note.public && !note.deleted_at;
  const handlePaste = useCallback(async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!mayEdit) return;
    const imageFile = getImageFromClipboard(event.nativeEvent as ClipboardEvent);
    if (!imageFile) return;
    event.preventDefault();
    const textarea = event.currentTarget;
    const original = { value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd };
    const { dismiss } = toast({ description: "Uploading image..." });
    try {
      const result = await uploadNoteImage(imageFile, note.id);
      dismiss();
      // The note may have been closed while its upload was in progress.
      if (result.success && result.url && textareaRef.current === textarea) {
        saveNote({ content: insertUploadedImage(textarea, original, result.url) });
      } else if (result.error) toast({ description: `Failed to upload image: ${result.error}`, variant: "destructive" });
    } catch {
      dismiss();
      toast({ description: "An unexpected error occurred while uploading the image.", variant: "destructive" });
    }
  }, [mayEdit, note.id, saveNote]);

  if (mayEdit) return (
    <div className="px-4 md:px-2 overflow-x-hidden">
      <Textarea ref={textareaRef} id="note-content" aria-label="Note content" value={note.content || ""} className="min-h-dvh focus:outline-none leading-normal" placeholder="Start writing..." onChange={(event) => saveNote({ content: event.target.value })} onPaste={handlePaste} />
    </div>
  );

  return (
    <div className="px-4 md:px-2 overflow-x-hidden h-full text-base md:text-sm">
      <ReactMarkdown className="markdown-body min-h-dvh max-w-full" remarkPlugins={[remarkGfm]} skipHtml
        components={{
          a: ({ node: _node, href, children, ...props }) => (
            <a {...props} href={href} target={/^https?:\/\//i.test(href || "") ? "_blank" : undefined} rel="noopener noreferrer">{children}</a>
          ),
          img: ({ node: _node, src, alt, ...props }) => (
            // Protected attachments require the reader's cookie or explicit share URL.
            // eslint-disable-next-line @next/next/no-img-element
            <img {...props} src={sharedAttachmentSource(src || "", note.id, shareToken)} alt={alt || "Note image"} loading="lazy" referrerPolicy="no-referrer" className="w-full max-w-xl h-auto object-contain" />
          ),
        }}>
        {note.content || ""}
      </ReactMarkdown>
    </div>
  );
}
