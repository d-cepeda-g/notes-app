import React from "react";
import Link from "next/link";
import { useSwipeable } from "react-swipeable";
import { useMobileDetect } from "@/components/mobile-detector";
import { SwipeActions } from "./swipe-actions";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./ui/context-menu";
import { Note } from "@/lib/types";
import { getNoteDate } from "@/lib/note-utils";

function previewContent(content: string): string {
  return (content || "")
    .replace(/!\[[^\]]*\]\([^\)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/\[[ x]\]/g, "")
    .replace(/[#*_~`>]/g, "")
    .replace(/\s+/g, " ").trim();
}

interface NoteItemProps {
  item: Note;
  selectedNoteSlug: string | null;
  onNoteSelect: (note: Note) => void;
  onNoteEdit: (slug: string) => void;
  handlePinToggle: (slug: string) => void;
  isPinned: boolean;
  isHighlighted: boolean;
  isSearching: boolean;
  handleNoteDelete: (note: Note) => Promise<void>;
  openSwipeItemSlug: string | null;
  setOpenSwipeItemSlug: React.Dispatch<React.SetStateAction<string | null>>;
  showDivider?: boolean;
}

export const NoteItem = React.memo(function NoteItem({
  item, selectedNoteSlug, onNoteSelect, onNoteEdit, handlePinToggle,
  isPinned, isHighlighted, isSearching, handleNoteDelete,
  openSwipeItemSlug, setOpenSwipeItemSlug, showDivider = false,
}: NoteItemProps) {
  const isMobile = useMobileDetect();
  const { created_at, updated_at } = item;
  const [dateLabel, setDateLabel] = React.useState(() => getNoteDate(item).toISOString().slice(0, 10));
  React.useEffect(() => {
    setDateLabel(getNoteDate({ created_at, updated_at }).toLocaleDateString());
  }, [created_at, updated_at]);
  const isSwipeOpen = openSwipeItemSlug === item.slug;
  const canEditOrDelete = item.can_edit && !item.public;
  const isSelected = (!isMobile && isSearching && isHighlighted) || (!isSearching && item.slug === selectedNoteSlug);
  const handleDelete = async () => { setOpenSwipeItemSlug(null); await handleNoteDelete(item); };
  const handleEdit = () => { setOpenSwipeItemSlug(null); onNoteEdit(item.slug); };
  const handlePinAction = () => { handlePinToggle(item.slug); setOpenSwipeItemSlug(null); };
  const handlers = useSwipeable({
    onSwipedLeft: () => setOpenSwipeItemSlug(item.slug),
    onSwipedRight: () => setOpenSwipeItemSlug(null),
    preventScrollOnSwipe: true,
    trackMouse: false,
  });

  const link = (
    <Link
      href={`/notes/${item.slug}`} prefetch={item.public}
      aria-current={item.slug === selectedNoteSlug ? "page" : undefined}
      onClick={(event) => {
        if (isSwipeOpen) { event.preventDefault(); setOpenSwipeItemSlug(null); return; }
        if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onNoteSelect(item);
      }}
      className={`flex flex-col justify-center gap-0.5 h-[70px] w-full max-w-full min-w-0 overflow-hidden px-3 py-2 box-border ${isSelected ? "bg-[#FFE390] dark:bg-[#9D7D28] dark:text-white rounded-md" : ""}`}
    >
      <h2 className="text-sm font-bold truncate min-w-0">{item.emoji} {item.title || "New note"}</h2>
      <p className={`text-xs truncate min-w-0 ${isSelected ? "text-muted-foreground dark:text-white/80" : "text-muted-foreground"}`}>
        <span className="text-black dark:text-white shrink-0 mr-1">{dateLabel}</span>
        {previewContent(item.content)}
      </p>
    </Link>
  );

  return (
    <li data-note-slug={item.slug} className="relative w-full max-w-full min-w-0 overflow-hidden box-border">
      {isMobile ? <>
        <div {...handlers} className={`relative z-10 w-full transition-transform duration-300 ease-out ${isSwipeOpen ? (canEditOrDelete ? "-translate-x-48" : "-translate-x-16") : ""}`}>
          {link}
        </div>
        <SwipeActions isOpen={isSwipeOpen} onPin={handlePinAction} onEdit={handleEdit} onDelete={handleDelete} isPinned={isPinned} canEditOrDelete={canEditOrDelete} />
      </> : (
        <ContextMenu>
          <ContextMenuTrigger asChild>{link}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={handlePinAction} className="cursor-pointer">{isPinned ? "Unpin" : "Pin"}</ContextMenuItem>
            {canEditOrDelete && <>
              <ContextMenuItem onClick={handleEdit} className="cursor-pointer">Edit</ContextMenuItem>
              <ContextMenuItem onClick={handleDelete} className="cursor-pointer">Delete</ContextMenuItem>
            </>}
          </ContextMenuContent>
        </ContextMenu>
      )}
      {showDivider && !isSelected && <div className="mx-2 border-t border-muted-foreground/20" />}
    </li>
  );
});
