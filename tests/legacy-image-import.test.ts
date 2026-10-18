import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { importLegacyImages, legacyImageCandidates, parseLegacyImportOptions, type LegacyImportDependencies, type LegacyImportNote } from "../lib/legacy-image-import";

const noteId = "ebf85b0f-572b-410c-bd48-a9fb9f9a63af";
const ownerId = "e0d729a2-8943-422c-8528-d4d0e29559f8";
const source = "/api/uploads/serve/note-images%2Fcool-websites%2F36db6dbb-4580-41d3-bc44-c6a51f283312.png";
const content = `![Site](${source})\n![Stripe](/api/uploads/serve/note-images%2Fcool-websites%2Fstripe-press.gif)\n![BFCM](/api/uploads/serve/note-images%2Fcool-websites%2Fbfcm-stripe.jpg)`;
const options = { noteId, legacyPrefix: "note-images/cool-websites", dryRun: true };
const note: LegacyImportNote = { id: noteId, content, public: true, owner_id: null };

async function fakeDependencies() {
  const input = await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } }).png().toBuffer();
  const calls: string[] = [];
  const dependencies: LegacyImportDependencies = {
    async findRegistered() { calls.push("find"); return false; },
    async readObject(path) { calls.push(`read:${path}`); return input; },
    async usage() { calls.push("usage"); return { total: 0, count: 0 }; },
    async writeImage() { calls.push("write"); },
    async updateContent() { calls.push("update"); },
  };
  return { calls, dependencies };
}

test("requires an explicit reviewed slug prefix and keeps the UUID default", () => {
  assert.throws(() => legacyImageCandidates(content, { noteId, dryRun: true }), /reviewed/);
  const candidates = legacyImageCandidates(content, options);
  assert.deepEqual(candidates.map(image => image.path), [
    "note-images/cool-websites/36db6dbb-4580-41d3-bc44-c6a51f283312.png",
    "note-images/cool-websites/stripe-press.gif",
    "note-images/cool-websites/bfcm-stripe.jpg",
  ]);
  assert.equal(legacyImageCandidates(`![A](/api/uploads/serve/note-images%2F${noteId}%2Fa.png)`, { noteId, dryRun: true })[0].path, `note-images/${noteId}/a.png`);
  assert.deepEqual(parseLegacyImportOptions([noteId, "--dry-run", "--legacy-prefix", "note-images/cool-websites"]), options);
  for (const prefix of ["note-images", "note-images/", "note-images/..", "note-images/cool-websites/", "note-images/a/b", "note-images%2Fcool-websites"]) {
    assert.throws(() => parseLegacyImportOptions([noteId, "--legacy-prefix", prefix]));
  }
  assert.throws(() => parseLegacyImportOptions([noteId, "--dry-run", "--dry-run"]));
});

test("decodes once and rejects traversal, double encoding and cross-note boundaries", () => {
  for (const path of [
    "note-images%2Fcool-websites-other%2Fa.png",
    "note-images%2Fother-note%2Fa.png",
    "note-images%252Fcool-websites%252Fa.png",
    "note-images%2Fcool-websites%2F..%2Fa.png",
    "note-images%2Fcool-websites%2F%2e%2e",
    "note-images%2Fcool-websites%2Fa%5Cb.png",
    "note-images%2Fcool-websites%2Fa.png%00",
    "note-images%2Fcool-websites%2Fa.png%3Fsecret=1",
    "note-images%2Fcool-websites%2Fa.png?x=1",
    "note-images%2Fcool-websites%2Fa%ZZ.png",
  ]) assert.throws(() => legacyImageCandidates(`![A](/api/uploads/serve/${path})`, options), path);
});

test("dry run validates actual objects and proposes links without writing", async () => {
  const { calls, dependencies } = await fakeDependencies();
  dependencies.writeImage = async () => { assert.fail("Dry run attempted a storage/database write"); };
  dependencies.updateContent = async () => { assert.fail("Dry run attempted a note update"); };
  const result = await importLegacyImages(note, options, dependencies);
  assert.equal(result.images.length, 3);
  assert.equal(calls.filter(call => call.startsWith("read:")).length, 3);
  assert.ok(result.images.every(image => image.newPath.startsWith(`note-images/${noteId}/`) && image.newPath.endsWith(".webp")));
  assert.ok(result.content.includes(result.images[0].newPath));
  assert.equal(note.content, content);
});

