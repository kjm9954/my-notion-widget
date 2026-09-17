-- 방 설정(사람 이름·역할·카테고리·그 단어가 들어간 문구)을 공개 파일 대신 서버에 두고 접근 키로만 내려준다.
ALTER TABLE qa_rooms ADD COLUMN config TEXT NOT NULL DEFAULT '{}';
