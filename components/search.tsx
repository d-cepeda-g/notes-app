import { RefObject, Dispatch, SetStateAction } from "react";
import { Note } from "@/lib/types";
import { searchNotes } from "@/lib/search";
import { Icons } from "./icons";

interface SearchBarProps {
  notes: Note[];
  onSearchResults: (results: Note[] | null) => void;
  inputRef: RefObject<HTMLInputElement>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  setHighlightedIndex: Dispatch<SetStateAction<number>>;
  clearSearch: () => void;
}

export function SearchBar({ notes, onSearchResults, inputRef, searchQuery, setSearchQuery, setHighlightedIndex, clearSearch }: SearchBarProps) {
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) return clearSearch();
    onSearchResults(searchNotes(notes, query));
    setHighlightedIndex(0);
  };
  return (
    <div className="p-2"><div className="relative">
      <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none"><Icons.search className="text-muted-foreground" /></div>
      <input id="search" type="text" value={searchQuery} onChange={(e) => handleSearch(e.target.value)} placeholder="Search" className="w-full pl-8 pr-8 py-0.5 rounded-lg text-base sm:text-sm placeholder:text-sm focus:outline-none border border-muted-foreground/20 dark:border-none dark:bg-[#353533]" aria-label="Search notes" autoComplete="off" ref={inputRef} />
      {searchQuery && <button type="button" onClick={clearSearch} className="absolute right-2 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search"><Icons.close className="h-4 w-4 text-muted-foreground" /></button>}
    </div></div>
  );
}
