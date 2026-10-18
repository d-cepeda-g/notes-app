import pg from "pg";
import { importLegacyImages, parseLegacyImportOptions } from "../lib/legacy-image-import";
import { readImageObject, saveImageObject, deleteImageObject } from "../lib/object-storage";

// Run only as the database administrator after reviewing the note, its owner,
// and any explicit legacy prefix. A dry run never writes to storage or the DB.
async function main() {
  const options = parseLegacyImportOptions(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const written: string[] = [];
  let commitAttempted = false;
  await client.connect();
  try {
    await client.query(options.dryRun ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    const lock = options.dryRun ? "" : " FOR NO KEY UPDATE";
    const { rows } = await client.query(`SELECT id,content,public,owner_id FROM notes WHERE id=$1 AND deleted_at IS NULL${lock}`, [options.noteId]);
    const note = rows[0];
    if (!note) throw new Error("The selected active note does not exist.");
    if (!options.dryRun) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [note.owner_id || note.id]);
    }
    const result = await importLegacyImages(note, options, {
      async findRegistered(path, noteId) {
        const { rows: existing } = await client.query("SELECT id FROM note_attachments WHERE path=$1 AND note_id=$2 AND status='ready'", [path, noteId]);
        return Boolean(existing[0]);
      },
      readObject: readImageObject,
      async usage(owner, noteId) {
        const { rows: usage } = await client.query("SELECT coalesce(sum(size),0)::int AS total, count(*) FILTER (WHERE note_id=$2)::int AS count FROM note_attachments WHERE owner_id=$1", [owner, noteId]);
        return usage[0];
      },
      async writeImage(image, owner, noteId) {
        // Track before starting the save so a failed/uncertain save is cleaned
        // up too. Every destination is a new, unguessable object path.
        written.push(image.newPath);
        await saveImageObject(image.newPath, image.bytes);
        await client.query("INSERT INTO note_attachments(id,note_id,owner_id,path,content_type,size,status) VALUES($1,$2,$3,$4,'image/webp',$5,'ready')", [image.id, noteId, owner, image.newPath, image.bytes.length]);
      },
      async updateContent(content, noteId) {
        await client.query("UPDATE notes SET content=$1,revision=revision+1 WHERE id=$2", [content, noteId]);
      },
    });
    commitAttempted = true;
    await client.query("COMMIT");
    console.log(JSON.stringify({
      dryRun: options.dryRun,
      noteId: options.noteId,
      reviewedPrefix: options.legacyPrefix ?? `note-images/${options.noteId}`,
      images: result.images.map(image => ({ source: image.source, object: image.path, proposedLink: `/api/uploads/serve/${image.newPath}`, processedBytes: image.bytes.length })),
      alreadyRegistered: result.existing.map(image => image.source),
    }, null, 2));
    console.log(options.dryRun
      ? "Dry run complete. No objects, attachment records, or note text were written. Proposed destination IDs are regenerated on a real run."
      : `Registered ${written.length} images. Old objects and original note timestamps were preserved.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    // A lost COMMIT reply leaves its outcome uncertain. Preserve new objects in
    // that case so a committed note can never be left pointing at deleted files.
    if (!commitAttempted) await Promise.all(written.map(path => deleteImageObject(path).catch(() => {})));
    else if (written.length) console.error("The commit outcome may be uncertain. New objects were preserved; inspect the note and attachment records before retrying.");
    throw error;
  } finally { await client.end(); }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : "Image import failed.");
  console.error("Usage: DATABASE_URL=… PRIVATE_OBJECT_DIR=… npx tsx scripts/import-legacy-images.ts NOTE_ID [--dry-run] [--legacy-prefix note-images/REVIEWED_FOLDER]");
  process.exitCode = 1;
});
