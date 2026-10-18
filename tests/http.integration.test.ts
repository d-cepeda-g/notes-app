import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { Note } from "../lib/types";

const base = process.env.NOTES_TEST_BASE_URL;
describe("production HTTP security and note lifecycle", { skip: !base }, () => {
  let ownerCookie = "";
  let otherCookie = "";
  let note: Note;
  let shareUrl = "";
  const request = (path: string, method = "GET", cookie = "", body?: unknown, extra: Record<string,string> = {}) => fetch(`${base}${path}`, {
    method, redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...(method !== "GET" ? { origin: base! } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...extra },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const assertSafe = (value: unknown) => assert.doesNotMatch(JSON.stringify(value), /"(?:session_id|owner_id|token_hash)"/);
  before(async () => {
    const a = await request("/api/session", "POST");
    const b = await request("/api/session", "POST");
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.match(a.headers.get("set-cookie")!, /HttpOnly/i);
    assert.match(a.headers.get("set-cookie")!, /SameSite=lax/i);
    ownerCookie = a.headers.get("set-cookie")!.split(";")[0];
    otherCookie = b.headers.get("set-cookie")!.split(";")[0];
    assert.notEqual(ownerCookie, otherCookie);
    assert.deepEqual(await a.json(), { authenticated: true });
  });
  it("rejects CSRF and legacy browser IDs", async () => {
    assert.equal((await request("/api/notes", "POST", ownerCookie, {}, { origin: "https://attacker.invalid" })).status, 403);
    assert.equal((await request("/api/session", "POST", "", { session_id: randomUUID() })).status, 400);
    assert.equal((await request(`/api/notes?session_id=${randomUUID()}`)).status, 401);
  });
  it("creates only server-owned safe notes and denies private links to others", async () => {
    const result = await request("/api/notes", "POST", ownerCookie, {});
    assert.equal(result.status, 201);
    note = await result.json(); assertSafe(note); assert.equal(note.can_edit, true);
    assert.equal((await request(`/api/notes/by-slug/${note.slug}`)).status, 404);
    assert.equal((await request(`/api/notes/by-slug/${note.slug}`, "GET", otherCookie)).status, 404);
    const owned = await request(`/api/notes/by-slug/${note.slug}`, "GET", ownerCookie);
    assert.equal(owned.status, 200); assertSafe(await owned.json());
    const list = await request("/api/notes", "GET", otherCookie);
    assert.deepEqual(await list.json(), []);
    assert.equal((await request(`/notes/${note.slug}`, "GET", otherCookie)).status, 404);
  });
  it("atomically rejects concurrent stale writes and cross-owner mutations", async () => {
    const changes = { revision: note.revision, updates: { content: "Owner's first draft" } };
    assert.equal((await request(`/api/notes/${note.id}`, "PATCH", otherCookie, changes)).status, 404);
    const responses = await Promise.all([
      request(`/api/notes/${note.id}`, "PATCH", ownerCookie, changes),
      request(`/api/notes/${note.id}`, "PATCH", ownerCookie, { revision: note.revision, updates: { content: "Other concurrent draft" } }),
    ]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    note = await responses.find(r => r.status === 200)!.json();
    const conflict = await responses.find(r => r.status === 409)!.json();
    assert.equal(conflict.note.revision, note.revision); assertSafe(conflict);
    assert.equal((await request(`/api/notes/${note.id}`, "PATCH", ownerCookie, { revision: note.revision, updates: { session_id: randomUUID() } })).status, 400);
  });
  it("provides read-only revocable sharing and isolates private page caches", async () => {
    const saved = await request(`/api/notes/${note.id}`, "PATCH", ownerCookie, { revision: note.revision, updates: { title: "Security fixture", content: '<iframe srcdoc="<script>parent.document.title=123</script>"></iframe>\n\n**Safe Markdown**' } });
    assert.equal(saved.status, 200); note = await saved.json();
    const result = await request(`/api/notes/${note.id}/share`, "POST", ownerCookie);
    assert.equal(result.status, 201);
    shareUrl = (await result.json()).url;
    const shared = await fetch(new URL(shareUrl, base));
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get("cache-control") || "", /no-store/);
    assert.match(shared.headers.get("content-security-policy") || "", /frame-src 'none'/);
    const html = await shared.text();
    assert.match(html, /Safe Markdown/);
    assert.doesNotMatch(html, /<iframe\b/i);
    const owned = await request(`/notes/${note.slug}`, "GET", ownerCookie);
    assert.equal(owned.status, 200);
    assert.match(owned.headers.get("cache-control") || "", /no-store/);
    assert.notEqual(owned.headers.get("content-security-policy"), shared.headers.get("content-security-policy"));
    assert.equal((await request(`/api/notes/${note.id}/share`, "DELETE", otherCookie)).status, 404);
    assert.equal((await request(`/api/notes/${note.id}/share`, "DELETE", ownerCookie)).status, 200);
    assert.equal((await fetch(new URL(shareUrl, base))).status, 404);
  });
  it("enforces image authentication, ownership and actual content", async () => {
    assert.equal((await request("/api/uploads", "POST", "", { name: "evil.html" })).status, 401);
    assert.equal((await request("/api/uploads", "POST", ownerCookie, { name: "evil.html" })).status, 415);
    const upload = async (cookie: string) => {
      const body = new FormData(); body.set("noteId", note.id);
      body.set("file", new File(['<html><script>alert(1)</script></html>'], "photo.png", { type: "image/png" }));
      return fetch(`${base}/api/uploads`, { method: "POST", headers: { cookie, origin: base! }, body });
    };
    assert.equal((await upload(otherCookie)).status, 404);
    assert.equal((await upload(ownerCookie)).status, 415);
    assert.equal((await request(`/api/uploads/serve/note-images/${note.id}/legacy.html`)).status, 404);
  });
  it("soft deletes, restores and never revives previously revoked sharing", async () => {
    const deleted = await request(`/api/notes/${note.id}`, "DELETE", ownerCookie, { revision: note.revision });
    assert.equal(deleted.status, 200); note = await deleted.json(); assert.ok(note.deleted_at);
    assert.equal((await request(`/api/notes/by-slug/${note.slug}`, "GET", ownerCookie)).status, 404);
    const trash = await (await request("/api/notes?deleted=true", "GET", ownerCookie)).json() as Note[];
    assert.ok(trash.some(item => item.id === note.id));
    const restored = await request(`/api/notes/${note.id}`, "PATCH", ownerCookie, { revision: note.revision, restore: true });
    assert.equal(restored.status, 200); note = await restored.json(); assert.equal(note.deleted_at, null);
    assert.equal((await fetch(new URL(shareUrl, base))).status, 404);
    assert.equal((await request(`/api/notes/by-slug/${note.slug}`, "GET", ownerCookie)).status, 200);
  });
  it("retires browser cache secrets and renders current project copy", async () => {
    assert.equal((await request("/notes/revalidate", "POST", ownerCookie, { slug: note.slug }, { "x-revalidate-token": "old-secret" })).status, 410);
    const projects = await request("/api/notes/by-slug/projects");
    assert.equal(projects.status, 200);
    const content = await projects.json(); assertSafe(content);
    assert.match(content.content, /kaloapp.xyz/); assert.match(content.content, /lucidejournal.com/); assert.match(content.content, /sudoclueapp.com/);
  });
});
