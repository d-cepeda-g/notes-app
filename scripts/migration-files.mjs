import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));

export async function loadMigrations(directory = migrationsDirectory) {
  const names = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (!names.length) throw new Error("No migration files were found for this release.");
  return Promise.all(names.map(async name => {
    const source = await readFile(path.join(directory, name), "utf8");
    return { name, source, checksum: createHash("sha256").update(source).digest("hex") };
  }));
}

export function assertMigrationHistory(applied, expected, { allowPending = false } = {}) {
  const files = new Map(expected.map(migration => [migration.name, migration]));
  for (const migration of applied) {
    const file = files.get(migration.name);
    if (!file) throw new Error(`The database contains migration ${migration.name}, which this release does not recognize. Use a compatible release.`);
    if (file.checksum !== migration.checksum) throw new Error(`Applied migration ${migration.name} has changed. Add a new migration instead.`);
  }
  if (!allowPending) {
    const names = new Set(applied.map(migration => migration.name));
    const pending = expected.filter(migration => !names.has(migration.name));
    if (pending.length) throw new Error(`Required migrations have not been applied: ${pending.map(migration => migration.name).join(", ")}.`);
  }
}
