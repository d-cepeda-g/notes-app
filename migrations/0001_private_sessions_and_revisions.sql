-- Preserve all legacy note data. Old browser UUIDs were disclosed as credentials,
-- so they must never be upgraded into trusted authenticated sessions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  content text,
  created_at timestamptz NOT NULL DEFAULT now(),
  public boolean DEFAULT false,
  session_id uuid,
  slug text,
  category text,
  emoji text
);
ALTER TABLE notes ADD COLUMN IF NOT EXISTS updated_at timestamptz;
-- Backfill only missing values. Re-running must preserve real modification dates.
UPDATE notes SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE notes ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE notes ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES sessions(id);
CREATE INDEX IF NOT EXISTS session_id_index ON notes(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS slug_unique_index ON notes(slug);
CREATE INDEX IF NOT EXISTS notes_owner_updated_index ON notes(owner_id, updated_at);
CREATE TABLE IF NOT EXISTS note_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS note_shares_note_index ON note_shares(note_id);
