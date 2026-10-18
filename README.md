# notes

David Cepeda's Notes-inspired personal website, based on [Alana Goyal's original project](https://github.com/alanagoyal/notes).

The app has public Markdown notes and private browser notes, automatic draft saving, recoverable deletion, and revocable read-only sharing. The current visual design and plain-text private editor are retained.

## Run locally

Use Node.js 22 or 24 and PostgreSQL 16 or later. Copy `.env.example` to `.env.local`, use a local database, and change both origin settings to `http://localhost:3000`. Next.js reads `.env.local`; database command-line scripts need `DATABASE_URL` exported in the shell.

```sh
npm ci
DATABASE_URL=postgresql://… npm run db:migrate
npm run dev
```

For a production build, configure the deployment's origin and database, then run:

```sh
npm run build
npm start
```

Image uploads require Replit App Storage and its credential sidecar. `PRIVATE_OBJECT_DIR` must name a private bucket prefix. Images are validated on the server, bound to notes, and checked again on download.

## Updating an existing deployment

Read [RECOVERY.md](./RECOVERY.md) first. Old private data remains in the database, but the former exposed browser IDs are not accepted as credentials. The guide includes explicit administrator recovery and a safe importer for old image URLs. Do not use `db:push` to replace the versioned production migrations.

## Current projects

Public copy lives in [content/projects.ts](./content/projects.ts). It preserves the original current/previous sections, compact entries, inline links, status lines, and previous projects, with Sudoclue added to the current projects. Update its copy and real modification timestamp when projects change; no production database edit is required to publish that copy in a new release.

## Checks

```sh
npm run typecheck
npm run lint
TEST_DATABASE_URL=postgresql://… DATABASE_URL=postgresql://… npm test
npm run build
```

Use a separate test database. With a test server running, set `NOTES_TEST_BASE_URL` and run `npm run test:http` to verify actual HTTP access boundaries and the create/save/share/delete/restore flow. CI runs these checks against isolated PostgreSQL.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the current security, saving, storage, and data model. Additional rich-text, folder, appearance, and sync improvements are deferred.

## Credits and license

Original concept and implementation by [Alana Goyal](https://alanagoyal.com). Licensed under the [MIT license](./LICENSE.md).
