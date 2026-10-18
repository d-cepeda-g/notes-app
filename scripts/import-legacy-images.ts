import { randomUUID } from "node:crypto";
import pg from "pg";
import { normalizeImage, MAX_OWNER_IMAGE_BYTES, MAX_NOTE_IMAGES } from "../lib/image-validation";
import { readImageObject, saveImageObject, deleteImageObject } from "../lib/object-storage";

// Run only as the database administrator after checking the note and its owner.
const noteId = process.argv[2];
if (!process.env.DATABASE_URL || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(noteId || "")) {
  console.error("Usage: DATABASE_URL=… PRIVATE_OBJECT_DIR=… npx tsx scripts/import-legacy-images.ts NOTE_ID");
  process.exit(1);
}
async function main() {
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const written: string[] = [];
await client.connect();
try {
  await client.query("BEGIN");
  const { rows } = await client.query("SELECT * FROM notes WHERE id=$1 AND deleted_at IS NULL FOR NO KEY UPDATE", [noteId]);
  const note = rows[0];
  if (!note || (!note.public && !note.owner_id)) throw new Error("Recover ownership of this private note before importing its images.");
  const owner = note.owner_id || note.id;
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [owner]);
  let content: string = note.content || "";
  const sources = Array.from(new Set(Array.from(content.matchAll(/!\[[^\]]*\]\((\/api\/uploads\/serve\/[^\s)]+)\)/g), (match: RegExpMatchArray) => match[1])));
  for (const source of sources) {
    const path = decodeURIComponent(source.slice("/api/uploads/serve/".length).split("?")[0]);
    if (!path.startsWith(`note-images/${noteId}/`) || path.split("/").some(part => !part || part === "." || part === "..")) throw new Error("A legacy image path does not belong to this note.");
    const { rows: existing } = await client.query("SELECT id FROM note_attachments WHERE path=$1 AND note_id=$2 AND status='ready'", [path, noteId]);
    if (existing[0]) continue;
    const bytes = await normalizeImage(await readImageObject(path));
    const { rows: usage } = await client.query("SELECT coalesce(sum(size),0)::int AS total, count(*) FILTER (WHERE note_id=$2)::int AS count FROM note_attachments WHERE owner_id=$1", [owner, noteId]);
    if (usage[0].total + bytes.length > MAX_OWNER_IMAGE_BYTES || usage[0].count >= MAX_NOTE_IMAGES) throw new Error("Image storage limit reached.");
    const id = randomUUID();
    const newPath = `note-images/${noteId}/${id}.webp`;
    await saveImageObject(newPath, bytes); written.push(newPath);
    await client.query("INSERT INTO note_attachments(id,note_id,owner_id,path,content_type,size,status) VALUES($1,$2,$3,$4,'image/webp',$5,'ready')", [id, noteId, owner, newPath, bytes.length]);
    content = content.split(source).join(`/api/uploads/serve/${newPath}`);
  }
  if (written.length) await client.query("UPDATE notes SET content=$1,revision=revision+1 WHERE id=$2", [content, noteId]);
  await client.query("COMMIT");
  console.log(`Registered ${written.length} images. Old objects were preserved; original note timestamps were preserved.`);
} catch (error) {
  await client.query("ROLLBACK");
  await Promise.all(written.map(path => deleteImageObject(path).catch(() => {})));
  console.error(error instanceof Error ? error.message : "Import failed."); process.exitCode = 1;
} finally { await client.end(); }

}
void main().catch(() => { console.error("Image import could not start."); process.exitCode = 1; });
