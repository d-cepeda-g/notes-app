import { Folder, Trash2 } from "lucide-react";

interface DeletedNotesNavigationProps {
  count: number;
  ready: boolean;
  selected: boolean;
  onShowNotes: () => void;
  onShowDeleted: () => void;
}

const rowStyle = "flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors md:min-h-9";

export function DeletedNotesNavigation({ count, ready, selected, onShowNotes, onShowDeleted }: DeletedNotesNavigationProps) {
  if (!selected && (!ready || count === 0)) return null;

  return (
    <nav aria-label="Note folders" className="space-y-0.5 border-b border-muted-foreground/20 py-2 mb-2">
      {selected && (
        <button type="button" onClick={onShowNotes} className={`${rowStyle} hover:bg-black/5 dark:hover:bg-white/[0.06]`}>
          <Folder aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[#e2a727]" strokeWidth={1.7} />
          <span className="flex-1 truncate">Notes</span>
        </button>
      )}
      <button
        type="button"
        onClick={onShowDeleted}
        aria-current={selected ? "page" : undefined}
        aria-label={ready ? `Recently Deleted, ${count} ${count === 1 ? "note" : "notes"}` : "Recently Deleted"}
        className={`${rowStyle} ${selected ? "bg-black/[0.08] dark:bg-[#3a3a3c]" : "hover:bg-black/5 dark:hover:bg-white/[0.06]"}`}
      >
        <Trash2 aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[#e2a727]" strokeWidth={1.7} />
        <span className="flex-1 truncate">Recently Deleted</span>
        {ready && <span aria-hidden="true" className="min-w-[1.5ch] text-right text-xs tabular-nums text-muted-foreground">{count}</span>}
      </button>
    </nav>
  );
}
