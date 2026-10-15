# notion-search · 노션 회의록 검색 Worker

`sky-lime/Worklog/calendar-search.html`(캘린더 검색 위젯)이 부르는 **검색 전용 Cloudflare Worker**입니다.

- 기존 `notion-widget` Worker·D1과 완전히 분리되어 있습니다. 저장소 루트의 `worker.js`·`wrangler.toml`과 상관없습니다.
- 노션 회의록 DB를 30분마다 읽어 KV에 색인을 만들고, 위젯은 이 색인으로 검색합니다.
- 노션에는 **읽기 요청만** 보냅니다(목록 조회·블록 읽기). 쓰기 요청은 없습니다.

## 파일

| 파일 | 내용 |
| --- | --- |
| `worker.js` | 색인 갱신(Cron·수동)과 검색 API |
| `wrangler.toml` | Worker 이름 `notion-search`, KV `SEARCH_INDEX`, Cron 30분, DB·데이터 소스 ID |
| `test/worker.test.mjs` | 노션 응답을 흉내 낸 테스트 데이터로 색인·검색 단위 테스트 |

## 설정

| 이름 | 종류 | 값 |
| --- | --- | --- |
| `NOTION_TOKEN` | secret | 노션 내부 연동 시크릿 (코드·저장소에 넣지 않음) |
| `ALLOWED_W` | secret | 검색을 허용할 인스턴스 키 = 위젯 주소의 `?w=` 값 |
| `NOTION_DATABASE_ID` | vars | `3f9b993c8a6180a180c7dbc6927835e3` |
| `NOTION_DATA_SOURCE_ID` | vars | `3f9b993c-8a61-80bd-851e-000bf5cc87ab` |
| `SEARCH_INDEX` | KV | 색인 저장소 |
| `MAX_NOTION_REQUESTS` | vars(선택) | 한 번 갱신할 때 노션 요청 상한. 기본 45 |
| `NOTION_MIN_INTERVAL_MS` | vars(선택) | 노션 요청 간격. 기본 350ms(초당 약 3회) |

## 배포 순서 (Windows PowerShell 기준)

저장소 폴더에서 아래 순서대로 실행합니다. 처음이면 `npx wrangler login`을 먼저 한 번 실행하세요.

```powershell
cd notion-search-worker

# 1) KV 만들기
npx wrangler kv namespace create SEARCH_INDEX
#    출력된 id를 wrangler.toml의 REPLACE_WITH_SEARCH_INDEX_KV_ID 자리에 붙여 넣습니다.
#    (설정 파일에 대신 추가할지 물으면 n을 누르고 id만 직접 바꿉니다. 예전 wrangler는 `kv:namespace create`)

# 2) secret 2개 입력 (값은 화면에 붙여 넣기만 하고 파일에 쓰지 않습니다)
npx wrangler secret put NOTION_TOKEN   # 노션 내부 연동 시크릿
npx wrangler secret put ALLOWED_W      # 위젯 주소의 ?w= 값 (w_로 시작)
#    "notion-search Worker가 아직 없다, 새로 만들까?"라고 물으면 y

# 3) 배포
npx wrangler deploy

# 4) 출력된 Worker 주소 확인
#    https://notion-search.<계정 서브도메인>.workers.dev
#    위젯의 기본값은 https://notion-search.wldnjsdkk.workers.dev 입니다.
#    다르면 sky-lime/Worklog/calendar-search.html 맨 위 SEARCH_API 한 줄만 바꿔서 push합니다.

# 5) 첫 색인 실행 — 응답의 "pending"이 0이 될 때까지 몇 번 반복합니다
curl.exe -X POST "https://notion-search.wldnjsdkk.workers.dev/reindex?w=<인스턴스 키>"
#    예: {"ok":true,"total":120,"indexed":38,"pending":82,"removed":0,"requests":45,"saved":true}
```

- 한 번 갱신할 때 노션 요청을 최대 45번만 씁니다(무료 플랜의 요청당 하위 요청 50개 안쪽). 그래서 페이지가 많으면 첫 색인은 여러 번에 나눠 끝납니다.
- 직접 다시 부르지 않아도 30분마다 Cron이 남은 페이지를 이어서 읽습니다.
- 본문을 아직 못 읽은 페이지도 제목으로는 바로 검색됩니다.
- 유료 플랜이면 `wrangler.toml`의 `[vars]`에 `MAX_NOTION_REQUESTS = "900"`처럼 올려서 한 번에 끝낼 수 있습니다.

## 노션 연동을 회의록 DB에 연결하는 방법

