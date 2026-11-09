# notion-search · 회의록 + 독서 본문 검색 Worker

## 2026-11-10: 독서 하위 페이지·하위 DB 본문 검색

- `reading-tree.mjs`는 책 아래에 실제로 소속된 하위 페이지, 그 아래 페이지, 하위 DB의 모든 자체 data source/페이지 본문을 읽습니다. 일반 블록과 DB 행 모두 페이지네이션을 끝까지 처리합니다.
- 외부 페이지 링크, 링크된 외부 data source, 외부 원본을 가리키는 synced block은 따라가지 않습니다. 권한이 없거나 삭제·이동된 하위 내용은 이전 검색 텍스트에서도 제외합니다.
- 결과는 기존처럼 **책 ID 하나당 한 건**, 클릭하면 원래 책 페이지입니다. 위젯 UI/응답 형식·회의록 검색·기존 인증은 그대로입니다.
- 하위 페이지/DB는 매 색인 주기마다 구조와 수정 시각을 확인합니다. 부모 책의 수정 시각만으로 하위 조회를 생략하지 않습니다. 수정되지 않은 개별 페이지의 본문은 기존 색인 안의 `readingTree.nodes` 캐시를 재사용합니다.
- 기존 20,000자 잘림은 독서 하위 본문에 적용하지 않습니다. 안전 상한은 책당 텍스트 1,000,000자, 방문 노드 5,000개, 중첩 깊이 64, 기존 continuation 4MiB입니다. 넘으면 조용히 잘라 저장하지 않고 오류를 내며 이전 정상 색인을 보존합니다.
- `meeting-production.mjs`에는 선택적인 reader 훅과 공통 응답 helper export만 추가했습니다. reader를 지정하지 않는 기존 회의록 경로는 같은 동작을 유지합니다.
- 요청 상한은 기본 45회 그대로. cron은 회의록을 먼저 처리하고 남은 예산에서 KV용 3회를 예약한 뒤 독서를 처리합니다. 큰 트리는 암호화된 continuation과 기존 KV의 `index:reading:checkpoint:v1`(24시간 TTL)로 이어받습니다. 새 Worker 인스턴스에서도 이어서 진행하며, 전체 완료 전까지 공개 검색 색인은 바꾸지 않습니다.
- 새 바인딩·secret·cron·D1 migration 없음. Notion에는 GET 및 조회용 POST(`/query`)만 보내고 원본 데이터를 쓰지 않습니다.
- 검증: 전체 단위 테스트 249/249. 하위/손자 페이지, 하위 DB 페이지네이션, 하위 내용만 변경, 캐시 재사용, 삭제/권한 상실/이동, 외부 링크 제외, 깊은 블록·순환 방지, 2회 요청 예산에서 cold start 이어받기, 20,000자 이후 검색, 서버/저장 실패 보존, 잘못된/오래된 continuation, 회의록 기존 payload·캐시 분리 확인.

운영 배포: `7109dad4-9f1a-4a6d-9ee6-2d814c99e369` (직전 `9f1e2d31-29eb-4cc8-abd2-e09ec7ea72cf`). 11번의 요청으로 재색인을 완료했습니다(회당 Notion 요청 최대 45, 총 452회). 책 16권·하위 DB 16개·총 154페이지(루트 16 + 하위 138), 건너뛴 권한 없는/외부 대상 0. 기존 직접 본문에는 없는 하위 본문 문장 3개를 실제 검색해 모두 200·해당 부모 책 반환·중복 없음 확인. 기존 루트 책 ID·원본 데이터·기존 API 상태 코드는 유지했습니다. 위젯 HTML/CSS/JS와 메인 Worker는 이번에 수정·배포하지 않았습니다.

운영 상태: 11/10에 사용자가 기존 검색 연동을 독서 DB에 연결한 뒤, 기존 16권의 직접 본문 색인 및 실제 본문 일치 검색이 성공했습니다. 아래 11/9의 권한 오류 기록은 해결된 과거 상태입니다.

## 2026-11-09 추가: 운영 기능을 보존한 독서 색인

