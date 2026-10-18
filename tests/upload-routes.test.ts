import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import * as drizzle from "drizzle-orm";
import * as http from "../lib/http";

const databaseUrl = process.env.TEST_DATABASE_URL;
const require = createRequire(import.meta.url);

describe("upload routes with real database authorization and quotas", { skip: !databaseUrl }, () => {
  let store: typeof import("../lib/db");
  let auth: typeof import("../lib/auth");
  let validation: typeof import("../lib/image-validation");
  let upload: { POST(request: NextRequest): Promise<NextResponse> };
  let serve: { GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> };
  let currentRequest: NextRequest;
  let png: Buffer;
  const owners: string[] = [];
  const cookies: string[] = [];
  const objects = new Map<string, Buffer>();
  let objectReads = 0;
  let objectWrites = 0;
  let failWrite = false;
  const previousOrigin = process.env.APP_ORIGIN;

  async function loadRoute(file: string) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const { attachments } = await import("../shared/attachments");
    const dependencies: Record<string, unknown> = {
      "next/server": { NextRequest, NextResponse }, "drizzle-orm": drizzle,
      "@/lib/auth": { ...auth, getSessionOwner: async () => { try { return await auth.requireSession(currentRequest); } catch { return null; } } },
      "@/lib/db": store, "@/lib/http": http, "@/shared/attachments": { attachments },
      "@/lib/image-validation": validation,
      "@/lib/object-storage": {
        saveImageObject: async (path: string, bytes: Buffer) => { objectWrites++; if (failWrite) throw new Error("Simulated storage outage"); objects.set(path, bytes); },
        deleteImageObject: async (path: string) => { objects.delete(path); },
        readImageObject: async (path: string) => { objectReads++; const bytes = objects.get(path); if (!bytes) throw new Error("Missing fixture image"); return bytes; },
      },
    };
    const routeModule = { exports: {} };
    vm.runInNewContext(compiled, {
      module: routeModule, exports: routeModule.exports, require: (name: string) => dependencies[name] || require(name),
      Buffer, File, Response, console, Uint8Array, Date, Number,
    }, { filename: file });
    return routeModule.exports;
  }

  before(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.APP_ORIGIN = "http://localhost";
    store = await import("../lib/db");
    auth = await import("../lib/auth");
    validation = await import("../lib/image-validation");
    for (let index = 0; index < 6; index++) {
      const token = randomBytes(32).toString("hex");
      const { rows } = await store.pool.query("INSERT INTO sessions(token_hash,expires_at) VALUES ($1,now()+interval '1 day') RETURNING id", [auth.hashToken(token)]);
      owners.push(rows[0].id);
      cookies.push(`${auth.SESSION_COOKIE}=${token}`);
    }
    png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ffaa00" } }).png().toBuffer();
    upload = await loadRoute("../app/api/uploads/route.ts") as typeof upload;
    serve = await loadRoute("../app/api/uploads/serve/[...path]/route.ts") as typeof serve;
  });

  after(async () => {
    if (previousOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previousOrigin;
    if (!store) return;
    await store.pool.query("DELETE FROM note_attachments WHERE owner_id = ANY($1::uuid[])", [owners]);
    await store.pool.query("DELETE FROM notes WHERE owner_id = ANY($1::uuid[])", [owners]);
    await store.pool.query("DELETE FROM sessions WHERE id = ANY($1::uuid[])", [owners]);
    await store.pool.end();
  });

  function uploadRequest(noteId: string, ownerIndex: number | null, bytes = png, origin = "http://localhost") {
    const form = new FormData();
    form.set("noteId", noteId);
    form.set("file", new File([new Uint8Array(bytes)], "untrusted-name.png", { type: "image/png" }));
    return new NextRequest("http://localhost/api/uploads", { method: "POST", body: form, headers: { origin, ...(ownerIndex === null ? {} : { cookie: cookies[ownerIndex] }) } });
  }

  async function download(url: string, ownerIndex: number | null = null, share?: string) {
    const target = new URL(url, "http://localhost");
    if (share) target.searchParams.set("share", share);
    currentRequest = new NextRequest(target, { headers: ownerIndex === null ? {} : { cookie: cookies[ownerIndex] } });
    const path = target.pathname.replace("/api/uploads/serve/", "").split("/").map(decodeURIComponent);
    return serve.GET(currentRequest, { params: Promise.resolve({ path }) });
  }

  it("rejects unauthenticated, cross-site and cross-owner uploads before storage writes", async () => {
    const note = await store.createNote(owners[0]);
    const initialWrites = objectWrites;
    assert.equal((await upload.POST(uploadRequest(note.id, null))).status, 401);
    assert.equal((await upload.POST(uploadRequest(note.id, 0, png, "https://attacker.example"))).status, 403);
    assert.equal((await upload.POST(uploadRequest(note.id, 1))).status, 404);
    assert.equal((await upload.POST(uploadRequest("-".repeat(36), 0))).status, 400);
    assert.equal(objectWrites, initialWrites);
  });

  it("rejects disguised executable files and oversized streamed bodies", async () => {
    const note = await store.createNote(owners[0]);
    assert.equal((await upload.POST(uploadRequest(note.id, 0, Buffer.from("<script>alert(1)</script>")))).status, 415);
    const oversized = uploadRequest(note.id, 0, Buffer.alloc(validation.MAX_IMAGE_BYTES + 1));
    assert.equal((await upload.POST(oversized)).status, 413);
    const unknownLength = new NextRequest("http://localhost/api/uploads", {
      method: "POST", headers: { origin: "http://localhost", cookie: cookies[0], "content-type": "multipart/form-data; boundary=test" },
      body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(validation.MAX_UPLOAD_BODY_BYTES + 1)); controller.close(); } }), duplex: "half",
    });
    assert.equal((await upload.POST(unknownLength)).status, 413);
    const malformedMultipart = new NextRequest("http://localhost/api/uploads", {
      method: "POST", headers: { origin: "http://localhost", cookie: cookies[0], "content-type": "multipart/form-data; boundary=missing" }, body: "invalid body",
    });
    assert.equal((await upload.POST(malformedMultipart)).status, 400);
  });

  it("re-encodes images, registers them, and restricts private reads to the owner or matching live share", async () => {
    const note = await store.createNote(owners[0]);
    const result = await upload.POST(uploadRequest(note.id, 0));
    assert.equal(result.status, 201);
    const { url } = await result.json();
    const beforeDenied = objectReads;
    assert.equal((await download(url)).status, 404);
    assert.equal((await download(url, 1)).status, 404);
    assert.equal(objectReads, beforeDenied);
    const own = await download(url, 0);
    assert.equal(own.status, 200);
    assert.equal(own.headers.get("content-type"), "image/webp");
    assert.equal(own.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(own.headers.get("x-content-type-options"), "nosniff");
    const bytes = Buffer.from(await own.arrayBuffer());
    assert.equal((await sharp(bytes).metadata()).format, "webp");
    const share = await store.createShare(note.id, owners[0]);
    assert.equal((await download(url, null, share)).status, 200);
    const other = await store.createNote(owners[0]);
    const wrongShare = await store.createShare(other.id, owners[0]);
    assert.equal((await download(url, null, wrongShare)).status, 404);
    await store.revokeShares(note.id, owners[0]);
    assert.equal((await download(url, null, share)).status, 404);
    await store.deleteNote(note.id, owners[0], note.revision);
    assert.equal((await download(url, 0)).status, 404);
  });

  it("fails closed on unregistered legacy objects and traversal paths", async () => {
    const reads = objectReads;
    assert.equal((await download(`/api/uploads/serve/note-images/${randomUUID()}/${randomUUID()}.webp`, 0)).status, 404);
    assert.equal((await download(`/api/uploads/serve/note-images/${randomUUID()}/legacy.png`, 0)).status, 404);
    currentRequest = new NextRequest("http://localhost/api/uploads/serve/path");
    assert.equal((await serve.GET(currentRequest, { params: Promise.resolve({ path: ["..", "secrets.html"] }) })).status, 404);
    assert.equal(objectReads, reads);
  });

  async function reserve(noteId: string, ownerId: string, count: number, size: number) {
    for (let index = 0; index < count; index++) {
      const id = randomUUID();
      await store.pool.query("INSERT INTO note_attachments(id,note_id,owner_id,path,content_type,size,status) VALUES($1,$2,$3,$4,'image/webp',$5,'pending')", [id, noteId, ownerId, `note-images/${noteId}/${id}.webp`, size]);
    }
  }

  it("counts pending reservations and prevents concurrent requests from bypassing the per-note limit", async () => {
    const note = await store.createNote(owners[2]);
    await reserve(note.id, owners[2], validation.MAX_NOTE_IMAGES - 1, 1);
    const results = await Promise.all([upload.POST(uploadRequest(note.id, 2)), upload.POST(uploadRequest(note.id, 2))]);
    assert.deepEqual(results.map(result => result.status).sort(), [201, 413]);
    const { rows } = await store.pool.query("SELECT count(*)::int AS count FROM note_attachments WHERE note_id=$1", [note.id]);
    assert.equal(rows[0].count, validation.MAX_NOTE_IMAGES);
  });

  it("enforces the aggregate owner quota across different notes", async () => {
    const existing = await store.createNote(owners[3]);
    const fresh = await store.createNote(owners[3]);
    await reserve(existing.id, owners[3], validation.MAX_OWNER_IMAGE_BYTES / validation.MAX_IMAGE_BYTES, validation.MAX_IMAGE_BYTES);
    assert.equal((await upload.POST(uploadRequest(fresh.id, 3))).status, 413);
  });

  it("reclaims expired pending reservations and their objects before reserving a new upload", async () => {
    const note = await store.createNote(owners[5]);
    const id = randomUUID();
    const stalePath = `note-images/${note.id}/${id}.webp`;
    await store.pool.query("INSERT INTO note_attachments(id,note_id,owner_id,path,content_type,size,status,created_at) VALUES($1,$2,$3,$4,'image/webp',1,'pending',now()-interval '2 hours')", [id, note.id, owners[5], stalePath]);
    objects.set(stalePath, Buffer.from("orphaned upload"));
    assert.equal((await upload.POST(uploadRequest(note.id, 5))).status, 201);
    assert.equal(objects.has(stalePath), false);
    const { rows } = await store.pool.query("SELECT count(*)::int AS count FROM note_attachments WHERE id=$1", [id]);
    assert.equal(rows[0].count, 0);
  });

  it("rolls back the attachment reservation if object storage fails", async () => {
    const note = await store.createNote(owners[4]);
    failWrite = true;
    try { assert.equal((await upload.POST(uploadRequest(note.id, 4))).status, 500); }
    finally { failWrite = false; }
    const { rows } = await store.pool.query("SELECT count(*)::int AS count FROM note_attachments WHERE note_id=$1", [note.id]);
    assert.equal(rows[0].count, 0);
  });
});
