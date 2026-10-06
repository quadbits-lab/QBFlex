CREATE TABLE IF NOT EXISTS secret_versions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),name TEXT NOT NULL,ciphertext TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credential_scopes(key_id TEXT PRIMARY KEY REFERENCES project_keys(id),definition TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS token_scopes(token_id TEXT PRIMARY KEY REFERENCES management_tokens(id),definition TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_config_versions(project_id TEXT PRIMARY KEY REFERENCES projects(id),version INTEGER NOT NULL);
