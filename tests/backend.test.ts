import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { NextRequest } from "next/server";
import { HttpError, parseUpdates, readJson, readOptionalJson, requireRevision } from "../lib/http";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe("request validation", () => {
  it("rejects owner credentials, unknown fields and invalid values", () => {
    assert.throws(() => parseUpdates({ session_id: randomUUID() }), HttpError);
    assert.throws(() => parseUpdates({ content: null }), HttpError);
    assert.throws(() => parseUpdates({ title: "x".repeat(501) }), HttpError);
    assert.throws(() => parseUpdates({}), HttpError);
    assert.throws(() => requireRevision(0), HttpError);
    assert.throws(() => requireRevision(1.5), HttpError);
    assert.deepEqual(parseUpdates({ content: "", title: "Valid" }), { title: "Valid", content: "" });
  });

  it("accepts optional bodies represented by empty streams without trusting nonempty input", async () => {
    const request = new NextRequest("http://localhost/api/session", {
      method: "POST", body: new ReadableStream({ start(controller) { controller.close(); } }), duplex: "half",
    });
    assert.notEqual(request.body, null);
    assert.equal(await readOptionalJson(request), null);
    await assert.rejects(readOptionalJson(new Request("http://localhost/api/session", { method: "POST", body: "not JSON" })), (error: unknown) => error instanceof HttpError && error.status === 415);
  });

  it("limits streamed request bodies and rejects malformed JSON", async () => {
    await assert.rejects(readJson(new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })), (error: unknown) => error instanceof HttpError && error.status === 400);
    await assert.rejects(readJson(new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "too large" }) }), 5), (error: unknown) => error instanceof HttpError && error.status === 413);
  });
});