test("refuses unrecovered private notes and mismatched notes before reading storage", async () => {
  const { calls, dependencies } = await fakeDependencies();
  await assert.rejects(importLegacyImages({ ...note, public: false }, options, dependencies), /Recover ownership/);
  await assert.rejects(importLegacyImages({ ...note, id: ownerId }, options, dependencies), /does not match/);
  assert.equal(calls.length, 0);
  const result = await importLegacyImages({ ...note, public: false, owner_id: ownerId }, options, dependencies);
  assert.equal(result.images.length, 3);
});

test("validates every path and all image bytes before any import write", async () => {
  const { calls, dependencies } = await fakeDependencies();
  await assert.rejects(importLegacyImages({ ...note, content: `${content}\n![Foreign](/api/uploads/serve/note-images/foreign/a.png)` }, { ...options, dryRun: false }, dependencies));
  assert.equal(calls.length, 0);
  let reads = 0;
  const goodRead = dependencies.readObject;
  dependencies.readObject = async path => ++reads === 2 ? Buffer.from("<html>bad</html>") : goodRead(path);
  await assert.rejects(importLegacyImages(note, { ...options, dryRun: false }, dependencies));
  assert.equal(calls.includes("write"), false);
  assert.equal(calls.includes("update"), false);
});

test("applies the reviewed plan once, and deduplicates equivalent encoded URLs", async () => {
  const { calls, dependencies } = await fakeDependencies();
  const duplicate = `![Again](/api/uploads/serve/note-images/cool-websites/36db6dbb-4580-41d3-bc44-c6a51f283312.png)`;
  const result = await importLegacyImages({ ...note, content: `![Site](${source})\n${duplicate}` }, { ...options, dryRun: false }, dependencies);
  assert.equal(result.images.length, 1);
  assert.equal(calls.filter(call => call === "write").length, 1);
  assert.equal(calls.filter(call => call === "update").length, 1);
  assert.equal(result.content.split(result.images[0].newPath).length, 3);
});

test("rejects quota exhaustion before making any write", async () => {
  const { calls, dependencies } = await fakeDependencies();
  dependencies.usage = async () => ({ total: 100 * 1024 * 1024, count: 0 });
  await assert.rejects(importLegacyImages(note, { ...options, dryRun: false }, dependencies), /storage limit/);
  assert.equal(calls.includes("write"), false);
});

test("supports a mixture of reviewed legacy paths and this note's registered UUID paths", async () => {
  const { calls, dependencies } = await fakeDependencies();
  const registered = `note-images/${noteId}/already-imported.webp`;
  dependencies.findRegistered = async path => path === registered;
  const mixed = { ...note, content: `![Imported](/api/uploads/serve/${registered})\n![Legacy](${source})` };
  const result = await importLegacyImages(mixed, options, dependencies);
  assert.equal(result.images.length, 1);
  assert.equal(result.existing.length, 1);
  assert.ok(result.content.includes(registered));
  assert.equal(calls.filter(call => call.startsWith("read:")).length, 1);
});

test("replaces exact image destinations without corrupting filename prefixes or prose", async () => {
  const { calls, dependencies } = await fakeDependencies();
  const short = "/api/uploads/serve/note-images%2Fcool-websites%2Fa.png";
  const long = `${short}-large.png`;
  const original = `![Small](${short})\n![Large](${long})\n![Repeated](${short})\nPlain URL: ${short}\n[Ordinary link](${long})`;
  let persisted = "";
  dependencies.updateContent = async updated => { persisted = updated; calls.push("update"); };
  const result = await importLegacyImages({ ...note, content: original }, { ...options, dryRun: false }, dependencies);
  const smallLink = `/api/uploads/serve/${result.images.find(image => image.path.endsWith("/a.png"))!.newPath}`;
  const largeLink = `/api/uploads/serve/${result.images.find(image => image.path.endsWith("/a.png-large.png"))!.newPath}`;
  const expected = `![Small](${smallLink})\n![Large](${largeLink})\n![Repeated](${smallLink})\nPlain URL: ${short}\n[Ordinary link](${long})`;
  assert.equal(result.images.length, 2);
  assert.equal(result.content, expected);
  assert.equal(persisted, expected);
  assert.equal(calls.filter(call => call === "write").length, 2);
  assert.equal(calls.filter(call => call.startsWith("read:")).length, 2);
});
