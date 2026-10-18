import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSessionOwner } from "@/lib/auth";
import { db, getAccessibleNoteById, getSharedNote } from "@/lib/db";
import { HttpError, errorResponse } from "@/lib/http";
import { attachments } from "@/shared/attachments";
import { readImageObject } from "@/lib/object-storage";
import { MAX_IMAGE_BYTES } from "@/lib/image-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const path = (await params).path.join("/");
    if (!/^note-images\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/i.test(path)) throw new HttpError(404, "Image not found.");
    const [image] = await db.select().from(attachments).where(and(eq(attachments.path, path), eq(attachments.status, "ready"))).limit(1);
    if (!image) throw new HttpError(404, "Image not found.");
    const ownerId = await getSessionOwner();
    let note = await getAccessibleNoteById(image.note_id, ownerId || undefined);
    const share = request.nextUrl.searchParams.get("share");
    if (!note && share) note = await getSharedNote(share);
    if (!note || note.id !== image.note_id || note.deleted_at) throw new HttpError(404, "Image not found.");
    const bytes = await readImageObject(image.path);
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.length !== image.size) throw new HttpError(404, "Image not found.");
    return new NextResponse(new Uint8Array(bytes), { headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${image.id}.webp"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "Vary": "Cookie",
    } });
  } catch (error) { return errorResponse(error); }
}
