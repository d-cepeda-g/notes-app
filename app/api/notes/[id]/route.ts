import { NextRequest, NextResponse } from "next/server";
import { updateNoteContent, updateNoteTitle, updateNoteEmoji, deleteNote, db } from "@/lib/db";
import { notes } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { session_id, field, value } = body;
    
    if (!session_id) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(session_id) || !uuidRegex.test(params.id)) {
      return NextResponse.json({ error: "Invalid UUID format" }, { status: 400 });
    }
    
    const existingNote = await db.select().from(notes)
      .where(and(eq(notes.id, params.id), eq(notes.session_id, session_id)))
      .limit(1);
    
    if (existingNote.length === 0) {
      return NextResponse.json({ error: "Note not found or access denied" }, { status: 404 });
    }
    
    if (field === "content") {
      await updateNoteContent(params.id, session_id, value);
    } else if (field === "title") {
      await updateNoteTitle(params.id, session_id, value);
    } else if (field === "emoji") {
      await updateNoteEmoji(params.id, session_id, value);
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating note:", error);
    return NextResponse.json({ error: "Failed to update note" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { session_id } = body;
    
    if (!session_id) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(session_id) || !uuidRegex.test(params.id)) {
      return NextResponse.json({ error: "Invalid UUID format" }, { status: 400 });
    }
    
    const existingNote = await db.select().from(notes)
      .where(and(eq(notes.id, params.id), eq(notes.session_id, session_id)))
      .limit(1);
    
    if (existingNote.length === 0) {
      return NextResponse.json({ error: "Note not found or access denied" }, { status: 404 });
    }
    
    await deleteNote(params.id, session_id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting note:", error);
    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }
}
