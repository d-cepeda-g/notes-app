"use client";

import { useEffect, useState, useRef, useCallback, useMemo, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToastAction } from "@/components/ui/toast";
import { useMobileDetect } from "./mobile-detector";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { SessionNotesProvider, useSessionNotes } from "@/app/notes/session-notes";
import Header from "./header";
import NewNote from "./new-note";
import { Pin } from "lucide-react";
import { CommandMenu } from "./command-menu";
import { SidebarContent } from "./sidebar-content";
import { DeletedNotesNavigation } from "./deleted-notes-navigation";
import { groupNotesByCategory, sortGroupedNotes } from "@/lib/note-utils";
import { searchNotes } from "@/lib/search";
import { getAdjacentNote } from "@/lib/note-navigation";
import { createNote, SESSION_EXPIRED_MESSAGE, SessionExpiredError } from "@/lib/create-note";
import { Note } from "@/lib/types";
import { toast } from "./ui/use-toast";
import { useTheme } from "next-themes";

const labels = {
  pinned: <><Pin className="inline-block w-4 h-4 mr-1" /> Pinned</>,
  today: "Today", yesterday: "Yesterday", "7": "Previous 7 Days", "30": "Previous 30 Days", older: "Older",
};
const categoryOrder = ["pinned", "today", "yesterday", "7", "30", "older"];

interface SidebarLayoutProps { children: React.ReactNode; notes: Note[]; initialTimestamp: string; }

