import sharp, { type Metadata } from "sharp";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
export const MAX_OWNER_IMAGE_BYTES = 100 * 1024 * 1024;
export const MAX_NOTE_IMAGES = 50;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_IMAGE_FRAMES = 120;
export const IMAGE_PROCESSING_TIMEOUT_SECONDS = 10;

/** Count all decoded frames, rather than allowing every frame its own pixel budget. */
export function validateImageGeometry(metadata: Pick<Metadata, "width" | "height" | "pages">): number {
  const frames = metadata.pages ?? 1;
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > MAX_IMAGE_FRAMES) {
    throw new Error(`Images must contain at most ${MAX_IMAGE_FRAMES} frames.`);
  }
  const { width, height } = metadata;
  if (!width || !height || width < 1 || height < 1 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width * height * frames > MAX_IMAGE_PIXELS) {
    throw new Error("The image exceeds the total decoded pixel limit.");
  }
  return frames;
}

/** Decode real raster bytes and write a clean image; never trust a filename or MIME header. */
export async function normalizeImage(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Images must be between 1 byte and 5 MB.");
  }
  // Inspect one frame first, so frame count and aggregate dimensions are checked
  // before asking the decoder to load an entire animation.
  const image = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "warning" });
  const metadata = await image.metadata();
  if (!metadata.format || !["jpeg", "png", "gif", "webp"].includes(metadata.format)) {
    throw new Error("Only JPEG, PNG, GIF, and WebP images are supported.");
  }
  const frames = validateImageGeometry(metadata);
  // Re-encoding strips embedded metadata and trailing payloads. Preserve GIF and
  // WebP animation, including timing and loop count, within the shared budget.
  const decoded = frames > 1
    ? sharp(bytes, { animated: true, limitInputPixels: MAX_IMAGE_PIXELS, failOn: "warning" })
    : image.rotate();
  const normalized = await decoded
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85, effort: 3 })
    .timeout({ seconds: IMAGE_PROCESSING_TIMEOUT_SECONDS })
    .toBuffer();
  if (!normalized.length || normalized.length > MAX_IMAGE_BYTES) {
    throw new Error("The processed image exceeds 5 MB.");
  }
  return normalized;
}
