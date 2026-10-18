import pg from "pg";

// Database-administrator recovery only. A browser's exposed legacy UUID is not proof of ownership.
const [targetNoteId, ...legacyNoteIds] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!process.env.DATABASE_URL || !uuid.test(targetNoteId || "") || !legacyNoteIds.length || legacyNoteIds.some(id => !uuid.test(id))) {
  console.error("Usage: DATABASE_URL=… node scripts/recover-legacy-notes.mjs TARGET_NEW_NOTE_ID LEGACY_NOTE_ID [LEGACY_NOTE_ID …]");
  process.exit(1);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  const { rows: targets } = await client.query("SELECT owner_id FROM notes WHERE id=$1 AND owner_id IS NOT NULL AND public=false AND deleted_at IS NULL FOR UPDATE", [targetNoteId]);
  if (!targets[0]) throw new Error("The target must be a private note created by the verified recipient in their new browser session.");
  const { rows } = await client.query("SELECT id FROM notes WHERE id=ANY($1::uuid[]) AND owner_id IS NULL AND public=false FOR UPDATE", [legacyNoteIds]);
  if (rows.length !== new Set(legacyNoteIds).size) throw new Error("Every source note must exist, be private, and have no new owner. Nothing was changed.");
  await client.query("UPDATE notes SET owner_id=$1, revision=revision+1 WHERE id=ANY($2::uuid[])", [targets[0].owner_id, legacyNoteIds]);
  await client.query("COMMIT");
  console.log(`Recovered ${rows.length} notes. Creation and modification dates were preserved.`);
} catch (error) {
  await client.query("ROLLBACK");
  console.error(error instanceof Error ? error.message : "Recovery failed.");
  process.exitCode = 1;
} finally { await client.end(); }
