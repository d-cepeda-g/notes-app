"use client";

import { RefObject } from "react";
import { Icons } from "./icons";
import NewNote from "./new-note";

interface HeaderProps {
  searchInputRef: RefObject<HTMLInputElement>;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  clearSearch: () => void;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  onCreateNote: () => void;
  creatingDisabled: boolean;
}

export default function Header({
  searchInputRef, searchQuery, onSearchChange, clearSearch,
  isSidebarOpen, toggleSidebar, onCreateNote, creatingDisabled,
}: HeaderProps) {
  return (
    <div className="h-11 flex items-center justify-between px-3 border-b border-muted-foreground/20 bg-background dark:bg-[#1c1c1e]">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 mr-2" aria-hidden="true">
          <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <span className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
        <button
          type="button" onClick={toggleSidebar}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-[#3a3a3c] hover:bg-[#4a4a4c] transition-colors shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]"
          title={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
          aria-label={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
          aria-expanded={isSidebarOpen}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-300" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
        <div className="flex items-center"><span className="text-sm font-semibold text-foreground">Notes</span></div>
        <NewNote onCreate={onCreateNote} disabled={creatingDisabled} />
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 flex items-center pl-2.5 pointer-events-none"><Icons.search className="w-3.5 h-3.5 text-muted-foreground" /></div>
          <input
            type="text" value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search"
            className="w-44 pl-7 pr-7 py-1 rounded-full text-sm placeholder:text-sm placeholder:text-muted-foreground focus:outline-none border-none bg-muted-foreground/10 dark:bg-[#38383a]"
            aria-label="Search notes" autoComplete="off" ref={searchInputRef}
          />
          {searchQuery && <button type="button" onClick={clearSearch} className="absolute right-2 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search"><Icons.close className="h-3.5 w-3.5" /></button>}
        </div>
      </div>
    </div>
  );
}
