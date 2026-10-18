CREATE TABLE IF NOT EXISTS note_attachments (
  id uuid PRIMARY KEY,
  note_id uuid NOT NULL REFERENCES notes(id),
  owner_id uuid NOT NULL,
  path text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type = 'image/webp'),
  size integer NOT NULL CHECK (size > 0 AND size <= 5242880),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS note_attachments_owner_idx ON note_attachments(owner_id);
CREATE INDEX IF NOT EXISTS note_attachments_note_idx ON note_attachments(note_id);
