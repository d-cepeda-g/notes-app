"use client";

import { useState, useCallback, useRef } from "react";
import { Textarea } from "./ui/textarea";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Note } from "@/lib/types";
import {
  getImageFromClipboard,
  uploadNoteImage,
  insertImageMarkdown,
} from "@/lib/image-upload";
import { toast } from "@/components/ui/use-toast";

export default function NoteContent({
  note,
  saveNote,
  canEdit,
}: {
  note: Note;
  saveNote: (updates: Partial<Note>) => void;
  canEdit: boolean;
}) {
  const [isEditing, setIsEditing] = useState(!note.content && canEdit);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    saveNote({ content: e.target.value });
  }, [saveNote]);

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!canEdit) return;

      const clipboardEvent = e.nativeEvent as ClipboardEvent;
      const imageFile = getImageFromClipboard(clipboardEvent);

      if (!imageFile) return;

      e.preventDefault();

      const { dismiss } = toast({ description: "Uploading image..." });

      try {
        const result = await uploadNoteImage(imageFile, note.id);

        dismiss();

        if (result.success && result.url && textareaRef.current) {
          insertImageMarkdown(textareaRef.current, result.url);
          const newContent = textareaRef.current.value;
          setTimeout(() => saveNote({ content: newContent }), 0);
        } else if (result.error) {
          toast({ description: `Failed to upload image: ${result.error}`, variant: "destructive" });
        }
      } catch (error) {
        dismiss();
        toast({ description: "An unexpected error occurred while uploading the image.", variant: "destructive" });
      }
    },
    [canEdit, note.id, saveNote]
  );

  const handleMarkdownCheckboxChange = useCallback((taskText: string, isChecked: boolean) => {
    const updatedContent = note.content.replace(
      new RegExp(`\\[[ x]\\] ${taskText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
      `[${isChecked ? 'x' : ' '}] ${taskText}`
    );
    saveNote({ content: updatedContent });
  }, [note.content, saveNote]);

  const renderListItem = useCallback(({ children, ...props }: any) => {
    if (!props.className?.includes('task-list-item')) return <li {...props}>{children}</li>;

    const checkbox = children.find((child: any) => child.type === 'input');
    if (!checkbox) return <li {...props}>{children}</li>;

    const isChecked = checkbox.props.checked;
    const taskContent = children.filter((child: any) => child !== checkbox);
    const taskText = taskContent.map((child: any) => {
      if (typeof child === 'string') return child;
      if (child.type === 'a') return `[${child.props.children}](${child.props.href})`;
      return child.props.children;
    }).join('').trim();

    const taskId = `task-${taskText.substring(0, 20).replace(/\s+/g, '-').toLowerCase()}-${props.index}`;

    const handleCheckboxClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (canEdit) handleMarkdownCheckboxChange(taskText, !isChecked);
    };

    return (
      <li {...props}>
        <span className="flex items-start">
          <span
            onClick={handleCheckboxClick}
            className={`${canEdit ? 'cursor-pointer' : 'cursor-default'} mr-1`}
          >
            <input
              type="checkbox"
              checked={isChecked}
              className="pointer-events-none"
              id={taskId}
              readOnly
            />
          </span>
          <span>{taskContent}</span>
        </span>
      </li>
    );
  }, [canEdit, handleMarkdownCheckboxChange]);

  const renderLink = useCallback((props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    const href = props.href || "";
    const isExternal = /^https?:\/\//i.test(href);
    return (
      <a
        {...props}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer" : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {props.children}
      </a>
    );
  }, []);

  const renderImage = useCallback((props: React.ImgHTMLAttributes<HTMLImageElement>) => {
    return (
      <img {...props} alt={props.alt || "image"} className="w-full max-w-xl h-auto object-contain" />
    );
  }, []);

  const isPrivateNote = canEdit && !note.public;

  if (isPrivateNote) {
    return (
      <div className="px-4 md:px-2 overflow-x-hidden">
        <Textarea
          ref={textareaRef}
          id="note-content"
          value={note.content || ""}
          className="min-h-dvh focus:outline-none leading-normal"
          placeholder="Start writing..."
          onChange={handleChange}
          onPaste={handlePaste}
        />
      </div>
    );
  }

  return (
    <div className="px-4 md:px-2 overflow-x-hidden">
      {(isEditing && canEdit) || (!note.content && canEdit) ? (
        <Textarea
          ref={textareaRef}
          id="note-content"
          value={note.content || ""}
          className="min-h-dvh focus:outline-none leading-normal"
          placeholder="Start writing..."
          onChange={handleChange}
          onPaste={handlePaste}
          onFocus={() => setIsEditing(true)}
          onBlur={() => setIsEditing(false)}
        />
      ) : (
        <div
          className="h-full text-base md:text-sm"
          onClick={() => {
            if (canEdit) setIsEditing(true);
          }}
        >
          <ReactMarkdown
            className="markdown-body min-h-dvh max-w-full"
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              li: renderListItem,
              a: renderLink,
              img: renderImage,
            }}
          >
            {note.content || "Start writing..."}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
