import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { checkSchema } from "../scripts/check-schema.mjs";
import { assertMigrationHistory, loadMigrations } from "../scripts/migration-files.mjs";

const execute = promisify(execFile);
const databaseUrl = process.env.TEST_DATABASE_URL;
const root = fileURLToPath(new URL("../", import.meta.url));

describe("database schema startup check", { skip: !databaseUrl }, () => {
  const schema = `startup_check_${randomUUID().replaceAll("-", "")}`;
  let admin: pg.Client;
  let client: pg.Client;
  let isolatedUrl: string;
  let runtime: string;

  before(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    // All fixtures stay in a unique schema; other database suites keep their tables.
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const connection = new URL(databaseUrl!);
    connection.searchParams.set("options", `-c search_path=${schema}`);
    isolatedUrl = connection.toString();
    client = new pg.Client({ connectionString: isolatedUrl });
    await client.connect();
  });

  after(async () => {
    await client?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    if (runtime) await rm(runtime, { recursive: true, force: true });
  });

  async function runScript(name: string, cwd = root) {
    return execute(process.execPath, [path.join(cwd, "scripts", name)], {
      cwd, env: { ...process.env, DATABASE_URL: isolatedUrl, NODE_OPTIONS: "" },
    });
  }

  it("rejects an unmigrated database without creating any objects", async () => {
    await assert.rejects(runScript("check-schema.mjs"), (error: unknown) => {
      const result = error as Error & { stderr: string; code: number };
      assert.equal(result.code, 1);
      assert.match(result.stderr, /migration registry is missing/);
      assert.match(result.stderr, /Startup stopped without applying migrations/);
      return true;
    });
    const { rows } = await client.query("SELECT relname FROM pg_class WHERE relnamespace = $1::regnamespace", [schema]);
    assert.deepEqual(rows, []);
  });

  it("passes only after an explicit migration and leaves migration records untouched", async () => {
    await runScript("migrate.mjs");
    const beforeCheck = await client.query("SELECT * FROM schema_migrations ORDER BY name");
    const result = await runScript("check-schema.mjs");
    assert.match(result.stdout, /Database schema is ready. No database changes were made/);
    assert.deepEqual((await client.query("SELECT * FROM schema_migrations ORDER BY name")).rows, beforeCheck.rows);
  });

  it("enforces a read-only transaction even if the caller attempts a write", async () => {
    const migrations = await loadMigrations();
    const guardedClient = {
      async query(sql: string, values?: unknown[]) {
        if (sql.startsWith("SELECT to_regclass")) {
          assert.equal((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only, "on");
          await assert.rejects(client.query("CREATE TABLE should_never_exist (id integer)"), /read-only transaction/);
          throw new Error("read-only transaction verified");
        }
        return client.query(sql, values);
      },
    };
    await assert.rejects(checkSchema(guardedClient, migrations), /read-only transaction verified/);
    assert.equal((await client.query("SELECT to_regclass('should_never_exist') AS relation")).rows[0].relation, null);
  });

  it("rejects changed, pending, and newer migration histories", async () => {
    const migrations = await loadMigrations();
    const applied = migrations.map(({ name, checksum }) => ({ name, checksum }));
    assert.throws(() => assertMigrationHistory(applied, [{ ...migrations[0], checksum: "changed" }, ...migrations.slice(1)]), /has changed/);
    await client.query("UPDATE schema_migrations SET checksum = 'changed' WHERE name = $1", [migrations[0].name]);
    try { await assert.rejects(runScript("check-schema.mjs"), /has changed/); }
    finally { await client.query("UPDATE schema_migrations SET checksum = $1 WHERE name = $2", [migrations[0].checksum, migrations[0].name]); }
    await client.query("DELETE FROM schema_migrations WHERE name = $1", [migrations[1].name]);
    try { await assert.rejects(runScript("check-schema.mjs"), /Required migrations have not been applied/); }
    finally { await client.query("INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)", [migrations[1].name, migrations[1].checksum]); }
    await client.query("INSERT INTO schema_migrations(name, checksum) VALUES ('9999_future_release.sql', 'future')");
    try { await assert.rejects(runScript("check-schema.mjs"), /does not recognize/); }
    finally { await client.query("DELETE FROM schema_migrations WHERE name = '9999_future_release.sql'"); }
  });

  it("rejects schema drift even when migration checksums match", async () => {
    await client.query("ALTER TABLE notes DROP COLUMN emoji");
    try { await assert.rejects(runScript("check-schema.mjs"), /notes\.emoji is missing/); }
    finally { await client.query("ALTER TABLE notes ADD COLUMN emoji text"); }
    await client.query("DROP INDEX slug_unique_index");
    try { await assert.rejects(runScript("check-schema.mjs"), /uniqueness rule for notes\.slug is missing/); }
    finally { await client.query("CREATE UNIQUE INDEX slug_unique_index ON notes(slug)"); }
  });

  it("runs the release check with plain Node and no installed tsx package", async () => {
    runtime = await mkdtemp(path.join(tmpdir(), "notes-startup-runtime-"));
    await mkdir(path.join(runtime, "scripts"));
    await mkdir(path.join(runtime, "node_modules"));
    for (const script of ["check-schema.mjs", "migration-files.mjs", "migrate.mjs"]) {
      await cp(path.join(root, "scripts", script), path.join(runtime, "scripts", script));
    }
    await cp(path.join(root, "migrations"), path.join(runtime, "migrations"), { recursive: true });
    await symlink(path.join(root, "node_modules", "pg"), path.join(runtime, "node_modules", "pg"), "dir");
    await execute(process.execPath, ["--input-type=module", "--eval", "try { import.meta.resolve('tsx'); process.exit(1); } catch { process.exit(0); }"], { cwd: runtime, env: { ...process.env, NODE_OPTIONS: "" } });
    assert.match((await runScript("check-schema.mjs", runtime)).stdout, /Database schema is ready/);
  });
});
