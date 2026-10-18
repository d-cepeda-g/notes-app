# Replit rollout and recovery

This release needs a rehearsed data migration before publishing. It does not replace the live database. The operator must verify the actual Replit production connection and storage configuration; the editor's `DATABASE_URL` can point to development instead.

## Verified project observations, 18 October 2026

- Personal Portfolio has separate Development and Production databases. The production `notes` table showed 15 rows during inspection; record fresh counts and content checksums before release rather than assuming this count is permanent.
- Production point-in-time recovery was on with seven days of history; scheduled backups were off. Database recovery does not replace an independent export or a separate copy of App Storage objects.
- At initial inspection, Replit's `recovered` checkout showed two "Published your App" commits not pushed to GitHub. Those commits and the later Replit configuration commit `7a88def` have since reached GitHub and are preserved in this release's history. Recheck for new Replit-only work before integration. Do not reset the Replit checkout to the GitHub branch or blindly synchronize it.
- Publishing had "Copy your development database to production database" unchecked. Keep it unchecked: it replaces production data. The editor preview and published projects note already contain different text.
- Publishing flagged `PRIVATE_OBJECT_DIR` as missing/out of sync for the next release. An existing live image still returned successfully. Verify and preserve the working live bucket/prefix; do not replace it with the sample setting or blindly copy every editor secret.
- The canonical, www, and Replit site addresses all served pages directly. Configure their canonical redirect policy before release so browser sessions and mutations use one origin.
- The public `cool-websites` note references seven existing images under the legacy `note-images/cool-websites/` prefix, including a GIF. These require an explicit reviewed import mapping.

## Before any production change

1. Record the current published release, Replit Git history, environment variable names, actual production database identity, and existing bucket/prefix. Keep secret values private.
2. Export a complete production PostgreSQL backup and preserve all current App Storage objects independently. Keep backups outside the public repository. Verify that the database export restores to an isolated database and that the stored-file copy is usable.
3. Rehearse the exact release against that restored database and a separate storage copy. A preview must never use production's database or writable storage prefix. Development and production can share App Storage within the same Replit app; copying code alone does not isolate storage. A different Replit project needs its own bucket containing copied objects.
4. Use Node 22 or 24. Set `APP_ORIGIN` and `NEXT_PUBLIC_SITE_URL` to the test deployment's origin and set `APP_REDIRECT_HOSTS` only to that test deployment's verified aliases. Build with the correct `NEXT_PUBLIC_SITE_URL`; it is a public build-time setting.
5. Run `npm run db:migrate` explicitly on the isolated copy, then `npm run db:check`, build, and start. The read-only startup check must pass. Check existing public pages, note counts/content, private recovery, images including animation, creation, saving, sharing/revocation, and deletion/restoration. Do not point automated tests at production data.
6. Inventory every legacy private collection and uploaded image. Resolve unsupported, oversized, missing, or unmatched objects before scheduling the live cutover. Do not treat a browser's old UUID as proof of ownership.

## Production configuration

Use the verified production database and existing storage prefix. For this site's canonical domain:

```text
APP_ORIGIN=https://dcepedag.com
NEXT_PUBLIC_SITE_URL=https://dcepedag.com
APP_REDIRECT_HOSTS=www.dcepedag.com,personal-portfolio--davidcepeda6.replit.app
PRIVATE_OBJECT_DIR=/<verified-existing-bucket>/<verified-existing-private-prefix>
```

Do not paste the storage placeholder into Replit. Review the next release's production secrets, including the `PRIVATE_OBJECT_DIR` warning. The new code does not use `SESSION_SECRET`, `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, or `PUBLIC_OBJECT_SEARCH_PATHS`; they do not need to be copied merely because the editor has them.

## Controlled live release

