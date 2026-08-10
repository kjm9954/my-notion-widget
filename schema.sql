CREATE TABLE diary (
  date TEXT PRIMARY KEY,
  mode TEXT,
  mood TEXT,
  achievements TEXT,
  images TEXT,
  quest TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE thoughts (
  id TEXT PRIMARY KEY,
  content TEXT,
  category TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  title TEXT,
  scope TEXT,
  parentId TEXT,
  done INTEGER DEFAULT 0,
  completedAt TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE widget_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt TEXT
);

CREATE TABLE schedule_items (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('once', 'weekly')),
  name TEXT NOT NULL,
  date_key TEXT,
  weekday INTEGER,
  schedule_time TEXT NOT NULL,
  project TEXT NOT NULL,
  lead_minutes INTEGER NOT NULL CHECK (lead_minutes IN (30, 60, 120, 180)),
  title_template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  skipped_occurrence_key TEXT,
  last_occurrence_key TEXT,
  last_created_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_schedule_items_instance_status
  ON schedule_items (instance_id, status);

CREATE TABLE schedule_runs (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  occurrence_key TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'succeeded', 'failed', 'uncertain')),
  notion_page_id TEXT,
  error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (instance_id, schedule_id, occurrence_key)
);

CREATE INDEX idx_schedule_runs_retry
  ON schedule_runs (status, lease_until);

CREATE TABLE worklog_tasks (
  instance_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (instance_id, task_id)
);

CREATE INDEX idx_worklog_tasks_instance_position
  ON worklog_tasks (instance_id, position, updated_at);

CREATE TABLE worklog_tombstones (
  instance_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (instance_id, task_id)
);

CREATE TABLE worklog_sync (
  instance_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  migrated INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
