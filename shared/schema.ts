import { pgTable, text, boolean, timestamp, uuid, index, uniqueIndex, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Browser credentials are opaque; only their hashes are stored. */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  token_hash: text("token_hash").notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title"),
  content: text("content"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  public: boolean("public").default(false),
  // Retained solely to preserve old data. Never use this value for authentication.
  session_id: uuid("session_id"),
  owner_id: uuid("owner_id").references(() => sessions.id),
  slug: text("slug"),
  category: text("category"),
  emoji: text("emoji"),
}, (table) => ({
  sessionIdIdx: index("session_id_index").on(table.session_id),
  ownerUpdatedIdx: index("notes_owner_updated_index").on(table.owner_id, table.updated_at),
  slugUniqueIdx: uniqueIndex("slug_unique_index").on(table.slug),
}));

export const noteShares = pgTable("note_shares", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  note_id: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  token_hash: text("token_hash").notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revoked_at: timestamp("revoked_at", { withTimezone: true }),
}, (table) => ({ noteIdx: index("note_shares_note_index").on(table.note_id) }));

export type Note = typeof notes.$inferSelect;
export type InsertNote = typeof notes.$inferInsert;