1. https://www.notion.so/profile/integrations 에서 **새 연동**을 만듭니다.
   - 유형: 내부(Internal)
   - 기능: **콘텐츠 읽기만** 체크합니다(입력·수정은 끕니다).
2. 만든 연동의 **내부 연동 시크릿**을 복사해 `npx wrangler secret put NOTION_TOKEN`에 붙여 넣습니다.
3. 노션에서 회의록 데이터베이스 페이지를 엽니다.
   - 오른쪽 위 `•••` → **연결(Connections)** → 방금 만든 연동을 찾아 추가합니다.
   - 데이터베이스에 연결하면 그 안의 회의록 페이지도 함께 읽을 수 있습니다.
4. 연결 전이거나 연결이 빠지면 `/reindex` 응답이 `{"ok":false,"error":"notion connection"}`입니다.

## 위젯 임베드 주소

```
https://kjm9954.github.io/my-notion-widget/sky-lime/Worklog/calendar-search.html?w=[인스턴스 키]
```

- 노션에서 높이 약 370px로 임베드합니다.
- `?w=`가 없거나 `ALLOWED_W`와 다르면 위젯은 "위젯 주소를 확인해 주세요"만 보여 줍니다. 키 값은 화면에 나오지 않습니다.

## API

| 요청 | 설명 |
| --- | --- |
| `GET /search?q=검색어&w=키` | 제목+본문 검색, 날짜 최신순 최대 20건 |
| `POST /reindex?w=키` | 색인 갱신을 지금 한 번 실행 |

- `w`가 없거나 `ALLOWED_W`와 다르면 `403`을 돌려주고, 결과 내용은 보내지 않습니다. `ALLOWED_W`를 넣지 않았으면 모두 거절합니다.
- CORS는 `https://kjm9954.github.io` 출처만 허용합니다.
- 검색 응답 예:

```json
{ "ok": true, "total": 3, "results": [
  { "date": "2026-10-14", "title": "스프린트 계획 회의", "url": "https://www.notion.so/…",
    "line": "온보딩 개선과 결제 오류 수정을 이번 스프린트 목표로 확정",
    "titleMatches": [[0, 4]], "lineMatches": [], "tags": ["회의록"] }
] }
```

- `titleMatches`·`lineMatches`는 찾은 글자 위치 `[시작, 끝)`이며, 위젯이 그 부분을 굵게 표시합니다.

## 색인·검색 규칙

- **목록:** 회의록 데이터 소스를 페이지네이션으로 모두 조회합니다. 휴지통·보관된 페이지와 목록에서 사라진 페이지는 색인에서 지웁니다.
- **페이지마다 저장하는 값**
  - 페이지 ID, 노션 URL, 제목(`이름`), 태그(`태그`), `last_edited_time`
  - 날짜: `날짜` 속성, 없으면 만든 날(한국 시간)
  - 본문 텍스트, 한 줄 요약
- **본문:** 제목·문단·글머리 기호·번호 목록·체크리스트·인용 블록에, 토글·콜아웃까지 읽습니다.
  - 하위 블록도 4단계까지 읽습니다.
  - 하위 페이지·하위 데이터베이스는 읽지 않습니다.
  - 페이지당 최대 2만 자까지 저장합니다.
- **한 줄 요약:** "한 줄 요약" 제목 블록 바로 아래 첫 번째 텍스트 블록의 내용입니다.
  - 비어 있거나, 그보다 다른 제목이 먼저 나오면 빈 값입니다.
  - 구분선처럼 글이 없는 블록은 건너뜁니다.
- **다시 읽기:** `last_edited_time`이 바뀐 페이지만 본문을 다시 읽습니다. 최근 날짜부터 읽습니다.
  - 노션 요청은 350ms 간격(초당 약 3회)으로 보냅니다.
  - `429`·`5xx` 응답은 `Retry-After`만큼 기다렸다가 다시 시도합니다.
- **검색**
  - 제목과 본문을 대소문자·공백 차이 없이 찾습니다.
  - 날짜 최신순으로 정렬하고, 최대 20건을 돌려줍니다.
  - 둘째 줄은 한 줄 요약이 있으면 요약, 없으면 검색어가 들어간 문장입니다(앞뒤를 잘라 `…`). 제목에만 있으면 본문 첫 문장을 씁니다.
- 색인을 갱신한 뒤 검색에 반영되기까지 최대 1분 걸릴 수 있습니다(KV 캐시).

## 테스트

```bash
node --test notion-search-worker/test/worker.test.mjs
```

노션 API와 KV는 테스트 안의 메모리 흉내로 대신합니다. 실제 노션·Cloudflare에는 요청하지 않습니다.
