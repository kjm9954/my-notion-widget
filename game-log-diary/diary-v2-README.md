# 일기 v2 · 노션 임베드 4종

첨부 `diary-widgets.zip`의 화면을 실제 DiaryV1 저장소에 연결한 새 위젯입니다.
시안·표본 데이터는 저장소에 복사하지 않았습니다. v1 두 화면, v1 클라이언트, Worker, D1 스키마와 migration은 변경하지 않았습니다.
2026-11-09 사용자가 Library에 이어 일기 v2의 커밋·배포도 승인했습니다.

## 화면과 주소

노션에서 `/embed`에 개인 인스턴스 키를 포함한 아래 주소를 넣습니다. 네 주소 모두 **기존 v1과 동일한 키**를 사용합니다.
문서·소스에는 실제 키를 넣지 않습니다. 이 URL을 가진 사람은 해당 일기에 접근할 수 있으므로 공개 페이지·저장소에 공유하지 않습니다.

| 화면 | 권장 임베드 높이 | 주소 형식 |
| --- | --- | --- |
| 하루의 기록 | 404px | `https://kjm9954.github.io/my-notion-widget/game-log-diary/diary-v2-today.html?w=[기존 키]` |
| 기록 달력 | 760px | `https://kjm9954.github.io/my-notion-widget/game-log-diary/diary-v2-calendar.html?w=[기존 키]` |
| 기분 추세 | 236px | `https://kjm9954.github.io/my-notion-widget/game-log-diary/diary-v2-mood-trend.html?w=[기존 키]` |
| 기록한 날 | 212px | `https://kjm9954.github.io/my-notion-widget/game-log-diary/diary-v2-record-days.html?w=[기존 키]` |

루트 카드는 iframe 가로·세로를 100% 채웁니다. 노션에서 위젯의 높이를 위 값에 맞추면 됩니다.
PC는 기록 위젯 전체 폭, 아래 달력 65%와 통계 35% 배치를 권장합니다. 모바일은 같은 높이로 세로 배치합니다.
페이지 전체에는 스크롤이 없고, 긴 글 편집/기록 상세의 내용 영역만 필요할 때 스크롤됩니다.
미래 날짜 작성·미래 월 이동은 비활성입니다. 날짜는 한국 시간 자정 기준입니다.

## 파일

- `diary-v2-today.html` / `diary-v2-today.js`: 날짜별 글·기분·사진, 사진 선택/크게 보기, 긴 글 편집, 저장 상태, 초안.
- `diary-v2-calendar.html` / `diary-v2-calendar.js`: 월 달력, 상세, 빠른 쓰기, 사진을 유지하는 수정, 명시적 삭제 확인.
- `diary-v2-mood-trend.html`, `diary-v2-record-days.html` / `diary-v2-stats.js`: 기분 개수와 기록일·연속일 집계.
- `diary-v2-common.js`: 얼굴 아이콘·날짜·월 집계, 편집 상태/초안/409 처리, 동기화 이벤트, 키보드 포커스.
- `diary-v2.css`: 네 화면 공통 스타일. v1의 같은 이름 토큰 값 유지. 삭제도 회색 안내, 사진 원본을 재인코딩하지 않음.
- `tests/diary-v2.test.mjs`, `tests/browser/diary-v2-audit.js`: 계산·저장 경합·오류 보존·실제 브라우저 동작 검사.
- `tests/widget-audit.test.mjs`: 요청서에 명시된 v2 달력의 삭제 확인 문장만 기존 금지 검사에서 예외 처리. 나머지 위젯 규칙 유지.
- `tests/browser/diary-v1-audit.js`: 기존 35개 검증 내용은 그대로, 날짜 이동 후 API 읽기가 끝난 다음 입력하도록 대기 조건만 보강.

## 데이터 흐름 / 사용한 DiaryV1 함수

새 API나 저장 계층은 없습니다. 다음 기존 함수를 통해서만 조회·저장합니다.

