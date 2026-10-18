# Notes architecture

The app is a Next.js personal website with public Markdown notes and private, anonymous browser notes. PostgreSQL stores notes, sessions, sharing permissions, and attachment records. Replit App Storage stores image objects.

## Access control

- The server issues a random 256-bit `notes_session` cookie. The cookie is HttpOnly, SameSite=Lax, and Secure on HTTPS deployments. The database stores only its SHA-256 hash, with a separate owner UUID.
- Browser requests never supply owner IDs or legacy `session_id` values. Every private read and mutation checks the cookie against an unexpired server session.
- Browser note data uses an explicit projection. It contains content, dates, revision, and `can_edit`, with no owner identifiers or credentials.
- Mutations require a matching Origin and reject cross-site Fetch Metadata. Set `APP_ORIGIN` to the actual deployment origin; previews need their own origin.
- `APP_REDIRECT_HOSTS` lists verified alternative page hosts. Their GET/HEAD requests redirect to the fixed canonical origin, preserving paths and searches. Mutation permissions are not broadened. This keeps browser sessions and writes on one production domain.
- Private and shared pages are dynamic and use private/no-store responses. Note mutation handlers perform cache invalidation; the former browser revalidation endpoint returns 410.
- Sharing uses a separate random token whose hash is stored in `note_shares`. A shared URL grants read-only access to one note and its registered images. Revocation and deletion invalidate it. Restoring a note does not restore old shares.
- Markdown rendering skips raw HTML. A nonce-based Content Security Policy blocks embedded frames and objects. Sharing tokens are not sent to external image URLs, and pages use a no-referrer policy.

## Editing and recovery

The browser persists draft changes locally before background synchronization. A module-level per-note queue serializes writes across route navigation. Each request includes the base revision; the server checks and increments it atomically. A conflict stops automatic writes and lets the user choose the saved version or explicitly replace it. Failed requests retain their draft and show an error/retry state.

Each page has its own draft writer ID, so two tabs cannot overwrite each other's local recovery copies. Previous-page copies can be recovered or discarded explicitly. Local storage failure is visible and enables the browser's unsaved-change warning.

`created_at` and `updated_at` are real persisted timestamps. Grouping, displayed dates, and ordering use the modification date with creation date as a fallback. Existing dates are backfilled from creation dates without inventing history.

Deletion sets `deleted_at` and increments the revision. Recently Deleted and Undo restore the existing row. This version does not automatically purge deleted notes.

## Uploads

`POST /api/uploads` accepts a bounded multipart body containing `noteId` and `file`. It authenticates the owner, rejects deleted or foreign notes, decodes actual JPEG/PNG/GIF/WebP bytes, and re-encodes to WebP. SVG and executable formats are rejected. Limits are 5 MB per source/output image, 40 million decoded pixels across all frames, 120 frames, 2048 px output dimensions per frame, 10 seconds of processing, 50 images per note, and 100 MB per owner including pending reservations. GIF and WebP animation is preserved within those bounds.

A PostgreSQL advisory lock serializes quota reservations. Successful writes become registered attachments; failed writes release their reservation. A later upload reclaims the same owner's pending reservations older than one hour. Serving requires a matching registered image, an accessible note, and either its owner, public visibility, or a live share token for that note. Responses have a fixed image MIME type, nosniff, private/no-store caching, and bounded object reads.

The production driver uses Replit's local credential sidecar and `PRIVATE_OBJECT_DIR`. Automated route tests mock only the object transport while using real PostgreSQL, authentication, image decoding, quotas, and response logic.

## Public projects

`content/projects.ts` holds reviewed public project copy. `lib/public-content.ts` overlays the public projects note without changing private notes or writing to production data. Its modification date records the copy update. Existing note IDs and creation dates remain intact.

## Migrations and legacy data

`npm run db:migrate` explicitly applies checksum-tracked SQL migrations under a PostgreSQL advisory lock. `npm start` first runs `db:check`, a PostgreSQL-enforced read-only transaction that verifies migration history, checksums, required columns, and critical unique keys. A missing or incompatible schema stops startup; Autoscale instances never apply migrations implicitly. Existing private rows retain their old `session_id` for administrator recovery, but receive no automatic new owner because the old ID was publicly exposed. Unregistered old uploads are not served through the formerly unrestricted route.

The administrator image importer plans all validated images before writes. `--dry-run` uses a read-only database transaction and does not save objects or note text. Non-UUID legacy folders require an explicit per-note `--legacy-prefix` allowlist; the serving API does not trust slugs as ownership credentials. Successful imports write new registered UUID-based WebP paths, update links atomically, and preserve the original objects and note timestamps.

Follow [the rollout and recovery guide](./RECOVERY.md) before updating an existing deployment. Database and storage backups remain the deployment operator's responsibility.

## Validation

`npm run typecheck`, `npm run lint`, and `npm test` cover local behavior. Set `TEST_DATABASE_URL` to an isolated PostgreSQL database to include database and upload integration tests. `npm run test:http` also needs `NOTES_TEST_BASE_URL` pointing to a separate running test server. CI verifies the production build and actual HTTP boundaries. Do not point tests at production data.
