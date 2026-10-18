import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { notes } from "./schema";

export const attachments = pgTable("note_attachments", {
  id: uuid("id").primaryKey(),
  note_id: uuid("note_id").notNull().references(() => notes.id),
  owner_id: uuid("owner_id").notNull(),
  path: text("path").notNull().unique(),
  content_type: text("content_type").notNull(),
  size: integer("size").notNull(),
  status: text("status").notNull().default("pending"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerIdx: index("note_attachments_owner_idx").on(table.owner_id),
  noteIdx: index("note_attachments_note_idx").on(table.note_id),
}));
