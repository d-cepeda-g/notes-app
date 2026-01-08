"use client";

import { useEffect, useState, useRef, useCallback, useMemo, useContext } from "react";
import { Toaster } from "@/components/ui/toaster";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMobileDetect } from "./mobile-detector";
import { useRouter, usePathname } from "next/navigation";
import { SessionNotesProvider, SessionNotesContext } from "@/app/notes/session-notes";
import Header from "./header";
import NewNote from "./new-note";
import { Pin } from "lucide-react";
import SessionId from "./session-id";
import { CommandMenu } from "./command-menu";
import { SidebarContent } from "./sidebar-content";
import { groupNotesByCategory, sortGroupedNotes } from "@/lib/note-utils";
import { Note } from "@/lib/types";
import { toast } from "./ui/use-toast";
import { useTheme } from "next-themes";

const labels = {
  pinned: (
    <>
      <Pin className="inline-block w-4 h-4 mr-1" /> Pinned
    </>
  ),
  today: "Today",
  yesterday: "Yesterday",
  "7": "Previous 7 Days",
  "30": "Previous 30 Days",
  older: "Older",
};

const categoryOrder = ["pinned", "today", "yesterday", "7", "30", "older"];

interface SidebarLayoutProps {
  children: React.ReactNode;
  notes: any;
}

