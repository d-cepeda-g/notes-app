# Existing deployment rollout and recovery

## Before deploying

1. Take a PostgreSQL backup and preserve the current private storage objects. Keep these outside the public repository.
2. Set `DATABASE_URL`, `APP_ORIGIN`, `NEXT_PUBLIC_SITE_URL`, and `PRIVATE_OBJECT_DIR` using `.env.example`. The origin settings must match the public deployment URL. Use the preview's own origin when testing a preview.
3. Run `npm run db:migrate` with the deployment database. It preserves notes and creation dates, adds real modification dates and revisions, and creates server sessions, sharing, and attachment tables. Re-running is safe; changed migration checksums are rejected.
4. Build and start the new app. `npm start` also checks migrations. Remove old `REVALIDATE_TOKEN` and `NEXT_PUBLIC_REVALIDATE_TOKEN` settings; browser cache invalidation secrets are retired.
5. Check public links, anonymous note creation, saving, sharing/revocation, image paste, and Recently Deleted before sending traffic to the release.

## Legacy private notes

The former browser UUID could be read from private URLs. It cannot securely prove ownership. This release preserves those private rows but does not let a browser claim them by submitting that UUID.

The administrator must verify the recipient and specific legacy notes through trusted information. Then:

1. Have the verified recipient create a new private note in their intended browser and provide its note ID from the URL/API. This identifies the new session without exposing its cookie.
2. With database administrator access, run:

```sh
DATABASE_URL=… node scripts/recover-legacy-notes.mjs TARGET_NEW_NOTE_ID LEGACY_NOTE_ID [LEGACY_NOTE_ID …]
```

The command moves only the explicitly named, unclaimed private rows to the new note's owner. It refuses public or already-owned rows and preserves their creation and modification dates. It does not treat knowledge of an old URL or legacy session UUID as sufficient verification. Refresh the recipient's browser after recovery.

Anonymous sessions remain specific to one browser. Clearing or expiring the cookie can require this administrator recovery; account-based sync and recovery are deferred improvements.

## Legacy uploaded images

The former serving route allowed arbitrary files without checking ownership. It now serves only registered, validated images. Old storage objects are preserved, but unregistered relative upload URLs return 404.

After checking ownership of the note (and recovering private notes first), run from a trusted Replit environment with storage credentials:

```sh
DATABASE_URL=… PRIVATE_OBJECT_DIR=… npx tsx scripts/import-legacy-images.ts NOTE_ID
```

The command reads only this note's relative `note-images/NOTE_ID/...` URLs, validates and re-encodes their bytes, records new attachment objects, and updates their Markdown links. Public notes can also be imported. Old objects and note timestamps remain unchanged; the revision increases. On failure, its database transaction rolls back and new objects are removed where possible. External image URLs are not downloaded or migrated.

## Verification limits

Automated tests use a separate local PostgreSQL database and fake note data. Image validation and ownership/quota checks run against real application code; cloud object transport is mocked. Verify actual Replit storage access in the deployment environment before release. No automatic production migration, legacy claim, or content database overwrite is performed by the repository changes alone.
