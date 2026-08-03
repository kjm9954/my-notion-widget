CREATE TABLE IF NOT EXISTS schedule_items (
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

CREATE INDEX IF NOT EXISTS idx_schedule_items_instance_status
  ON schedule_items (instance_id, status);

CREATE TABLE IF NOT EXISTS schedule_runs (
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

CREATE INDEX IF NOT EXISTS idx_schedule_runs_retry
  ON schedule_runs (status, lease_until);
