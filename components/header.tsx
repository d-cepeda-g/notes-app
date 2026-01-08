"use client";

import { RefObject, Dispatch, SetStateAction } from "react";
import { Note } from "@/lib/types";
import { Icons } from "./icons";
import NewNote from "./new-note";

interface HeaderProps {
  notes: Note[];
  onSearchResults: (results: Note[] | null) => void;
  sessionId: string;
  searchInputRef: RefObject<HTMLInputElement>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  setHighlightedIndex: Dispatch<SetStateAction<number>>;
  clearSearch: () => void;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  isMobile: boolean;
  addNewPinnedNote: (slug: string) => void;
  setSelectedNoteSlug: (slug: string | null) => void;
}

export default function Header({
  notes,
  onSearchResults,
  sessionId,
  searchInputRef,
  searchQuery,
  setSearchQuery,
  setHighlightedIndex,
  clearSearch,
  isSidebarOpen,
  toggleSidebar,
  isMobile,
  addNewPinnedNote,
  setSelectedNoteSlug,
}: HeaderProps) {
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.trim() === "") {
      clearSearch();
      return;
    }

    const filteredNotes = notes.filter(
      (note) =>
        (note.public || note.session_id === sessionId) &&
        (note.title.toLowerCase().includes(query.trim().toLowerCase()) ||
          note.content.toLowerCase().includes(query.trim().toLowerCase()))
    );

    onSearchResults(filteredNotes);
    setHighlightedIndex(0);
  };

  return (
    <div className="h-11 flex items-center justify-between px-3 border-b border-muted-foreground/20 bg-background dark:bg-[#1c1c1e]">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 mr-2">
          <button
            onClick={() => window.close()}
            className="cursor-pointer group w-3 h-3 rounded-full bg-[#ff5f57] hover:opacity-80 flex items-center justify-center"
            aria-label="Close"
          >
            <span className="opacity-0 group-hover:opacity-100 text-[8px] font-bold leading-none text-black/60">×</span>
          </button>
          <button className="group w-3 h-3 rounded-full bg-[#febc2e] hover:opacity-80 flex items-center justify-center cursor-default">
            <span className="opacity-0 group-hover:opacity-100 text-[8px] font-bold leading-none text-black/60">−</span>
          </button>
          <button className="group w-3 h-3 rounded-full bg-[#28c840] hover:opacity-80 flex items-center justify-center cursor-default">
            <span className="opacity-0 group-hover:opacity-100 text-[8px] font-bold leading-none text-black/60">+</span>
          </button>
        </div>

        <button
          onClick={toggleSidebar}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-[#3a3a3c] hover:bg-[#4a4a4c] transition-colors shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]"
          title={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-300">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>

        <div className="flex items-center">
          <span className="text-sm font-semibold text-foreground">Notes</span>
        </div>

        <NewNote
          addNewPinnedNote={addNewPinnedNote}
          clearSearch={clearSearch}
          setSelectedNoteSlug={setSelectedNoteSlug}
          isMobile={isMobile}
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 flex items-center pl-2.5 pointer-events-none">
            <Icons.search className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search"
            className="w-44 pl-7 pr-7 py-1 rounded-full text-sm placeholder:text-sm placeholder:text-muted-foreground focus:outline-none border-none bg-muted-foreground/10 dark:bg-[#38383a]"
            aria-label="Search notes"
            autoComplete="off"
            ref={searchInputRef}
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <Icons.close className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
