import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { normalizeImage, MAX_IMAGE_BYTES } from "../lib/image-validation";

test("rejects executable content disguised as an image", async () => {
  await assert.rejects(normalizeImage(Buffer.from('<html><script>alert(1)</script></html>')));
  await assert.rejects(normalizeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')));
  await assert.rejects(normalizeImage(Buffer.alloc(0)));
});

test("enforces source byte and decoded pixel limits", async () => {
  await assert.rejects(normalizeImage(Buffer.alloc(MAX_IMAGE_BYTES + 1)));
  const large = await sharp({ create: { width: 6400, height: 6400, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(normalizeImage(large));
});

test("rewrites raster bytes, removing appended active content and metadata", async () => {
  const input = await sharp({ create: { width: 40, height: 20, channels: 3, background: "red" } }).png().toBuffer();
  const result = await normalizeImage(Buffer.concat([input, Buffer.from('<script>payload()</script>')]));
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 40);
  assert.equal(result.includes(Buffer.from("<script>")), false);
  assert.equal(metadata.exif, undefined);
});
