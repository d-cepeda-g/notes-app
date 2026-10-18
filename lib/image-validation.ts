import sharp from "sharp";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
export const MAX_OWNER_IMAGE_BYTES = 100 * 1024 * 1024;
export const MAX_NOTE_IMAGES = 50;

/** Decode real raster bytes and write a clean image; never trust a filename or MIME header. */
export async function normalizeImage(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Images must be between 1 byte and 5 MB.");
  }
  const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" });
  const metadata = await image.metadata();
  if (!metadata.format || !["jpeg", "png", "gif", "webp"].includes(metadata.format)) {
    throw new Error("Only JPEG, PNG, GIF, and WebP images are supported.");
  }
  // Re-encoding strips embedded metadata and trailing payloads. GIF uploads use the first frame.
  const normalized = await image.rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  if (!normalized.length || normalized.length > MAX_IMAGE_BYTES) {
    throw new Error("The processed image exceeds 5 MB.");
  }
  return normalized;
}
