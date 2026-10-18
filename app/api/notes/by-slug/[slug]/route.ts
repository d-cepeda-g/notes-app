import { NextRequest, NextResponse } from "next/server";
import { getNoteBySlug } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { errorResponse, HttpError, privateHeaders } from "@/lib/http";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    let owner: string | undefined;
    try { owner = await requireSession(request); } catch (error) { if (!(error instanceof HttpError) || error.status !== 401) throw error; }
    const note = await getNoteBySlug((await params).slug, owner);
    if (!note) throw new HttpError(404, "Note not found");
    return NextResponse.json(note, { headers: privateHeaders });
  } catch (error) { return errorResponse(error); }
}
