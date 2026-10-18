import { NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details: Record<string, unknown> = {}) {
    super(message);
    this.name = "HttpError";
  }
}

export const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message, ...error.details }, { status: error.status, headers: privateHeaders });
  }
  console.error("Request failed:", error instanceof Error ? error.name : "UnknownError");
  return NextResponse.json({ error: "The request could not be completed. Please try again." }, { status: 500, headers: privateHeaders });
}

async function readBodyBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "Request is too large");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Could not read the request body");
  } finally { reader.releaseLock(); }
}

function checkJsonContentType(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }
}

function decodeJson(bytes: Uint8Array) {
  try { return record(JSON.parse(new TextDecoder().decode(bytes))); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid JSON body");
  }
}

export async function readJson(request: Request, maxBytes = 1_100_000): Promise<Record<string, unknown>> {
  checkJsonContentType(request);
  return decodeJson(await readBodyBytes(request, maxBytes));
}

/** Framework adapters can expose an empty body as a stream rather than null. */
export async function readOptionalJson(request: Request, maxBytes = 1024): Promise<Record<string, unknown> | null> {
  const bytes = await readBodyBytes(request, maxBytes);
  if (!bytes.length) return null;
  checkJsonContentType(request);
  return decodeJson(bytes);
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Expected a JSON object");
  return value as Record<string, unknown>;
}

export function allowKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new HttpError(400, "Unsupported request field");
}

export function requireUuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, "Invalid note ID");
  }
  return value;
}

export function requireRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new HttpError(400, "A valid revision is required");
  return value as number;
}

export function parseUpdates(value: unknown, allowEmpty = false) {
  const updates = record(value);
  allowKeys(updates, ["title", "content", "emoji"]);
  if (!allowEmpty && Object.keys(updates).length === 0) throw new HttpError(400, "No changes supplied");
  const result: { title?: string; content?: string; emoji?: string } = {};
  for (const field of ["title", "content", "emoji"] as const) {
    if (!(field in updates)) continue;
    const entry = updates[field];
    const limit = field === "content" ? 1_000_000 : field === "title" ? 500 : 64;
    if (typeof entry !== "string" || entry.length > limit) throw new HttpError(400, `Invalid ${field}`);
    result[field] = entry;
  }
  return result;
}
