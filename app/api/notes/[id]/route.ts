import { NextRequest, NextResponse } from "next/server";
import { updateNote, deleteNote, restoreNote } from "@/lib/db";
import { assertSameOrigin, requireSession } from "@/lib/auth";
import { allowKeys, errorResponse, HttpError, parseUpdates, privateHeaders, readJson, requireRevision, requireUuid } from "@/lib/http";
import { revalidatePath } from "next/cache";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    assertSameOrigin(request);
    const owner = await requireSession(request);
    const id = requireUuid((await params).id);
    const body = await readJson(request);
    allowKeys(body, ["revision", "updates", "restore"]);
    const revision = requireRevision(body.revision);
    if ("restore" in body && (body.restore !== true || "updates" in body)) throw new HttpError(400, "Invalid restore request");
    const note = body.restore === true ? await restoreNote(id, owner, revision) : await updateNote(id, owner, revision, parseUpdates(body.updates));
    revalidatePath(`/notes/${note.slug}`);
    revalidatePath("/notes", "layout");
    return NextResponse.json(note, { headers: privateHeaders });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    assertSameOrigin(request);
    const owner = await requireSession(request);
    const id = requireUuid((await params).id);
    const body = await readJson(request);
    allowKeys(body, ["revision"]);
    const note = await deleteNote(id, owner, requireRevision(body.revision));
    revalidatePath(`/notes/${note.slug}`);
    revalidatePath("/notes", "layout");
    return NextResponse.json(note, { headers: privateHeaders });
  } catch (error) { return errorResponse(error); }
}
