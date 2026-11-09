# Library · sky-lime 위젯 4종

첨부 시안의 네 화면을 기존 독서 Store API에 연결한 구현입니다. 시안 원본과 표본 데이터는 복사하지 않았습니다.
2026-11-09 사용자 요청에 따라 검증된 파일을 기존 GitHub Pages 방식으로 커밋·배포합니다.

## 파일 및 임베드 주소

배포 후 아래 주소의 `[인스턴스 키]`를 기존 키로 바꿉니다. 네 위젯은 같은 키를 사용합니다.
키를 코드·문서에 넣거나 새로 만들지 않습니다. 키가 없으면 Store가 조회·저장을 막습니다.

| 위젯 | 파일 | 노션 높이 | 배포 후 주소 형식 |
| --- | --- | --- | --- |
| 새 기록 | `new-book.html` | 72px | `https://kjm9954.github.io/my-notion-widget/sky-lime/Library/new-book.html?w=[인스턴스 키]` |
| 책장 | `bookshelf.html` | 220px | `https://kjm9954.github.io/my-notion-widget/sky-lime/Library/bookshelf.html?w=[인스턴스 키]` |
| 읽은 권수 | `reading-count.html` | 140px | `https://kjm9954.github.io/my-notion-widget/sky-lime/Library/reading-count.html?w=[인스턴스 키]` |
| 책장 검색 | `book-search.html` | 268px | `https://kjm9954.github.io/my-notion-widget/sky-lime/Library/book-search.html?w=[인스턴스 키]` |

- 모든 카드는 임베드 가로·세로를 채웁니다. 기존 sky-lime CSS와 같이 오른쪽·아래 1px을 남겨 소수점 임베드에서 테두리 잘림을 방지합니다.
- PC/태블릿 책장 4칸, 폭 480px 이하 2칸. 긴 제목·한 줄은 말줄임하며 위젯 전체와 목록에는 스크롤이 없습니다.
- 완독 레이어는 책장 iframe 안에서만 열립니다. 별점·한 줄 입력·완독 버튼은 220px 안에 배치됩니다.
- 공통 UI 동작: `library-widgets.mjs`. 정렬·집계·검색·Store 읽기: `library-common.mjs`. 고유 수치: `library.css`.
- 기존 `sky-lime/Worklog/sky-lime.css`를 그대로 불러옵니다. Library의 하늘색은 첨부 명세대로 이 폴더 안에서만 `#4BA3E3`를 사용합니다.
- Library 서버 변경은 `reading-notion.js`, `notion-search-worker/`뿐입니다. Store·기존 독서 위젯·다른 sky-lime 위젯·스키마·migration은 변경하지 않았습니다.

## 데이터 흐름

| 기능 | 기존 Store 함수 | 입력 / 응답 처리 |
| --- | --- | --- |
| 조회·갱신 | `loadReadingLibrary({ fresh })` | `{ books, quotes, fetchedAt }`의 책·필사를 함께 사용 |
| 구독 | `watchReadingLibrary(callback, { allowWhileEditing:true, onError })` | 변경 시 재조회. 입력 중에도 다른 위젯 변경을 반영하되 완독 입력은 덮지 않음 |
| 새 기록 | `createReadingBook({ title, status:'reading' })` | 서버가 서울 오늘을 날짜 시작일로 설정. 반환된 `url`로 노션 페이지 열기 |
| 완독 | `updateReadingBook(id, { status:'done', star, one })` | 응답은 `{ id }`. 성공 후 화면에 저장한 패치를 반영하고 `loadReadingLibrary({ fresh:true })`로 확인 |

Store가 기존 Worker/Notion API 요청·캐시 무효화·BroadcastChannel 동기화·공통 오류 표시를 담당합니다.
본문 검색 GET(`/search?source=reading`)만 예외로 직접 요청합니다. localStorage에 책·키를 쓰지 않고 새 저장 체계도 없습니다.

저장 중 중복 요청을 막고 실패하면 입력값을 남깁니다. 완독 실패 시 레이어를 닫지 않습니다.
읽기 실패 시 이미 받은 목록을 유지하며 Store 공통 오류 표시를 사용합니다. 키·서버 오류 원문을 화면이나 콘솔에 출력하지 않습니다.

## 현재 서버의 제약 — 반드시 확인

### 연도 집계

최신 요청대로 **완독 + 날짜(종료일 → 시작일)의 연도**로 집계합니다. 날짜 없는 완독 책은 제외합니다.
서버 `year`도 같은 규칙으로 계산하며 연도 DB를 조회하거나 만들지 않습니다.
완독 시 기존 시작일은 보존하고 종료일을 서울 오늘로 넣습니다. 같은 날/시작일 없음은 하루짜리 날짜입니다.
시작일이 미래인 잘못된 범위는 날짜를 지우지 않고 오류를 반환합니다.

