import { Pin, PinOff, Trash2, Edit } from "lucide-react";

interface SwipeActionsProps {
  isOpen: boolean;
  onPin: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isPinned: boolean;
  canEditOrDelete: boolean;
}

export function SwipeActions({ isOpen, onPin, onEdit, onDelete, isPinned, canEditOrDelete }: SwipeActionsProps) {
  const controlProps = { type: "button" as const, tabIndex: isOpen ? 0 : -1, disabled: !isOpen };
  return (
    <div aria-hidden={!isOpen} className={`absolute top-0 right-0 h-full flex items-center transition-opacity duration-300 ${isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
      <button {...controlProps} onClick={onPin} aria-label={isPinned ? "Unpin note" : "Pin note"} className="bg-[#3293FC] text-white p-2 h-full w-16 flex items-center justify-center">{isPinned ? <PinOff size={20} /> : <Pin size={20} />}</button>
      {canEditOrDelete && <>
        <button {...controlProps} onClick={onEdit} aria-label="Edit note" className="bg-[#787BFF] text-white p-2 h-full w-16 flex items-center justify-center"><Edit size={20} /></button>
        <button {...controlProps} onClick={onDelete} aria-label="Delete note" className="bg-[#FF4539] text-white p-2 h-full w-16 flex items-center justify-center"><Trash2 size={20} /></button>
      </>}
    </div>
  );
}