describe("database security and recovery", { skip: !databaseUrl }, () => {
  let store: typeof import("../lib/db");
  let auth: typeof import("../lib/auth");
  let owner: string;
  let otherOwner: string;
  const token = randomBytes(32).toString("hex");
  const publicIds: string[] = [];
  const extraOwnerIds: string[] = [];

  before(async () => {
    process.env.DATABASE_URL = databaseUrl;
    store = await import("../lib/db");
    auth = await import("../lib/auth");
    const result = await store.pool.query("INSERT INTO sessions(token_hash, expires_at) VALUES ($1, now() + interval '1 day'), ($2, now() + interval '1 day') RETURNING id", [auth.hashToken(token), auth.hashToken(randomBytes(32).toString("hex"))]);
    [owner, otherOwner] = result.rows.map(row => row.id);
  });

  after(async () => {
    if (!store) return;
    await store.pool.query("DELETE FROM notes WHERE owner_id = ANY($1::uuid[]) OR id = ANY($2::uuid[])", [[owner, otherOwner, ...extraOwnerIds].filter(Boolean), publicIds]);
    await store.pool.query("DELETE FROM sessions WHERE id = ANY($1::uuid[])", [[owner, otherOwner, ...extraOwnerIds].filter(Boolean)]);
    await store.pool.end();
  });

  it("authenticates only a hashed server-issued token", async () => {
    const valid = new NextRequest("http://localhost/api/notes", { headers: { cookie: `${auth.SESSION_COOKIE}=${token}` } });
    assert.equal(await auth.requireSession(valid), owner);
    const forged = new NextRequest("http://localhost/api/notes", { headers: { cookie: `${auth.SESSION_COOKIE}=${owner}` } });
    await assert.rejects(auth.requireSession(forged), (error: unknown) => error instanceof HttpError && error.status === 401);
    const rows = await store.pool.query("SELECT token_hash FROM sessions WHERE id=$1", [owner]);
    assert.notEqual(rows.rows[0].token_hash, token);
    assert.equal(rows.rows[0].token_hash, auth.hashToken(token));
  });

  it("uses secure HttpOnly cookies behind an HTTPS canonical reverse proxy and refuses legacy claims", async () => {
    const previousOrigin = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = "https://notes.example";
    try {
      const { GET, POST } = await import("../app/api/session/route");
      const response = await POST(new NextRequest("http://internal:3000/api/session", { method: "POST", headers: { origin: "https://notes.example" } }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { authenticated: true });
      const cookie = response.headers.get("set-cookie")!;
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /Secure/i);
      assert.match(cookie, /SameSite=lax/i);
      assert.match(cookie, /Path=\//i);
      const tokenCookie = cookie.split(";")[0];
      const request = new NextRequest("http://internal:3000/api/session", { headers: { cookie: tokenCookie } });
      extraOwnerIds.push(await auth.requireSession(request));
      assert.deepEqual(await (await GET(request)).json(), { authenticated: true });
      const forged = await POST(new NextRequest("http://internal:3000/api/session", { method: "POST", headers: { origin: "https://notes.example", "Content-Type": "application/json" }, body: JSON.stringify({ session_id: owner }) }));
      assert.equal(forged.status, 400);
      assert.equal(forged.headers.get("set-cookie"), null);
      const crossSite = await POST(new NextRequest("http://internal:3000/api/session", { method: "POST", headers: { origin: "https://attacker.example" } }));
      assert.equal(crossSite.status, 403);
    } finally {
      if (previousOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previousOrigin;
    }
  });

  it("bootstraps a session from an empty request stream without Content-Type", async () => {
    const previousOrigin = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = "http://localhost";
    try {
      const { POST } = await import("../app/api/session/route");
      const request = new NextRequest("http://localhost/api/session", {
        method: "POST", headers: { origin: "http://localhost" },
        body: new ReadableStream({ start(controller) { controller.close(); } }), duplex: "half",
      });
      assert.notEqual(request.body, null);
      const response = await POST(request);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { authenticated: true });
      const cookie = response.headers.get("set-cookie")!.split(";")[0];
      extraOwnerIds.push(await auth.requireSession(new NextRequest("http://localhost/api/session", { headers: { cookie } })));
    } finally {
      if (previousOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previousOrigin;
    }
  });

  it("creates share URLs with the canonical HTTPS origin behind a reverse proxy", async () => {
    const note = await store.createNote(owner, { content: "Proxy-safe share" });
    const previousOrigin = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = "https://notes.example";
    try {
      const { POST } = await import("../app/api/notes/[id]/share/route");
      const response = await POST(new NextRequest("http://internal:3000/api/notes/share", { method: "POST", headers: { origin: "https://notes.example", cookie: `${auth.SESSION_COOKIE}=${token}` } }), { params: Promise.resolve({ id: note.id }) });
      assert.equal(response.status, 201);
      const { url } = await response.json();
      assert.match(url, /^https:\/\/notes\.example\/shared\/[a-f0-9]{64}$/);
      assert.equal((await store.getSharedNote(new URL(url).pathname.split("/").pop()!))?.id, note.id);
    } finally {
      if (previousOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previousOrigin;
    }
  });

  it("rejects CSRF requests, including absent or malformed origins", () => {
    const previousOrigin = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = "http://localhost";
    try {
      for (const origin of [undefined, "null", "https://attacker.example", "http://localhost.attacker.example"]) {
        assert.throws(() => auth.assertSameOrigin(new Request("http://localhost/api/notes", { headers: origin ? { origin } : {} })), (error: unknown) => error instanceof HttpError && error.status === 403);
      }
      assert.throws(() => auth.assertSameOrigin(new Request("http://localhost/api/notes", { headers: { origin: "http://localhost", "sec-fetch-site": "cross-site" } })), HttpError);
      assert.doesNotThrow(() => auth.assertSameOrigin(new Request("http://localhost/api/notes", { headers: { origin: "http://localhost", "sec-fetch-site": "same-origin" } })));
    } finally {
      if (previousOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previousOrigin;
    }
  });

  it("never discloses private notes or owner credentials to other readers", async () => {
    const note = await store.createNote(owner, { title: "Private", content: "secret" });
    assert.equal(note.can_edit, true);
    assert.equal("owner_id" in note, false);
    assert.equal("session_id" in note, false);
    assert.equal(await store.getNoteBySlug(note.slug), null);
    assert.equal(await store.getNoteBySlug(note.slug, otherOwner), null);
    assert.equal(await store.getAccessibleNoteById(note.id, otherOwner), null);
    assert.equal((await store.getNoteBySlug(note.slug, owner))?.content, "secret");
    await assert.rejects(store.updateNote(note.id, otherOwner, note.revision, { content: "attack" }), (error: unknown) => error instanceof HttpError && error.status === 404);
  });

  it("does not upgrade exposed legacy UUIDs into note ownership", async () => {
    const legacyId = randomUUID();
    const slug = `legacy-${legacyId}`;
    publicIds.push(legacyId);
    await store.pool.query("INSERT INTO notes(id, slug, session_id, content, public) VALUES ($1,$2,$3,'legacy private',false)", [legacyId, slug, owner]);
    assert.equal(await store.getNoteBySlug(slug, owner), null);
    assert.equal((await store.getSessionNotes(owner)).some(note => note.id === legacyId), false);
  });

  it("returns safe public DTOs without exposing internal ownership", async () => {
    const id = randomUUID();
    publicIds.push(id);
    const slug = `public-${id}`;
    await store.pool.query("INSERT INTO notes(id, slug, title, public, owner_id, session_id) VALUES ($1,$2,'Public',true,$3,$3)", [id, slug, owner]);
    const note = await store.getNoteBySlug(slug);
    assert.equal(note?.can_edit, false);
    assert.equal(note?.public, true);
    assert.equal("owner_id" in note!, false);
    assert.equal("session_id" in note!, false);
    assert.equal((await store.getPublicNotes()).some(row => row.id === id), true);
    assert.equal((await store.getNoteBySlug(slug, owner))?.can_edit, false);
    assert.equal((await store.getSessionNotes(owner)).some(row => row.id === id), false);
    await assert.rejects(store.updateNote(id, owner, note!.revision, { content: "Visitor edit" }), (error: unknown) => error instanceof HttpError && error.status === 404);
    await assert.rejects(store.deleteNote(id, owner, note!.revision), (error: unknown) => error instanceof HttpError && error.status === 404);
    await assert.rejects(store.createShare(id, owner), (error: unknown) => error instanceof HttpError && error.status === 404);
  });

  it("allows one writer per revision and returns the newer note on conflicts", async () => {
    const note = await store.createNote(owner, { content: "first" });
    const results = await Promise.allSettled([
      store.updateNote(note.id, owner, note.revision, { content: "second" }),
      store.updateNote(note.id, owner, note.revision, { content: "third" }),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    assert.equal(rejected.reason.status, 409);
    assert.equal(rejected.reason.details.note.revision, note.revision + 1);
    assert.equal("session_id" in rejected.reason.details.note, false);
  });

  it("soft-deletes and restores notes while permanently revoking old share links", async () => {
    const note = await store.createNote(owner, { content: "Recoverable" });
    const share = await store.createShare(note.id, owner);
    const shared = await store.getSharedNote(share);
    assert.equal(shared?.content, "Recoverable");
    assert.equal(shared?.can_edit, false);
    await assert.rejects(store.revokeShares(note.id, otherOwner), (error: unknown) => error instanceof HttpError && error.status === 404);
    const deleted = await store.deleteNote(note.id, owner, note.revision);
    assert.ok(deleted.deleted_at);
    assert.equal(await store.getNoteBySlug(note.slug, owner), null);
    assert.equal(await store.getSharedNote(share), null);
    assert.equal((await store.getSessionNotes(owner, true)).some(row => row.id === note.id), true);
    const restored = await store.restoreNote(note.id, owner, deleted.revision);
    assert.equal(restored.content, "Recoverable");
    assert.equal(restored.deleted_at, null);
    assert.equal(await store.getSharedNote(share), null);
    const freshShare = await store.createShare(note.id, owner);
    await store.revokeShares(note.id, owner);
    assert.equal(await store.getSharedNote(freshShare), null);
  });

  it("re-runs the migration runner safely and refuses an edited applied migration", async () => {
    const { mkdtemp, mkdir, writeFile, rm, cp, symlink } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { spawnSync } = await import("node:child_process");
    const fixture = await mkdtemp(join(tmpdir(), "notes-migration-check-"));
    const temporarySchema = `runner_test_${randomBytes(8).toString("hex")}`;
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${temporarySchema}`);
      await mkdir(join(fixture, "migrations"));
      await mkdir(join(fixture, "scripts"));
      await mkdir(join(fixture, "node_modules"));
      for (const name of ["migrate.mjs", "migration-files.mjs"]) {
        await cp(new URL(`../scripts/${name}`, import.meta.url), join(fixture, "scripts", name));
      }
      await symlink(fileURLToPath(new URL("../node_modules/pg", import.meta.url)), join(fixture, "node_modules", "pg"), "dir");
      const filename = join(fixture, "migrations", "0001_marker.sql");
      await writeFile(filename, "CREATE TABLE migration_marker(id integer PRIMARY KEY);\n");
      const connection = new URL(databaseUrl!);
      connection.searchParams.set("options", `-c search_path=${temporarySchema},public`);
      const execute = () => spawnSync(process.execPath, [join(fixture, "scripts", "migrate.mjs")], {
        cwd: fixture, env: { ...process.env, DATABASE_URL: connection.toString() }, encoding: "utf8", timeout: 5000,
      });
      const initial = execute();
      assert.equal(initial.status, 0, initial.stderr);
      const repeat = execute();
      assert.equal(repeat.status, 0, repeat.stderr);
      await writeFile(filename, "DROP TABLE migration_marker;\n");
      const changed = execute();
      assert.equal(changed.status, 1);
      assert.match(changed.stderr, /has changed/);
      const { rows } = await client.query("SELECT to_regclass($1) AS marker", [`${temporarySchema}.migration_marker`]);
      assert.ok(rows[0].marker, "Refused migration must not execute its changed SQL");
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${temporarySchema} CASCADE`);
      await client.end();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("migrates legacy notes idempotently without changing creation timestamps", async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    const temporarySchema = `migration_test_${randomBytes(8).toString("hex")}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${temporarySchema}`);
      await client.query(`SET search_path TO ${temporarySchema}, public`);
      await client.query("CREATE TABLE notes (id uuid PRIMARY KEY, title text, content text, created_at timestamptz NOT NULL, public boolean, session_id uuid, slug text, category text, emoji text)");
      const id = randomUUID();
      const createdAt = "2021-03-04T12:30:00.000Z";
      await client.query("INSERT INTO notes(id, created_at, session_id, content) VALUES ($1,$2,$3,'keep me')", [id, createdAt, owner]);
      const migration = await readFile(new URL("../migrations/0001_private_sessions_and_revisions.sql", import.meta.url), "utf8");
      await client.query(migration);
      await client.query(migration);
      const { rows } = await client.query("SELECT * FROM notes WHERE id=$1", [id]);
      assert.equal(rows[0].content, "keep me");
      assert.equal(rows[0].created_at.toISOString(), createdAt);
      assert.equal(rows[0].updated_at.toISOString(), createdAt);
      assert.equal(rows[0].owner_id, null);
      assert.equal(rows[0].session_id, owner);
      assert.equal(rows[0].revision, 1);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${temporarySchema} CASCADE`);
      await client.end();
    }
  });
});
