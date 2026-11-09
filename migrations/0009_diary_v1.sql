CREATE TABLE IF NOT EXISTS diary_v1_entries (
  instance_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  mood TEXT,
  body TEXT NOT NULL DEFAULT '',
  photo_count INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  write_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (instance_id, date_key)
);

CREATE INDEX IF NOT EXISTS idx_diary_v1_entries_instance_date
  ON diary_v1_entries (instance_id, date_key);

CREATE TABLE IF NOT EXISTS diary_v1_images (
  instance_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  image_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  part INTEGER NOT NULL,
  parts INTEGER NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (instance_id, date_key, image_id, part)
);

CREATE INDEX IF NOT EXISTS idx_diary_v1_images_entry_position
  ON diary_v1_images (instance_id, date_key, position, image_id, part);
