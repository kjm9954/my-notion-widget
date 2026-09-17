-- 질문 이미지를 D1에 base64 조각으로 저장한다. (KV는 무료 플랜의 하루 쓰기 한도를 다른 위젯과 나눠 쓴다)
CREATE TABLE IF NOT EXISTS qa_images (
  room TEXT NOT NULL,
  id TEXT NOT NULL,
  part INTEGER NOT NULL,
  parts INTEGER NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room, id, part)
);
