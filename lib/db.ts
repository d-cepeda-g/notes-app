import { randomUUID, createHash, randomBytes } from "crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { notes, noteShares } from "@shared/schema";
import { eq, or, and, isNull, isNotNull, desc, sql } from "drizzle-orm";
import type { Note, NoteUpdates } from "@/lib/types";
import { HttpError } from "@/lib/http";
import { applyPublicContent, getProjectsNote } from "@/lib/public-content";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

// Explicit projection: neither legacy session IDs nor owner IDs can enter a DTO.
const safeColumns = {
  id: notes.id, slug: notes.slug, title: notes.title, content: notes.content,
  created_at: notes.created_at, updated_at: notes.updated_at, deleted_at: notes.deleted_at,
  revision: notes.revision, public: notes.public, category: notes.category, emoji: notes.emoji,
};

function projection(ownerId?: string) {
  return { ...safeColumns, can_edit: ownerId ? sql<boolean>`coalesce(${notes.public} = false AND ${notes.owner_id} = ${ownerId}::uuid, false)` : sql<boolean>`false` };
}

type SafeRow = {
  id: string; slug: string | null; title: string | null; content: string | null;
  created_at: Date; updated_at: Date; deleted_at: Date | null; revision: number;
  public: boolean | null; category: string | null; emoji: string | null; can_edit: boolean;
};
function toNote(row: SafeRow): Note {
  return {
    id: row.id, slug: row.slug || row.id, title: row.title || "", content: row.content || "",
    created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(),
    deleted_at: row.deleted_at?.toISOString() || null, revision: row.revision,
    public: row.public === true, can_edit: row.can_edit === true,
    ...(row.category ? { category: row.category } : {}), ...(row.emoji ? { emoji: row.emoji } : {}),
  };
}

function accessible(ownerId?: string) {
  return and(isNull(notes.deleted_at), ownerId ? or(eq(notes.public, true), eq(notes.owner_id, ownerId)) : eq(notes.public, true));
}

export async function getPublicNotes(): Promise<Note[]> {
  const rows = await db.select(projection()).from(notes).where(and(eq(notes.public, true), isNull(notes.deleted_at))).orderBy(desc(notes.updated_at), desc(notes.id));
  const result = rows.map(row => applyPublicContent(toNote(row)));
  if (!result.some(note => note.slug === "projects")) {
    const [existing] = await db.select({ id: notes.id }).from(notes).where(eq(notes.slug, "projects")).limit(1);
    if (!existing) result.push(getProjectsNote());
  }
  return result;
}

export async function getSessionNotes(ownerId: string, deleted = false): Promise<Note[]> {
  const rows = await db.select(projection(ownerId)).from(notes)
    .where(and(eq(notes.owner_id, ownerId), eq(notes.public, false), deleted ? isNotNull(notes.deleted_at) : isNull(notes.deleted_at)))
    .orderBy(desc(notes.updated_at), desc(notes.id));
  return rows.map(toNote);
}

export async function getNoteBySlug(slug: string, ownerId?: string): Promise<Note | null> {
  const [row] = await db.select(projection(ownerId)).from(notes).where(and(eq(notes.slug, slug), accessible(ownerId))).limit(1);
  if (row) return applyPublicContent(toNote(row));
  if (slug === "projects") {
    const [existing] = await db.select({ id: notes.id }).from(notes).where(eq(notes.slug, slug)).limit(1);
    if (!existing) return getProjectsNote();
  }
  return null;
}

export async function getAccessibleNoteById(id: string, ownerId?: string): Promise<Note | null> {
  const [row] = await db.select(projection(ownerId)).from(notes).where(and(eq(notes.id, id), accessible(ownerId))).limit(1);
  return row ? toNote(row) : null;
}

export async function createNote(ownerId: string, updates: NoteUpdates = {}): Promise<Note> {
  const id = randomUUID();
  const [row] = await db.insert(notes).values({
    id, slug: `note-${id}`, owner_id: ownerId, title: updates.title || "", content: updates.content || "",
    emoji: updates.emoji ?? "👋🏼", public: false,
  }).returning(safeColumns);
  return toNote({ ...row, can_edit: true });
}

