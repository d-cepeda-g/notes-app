import { randomUUID } from "node:crypto";
import { MAX_NOTE_IMAGES, MAX_OWNER_IMAGE_BYTES, normalizeImage } from "./image-validation";

const SERVE_PREFIX = "/api/uploads/serve/";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH_PART = /^[a-z0-9][a-z0-9._-]*$/i;

function legacyImagePattern() {
  return /(!\[[^\]]*\]\()(\/api\/uploads\/serve\/[^\s)]+)(\))/g;
}

export interface LegacyImportOptions { noteId: string; legacyPrefix?: string; dryRun: boolean }
export interface LegacyImportNote { id: string; content: string; public: boolean; owner_id: string | null }
export interface LegacyImageCandidate { source: string; path: string }
export interface LegacyImagePlan extends LegacyImageCandidate { id: string; newPath: string; bytes: Buffer }
export interface LegacyImportDependencies {
  findRegistered(path: string, noteId: string): Promise<boolean>;
  readObject(path: string): Promise<Buffer>;
  usage(ownerId: string, noteId: string): Promise<{ total: number; count: number }>;
  writeImage(image: LegacyImagePlan, ownerId: string, noteId: string): Promise<void>;
  updateContent(content: string, noteId: string): Promise<void>;
}

function validatePrefix(value: string): string {
  const parts = value.split("/");
  if (parts.length !== 2 || parts[0] !== "note-images" || !PATH_PART.test(parts[1])) {
    throw new Error("The reviewed legacy prefix must be exactly note-images/FOLDER, without encoding or a trailing slash.");
  }
  return value;
}

export function parseLegacyImportOptions(args: string[]): LegacyImportOptions {
  const [noteId, ...flags] = args;
  if (!UUID.test(noteId || "")) throw new Error("An explicit UUID note ID is required.");
  const options: LegacyImportOptions = { noteId, dryRun: false };
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === "--dry-run" && !options.dryRun) options.dryRun = true;
    else if (flags[i] === "--legacy-prefix" && !options.legacyPrefix && flags[i + 1]) {
      options.legacyPrefix = validatePrefix(flags[++i]);
    } else throw new Error("Unknown, repeated, or incomplete import option.");
  }
  return options;
}

/** A non-UUID folder is accepted only when the administrator explicitly names it. */
export function legacyImageCandidates(content: string, options: LegacyImportOptions): LegacyImageCandidate[] {
  if (!UUID.test(options.noteId)) throw new Error("An explicit UUID note ID is required.");
  const prefixes = [`note-images/${options.noteId}`];
  if (options.legacyPrefix) prefixes.push(validatePrefix(options.legacyPrefix));
  const sources = Array.from(new Set(Array.from(content.matchAll(legacyImagePattern()), match => match[2])));
  if (sources.length > MAX_NOTE_IMAGES) throw new Error("The note contains too many image URLs to import.");
  return sources.map(source => {
    let path: string;
    try { path = decodeURIComponent(source.slice(SERVE_PREFIX.length)); }
    catch { throw new Error("A legacy image URL has invalid encoding."); }
    const parts = path.split("/");
    // Three exact path parts exclude traversal, nested paths, backslashes,
    // query strings and residual percent escapes requiring a second decode.
    if (parts.length !== 3 || parts.some(part => !PATH_PART.test(part)) || !prefixes.some(prefix => path.startsWith(`${prefix}/`))) {
      throw new Error("A legacy image path is outside the explicitly reviewed note prefix.");
    }
    return { source, path };
  });
}

/** Plan and validate every source before making writes. Dry runs call read methods only. */
export async function importLegacyImages(note: LegacyImportNote, options: LegacyImportOptions, dependencies: LegacyImportDependencies) {
  if (note.id !== options.noteId) throw new Error("The selected note does not match the requested note ID.");
  if (!note.public && !note.owner_id) throw new Error("Recover ownership of this private note before importing its images.");
  const owner = note.owner_id || note.id;
  const candidates = legacyImageCandidates(note.content, options);
  const usage = await dependencies.usage(owner, note.id);
  let total = Number(usage.total);
  let count = Number(usage.count);
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(count) || count < 0) throw new Error("Image storage usage is invalid.");
  const images: LegacyImagePlan[] = [];
  const existing: LegacyImageCandidate[] = [];
  const byPath = new Map<string, LegacyImagePlan>();
  const replacements = new Map<string, string>();
  for (const candidate of candidates) {
    let planned = byPath.get(candidate.path);
    if (!planned) {
      if (await dependencies.findRegistered(candidate.path, note.id)) {
        existing.push(candidate); continue;
      }
      if (count >= MAX_NOTE_IMAGES) throw new Error("Image storage limit reached.");
      const bytes = await normalizeImage(await dependencies.readObject(candidate.path));
      if (total + bytes.length > MAX_OWNER_IMAGE_BYTES) throw new Error("Image storage limit reached.");
      const id = randomUUID();
      planned = { ...candidate, id, newPath: `note-images/${note.id}/${id}.webp`, bytes };
      images.push(planned); byPath.set(candidate.path, planned);
      total += bytes.length; count++;
    }
    replacements.set(candidate.source, `${SERVE_PREFIX}${planned.newPath}`);
  }
  // Replace exact parsed destinations in the original text in one pass. A URL
  // may be a prefix of another filename, or also occur in prose and links.
  const content = note.content.replace(legacyImagePattern(), (match, prefix: string, source: string, suffix: string) => {
    const replacement = replacements.get(source);
    return replacement ? `${prefix}${replacement}${suffix}` : match;
  });
  if (!options.dryRun) {
    for (const image of images) await dependencies.writeImage(image, owner, note.id);
    if (images.length) await dependencies.updateContent(content, note.id);
  }
  return { images, existing, content };
}
