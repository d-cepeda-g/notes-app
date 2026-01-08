import { pgTable, text, boolean, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title"),
  content: text("content"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  public: boolean("public").default(false),
  session_id: uuid("session_id"),
  slug: text("slug"),
  category: text("category"),
  emoji: text("emoji"),
}, (table) => ({
  sessionIdIdx: index("session_id_index").on(table.session_id),
  slugUniqueIdx: uniqueIndex("slug_unique_index").on(table.slug),
}));

export type Note = typeof notes.$inferSelect;
export type InsertNote = typeof notes.$inferInsert;