1. Arrange a short maintenance window and prevent ordinary users from writing while the migration, ownership recovery, image import, and release checks run. Establish operator access on the actual production domain before scheduling this window.
2. Take final database and storage backups and record the release time. Preserve the failure-time database too if rollback later becomes necessary.
3. Apply the rehearsed migrations once with `npm run db:migrate` against the verified production connection, then run `npm run db:check`. The migrations preserve notes and creation dates, add real modification dates/revisions, and create session/share/attachment tables. Re-running is safe; changed or unknown migration histories are rejected.
4. Review any database changes proposed by Replit publishing. Do not approve dropped/recreated note tables, development-data replacement, or a second conflicting schema migration. Keep the development-to-production copy option off.
5. Publish the verified build. `npm start` checks the prepared schema without changing it. Check that both aliases redirect note paths to the canonical domain, and that ordinary visits and writes there work.
6. Recover verified owners, then import private attachments. Import public attachments too. Run the rehearsed live checks before reopening ordinary traffic.
7. Remove retired `REVALIDATE_TOKEN` and `NEXT_PUBLIC_REVALIDATE_TOKEN` settings when the release has been verified.

## Legacy private notes

The former browser UUID could be read from private URLs. It cannot securely prove ownership. Private rows remain stored, but do not automatically appear in a browser's new session.

The administrator must verify each recipient and the specific legacy notes through trusted information. Then:

1. Have the verified recipient create a new private note in their intended browser on the actual production domain after the new release is active. Obtain its note UUID from the URL/API without exposing its cookie. A staging session or staging note ID cannot identify this browser's production session.
2. With database administrator access, run:

```sh
DATABASE_URL=… node scripts/recover-legacy-notes.mjs TARGET_NEW_NOTE_ID LEGACY_NOTE_ID [LEGACY_NOTE_ID …]
```

The command moves only the explicitly named, unclaimed private rows to that new owner. It refuses public or already-owned rows and preserves creation/modification dates. Knowledge of an old URL or legacy session UUID is not sufficient verification. Refresh the recipient's browser afterward.

Anonymous sessions remain specific to one browser. Clearing or expiring the cookie can require administrator recovery; accounts and cross-device sync remain outside this release.

## Legacy uploaded images

Unregistered old upload URLs return 404 in the protected serving route. Original storage objects remain preserved. Recover private ownership before importing private images.

In a trusted Replit administration environment with the correct database and storage access, first perform a read-only dry run:

```sh
DATABASE_URL=… PRIVATE_OBJECT_DIR=… npx tsx scripts/import-legacy-images.ts NOTE_ID --dry-run
```

The default permits only this note's `note-images/NOTE_ID/` prefix. For the verified `cool-websites` note, first obtain its UUID from the database, check that these source objects belong to it, and explicitly review the slug-based prefix:

```sh
DATABASE_URL=… PRIVATE_OBJECT_DIR=… npx tsx scripts/import-legacy-images.ts NOTE_ID --legacy-prefix note-images/cool-websites --dry-run
```

Review every reported source, proposed destination, byte size, and the rendered result in rehearsal. Only after that review, repeat the same command without `--dry-run` to apply it. Do not reuse a different note's UUID or approve another collection's folder. A legacy prefix is an administrator allowlist for one import, never a browser permission.

The importer validates and re-encodes bytes, preserves bounded GIF/WebP animation, records new UUID-based attachment objects, and updates Markdown links atomically. Old objects and note timestamps remain unchanged; the revision increases. On failure, its database transaction rolls back and newly written objects are removed where possible. If the commit outcome is uncertain, new objects are retained for administrator review instead of risking deletion of committed attachments. External images, raw HTML images, and sources outside the reviewed prefixes are not silently downloaded or migrated.

## Rollback and limits

There are no destructive down migrations. A code rollback alone does not restore the database and would reintroduce the former security weaknesses. New-session notes also do not have the old browser UUID, so the old application may hide them.

If release checks fail, stop writes, preserve the current database/storage state, and use the rehearsed recovery path. Restore matching code and data only after accounting for any writes since the backup. Restoring an older database after users resume editing would otherwise discard their newer work. Do not drop the added tables/columns as an improvised rollback.

Automated tests use isolated local PostgreSQL and fake notes. Cloud object transport is mocked there. Public legacy image processing can be checked read-only, but actual Replit sidecar access, a restored production-data rehearsal, and owner recovery still require verification in the release environment. This repository change alone does not modify production data, publish the app, or perform legacy claims.