| 흐름 | 기존 함수 |
| --- | --- |
| 날짜 이동/상세 | `loadEntry(date)` → `{ date, text, mood, revision, photos }` 또는 `null` |
| 달력/통계 | `monthBounds(year, month)` → `loadRange(start, end)`; 반환값의 해당 월만 집계 |
| 사진 읽기 | `photoFromFile(file)` → 원본 dataURL, 최대 4장·장당 5MB |
| 저장 | `saveEntry({ date, text, mood, photos, expectedRevision })` |
| 기존 사진 유지 | `photos: [{ id }]`만 전송. 새 사진만 `{ id, dataUrl }` 전송 |
| 삭제 | `deleteEntry(date, revision)`, 확인 후 한 번만 실행 |
| 초안 | `loadDraft(date)`, `saveDraft(date, draft)`, `clearDraft(date)` |
| 변경 알림 | `announce({ type:'saved' 또는 'deleted', date })`, `onChange(...)` |
| 한국 날짜 | `seoulDateKey()`, `shiftDate(...)`, `formatDate(...)`, `validDateKey(...)` |
| 키 없음 | `connected`, `connectionUrl(현재 파일)` |

- 저장·사진 읽기·삭제 중 중복 조작을 잠급니다. 날짜가 바뀌면 이전 읽기 결과는 버립니다.
- 날짜 조회가 실패하면 다른 날짜의 글을 가져다 저장하지 않으며, 읽기에 성공하기 전에는 저장할 수 없습니다.
- 글/기분/사진이 모두 비면 저장 버튼만 비활성입니다. 비웠다고 자동 삭제하지 않습니다.
- 실패한 저장은 입력·새 사진을 화면에 유지합니다. 초안 보관 용량이 부족하면 경고하고 날짜 이동을 막습니다. 브라우저를 강제로 종료하면 보관 못 한 새 사진은 복구할 수 없습니다.
- 409일 때 최신 기록(삭제됐으면 삭제 사실)을 보여주며 내 초안은 보존합니다. 사용자가 ‘내 초안으로 다시 작성’을 선택해야 최신 revision으로 재작성되고, **저장을 한 번 더 눌러야** 서버에 씁니다.
- 다른 기기에서 삭제된 기존 사진은 충돌 해결 시 다시 살리지 않습니다. 해당 사진을 제외했음을 알립니다. 새로 고른 사진은 그대로 보존합니다.
- 같은 브라우저 위젯 사이에는 기존 BroadcastChannel 알림을 사용합니다. 다른 기기 수정은 창 포커스/다시 표시될 때 조회하며, 계속 열린 화면의 원격 실시간 push를 새로 만들지는 않았습니다.
- 현재 달 기록 수 분모는 오늘까지입니다. 지난달은 전체 날짜 수입니다. 연속일은 시안처럼 **표시 중인 달 안에서만** 계산합니다.
- 본문 사진/확대 사진은 `contain`으로 원본 비율을 유지하고, 달력의 대표 사진만 시안처럼 썸네일 `cover`로 표시합니다. 저장 원본에는 영향을 주지 않습니다.

## 실행·검증

저장소 루트를 정적 HTTP 서버로 열고 위 상대 경로에 기존 키를 붙여 접속합니다. HTML을 `file://`로 직접 열면 ES module이 차단될 수 있습니다.

```powershell
node --check game-log-diary/diary-v2-common.js
node --check game-log-diary/diary-v2-today.js
node --check game-log-diary/diary-v2-calendar.js
node --check game-log-diary/diary-v2-stats.js
node --test tests/*.test.mjs sky-lime/tests/*.test.mjs
# 저장소 루트가 127.0.0.1:4173에서 서비스 중일 때:
npx --yes --package @playwright/cli playwright-cli -s=diary-v2 open http://127.0.0.1:4173/game-log-diary/diary-v2-today.html
npx --yes --package @playwright/cli playwright-cli -s=diary-v2 run-code --filename tests/browser/diary-v2-audit.js
npx --yes --package @playwright/cli playwright-cli -s=diary-v2 run-code --filename tests/browser/diary-v1-audit.js
```

