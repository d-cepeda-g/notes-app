import { NextRequest, NextResponse } from "next/server";
import { createNote, getSessionNotes } from "@/lib/db";
import { assertSameOrigin, requireSession } from "@/lib/auth";
import { allowKeys, errorResponse, parseUpdates, privateHeaders, readJson } from "@/lib/http";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const owner = await requireSession(request);
    const notes = await getSessionNotes(owner, request.nextUrl.searchParams.get("deleted") === "true");
    return NextResponse.json(notes, { headers: privateHeaders });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const owner = await requireSession(request);
    const body = await readJson(request);
    allowKeys(body, ["title", "content", "emoji"]);
    const note = await createNote(owner, parseUpdates(body, true));
    revalidatePath("/notes", "layout");
    return NextResponse.json(note, { status: 201, headers: privateHeaders });
  } catch (error) { return errorResponse(error); }
}
