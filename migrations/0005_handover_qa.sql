CREATE TABLE IF NOT EXISTS qa_rooms (
  room TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS qa_threads (
  room TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (room, id)
);

CREATE INDEX IF NOT EXISTS idx_qa_threads_room_updated
  ON qa_threads (room, updated_at);
