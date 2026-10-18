import { Storage } from "@google-cloud/storage";

const SIDECAR = "http://127.0.0.1:1106";
const storage = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token", type: "external_account",
    token_url: `${SIDECAR}/token`,
    credential_source: { url: `${SIDECAR}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function objectFile(path: string) {
  const directory = process.env.PRIVATE_OBJECT_DIR;
  if (!directory) throw new Error("Object storage is not configured.");
  const parts = directory.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("PRIVATE_OBJECT_DIR must contain a bucket and prefix.");
  const [bucket, ...prefix] = parts;
  return storage.bucket(bucket).file([...prefix, path].join("/"));
}

export async function saveImageObject(path: string, bytes: Buffer): Promise<void> {
  await objectFile(path).save(bytes, { resumable: false, metadata: { contentType: "image/webp", cacheControl: "private, no-store" } });
}

export async function readImageObject(path: string): Promise<Buffer> {
  const file = objectFile(path);
  const [metadata] = await file.getMetadata();
  const maximum = 5 * 1024 * 1024;
  if (Number(metadata.size) > maximum) throw new Error("Stored image exceeds the size limit.");
  const [bytes] = await file.download({ start: 0, end: maximum });
  if (bytes.length > maximum) throw new Error("Stored image exceeds the size limit.");
  return bytes;
}

export async function deleteImageObject(path: string): Promise<void> {
  await objectFile(path).delete({ ignoreNotFound: true });
}
