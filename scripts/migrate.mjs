import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to apply migrations");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // A session-level lock prevents two deploys from racing through migrations.
    await client.query("SELECT pg_advisory_lock(684023901)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const directory = path.join(process.cwd(), "migrations");
    for (const name of (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort()) {
      const source = await readFile(path.join(directory, name), "utf8");
      const checksum = createHash("sha256").update(source).digest("hex");
      const { rows } = await client.query("SELECT checksum FROM schema_migrations WHERE name = $1", [name]);
      if (rows[0]) {
        if (rows[0].checksum !== checksum) throw new Error(`Applied migration ${name} has changed. Add a new migration instead.`);
        continue;
      }
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
