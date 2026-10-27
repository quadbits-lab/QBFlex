ALTER TABLE branches ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'primary';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS expires_at TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS error TEXT;
CREATE INDEX IF NOT EXISTS branches_kind_status ON branches(kind,status,expires_at);
