import { NextRequest, NextResponse } from "next/server";
import { getNoteBySlug } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const note = await getNoteBySlug(params.slug);
    
    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }
    
    return NextResponse.json(note);
  } catch (error) {
    console.error("Error fetching note:", error);
    return NextResponse.json({ error: "Failed to fetch note" }, { status: 500 });
  }
}
