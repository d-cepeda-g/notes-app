import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { notes, Note, InsertNote } from "@shared/schema";
import { eq, or, and, ilike } from "drizzle-orm";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export async function getPublicNotes(): Promise<Note[]> {
  const result = await db.select().from(notes).where(eq(notes.public, true));
  return result;
}

export async function getSessionNotes(sessionId: string): Promise<Note[]> {
  const result = await db.select().from(notes).where(eq(notes.session_id, sessionId));
  return result;
}

export async function getNoteBySlug(slug: string): Promise<Note | null> {
  const result = await db.select().from(notes).where(eq(notes.slug, slug)).limit(1);
  return result[0] || null;
}

export async function createNote(note: InsertNote): Promise<Note> {
  const result = await db.insert(notes).values(note).returning();
  return result[0];
}

export async function updateNote(
  id: string,
  sessionId: string,
  updates: Partial<Pick<Note, 'title' | 'content' | 'emoji'>>
): Promise<void> {
  await db.update(notes)
    .set(updates)
    .where(and(eq(notes.id, id), eq(notes.session_id, sessionId)));
}

export async function updateNoteContent(
  id: string,
  sessionId: string,
  content: string
): Promise<void> {
  await db.update(notes)
    .set({ content })
    .where(and(eq(notes.id, id), eq(notes.session_id, sessionId)));
}

export async function updateNoteTitle(
  id: string,
  sessionId: string,
  title: string
): Promise<void> {
  await db.update(notes)
    .set({ title })
    .where(and(eq(notes.id, id), eq(notes.session_id, sessionId)));
}

export async function updateNoteEmoji(
  id: string,
  sessionId: string,
  emoji: string
): Promise<void> {
  await db.update(notes)
    .set({ emoji })
    .where(and(eq(notes.id, id), eq(notes.session_id, sessionId)));
}

export async function deleteNote(id: string, sessionId: string): Promise<void> {
  await db.delete(notes)
    .where(and(eq(notes.id, id), eq(notes.session_id, sessionId)));
}
