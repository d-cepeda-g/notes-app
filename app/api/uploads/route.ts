import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, lt, sql } from "drizzle-orm";
import { assertSameOrigin, requireSession } from "@/lib/auth";
import { db, getAccessibleNoteById } from "@/lib/db";
import { HttpError, errorResponse, requireUuid } from "@/lib/http";
import { attachments } from "@/shared/attachments";
import { normalizeImage, MAX_IMAGE_BYTES, MAX_UPLOAD_BODY_BYTES, MAX_OWNER_IMAGE_BYTES, MAX_NOTE_IMAGES } from "@/lib/image-validation";
import { saveImageObject, deleteImageObject } from "@/lib/object-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function boundedFormData(request: NextRequest): Promise<FormData> {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) {
    throw new HttpError(415, "Send an image using multipart/form-data.");
  }
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_UPLOAD_BODY_BYTES) throw new HttpError(413, "The upload exceeds 5 MB.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "An image is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_UPLOAD_BODY_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "The upload exceeds 5 MB.");
    }
    chunks.push(value);
  }
  try {
    return await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type")! } }).formData();
  } catch {
    throw new HttpError(400, "Invalid multipart upload.");
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const ownerId = await requireSession(request);
    const form = await boundedFormData(request);
    const noteId = form.get("noteId");
    const file = form.get("file");
    if (typeof noteId !== "string") throw new HttpError(400, "A valid note ID is required.");
    requireUuid(noteId);
    const note = await getAccessibleNoteById(noteId, ownerId);
    if (!note?.can_edit || note.deleted_at) throw new HttpError(404, "Note not found.");
    if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "An image is required.");
    if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "The image exceeds 5 MB.");
    let bytes: Buffer;
    try { bytes = await normalizeImage(Buffer.from(await file.arrayBuffer())); }
    catch { throw new HttpError(415, "Upload a valid JPEG, PNG, GIF, or WebP image up to 5 MB."); }
    const id = randomUUID();
    const path = `note-images/${noteId}/${id}.webp`;
    const stalePaths = await db.transaction(async (tx) => {
      // Cross-instance lock makes quota reservations atomic, including in-flight uploads.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`);
      const stale = await tx.delete(attachments).where(and(eq(attachments.owner_id, ownerId), eq(attachments.status, "pending"), lt(attachments.created_at, new Date(Date.now() - 60 * 60 * 1000)))).returning({ path: attachments.path });
      const [usage] = await tx.select({ total: sql<number>`coalesce(sum(${attachments.size}), 0)::int`, count: sql<number>`count(*) filter (where ${attachments.note_id} = ${noteId})::int` }).from(attachments).where(eq(attachments.owner_id, ownerId));
      if (usage.total + bytes.length > MAX_OWNER_IMAGE_BYTES || usage.count >= MAX_NOTE_IMAGES) throw new HttpError(413, "Image storage limit reached (100 MB per browser, 50 images per note).");
      await tx.insert(attachments).values({ id, note_id: noteId, owner_id: ownerId, path, content_type: "image/webp", size: bytes.length, status: "pending" });
      return stale.map((image) => image.path);
    });
    await Promise.all(stalePaths.map((path) => deleteImageObject(path).catch(() => {})));
    try {
      await saveImageObject(path, bytes);
      const [saved] = await db.update(attachments).set({ status: "ready" }).where(eq(attachments.id, id)).returning({ id: attachments.id });
      if (!saved) throw new Error("Upload reservation expired.");
    } catch (error) {
      await deleteImageObject(path).catch(() => {});
      await db.delete(attachments).where(eq(attachments.id, id));
      throw error;
    }
    return NextResponse.json({ url: `/api/uploads/serve/${path.split("/").map(encodeURIComponent).join("/")}` }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
