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
- 서버·Store·기존 독서 위젯·다른 sky-lime 위젯·스키마·migration은 수정하지 않았습니다.

## 데이터 흐름

| 기능 | 기존 Store 함수 | 입력 / 응답 처리 |
| --- | --- | --- |
| 조회·갱신 | `loadReadingLibrary({ fresh })` | `{ books, quotes, fetchedAt }` 중 `books` 사용 |
| 구독 | `watchReadingLibrary(callback, { allowWhileEditing:true, onError })` | 변경 시 재조회. 입력 중에도 다른 위젯 변경을 반영하되 완독 입력은 덮지 않음 |
| 새 기록 | `createReadingBook({ title, status:'reading', year })` | 서울 기준 올해. 반환된 정규화 책의 `url`로 노션 페이지 열기 |
| 완독 | `updateReadingBook(id, { status:'done', star, one })` | 응답은 `{ id }`. 성공 후 화면에 저장한 패치를 반영하고 `loadReadingLibrary({ fresh:true })`로 확인 |

Store가 기존 Worker/Notion API 요청·캐시 무효화·BroadcastChannel 동기화·공통 오류 표시를 담당합니다.
새 위젯은 직접 fetch하지 않으며 localStorage에 책·키를 쓰지 않습니다. 새 저장 체계도 없습니다.

저장 중 중복 요청을 막고 실패하면 입력값을 남깁니다. 완독 실패 시 레이어를 닫지 않습니다.
읽기 실패 시 이미 받은 목록을 유지하며 Store 공통 오류 표시를 사용합니다. 키·서버 오류 원문을 화면이나 콘솔에 출력하지 않습니다.

## 현재 서버의 제약 — 반드시 확인

### 연도 집계

사용자 확인에 따라 **기존 API의 `year` 값으로 우선 집계**합니다.
`reading-notion.js`의 `pageYear`는 연도 관계가 있으면 그 값을 쓰지만, 없으면 종료일/시작일의 연도를 반환합니다.
따라서 현재 응답만으로는 ‘관계 없는 책을 무조건 제외’할 수 없습니다. 위젯에서 날짜를 추가로 추정하지는 않으며, `year`가 없는 책은 세지 않습니다.
완독(`done`)만 집계하고 읽는 중·구입 전·중도포기는 제외합니다.

### 인스턴스별 데이터 분리

클라이언트는 주소의 키만 사용하고 키별 Store 캐시/알림 채널을 따릅니다. 하지만 **기존 독서 서버 자체는 인스턴스별 DB가 아닙니다.**

- `worker.js`의 `instanceEnv`는 `__instanceId`만 붙입니다.
- `reading-notion.js`의 `notionReadingConfig`는 공통 `NOTION_READING_*` 설정을 사용합니다.
- 독서 KV 캐시 키와 진행 중 조회도 인스턴스별로 나뉘어 있지 않습니다.

따라서 다른 등록 키가 같은 공통 독서 DB를 볼 가능성을 위젯 코드로 차단할 수 없으며, 실제 서버의 사용자별 격리를 완료했다고 보고하지 않습니다.
이번 요청의 서버 수정 금지에 따라 그대로 두었습니다. 개인용 기존 DB 연결로 사용하고, 다른 사람에게 배포하기 전에는 별도의 서버 접근 제어/DB 연결 작업이 필요합니다.

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

2026-11-09 검증:

- 기존 테스트 + 새 순수 함수 테스트: 197/197 통과. 새 테스트는 7개.
- 실제 Store를 사용하는 오프라인 브라우저 검사: 45/45 통과. Worker/Notion 요청을 테스트 데이터로 가로채 운영 쓰기 없음.
- 1320/1130/450/390px × 4종 권장 높이, 모바일 입력 규격, iframe 390→1130 변경, 팝업 차단, 레이어 경계, 새 기록 중복 방지, 저장 실패 후 재시도, 완독·다른 위젯 갱신, 새로고침, 검색/말줄임/3건 상한, 빈 상태, 키 없는 요청 차단, JS 오류 없음 확인.
- 실제 운영 API 읽기 조회: 20권(읽는 중 1, 완독 16), 새 책장 4칸 표시 확인.
- 실제 읽은 권수 위젯: 2026년 3권 표시, 동일 API의 `done + year=2026` 집계 3권과 일치. 운영 쓰기 요청 0건.
- 실제 Notion DB 추가/수정, 갤러리 반영, 실기기/iPad 앱, 별도 실제 사용자 키의 데이터 격리는 검증하지 않음. 실제 DB에는 테스트 책을 만들지 않음.
- 스크린샷은 git 제외 폴더 `output/playwright/library-*.png`에 저장.

배포는 위 폴더와 테스트 파일만 현재 브랜치에 커밋하고 기존 GitHub Pages 절차로 반영합니다. Worker 배포/migration은 필요하지 않습니다.
