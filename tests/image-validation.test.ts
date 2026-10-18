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

test("preserves animated GIF and WebP frames, delays, and looping", async () => {
  const frames = await Promise.all(["red", "blue"].map(background => sharp({ create: { width: 16, height: 12, channels: 3, background } }).png().toBuffer()));
  const gif = await sharp(frames, { join: { animated: true } }).gif({ delay: [70, 130], loop: 3 }).toBuffer();
  for (const input of [gif, await sharp(gif, { animated: true }).webp().toBuffer()]) {
    const output = await normalizeImage(input);
    const metadata = await sharp(output, { animated: true }).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.pages, 2);
    assert.equal(metadata.pageHeight, 12);
    assert.deepEqual(metadata.delay, [70, 130]);
    assert.equal(metadata.loop, 3);
    const { data, info } = await sharp(output, { animated: true }).raw().toBuffer({ resolveWithObject: true });
    const second = 16 * 12 * info.channels;
    assert.ok(data[0] > data[2], "first frame remains red");
    assert.ok(data[second + 2] > data[second], "second frame remains blue");
  }
});

test("rejects animations beyond the frame or aggregate pixel budgets", async () => {
  const frames = await Promise.all(Array.from({ length: 121 }, (_, index) => sharp({ create: { width: 1, height: 1, channels: 3, background: { r: index, g: 255 - index, b: index % 2 ? 255 : 0 } } }).png().toBuffer()));
  const gif = await sharp(frames, { join: { animated: true } }).gif().toBuffer();
  assert.equal((await sharp(gif).metadata()).pages, 121);
  await assert.rejects(normalizeImage(gif), /frames/);
  // An animated WebP can claim a huge canvas despite tiny frame payloads.
  // Reject its aggregate decoded area before requesting animated pixel decoding.
  const twoFrames = await sharp(frames.slice(0, 2), { join: { animated: true } }).webp().toBuffer();
  const extendedHeader = twoFrames.indexOf("VP8X");
  twoFrames.writeUIntLE(5999, extendedHeader + 12, 3); twoFrames.writeUIntLE(3999, extendedHeader + 15, 3);
  await assert.rejects(normalizeImage(twoFrames), /pixel limit/);
});
