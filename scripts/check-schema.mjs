import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import pg from "pg";
import { assertMigrationHistory, loadMigrations } from "./migration-files.mjs";

// Validate the shapes used by the running application as well as migration history.
// A recorded migration alone cannot detect an accidentally removed table or column.
const requiredColumns = {
  schema_migrations: { name: "text!", checksum: "text!", applied_at: "timestamp with time zone!" },
  sessions: { id: "uuid!", token_hash: "text!", created_at: "timestamp with time zone!", expires_at: "timestamp with time zone!" },
  notes: {
    id: "uuid!", title: "text", content: "text", created_at: "timestamp with time zone!", updated_at: "timestamp with time zone!",
    deleted_at: "timestamp with time zone", revision: "integer!", public: "boolean", session_id: "uuid", owner_id: "uuid",
    slug: "text", category: "text", emoji: "text",
  },
  note_shares: { id: "uuid!", note_id: "uuid!", token_hash: "text!", created_at: "timestamp with time zone!", revoked_at: "timestamp with time zone" },
  note_attachments: {
    id: "uuid!", note_id: "uuid!", owner_id: "uuid!", path: "text!", content_type: "text!", size: "integer!",
    status: "text!", created_at: "timestamp with time zone!",
  },
};

const requiredUniqueKeys = {
  schema_migrations: ["name"], sessions: ["id", "token_hash"], notes: ["id", "slug"],
  note_shares: ["id", "token_hash"], note_attachments: ["id", "path"],
};

export async function checkSchema(client, migrations) {
  // This transaction is enforced read-only by PostgreSQL, including on failure.
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const { rows: registry } = await client.query("SELECT to_regclass('schema_migrations') AS relation");
    if (!registry[0].relation) throw new Error("The migration registry is missing; this database has not been prepared for this release.");
    const { rows: applied } = await client.query("SELECT name, checksum FROM schema_migrations ORDER BY name");
    assertMigrationHistory(applied, migrations);

    for (const [table, columns] of Object.entries(requiredColumns)) {
      const { rows } = await client.query(`
        SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS required
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
        WHERE a.attrelid = to_regclass($1) AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
      `, [table]);
      const actual = new Map(rows.map(column => [column.name, column]));
      for (const [name, shape] of Object.entries(columns)) {
        const type = shape.replace(/!$/, "");
        const column = actual.get(name);
        if (!column || column.type !== type || (shape.endsWith("!") && !column.required)) {
          throw new Error(`Required database column ${table}.${name} is missing or has an incompatible definition.`);
        }
      }

      const { rows: uniqueKeys } = await client.query(`
        SELECT a.attname AS name FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
        WHERE i.indrelid = to_regclass($1) AND i.indisunique AND i.indisvalid
          AND i.indnkeyatts = 1 AND i.indpred IS NULL AND i.indexprs IS NULL
      `, [table]);
      const keys = new Set(uniqueKeys.map(key => key.name));
      for (const key of requiredUniqueKeys[table]) {
        if (!keys.has(key)) throw new Error(`Required database uniqueness rule for ${table}.${key} is missing.`);
      }
    }
  } finally {
    // There are no writes to commit. Always leave the connection outside the check transaction.
    await client.query("ROLLBACK");
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to check the database schema.");
  const migrations = await loadMigrations();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try { await checkSchema(client, migrations); }
  finally { await client.end(); }
  console.log("Database schema is ready. No database changes were made.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(error => {
    console.error(`Database schema check failed: ${error instanceof Error ? error.message : "Unable to verify the database."}`);
    console.error("Startup stopped without applying migrations. After a verified backup and release review, apply migrations explicitly with npm run db:migrate, then start again.");
    process.exitCode = 1;
  });
}