- 배포 진입점은 `entry.mjs`입니다. 운영 버전 `5448ce72-9f78-4124-9dd5-9f4d2f3d97c4`의 번들을 `meeting-production.mjs`로 보존했습니다(기존 index runner export만 추가).
- 기존 `/search`, `/reindex`, `/resolve`, `/meetings`, 암호화된 색인 continuation, KV 한도 처리와 `INDEX_NOT_BEFORE`는 그대로입니다. 아래 초기 설치 설명의 KV/secret 생성은 **신규 설치에만** 해당하며, 기존 배포에서는 재생성하지 않습니다.
- `source=reading` 검색만 새 응답(`id`, `url`, 일치 본문 조각 포함)을 사용합니다. 읽기 색인도 운영의 이어받기 엔진을 재사용하되 KV `index:reading:v1`로 격리합니다. 회의록은 `index:v1` 그대로입니다.
- 추가 vars: `NOTION_READING_DATA_SOURCE_ID = 519b993c-8a61-8222-b574-073c2e3ab536`. 기존 실제 KV ID를 공식 읽기 API로 확인해 설정했고 `keep_vars=true`로 운영 전용 변수를 보존합니다. 기존 secret·KV·cron은 바꾸지 않습니다.
- 운영 조회에서 Library 키가 기존 검색 인증으로 403이어서, 사용자 승인 후 **독서 검색 전용 secret `READING_ALLOWED_W`**를 추가했습니다. `source=reading`의 `/search`·`/reindex`에만 적용하며 기존 회의록 `ALLOWED_W`는 유지합니다. 별도 secret이 없는 기존 설치는 `ALLOWED_W`로 동작합니다. 키 값은 코드·문서에 남기지 않습니다.
- 매 cron의 기본 45회 요청은 **회의록 우선, 사용 후 남은 예산만 독서**에 씁니다. 재시도·목록 요청도 포함합니다. 회의록을 늦추지 않지만 대량 변경/최초 색인/오류 때 독서의 반영은 30분을 넘길 수 있습니다. 정상적인 소량 변경은 다음 30분 cron + KV 캐시 최대 1분입니다.
- 최초 버전은 `child_database`를 읽지 않았고 부모 책의 수정 시각만 확인했습니다. 11/10부터 위 하위 트리 방식으로 확장했습니다. Store quotes 검색은 그대로 병행합니다.

### 기존 환경 배포와 첫 독서 색인

```powershell
node --test notion-search-worker/test/*.test.mjs
cd notion-search-worker
npx wrangler deploy --dry-run
# 별도 독서 키가 필요한 기존 환경에서만, 승인한 키를 안전한 stdin으로 전달:
npx wrangler secret put READING_ALLOWED_W
npx wrangler deploy
```

키를 파일·터미널 명령 기록에 적지 말고 안전한 세션 메모리에서 URL을 구성해 아래 요청을 보냅니다.

- 첫 `POST /reindex?source=reading&w=<기존 키>`는 본문 없이 보냅니다(`{}` 아님). Notion에는 조회 요청만 하고 KV 색인만 갱신합니다.
- `pending > 0`이면 응답의 `continuation`을 다음 요청의 JSON `{ "continuation": "..." }`로 넘깁니다. 키와 continuation은 출력/공유하지 않습니다. `pending=0`까지 반복합니다.
- `GET /search?source=reading&q=<단어>&w=<기존 키>`로 확인합니다. 기존 회의록 검색에는 source를 붙이지 않습니다.
- `notion connection`(연동 권한 부족)이면 Notion의 lιвrary 페이지/독서 DB → 우상단 `···` → 연결(Connections)에서 **검색 Worker의 NOTION_TOKEN에 해당하는 기존 연동**을 추가하고 첫 색인을 재시도합니다. 새 연동을 무조건 만들지 않습니다.

운영 원본 백업은 git 제외 경로 `output/playwright/notion-search-before.multipart`에 있습니다. 원본에 없는 기능을 덮어 지우지 않도록 복원 모듈을 현재 진입점에서 그대로 위임합니다.

이번 배포 버전: `9f1e2d31-29eb-4cc8-abd2-e09ec7ea72cf`. 독서 검색 인증 200 확인. 첫 독서 색인은 `502 / notion connection`으로 완료되지 않았습니다. 위 안내에 따라 검색용 기존 Notion 연동에 독서 DB 접근 권한을 추가해야 본문 결과가 채워집니다. 운영 본문 검색까지 완료했다고 간주하지 않습니다.

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
