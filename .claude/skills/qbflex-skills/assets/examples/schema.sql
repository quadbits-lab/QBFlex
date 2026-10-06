CREATE TABLE tasks (id TEXT PRIMARY KEY NOT NULL DEFAULT(lower(hex(randomblob(16)))), owner_id TEXT NOT NULL, title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, internal_note TEXT);
CREATE INDEX tasks_owner ON tasks(owner_id);
