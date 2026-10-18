import pg from "pg";
import { assertMigrationHistory, loadMigrations } from "./migration-files.mjs";

async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to apply migrations");
  const migrations = await loadMigrations();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // A session-level lock prevents two deploys from racing through migrations.
    await client.query("SELECT pg_advisory_lock(684023901)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const { rows: applied } = await client.query("SELECT name, checksum FROM schema_migrations ORDER BY name");
    assertMigrationHistory(applied, migrations, { allowPending: true });
    const appliedNames = new Set(applied.map(migration => migration.name));
    for (const { name, source, checksum } of migrations) {
      if (appliedNames.has(name)) continue;
      await client.query("BEGIN");
      try {
        await client.query(source);
        await client.query("INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)", [name, checksum]);
        await client.query("COMMIT");
        console.log(`Applied ${name}`);
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
    console.log("Database migrations are up to date.");
  } finally { await client.end(); }
}

migrate().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
