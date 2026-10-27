-- Operational alerts, notification center and delivery log.
CREATE TABLE IF NOT EXISTS alert_rules(
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('error_rate','error_count','p95_latency','dead_letter_depth','quota_usage','backup_failure','snapshot_age')),
  config TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN('info','warning','critical')),
  channels TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS alert_rules_org ON alert_rules(org_id,enabled);
CREATE INDEX IF NOT EXISTS alert_rules_project ON alert_rules(project_id,enabled);

CREATE TABLE IF NOT EXISTS alert_states(
  rule_id TEXT PRIMARY KEY REFERENCES alert_rules(id) ON DELETE CASCADE,
  window_start TEXT,
  last_fired_at TEXT,
  silenced_until TEXT
);

CREATE TABLE IF NOT EXISTS notifications(
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK(severity IN('info','warning','critical')),
  title TEXT NOT NULL,
  body TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_org ON notifications(org_id,read_at,created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_project ON notifications(project_id,read_at,created_at DESC);

CREATE TABLE IF NOT EXISTS alert_deliveries(
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  result TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS alert_deliveries_rule ON alert_deliveries(rule_id,created_at DESC);