2026-11-09 검증:

- Node 전체 211/211 통과 (v2 14개, 기존 DiaryV1 API 9개 포함).
- v2 실제 Chromium 브라우저 52/52 통과. 실제 DiaryV1 클라이언트를 사용하되 Worker 요청은 테스트 데이터로 전부 가로채 운영 쓰기 없이 검증.
- v1 브라우저 35/35 통과 (아래 설명한 조회 완료 대기 보강 후, 검증 항목은 변경 없음).
- 1320/1130/390px 및 실제 65%/35% iframe 폭, 추가 344px 작성/960px 달력. 네 권장 높이를 정확히 채우고 가로 잘림·페이지 이중 스크롤 없음.
- 글/기분/사진, 5장 시도→4장 제한, 원본 바이트 유지, 사진 교체, 사진 전용 기록, 새로고침, 달력 상세·수정·삭제, 6주 달력, 통계, 네 위젯 갱신 확인.
- 두 탭 동시 수정과 실제 모의 HTTP409, 삭제된 최신 기록 충돌, 저장·사진 업로드 실패, 중복 저장 잠금, 다른 날짜 조회 실패, 키 분리/키 없음/초안 네임스페이스 검증.
- 팝업 허용 없는 sandbox iframe에서 글 작성·저장 확인.
- 운영 읽기 GET 모두 200, 네 위젯 표시와 응답 집계 일치. 해당 키의 이번 달 기록은 0건이어서 운영의 기존 작성 내용/사진 표시까지 검증한 것은 아님. 운영 쓰기 0건.
- 실제 Notion 앱·실물 iPad/휴대폰·다른 PC 두 대의 동시 수정은 미검증. 브라우저 크기/iframe/두 탭 모의 서버로 검증한 결과와 구분합니다.
- v1은 날짜 변경 때 조회 완료 전에도 입력이 켜져 있는 기존 동작이 있습니다. 초기에 너무 일찍 입력한 회귀 검사는 6개가 연쇄 실패했고, 검사에 조회 완료 대기를 보강했습니다. v1 UI/저장 코드는 사용자 요청대로 수정하지 않았습니다. v2는 이 상황에서 입력·저장을 잠그고 회귀 테스트로 보호합니다.

최초 v2 배포는 정적 파일만 반영했습니다. 아래 추가 기분 변경에는 Worker 배포도 필요합니다.

## 2026-11-09 추가 보완

- 달력 빠른 쓰기의 본문과 임시 보관 상태 사이에 8px 간격을 확보했습니다.
- 오늘/달력 빠른 쓰기에 클립보드 이미지 붙여넣기를 연결했습니다. 텍스트 붙여넣기는 그대로이며 사진은 기존 원본 저장·최대 4장 규칙을 따릅니다. 달력에서도 사진 미리보기·제거 후 저장이 가능합니다.
- 작성 기분에 슬픔(`sad`)·화남(`angry`)을 추가했습니다. 상세 보기·기분 추세도 같은 다섯 기분을 사용합니다. 기존 `diary-v1-api.mjs`의 허용 값만 확장하며 스키마·저장 구조는 바꾸지 않았습니다.
- 빈 기분 추세의 안내는 가로·세로 가운데 정렬을 유지합니다. 다섯 기분이 있는 좁은 화면도 넘치지 않게 확인했습니다.
- 추가 검증: v2 브라우저 67/67, 기분 배치 10/10, 전체 Node 238/238 통과. 사진/저장 실패·동시 수정은 모의 서버, 붙여넣기는 ClipboardEvent/DataTransfer로 검증했습니다. 실제 OS 클립보드 단축키·Notion/iPad 앱은 미검증입니다.
- 배포 순서: 루트 Worker(`sad`/`angry` 허용) → GitHub Pages(클라이언트). D1 migration·추가 계정 설정 없음.
