-- Recovery Center: project schedule, off-node destinations, replica inventory and drills.
CREATE TABLE IF NOT EXISTS recovery_settings(
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  enabled BIGINT NOT NULL DEFAULT 1,
  interval_hours BIGINT NOT NULL DEFAULT 24,
  retention_days BIGINT NOT NULL DEFAULT 7,
  retention_weeks BIGINT NOT NULL DEFAULT 4,
  drill_interval_hours BIGINT NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS recovery_destinations(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  region TEXT NOT NULL,
  bucket TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT '',
  credentials TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN('active','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recovery_destinations_project ON recovery_destinations(project_id,state);
CREATE TABLE IF NOT EXISTS backup_replicas(
  id TEXT PRIMARY KEY,
  backup_id TEXT NOT NULL REFERENCES backups(id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL REFERENCES recovery_destinations(id) ON DELETE CASCADE,
  object_key TEXT,
  state TEXT NOT NULL CHECK(state IN('staging','encrypted','uploading','verified','failed')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(backup_id,destination_id)
);
CREATE INDEX IF NOT EXISTS backup_replicas_backup ON backup_replicas(backup_id,state);
CREATE TABLE IF NOT EXISTS recovery_drills(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  backup_id TEXT NOT NULL REFERENCES backups(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  job_id TEXT,
  state TEXT NOT NULL CHECK(state IN('queued','restoring','validating','complete','partial','failed','cancelled')),
  database_result TEXT,
  objects_result TEXT,
  key_result TEXT,
  report TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS recovery_drills_project ON recovery_drills(project_id,created_at);
CREATE TABLE IF NOT EXISTS recovery_findings(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  resource TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS recovery_findings_project ON recovery_findings(project_id,resolved_at,created_at);