function SidebarLayoutInner({ children, notes: publicNotes, initialTimestamp }: SidebarLayoutProps) {
  const isMobile = useMobileDetect();
  const router = useRouter();
  const pathname = usePathname();
  const trashFromUrl = useSearchParams().get("view") === "trash";
  const { notes: sessionNotes, deletedNotes, ready, error, refreshSessionNotes, upsertNote, expireSession } = useSessionNotes();
  const { setTheme, theme } = useTheme();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedNoteSlug, setSelectedNoteSlug] = useState<string | null>(null);
  const [pinnedNotes, setPinnedNotes] = useState<Set<string>>(new Set());
  const [pinsLoaded, setPinsLoaded] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [openSwipeItemSlug, setOpenSwipeItemSlug] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const isTrashView = showDeleted || trashFromUrl;
  const [creating, setCreating] = useState(false);
  const [busyNoteIds, setBusyNoteIds] = useState<Set<string>>(new Set());
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const creationPending = useRef(false);
  const pendingNoteIds = useRef(new Set<string>());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const commandMenuRef = useRef<{ setOpen: (open: boolean) => void } | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);

  const notes = useMemo(() => [...publicNotes, ...sessionNotes].filter((note) => !note.deleted_at), [publicNotes, sessionNotes]);
  const groupedNotes = useMemo(() => {
    const grouped = groupNotesByCategory(notes, pinnedNotes, isMobile === null
      ? { now: new Date(initialTimestamp), utc: true }
      : undefined);
    sortGroupedNotes(grouped);
    return grouped as Record<string, Note[]>;
  }, [notes, pinnedNotes, isMobile, initialTimestamp]);
  const localSearchResults = useMemo(() => searchQuery.trim() ? searchNotes(notes, searchQuery) : null, [notes, searchQuery]);
  const selectedNote = notes.find((note) => note.slug === selectedNoteSlug) || null;
  const highlightedNote = showDeleted ? null : (localSearchResults ? localSearchResults[highlightedIndex] || null : selectedNote);
  const flattenedNotes = useMemo(() => categoryOrder.flatMap((category) => groupedNotes[category] || []), [groupedNotes]);

  useEffect(() => {
    try {
      const storedSidebar = localStorage.getItem("sidebarOpen");
      if (storedSidebar !== null) setIsSidebarOpen(storedSidebar === "true");
      const storedPins = JSON.parse(localStorage.getItem("pinnedNotes") || "null");
      setPinnedNotes(new Set(Array.isArray(storedPins) ? storedPins.filter((slug): slug is string => typeof slug === "string") : ["about-me", "quick-links"]));
    } catch {
      setPinnedNotes(new Set(["about-me", "quick-links"]));
    }
    setPinsLoaded(true);
  }, []);

  useEffect(() => {
    if (pinsLoaded) {
      try { localStorage.setItem("pinnedNotes", JSON.stringify(Array.from(pinnedNotes))); } catch {}
    }
  }, [pinnedNotes, pinsLoaded]);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((previous) => {
      try { localStorage.setItem("sidebarOpen", JSON.stringify(!previous)); } catch {}
      return !previous;
    });
  }, []);

  useEffect(() => {
    // Only select a default on the desktop home screen; never rewrite a note deep link.
    if (isMobile === false && pathname === "/notes" && !selectedNoteSlug && !showDeleted && !trashFromUrl) {
      const initialNote = notes.find((note) => note.slug === "about-me") || notes[0];
      if (initialNote) router.replace(`/notes/${initialNote.slug}`);
    }
  }, [isMobile, pathname, selectedNoteSlug, notes, showDeleted, trashFromUrl, router]);

  useEffect(() => {
    setShowDeleted(trashFromUrl);
    setSelectedNoteSlug(pathname?.startsWith("/notes/") ? pathname.split("/").pop() || null : null);
  }, [pathname, trashFromUrl]);

  useEffect(() => {
    if (!selectedNoteSlug || !scrollViewportRef.current) return;
    const selectedElement = Array.from(scrollViewportRef.current.querySelectorAll<HTMLElement>("[data-note-slug]")).find((element) => element.dataset.noteSlug === selectedNoteSlug);
    selectedElement?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedNoteSlug]);

  useEffect(() => { setHighlightedIndex(0); }, [searchQuery]);

  const clearSearch = useCallback(() => { setSearchQuery(""); setHighlightedIndex(0); }, []);
  const handleSearch = useCallback((query: string) => {
    setShowDeleted(false);
    if (trashFromUrl) router.replace("/notes");
    if (query.trim()) setIsSidebarOpen(true);
    setSearchQuery(query);
  }, [trashFromUrl, router]);
  const handleNoteSelect = useCallback((note: Note) => {
    clearSearch();
    setShowDeleted(false);
    setSelectedNoteSlug(note.slug);
    setOpenSwipeItemSlug(null);
  }, [clearSearch]);
  const openNote = useCallback((note: Note) => { handleNoteSelect(note); router.push(`/notes/${note.slug}`); }, [handleNoteSelect, router]);

  const handleCreateNote = useCallback(async () => {
    if (!ready || creationPending.current) return;
    creationPending.current = true;
    setCreating(true);
    try {
      const note = await createNote();
      upsertNote(note);
      setPinnedNotes((previous) => new Set([...Array.from(previous), note.slug]));
      setShowDeleted(false);
      clearSearch();
      setSelectedNoteSlug(note.slug);
      router.push(`/notes/${note.slug}`);
      toast({ description: "Private note created" });
    } catch (failure) {
      if (failure instanceof SessionExpiredError) expireSession();
      toast({ description: failure instanceof Error ? failure.message : "Could not create your note. Please try again.", variant: "destructive" });
    } finally {
      creationPending.current = false;
      setCreating(false);
    }
  }, [ready, upsertNote, clearSearch, router, expireSession]);

  const handlePinToggle = useCallback((slug: string) => {
    const isPinning = !pinnedNotes.has(slug);
    setPinnedNotes((previous) => {
      const next = new Set(previous);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
    clearSearch();
    toast({ description: isPinning ? "Note pinned" : "Note unpinned" });
  }, [pinnedNotes, clearSearch]);

  const markBusy = useCallback((id: string, busy: boolean) => {
    if (busy) pendingNoteIds.current.add(id); else pendingNoteIds.current.delete(id);
    setBusyNoteIds(new Set(pendingNoteIds.current));
  }, []);

  const restoreNote = useCallback(async (trashedNote: Note, open = false) => {
    if (!ready || pendingNoteIds.current.has(trashedNote.id)) return;
    markBusy(trashedNote.id, true);
    try {
      const current = deletedNotes.find((note) => note.id === trashedNote.id) || trashedNote;
      const response = await fetch(`/api/notes/${current.id}`, {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: current.revision, restore: true }),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 401) { expireSession(); throw new SessionExpiredError(); }
      if (!response.ok) {
        if (response.status === 409 && data?.note) upsertNote(data.note);
        throw new Error(response.status === 409 ? "This note changed. Please try restoring it again." : "Could not restore your note. Please try again.");
      }
      upsertNote(data as Note);
      if (open) openNote(data as Note);
      toast({ description: "Note restored" });
    } catch (failure) {
      toast({ description: failure instanceof Error ? failure.message : "Could not restore your note.", variant: "destructive" });
    } finally { markBusy(trashedNote.id, false); }
  }, [ready, deletedNotes, upsertNote, markBusy, openNote, expireSession]);

  const handleNoteDelete = useCallback(async (noteToDelete: Note) => {
    if (!ready || !noteToDelete.can_edit || noteToDelete.public || pendingNoteIds.current.has(noteToDelete.id)) return;
    markBusy(noteToDelete.id, true);
    try {
      const current = sessionNotes.find((note) => note.id === noteToDelete.id) || noteToDelete;
      const response = await fetch(`/api/notes/${current.id}`, {
        method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: current.revision }),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 401) { expireSession(); throw new SessionExpiredError(); }
      if (!response.ok) {
        if (response.status === 409 && data?.note) upsertNote(data.note);
        throw new Error(response.status === 409 ? "This note changed. Review it before deleting it again." : "Could not delete your note. Please try again.");
      }
      const trashedNote = data as Note;
      upsertNote(trashedNote);
      clearSearch();
      setOpenSwipeItemSlug(null);
      if (selectedNoteSlug === current.slug) {
        const remaining = flattenedNotes.filter((note) => note.id !== current.id);
        const next = remaining[0];
        setSelectedNoteSlug(next?.slug || null);
        router.push(!isMobile && next ? `/notes/${next.slug}` : "/notes");
      }
      toast({
        description: "Note moved to Recently Deleted",
        duration: 8000,
        action: <ToastAction altText="Restore deleted note" onClick={() => { void restoreNote(trashedNote); }}>Undo</ToastAction>,
      });
    } catch (failure) {
      toast({ description: failure instanceof Error ? failure.message : "Could not delete your note.", variant: "destructive" });
    } finally { markBusy(noteToDelete.id, false); }
  }, [ready, sessionNotes, selectedNoteSlug, flattenedNotes, isMobile, router, upsertNote, clearSearch, restoreNote, markBusy, expireSession]);

  const navigateNotes = useCallback((direction: "up" | "down") => {
    if (showDeleted) return;
    const next = getAdjacentNote(flattenedNotes, selectedNoteSlug, direction);
    if (next) openNote(next);
  }, [showDeleted, flattenedNotes, selectedNoteSlug, openNote]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        commandMenuRef.current?.setOpen(!commandMenuOpen);
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : document.body;
      if (commandMenuOpen || target.closest('[role="dialog"], [role="menu"]')) return;
      if (target === searchInputRef.current) {
        if (event.key === "Escape") { event.preventDefault(); clearSearch(); target.blur(); }
        if (localSearchResults?.length && ["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          const offset = event.key === "ArrowDown" ? 1 : -1;
          setHighlightedIndex((previous) => (previous + offset + localSearchResults.length) % localSearchResults.length);
        }
        if (event.key === "Enter" && localSearchResults?.length) {
          event.preventDefault();
          openNote(localSearchResults[highlightedIndex] || localSearchResults[0]);
        }
        return;
      }
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Focused links and buttons keep their native Enter/Space behavior.
      if (event.key === "n") { event.preventDefault(); void handleCreateNote(); }
      else if (event.key === "/") { event.preventDefault(); searchInputRef.current?.focus(); }
      else if (event.key === "Escape") { clearSearch(); target.blur(); }
      else if (["j", "ArrowDown", "k", "ArrowUp"].includes(event.key)) { event.preventDefault(); navigateNotes(["j", "ArrowDown"].includes(event.key) ? "down" : "up"); }
      else if (event.key === "p" && highlightedNote) { event.preventDefault(); handlePinToggle(highlightedNote.slug); }
      else if (event.key === "t") { event.preventDefault(); setTheme(theme === "dark" ? "light" : "dark"); }
      else if (event.key === "[") { event.preventDefault(); toggleSidebar(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandMenuOpen, clearSearch, localSearchResults, highlightedIndex, openNote, handleCreateNote, navigateNotes, highlightedNote, handlePinToggle, theme, setTheme, toggleSidebar]);

  const showSidebar = isMobile ? pathname === "/notes" : isSidebarOpen;
  return (
    <div className="dark:text-white h-dvh flex flex-col">
      <CommandMenu ref={commandMenuRef} notes={notes} onCreateNote={() => { void handleCreateNote(); }} creatingDisabled={!ready || creating} onNoteSelect={openNote} navigateNotes={navigateNotes} togglePinned={handlePinToggle} deleteNote={(note) => { void handleNoteDelete(note); }} highlightedNote={highlightedNote} onOpenChange={setCommandMenuOpen} />
      {!isMobile && <Header searchInputRef={searchInputRef} searchQuery={searchQuery} onSearchChange={handleSearch} clearSearch={clearSearch} isSidebarOpen={isSidebarOpen} toggleSidebar={toggleSidebar} onCreateNote={() => { void handleCreateNote(); }} creatingDisabled={!ready || creating} />}
      <div className="flex flex-1 overflow-hidden">
        {showSidebar && <div className={`${isMobile ? "w-full max-w-[100vw] overflow-x-hidden" : "w-[320px] shrink-0 border-r border-muted-foreground/20"} h-full flex flex-col dark:bg-muted transition-all duration-200`} style={isMobile ? { width: "100%", maxWidth: "100vw" } : undefined}>
          {isMobile && <div className="flex flex-col border-b border-muted-foreground/20">
            <div className="flex items-center justify-between px-4 py-3">
              <div><h1 className="text-2xl font-bold">Notes</h1><p className="text-xs text-muted-foreground">{notes.length} Notes</p></div>
              <NewNote onCreate={() => { void handleCreateNote(); }} disabled={!ready || creating} />
            </div>
            <p className="px-4 pb-3 text-xs text-muted-foreground/70">👋 New here? Start with <button type="button" onClick={() => { clearSearch(); setShowDeleted(false); router.push('/notes/about-me'); }} className="underline hover:text-foreground transition-colors">about me</button></p>
          </div>}
          <ScrollArea className="flex-1" isMobile={Boolean(isMobile)}>
            <div ref={scrollViewportRef} className="flex flex-col overflow-x-hidden box-border" style={isMobile ? { width: "calc(100vw - 32px)", maxWidth: "calc(100vw - 32px)", marginLeft: "16px", marginRight: "16px" } : { width: "100%" }}>
              <div className={`${isMobile ? "w-full" : "w-[320px] px-4"} overflow-hidden box-border`}>
                {isMobile && <div className="pt-2 pb-4 box-border w-full"><div className="relative w-full box-border">
                  <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none"><svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg></div>
                  <input type="text" value={searchQuery} onChange={(event) => handleSearch(event.target.value)} placeholder="Search" aria-label="Search notes" autoComplete="off" className="w-full pl-9 pr-4 py-2 rounded-lg text-base placeholder:text-muted-foreground focus:outline-none border border-muted-foreground/20 dark:border-none dark:bg-[#353533] box-border" ref={searchInputRef} />
                </div></div>}
                {error && <div role="alert" className="px-2 py-3 text-xs"><p>{error}</p><button type="button" className="underline mt-1" onClick={() => { if (error === SESSION_EXPIRED_MESSAGE) window.location.reload(); else void refreshSessionNotes().catch(() => {}); }}>{error === SESSION_EXPIRED_MESSAGE ? "Reload" : "Retry"}</button></div>}
                <DeletedNotesNavigation
                  count={deletedNotes.length}
                  ready={ready}
                  selected={isTrashView}
                  onShowNotes={() => { clearSearch(); setShowDeleted(false); router.push("/notes"); }}
                  onShowDeleted={() => { clearSearch(); setShowDeleted(true); router.push("/notes?view=trash"); }}
                />
                {isTrashView ? <section aria-label="Recently Deleted" className="py-2">
                  <h2 className="px-2 py-1 text-xs font-bold text-muted-foreground">Recently Deleted</h2>
                  {deletedNotes.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-muted-foreground">{ready ? "No recently deleted notes" : "Loading notes…"}</p>
                  ) : (
                    <ul>{deletedNotes.map((note) => (
                      <li key={note.id} className="flex min-h-[70px] items-center justify-between gap-3 border-b border-muted-foreground/20 px-3 py-2">
                        <span className="min-w-0 truncate text-sm font-medium">{note.emoji} {note.title || "New note"}</span>
                        <button
                          type="button"
                          disabled={!ready || busyNoteIds.has(note.id)}
                          onClick={() => { void restoreNote(note, true); }}
                          aria-label={`Restore ${note.title || "New note"}`}
                          className="min-h-11 shrink-0 rounded-full border border-muted-foreground/20 bg-background/50 px-3 text-xs font-medium text-[#e2a727] transition-colors hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50 md:min-h-9"
                        >Restore</button>
                      </li>
                    ))}</ul>
                  )}
                </section> : <SidebarContent groupedNotes={groupedNotes} selectedNoteSlug={selectedNoteSlug} onNoteSelect={handleNoteSelect} handlePinToggle={handlePinToggle} pinnedNotes={pinnedNotes} localSearchResults={localSearchResults} highlightedIndex={highlightedIndex} categoryOrder={categoryOrder} labels={labels} handleNoteDelete={handleNoteDelete} openSwipeItemSlug={openSwipeItemSlug} setOpenSwipeItemSlug={setOpenSwipeItemSlug} clearSearch={clearSearch} setSelectedNoteSlug={setSelectedNoteSlug} />}
              </div>
            </div>
          </ScrollArea>
        </div>}
        {/* Keep the route mounted while the mobile list hides it, including during navigation and resizing. */}
        <div hidden={Boolean(isMobile && showSidebar)} className="flex-grow min-w-0 h-full overflow-hidden"><ScrollArea className="h-full" isMobile={Boolean(isMobile)}>{children}</ScrollArea></div>
      </div>
      <Toaster />
    </div>
  );
}

export default function SidebarLayout({ children, notes, initialTimestamp }: SidebarLayoutProps) {
  return <SessionNotesProvider><Suspense fallback={children}><SidebarLayoutInner notes={notes} initialTimestamp={initialTimestamp}>{children}</SidebarLayoutInner></Suspense></SessionNotesProvider>;
}
