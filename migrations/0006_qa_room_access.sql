-- 등록된 방 키만 쓸 수 있게 상태를 둔다: active(읽기·쓰기) | readonly(읽기만) | revoked(차단)
ALTER TABLE qa_rooms ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

-- 스레드마다 마지막으로 바뀐 방 리비전을 기록한다. 늦게 커밋된 변경도 동기화에서 빠지지 않는다.
ALTER TABLE qa_threads ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS idx_qa_threads_room_updated;

CREATE INDEX IF NOT EXISTS idx_qa_threads_room_rev
  ON qa_threads (room, rev);
