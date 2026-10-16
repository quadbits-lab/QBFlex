CREATE TABLE tasks (id TEXT PRIMARY KEY NOT NULL DEFAULT(replace(gen_random_uuid()::text,'-','')), owner_id TEXT NOT NULL, title TEXT NOT NULL, completed BIGINT NOT NULL DEFAULT 0, revision BIGINT NOT NULL DEFAULT 1, internal_note TEXT);
CREATE INDEX tasks_owner ON tasks(owner_id);