### 인스턴스별 데이터 분리

클라이언트는 주소의 키만 사용하고 키별 Store 캐시/알림 채널을 따릅니다. 하지만 **기존 독서 서버 자체는 인스턴스별 DB가 아닙니다.**

- `worker.js`의 `instanceEnv`는 `__instanceId`만 붙입니다.
- `reading-notion.js`의 `notionReadingConfig`는 공통 `NOTION_READING_*` 설정을 사용합니다.
- 독서 KV 캐시 키와 진행 중 조회도 인스턴스별로 나뉘어 있지 않습니다.

따라서 다른 등록 키가 같은 공통 독서 DB를 볼 가능성을 위젯 코드로 차단할 수 없으며, 실제 서버의 사용자별 격리를 완료했다고 보고하지 않습니다.
이번 허용 범위 밖인 인증·사용자별 DB 구조는 그대로 두었습니다. 개인용 기존 DB 연결로 사용하고, 다른 사람에게 배포하기 전에는 별도의 서버 접근 제어/DB 연결 작업이 필요합니다.

### 노션 새 탭

- 새 기록은 클릭/Enter 시 빈 탭을 확보한 후 저장 성공 때 반환된 노션 주소로 이동합니다. 실패하면 확보한 빈 탭을 닫습니다.
- 팝업이 차단되면 저장은 유지되고 입력 칸 자리에 **저장됨 · 노션에서 열기** 링크가 나옵니다. ‘새 기록’ 버튼으로 다음 입력으로 돌아갑니다.
- 책장 카드·검색 결과는 노션 URL을 새 탭으로 엽니다. 다른 프로토콜/외부 도메인은 열지 않습니다.
- 일반 브라우저 및 popup 허용/금지 sandbox iframe에서 검증했습니다. 실제 Notion 데스크톱·iPad 앱 안에서의 새 탭 정책은 아직 검증하지 않았습니다. 팝업을 완전히 금지한 iframe에서는 대체 링크도 새 탭으로 열리지 않을 수 있으며, 이때는 노션 갤러리에서 책을 열어야 합니다.

## 실행·검증

저장소 루트에서 정적 HTTP 서버를 실행하고 `sky-lime/Library/<파일>.html?w=<기존 키>`를 엽니다.
키는 로컬 브라우저 주소에만 입력하고 공유·커밋하지 않습니다.

```powershell
node --check sky-lime/Library/library-common.mjs
node --check sky-lime/Library/library-widgets.mjs
node --test sky-lime/tests/library-model.test.mjs
# 127.0.0.1:4173에서 저장소 루트를 서비스하는 상태:
npx --yes --package @playwright/cli playwright-cli -s=library open http://127.0.0.1:4173/sky-lime/Library/bookshelf.html
npx --yes --package @playwright/cli playwright-cli -s=library run-code --filename sky-lime/tests/library-browser-audit.js
```

2026-11-09 최초 배포 검증(아래 추가 보완 전):

- 기존 테스트 + 새 순수 함수 테스트: 197/197 통과. 새 테스트는 7개.
- 실제 Store를 사용하는 오프라인 브라우저 검사: 45/45 통과. Worker/Notion 요청을 테스트 데이터로 가로채 운영 쓰기 없음.
- 1320/1130/450/390px × 4종 권장 높이, 모바일 입력 규격, iframe 390→1130 변경, 팝업 차단, 레이어 경계, 새 기록 중복 방지, 저장 실패 후 재시도, 완독·다른 위젯 갱신, 새로고침, 검색/말줄임/3건 상한, 빈 상태, 키 없는 요청 차단, JS 오류 없음 확인.
- 실제 운영 API 읽기 조회: 20권(읽는 중 1, 완독 16), 새 책장 4칸 표시 확인.
- 실제 읽은 권수 위젯: 2026년 3권 표시, 동일 API의 `done + year=2026` 집계 3권과 일치. 운영 쓰기 요청 0건.
- 실제 Notion DB 추가/수정, 갤러리 반영, 실기기/iPad 앱, 별도 실제 사용자 키의 데이터 격리는 검증하지 않음. 실제 DB에는 테스트 책을 만들지 않음.
- 스크린샷은 git 제외 폴더 `output/playwright/library-*.png`에 저장.

## 오늘의 문구 — 카드 선택만 변경

`library-phrases.mjs`의 `dailyShelf`가 선택합니다. 읽는 중 최신 1권(시작일 → 생성일) 뒤에 완독 책의 한 줄/필사 `text`를 채웁니다. 빈 문장·같은 책의 동일 문장은 제외합니다.

