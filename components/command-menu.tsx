"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "./ui/command";
import { DialogTitle, DialogDescription } from "./ui/dialog";
import { Pin, ArrowUp, ArrowDown, Trash, PenSquare, Moon, Sun } from "lucide-react";
import { searchNotes } from "@/lib/search";
import { Note } from "@/lib/types";
import { useTheme } from "next-themes";

export interface CommandMenuProps {
  notes: Note[];
  onCreateNote: () => void;
  creatingDisabled: boolean;
  onNoteSelect: (note: Note) => void;
  navigateNotes: (direction: "up" | "down") => void;
  togglePinned: (slug: string) => void;
  deleteNote: (note: Note) => void;
  highlightedNote: Note | null;
  onOpenChange: (open: boolean) => void;
}

export const CommandMenu = forwardRef<{ setOpen: (open: boolean) => void }, CommandMenuProps>(
  ({ notes, onCreateNote, creatingDisabled, onNoteSelect, navigateNotes, togglePinned, deleteNote, highlightedNote, onOpenChange }, ref) => {
    const [open, setOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const { setTheme, theme } = useTheme();
    const changeOpen = (next: boolean) => {
      setOpen(next);
      onOpenChange(next);
      if (!next) setSearchTerm("");
    };
    useImperativeHandle(ref, () => ({ setOpen: changeOpen }));

    const run = (action: () => void) => {
      changeOpen(false);
      action();
    };
    const commands = [
      { name: "New note", icon: <PenSquare />, shortcut: "N", disabled: creatingDisabled, action: onCreateNote },
      ...(highlightedNote ? [{ name: "Pin or unpin", icon: <Pin />, shortcut: "P", action: () => togglePinned(highlightedNote.slug) }] : []),
      { name: "Move up", icon: <ArrowUp />, shortcut: "K", action: () => navigateNotes("up") },
      { name: "Move down", icon: <ArrowDown />, shortcut: "J", action: () => navigateNotes("down") },
      ...(highlightedNote?.can_edit ? [{ name: "Delete note", icon: <Trash />, shortcut: "", action: () => deleteNote(highlightedNote) }] : []),
      { name: "Toggle theme", icon: theme === "light" ? <Moon /> : <Sun />, shortcut: "T", action: () => setTheme(theme === "light" ? "dark" : "light") },
    ];
    const filteredNotes = searchNotes(notes, searchTerm);
    const filteredCommands = commands.filter((command) => command.name.toLowerCase().includes(searchTerm.toLowerCase()));

    return (
      <CommandDialog open={open} onOpenChange={changeOpen}>
        <DialogTitle className="sr-only">Command Menu</DialogTitle>
        <DialogDescription className="sr-only">Execute a command or search for a note</DialogDescription>
        <CommandInput placeholder="Type a command or search for a note..." value={searchTerm} onValueChange={setSearchTerm} />
        <CommandList>
          <CommandEmpty>No results found</CommandEmpty>
          {filteredCommands.length > 0 && <CommandGroup heading="Commands">{filteredCommands.map((command) => (
            <CommandItem key={command.name} value={`command:${command.name}`} disabled={"disabled" in command && command.disabled} onSelect={() => run(command.action)}>
              {command.icon}<span className="ml-2">{command.name}</span><CommandShortcut>{command.shortcut}</CommandShortcut>
            </CommandItem>
          ))}</CommandGroup>}
          {filteredNotes.length > 0 && <CommandGroup heading="Notes">{filteredNotes.map((note) => (
            <CommandItem key={note.id} value={`note:${note.id}`} onSelect={() => run(() => onNoteSelect(note))}>{note.emoji} {note.title || "New note"}</CommandItem>
          ))}</CommandGroup>}
        </CommandList>
      </CommandDialog>
    );
  }
);
CommandMenu.displayName = "CommandMenu";
