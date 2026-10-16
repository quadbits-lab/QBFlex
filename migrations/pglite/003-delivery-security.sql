-- Additive metadata only: preserve the existing key row shape and legacy contracts.
CREATE TABLE IF NOT EXISTS project_key_metadata(
  key_id TEXT PRIMARY KEY REFERENCES project_keys(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
INSERT INTO project_key_metadata(key_id,created_at)
SELECT k.id,MIN(a.time) FROM project_keys k JOIN audit_events a
ON a.project_id=k.project_id AND a.resource=k.id AND a.action='key.create'
GROUP BY k.id ON CONFLICT DO NOTHING;
-- A marker, not a destination or job payload. Only branches with delivery configuration are polled.
CREATE TABLE IF NOT EXISTS branch_job_targets(
  branch_id TEXT PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE
);