- 서울 날짜 + 안정적인 문구 ID를 FNV-1a 32비트 해시로 정렬합니다. 무작위 함수·브라우저 영구 저장소를 쓰지 않습니다.
- 한 책은 하루 한 장. 어제 **실제로 선택된** 책을 제외한 뒤, 부족한 칸만 어제 책으로 채웁니다.
- 같은 후보 집합에서는 Unix epoch부터 선택을 결정적으로 계산해 어제 결과를 재구성하고 메모리에 캐시합니다. 어제의 단순 해시 순위를 쓰지 않으므로 연속 날짜 제외 규칙이 실제 카드에 적용됩니다.
- PC 기준 4칸을 먼저 고르고 모바일은 앞의 2칸만 보여줍니다. 서울 자정 타이머·창 복귀 때 날짜를 확인합니다.
- 후보가 바뀌면 같은 날짜 규칙으로 재계산합니다. 후보 변경 전의 카드 목록을 서버에 저장하지 않으므로 **완전 고정은 보장하지 않습니다**. 새 문구가 해시 앞쪽으로 들어오거나 어제 제외 집합이 바뀌면 카드가 달라질 수 있습니다.
- 기존 220px 높이·카드·완독 레이어·새 탭 이동은 그대로입니다.

## 검색 보완

`library-common.mjs`의 `searchBooks`: 제목 → 한 줄 → 필사(text/note/thought) → 본문 순으로 책당 하나만 표시합니다. 입력 즉시 로컬 검색, 본문만 300ms 뒤 조회하며 이전 요청을 취소하고 늦은 응답을 무시합니다. 본문 장애 시 로컬 결과를 유지합니다.

## 기존 위젯에서 더 이상 저장되지 않는 칸

기존 `reading-notes/` 화면은 수정하지 않았습니다.

- `book-add.html`: 저자·출판사·표지·연도 입력은 무시됩니다. 제목·상태는 저장됩니다.
- `library.html`: 배운 것(`learned`), 적용할 것(`applying`), 중도포기 이유(`dropReason`)는 무시됩니다. 제목·상태·별점·한 줄은 저장됩니다.
- `session.html`: 현재 읽은 페이지(`pageRead`)의 책 속성 업데이트와 연도 입력은 무시됩니다. 필사 내용·필사 페이지 표시는 기존대로 저장됩니다.
- `wishlist.html`: 기존 상태 변경 API는 유지됩니다. 삭제된 저자·표지 속성은 빈 값일 수 있습니다.

## 추가 보완 배포

1. 운영 원본 백업·비교. `notion-widget` 운영 소스맵의 8개 원본이 수정 전 HEAD와 모두 일치함을 확인했습니다.
2. 루트에서 `npx wrangler deploy` — 날짜 처리와 별도 요청된 일기 기분 2종. D1 migration 없음.
3. `notion-search-worker/`에서 `npx wrangler deploy` — 기존 운영 검색/데스크톱 API를 보존한 진입점. 첫 색인·연동 안내는 해당 README 참고.
4. 위젯·테스트·문서를 현재 브랜치에 커밋하고 main에 fast-forward push하여 기존 GitHub Pages 배포.

추가 검증: 전체 Node 테스트 239개, Library 기존 흐름 브라우저 48개, 비동기 검색 8개, 오늘의 문구 9개 통과. 오늘의 문구는 같은 날 PC/모바일 일치·실제 선택된 어제 책 제외·필사 포함·책 중복 방지·서울 자정 갱신·완독 후 채우기·220px 넘침 없음을 확인했습니다. 실제 Notion DB에 시험용 기록을 추가하지 않았으므로 실제 추가/완독 쓰기와 iPad Notion 앱은 미검증입니다.

### 이번 운영 반영 결과

- `notion-widget`: `6cf44c5f-f87b-4bac-ad55-787f4590f26c` 배포 완료.
- `notion-search`: `9f1e2d31-29eb-4cc8-abd2-e09ec7ea72cf` 배포 완료. 승인된 Library 키를 독서 검색에만 별도 허용했습니다(서버 secret, 코드에 값 없음).
- 운영 읽기: 독서 API 200, 독서 검색 API 200, 기존 업무일지/일기 키 없는 응답 200/400 유지, 회의록은 해당 Library 키로 배포 전후 동일한 403. 기존 책 ID 집합 유지.
- 실제 브라우저 읽기: 책 16권·필사 51개 중 오늘 문구 4칸 표시, 2026년 완독 4권(날짜 기준) 일치. 운영 책·일기 쓰기 요청 0건.
- **본문 검색 첫 색인은 미완료**: `POST /reindex?source=reading`가 `502 / notion connection` 반환. 검색 Worker의 기존 Notion 연동이 독서 DB를 읽을 수 있도록 DB의 `··· → 연결`에서 권한을 추가한 뒤 다시 색인해야 합니다. 키 인증은 해결됐고 제목·한 줄·필사 검색은 이 연결과 무관하게 동작합니다. Notion 데이터·DB 속성·기존 회의록 키는 변경하지 않았습니다.