function SidebarLayoutInner({ children, notes: publicNotes }: SidebarLayoutProps) {
  const isMobile = useMobileDetect();
  const router = useRouter();
  const pathname = usePathname();

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isScrolled, setIsScrolled] = useState(false);
  const [selectedNoteSlug, setSelectedNoteSlug] = useState<string | null>(null);
  const [pinnedNotes, setPinnedNotes] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [localSearchResults, setLocalSearchResults] = useState<any[] | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [groupedNotes, setGroupedNotes] = useState<any>({});
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [openSwipeItemSlug, setOpenSwipeItemSlug] = useState<string | null>(null);
  const [highlightedNote, setHighlightedNote] = useState<Note | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const commandMenuRef = useRef<{ setOpen: (open: boolean) => void } | null>(null);
  const selectedNoteRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const hasSeenSidebarRef = useRef(false);

  const {
    notes: sessionNotes,
    sessionId,
    setSessionId,
    refreshSessionNotes,
  } = useContext(SessionNotesContext);

  const notes = useMemo(
    () => [...publicNotes, ...sessionNotes],
    [publicNotes, sessionNotes]
  );

  useEffect(() => {
    const stored = localStorage.getItem("sidebarOpen");
    if (stored !== null) {
      setIsSidebarOpen(JSON.parse(stored));
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => {
      const newValue = !prev;
      localStorage.setItem("sidebarOpen", JSON.stringify(newValue));
      return newValue;
    });
  }, []);

  useEffect(() => {
    if (isMobile !== null && !isMobile && pathname === "/notes") {
      router.push("/notes/about-me");
    }
    // On mobile, redirect to sidebar on initial load only (not on subsequent navigations)
    // Skip redirect for private notes shared by link (notes with session_id)
    if (isMobile && !hasSeenSidebarRef.current && pathname !== "/notes" && pathname?.startsWith("/notes/")) {
      const slug = pathname.split("/").pop();
      const targetNote = [...publicNotes, ...sessionNotes].find((n) => n.slug === slug);
      const isPrivateNote = targetNote?.session_id;
      
      if (!isPrivateNote) {
        hasSeenSidebarRef.current = true;
        router.replace("/notes");
      }
    }
    // Mark as seen when user is on the sidebar
    if (isMobile && pathname === "/notes") {
      hasSeenSidebarRef.current = true;
    }
  }, [isMobile, router, pathname, publicNotes, sessionNotes]);

  useEffect(() => {
    if (selectedNoteSlug && scrollViewportRef.current) {
      const selectedElement = scrollViewportRef.current.querySelector(`[data-note-slug="${selectedNoteSlug}"]`);
      if (selectedElement) {
        selectedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedNoteSlug]);

  useEffect(() => {
    if (pathname) {
      const slug = pathname.split("/").pop();
      setSelectedNoteSlug(slug || null);
    }
  }, [pathname]);

  useEffect(() => {
    if (selectedNoteSlug) {
      const note = notes.find((note) => note.slug === selectedNoteSlug);
      setSelectedNote(note || null);
    } else {
      setSelectedNote(null);
    }
  }, [selectedNoteSlug, notes]);

  useEffect(() => {
    const storedPinnedNotes = localStorage.getItem("pinnedNotes");
    if (storedPinnedNotes) {
      setPinnedNotes(new Set(JSON.parse(storedPinnedNotes)));
    } else {
      const initialPinnedNotes = new Set(
        notes
          .filter(
            (note) =>
              note.slug === "about-me" ||
              note.slug === "quick-links" ||
              note.session_id === sessionId
          )
          .map((note) => note.slug)
      );
      setPinnedNotes(initialPinnedNotes);
      localStorage.setItem("pinnedNotes", JSON.stringify(Array.from(initialPinnedNotes)));
    }
  }, [notes, sessionId]);

  useEffect(() => {
    const userSpecificNotes = notes.filter(
      (note) => note.public || note.session_id === sessionId
    );
    const grouped = groupNotesByCategory(userSpecificNotes, pinnedNotes);
    sortGroupedNotes(grouped);
    setGroupedNotes(grouped);
  }, [notes, sessionId, pinnedNotes]);

  useEffect(() => {
    if (localSearchResults && localSearchResults.length > 0) {
      setHighlightedNote(localSearchResults[highlightedIndex]);
    } else {
      setHighlightedNote(selectedNote);
    }
  }, [localSearchResults, highlightedIndex, selectedNote]);

  const clearSearch = useCallback(() => {
    setLocalSearchResults(null);
    setSearchQuery("");
    setHighlightedIndex(0);
    if (searchInputRef.current) {
      searchInputRef.current.value = "";
    }
  }, []);

  const flattenedNotes = useCallback(() => {
    return categoryOrder.flatMap((category) =>
      groupedNotes[category] ? groupedNotes[category] : []
    );
  }, [groupedNotes]);

  const navigateNotes = useCallback(
    (direction: "up" | "down") => {
      if (!localSearchResults) {
        const flattened = flattenedNotes();
        const currentIndex = flattened.findIndex((note) => note.slug === selectedNoteSlug);
        
        let nextIndex;
        if (direction === "up") {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : flattened.length - 1;
        } else {
          nextIndex = currentIndex < flattened.length - 1 ? currentIndex + 1 : 0;
        }

        const nextNote = flattened[nextIndex];
        if (nextNote) {
          router.push(`/notes/${nextNote.slug}`);
          setTimeout(() => {
            const selectedElement = document.querySelector(`[data-note-slug="${nextNote.slug}"]`);
            if (selectedElement) {
              selectedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          }, 100);
        }
      }
    },
    [flattenedNotes, selectedNoteSlug, router, localSearchResults]
  );

  const handlePinToggle = useCallback(
    (slug: string) => {
      let isPinning = false;
      setPinnedNotes((prev) => {
        const newPinned = new Set(prev);
        isPinning = !newPinned.has(slug);
        if (isPinning) {
          newPinned.add(slug);
        } else {
          newPinned.delete(slug);
        }
        localStorage.setItem("pinnedNotes", JSON.stringify(Array.from(newPinned)));
        return newPinned;
      });

      clearSearch();

      if (!isMobile) {
        router.push(`/notes/${slug}`);
      }

      toast({ description: isPinning ? "Note pinned" : "Note unpinned" });
    },
    [router, isMobile, clearSearch]
  );

  const handleNoteDelete = useCallback(
    async (noteToDelete: Note) => {
      if (noteToDelete.public) {
        toast({ description: "Oops! You can't delete public notes" });
        return;
      }

      try {
        if (noteToDelete.id && sessionId) {
          await fetch(`/api/notes/${noteToDelete.id}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId }),
          });
        }

        setGroupedNotes((prevGroupedNotes: Record<string, Note[]>) => {
          const newGroupedNotes = { ...prevGroupedNotes };
          for (const category in newGroupedNotes) {
            newGroupedNotes[category] = newGroupedNotes[category].filter(
              (note: Note) => note.slug !== noteToDelete.slug
            );
          }
          return newGroupedNotes;
        });

        const allNotes = flattenedNotes();
        const deletedNoteIndex = allNotes.findIndex((note) => note.slug === noteToDelete.slug);

        let nextNote;
        if (deletedNoteIndex === 0) {
          nextNote = allNotes[1];
        } else {
          nextNote = allNotes[deletedNoteIndex - 1];
        }

        if (!isMobile) {
          router.push(nextNote ? `/notes/${nextNote.slug}` : "/notes/about-me");
        }

        clearSearch();
        refreshSessionNotes();
        router.refresh();

        toast({ description: "Note deleted" });
      } catch (error) {
        console.error("Error deleting note:", error);
      }
    },
    [sessionId, flattenedNotes, isMobile, clearSearch, refreshSessionNotes, router]
  );

  const goToHighlightedNote = useCallback(() => {
    if (localSearchResults && localSearchResults[highlightedIndex]) {
      const selectedNote = localSearchResults[highlightedIndex];
      router.push(`/notes/${selectedNote.slug}`);
      setTimeout(() => {
        const selectedElement = document.querySelector(`[data-note-slug="${selectedNote.slug}"]`);
        selectedElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 0);
      clearSearch();
    }
  }, [localSearchResults, highlightedIndex, router, clearSearch]);

  const { setTheme, theme } = useTheme();

  useEffect(() => {
    const shortcuts = {
      j: () => navigateNotes("down"),
      ArrowDown: () => navigateNotes("down"),
      k: () => navigateNotes("up"),
      ArrowUp: () => navigateNotes("up"),
      p: () => highlightedNote && handlePinToggle(highlightedNote.slug),
      d: () => highlightedNote && handleNoteDelete(highlightedNote),
      "/": () => searchInputRef.current?.focus(),
      Escape: () => (document.activeElement as HTMLElement)?.blur(),
      t: () => setTheme(theme === "dark" ? "light" : "dark"),
      "[": () => toggleSidebar(),
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping =
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;

      if (isTyping) {
        if (event.key === "Escape") {
          shortcuts["Escape"]();
        } else if (event.key === "Enter" && localSearchResults && localSearchResults.length > 0) {
          event.preventDefault();
          goToHighlightedNote();
        }
        return;
      }

      const key = event.key as keyof typeof shortcuts;
      if (shortcuts[key] && !(event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        (document.activeElement as HTMLElement)?.blur();

        if (localSearchResults && ["j", "ArrowDown", "k", "ArrowUp"].includes(key)) {
          const direction = ["j", "ArrowDown"].includes(key) ? 1 : -1;
          setHighlightedIndex(
            (prevIndex) =>
              (prevIndex + direction + localSearchResults.length) % localSearchResults.length
          );
        } else {
          shortcuts[key]();
        }
      } else if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        commandMenuRef.current?.setOpen(true);
      } else if (event.key === "Enter" && localSearchResults && localSearchResults.length > 0) {
        event.preventDefault();
        goToHighlightedNote();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    navigateNotes,
    highlightedNote,
    handlePinToggle,
    localSearchResults,
    handleNoteDelete,
    goToHighlightedNote,
    setTheme,
    theme,
    toggleSidebar,
  ]);

  const handleNoteSelect = useCallback(
    (note: any) => {
      if (!isMobile) {
        router.push(`/notes/${note.slug}`);
      }
      clearSearch();
    },
    [clearSearch, isMobile, router]
  );

  if (isMobile === null) {
    return null;
  }

  const showSidebar = isMobile ? pathname === "/notes" : isSidebarOpen;

  return (
    <div className="dark:text-white h-dvh flex flex-col">
      {!isMobile && (
        <Header
          notes={notes}
          onSearchResults={setLocalSearchResults}
          sessionId={sessionId}
          searchInputRef={searchInputRef}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          setHighlightedIndex={setHighlightedIndex}
          clearSearch={clearSearch}
          isSidebarOpen={isSidebarOpen}
          toggleSidebar={toggleSidebar}
          isMobile={isMobile}
          addNewPinnedNote={handlePinToggle}
          setSelectedNoteSlug={setSelectedNoteSlug}
        />
      )}
      <div className="flex flex-1 overflow-hidden">
        {showSidebar && (
          <div
            className={`${
              isMobile ? "w-full max-w-[100vw] overflow-x-hidden" : "w-[320px] border-r border-muted-foreground/20"
            } h-full flex flex-col dark:bg-muted transition-all duration-200`}
            style={isMobile ? { width: '100%', maxWidth: '100vw' } : undefined}
          >
            {isMobile && (
              <div className="flex items-center justify-between px-4 py-3 border-b border-muted-foreground/20">
                <div>
                  <h1 className="text-2xl font-bold">Notes</h1>
                  <p className="text-xs text-muted-foreground">{notes.length} Notes</p>
                </div>
                <NewNote
                  addNewPinnedNote={handlePinToggle}
                  clearSearch={clearSearch}
                  setSelectedNoteSlug={setSelectedNoteSlug}
                  isMobile={isMobile}
                />
              </div>
            )}
            <ScrollArea
              className="flex-1"
              onScrollCapture={(e: React.UIEvent<HTMLDivElement>) => {
                const viewport = e.currentTarget.querySelector('[data-radix-scroll-area-viewport]');
                if (viewport) {
                  const scrolled = viewport.scrollTop > 0;
                  setIsScrolled(scrolled);
                }
              }}
              isMobile={isMobile}
            >
              <div 
                ref={scrollViewportRef} 
                className="flex flex-col overflow-x-hidden box-border"
                style={isMobile ? { width: 'calc(100vw - 32px)', maxWidth: 'calc(100vw - 32px)', marginLeft: '16px', marginRight: '16px' } : { width: '100%' }}
              >
                <SessionId setSessionId={setSessionId} />
                <CommandMenu
                  notes={notes}
                  sessionId={sessionId}
                  addNewPinnedNote={handlePinToggle}
                  navigateNotes={navigateNotes}
                  togglePinned={handlePinToggle}
                  deleteNote={handleNoteDelete}
                  highlightedNote={highlightedNote}
                  setSelectedNoteSlug={setSelectedNoteSlug}
                  isMobile={isMobile}
                />
                <div className={`${isMobile ? "w-full" : "w-[320px] px-4"} overflow-hidden box-border`}>
                  {isMobile && (
                    <div className="pt-2 pb-4 box-border w-full">
                      <div className="relative w-full box-border">
                        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                          <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </div>
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => {
                            const query = e.target.value;
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
                            setLocalSearchResults(filteredNotes);
                            setHighlightedIndex(0);
                          }}
                          placeholder="Search"
                          className="w-full pl-9 pr-4 py-2 rounded-lg text-base placeholder:text-muted-foreground focus:outline-none border border-muted-foreground/20 dark:border-none dark:bg-[#353533] box-border"
                          ref={searchInputRef}
                        />
                      </div>
                    </div>
                  )}
                  <div className="w-full box-border">
                    <SidebarContent
                      groupedNotes={groupedNotes}
                      selectedNoteSlug={selectedNoteSlug}
                      onNoteSelect={handleNoteSelect}
                      sessionId={sessionId}
                      handlePinToggle={handlePinToggle}
                      pinnedNotes={pinnedNotes}
                      localSearchResults={localSearchResults}
                      highlightedIndex={highlightedIndex}
                      categoryOrder={categoryOrder}
                      labels={labels}
                      handleNoteDelete={handleNoteDelete}
                      openSwipeItemSlug={openSwipeItemSlug}
                      setOpenSwipeItemSlug={setOpenSwipeItemSlug}
                      clearSearch={clearSearch}
                      setSelectedNoteSlug={setSelectedNoteSlug}
                    />
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>
        )}
        {(!isMobile || !showSidebar) && (
          <div className="flex-grow h-full overflow-hidden">
            <ScrollArea className="h-full" isMobile={isMobile}>
              {children}
            </ScrollArea>
          </div>
        )}
      </div>
      <Toaster />
    </div>
  );
}

export default function SidebarLayout({ children, notes }: SidebarLayoutProps) {
  return (
    <SessionNotesProvider>
      <SidebarLayoutInner notes={notes}>{children}</SidebarLayoutInner>
    </SessionNotesProvider>
  );
}