async function mutationMiss(id: string, ownerId: string): Promise<never> {
  const [current] = await db.select(projection(ownerId)).from(notes).where(and(eq(notes.id, id), eq(notes.owner_id, ownerId), eq(notes.public, false))).limit(1);
  if (!current) throw new HttpError(404, "Note not found");
  throw new HttpError(409, "This note changed in another window. Review the latest version before saving.", { note: toNote(current) });
}

export async function updateNote(id: string, ownerId: string, revision: number, updates: NoteUpdates): Promise<Note> {
  const [row] = await db.update(notes).set({ ...updates, updated_at: new Date(), revision: sql`${notes.revision} + 1` })
    .where(and(eq(notes.id, id), eq(notes.owner_id, ownerId), eq(notes.public, false), eq(notes.revision, revision), isNull(notes.deleted_at)))
    .returning(safeColumns);
  if (!row) return mutationMiss(id, ownerId);
  return toNote({ ...row, can_edit: true });
}

export async function deleteNote(id: string, ownerId: string, revision: number): Promise<Note> {
  const now = new Date();
  // Locking the note also serializes share creation/revocation with deletion.
  const deleted = await db.transaction(async tx => {
    const [row] = await tx.update(notes).set({ deleted_at: now, updated_at: now, revision: sql`${notes.revision} + 1` })
      .where(and(eq(notes.id, id), eq(notes.owner_id, ownerId), eq(notes.public, false), eq(notes.revision, revision), isNull(notes.deleted_at)))
      .returning(safeColumns);
    if (!row) return null;
    await tx.update(noteShares).set({ revoked_at: now }).where(and(eq(noteShares.note_id, id), isNull(noteShares.revoked_at)));
    return row;
  });
  if (!deleted) return mutationMiss(id, ownerId);
  return toNote({ ...deleted, can_edit: true });
}

export async function restoreNote(id: string, ownerId: string, revision: number): Promise<Note> {
  const [row] = await db.update(notes).set({ deleted_at: null, updated_at: new Date(), revision: sql`${notes.revision} + 1` })
    .where(and(eq(notes.id, id), eq(notes.owner_id, ownerId), eq(notes.public, false), eq(notes.revision, revision), isNotNull(notes.deleted_at)))
    .returning(safeColumns);
  if (!row) return mutationMiss(id, ownerId);
  return toNote({ ...row, can_edit: true });
}

function hashShare(token: string) { return createHash("sha256").update(token).digest("hex"); }

export async function createShare(id: string, ownerId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.transaction(async tx => {
    const [note] = await tx.select({ id: notes.id }).from(notes)
      .where(and(eq(notes.id, id), eq(notes.owner_id, ownerId), eq(notes.public, false), isNull(notes.deleted_at))).for("update");
    if (!note) throw new HttpError(404, "Note not found");
    await tx.insert(noteShares).values({ note_id: id, token_hash: hashShare(token) });
  });
  return token;
}

export async function revokeShares(id: string, ownerId: string): Promise<void> {
  await db.transaction(async tx => {
    const [note] = await tx.select({ id: notes.id }).from(notes)
      .where(and(eq(notes.id, id), eq(notes.owner_id, ownerId), eq(notes.public, false))).for("update");
    if (!note) throw new HttpError(404, "Note not found");
    await tx.update(noteShares).set({ revoked_at: new Date() }).where(and(eq(noteShares.note_id, id), isNull(noteShares.revoked_at)));
  });
}

export async function getSharedNote(token: string): Promise<Note | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const [row] = await db.select(projection()).from(notes).innerJoin(noteShares, eq(noteShares.note_id, notes.id))
    .where(and(eq(noteShares.token_hash, hashShare(token)), isNull(noteShares.revoked_at), isNull(notes.deleted_at))).limit(1);
  return row ? toNote(row) : null;
}
