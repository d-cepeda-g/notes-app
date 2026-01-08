import { NextRequest, NextResponse } from "next/server";
import { createNote as createNoteDb, getSessionNotes } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id");
  
  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }
  
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session_id format" }, { status: 400 });
  }
  
  try {
    const notes = await getSessionNotes(sessionId);
    return NextResponse.json(notes);
  } catch (error) {
    console.error("Error fetching session notes:", error);
    return NextResponse.json({ error: "Failed to fetch notes" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    if (!body.session_id) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(body.session_id)) {
      return NextResponse.json({ error: "Invalid session_id format" }, { status: 400 });
    }
    
    const noteData = {
      id: body.id || uuidv4(),
      title: body.title || "",
      content: body.content || "",
      slug: body.slug || `note-${uuidv4()}`,
      session_id: body.session_id,
      public: false,
      category: body.category || "today",
      emoji: body.emoji || "👋🏼",
    };
    
    const note = await createNoteDb(noteData);
    return NextResponse.json(note);
  } catch (error) {
    console.error("Error creating note:", error);
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }
}
