CREATE TABLE IF NOT EXISTS worklog_tasks (
  instance_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (instance_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_worklog_tasks_instance_position
  ON worklog_tasks (instance_id, position, updated_at);

CREATE TABLE IF NOT EXISTS worklog_tombstones (
  instance_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (instance_id, task_id)
);

CREATE TABLE IF NOT EXISTS worklog_sync (
  instance_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  migrated INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
