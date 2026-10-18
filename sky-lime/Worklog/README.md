# sky-lime · WORK LOG 위젯 4종

WORK LOG 페이지용 새 테마입니다. 기존 업무일지·메모 데이터를 그대로 쓰며, 새 저장 키나 서버 테이블을 만들지 않습니다.
`sky-lime/` 밖의 파일(store.js, worker.js, widget-frame.*, 다른 테마)은 수정하지 않았습니다. (아래 목표 체크 3종은 store.js에 함수 2개를 더했습니다.)

## 주소

GitHub Pages에 반영된 뒤 아래 형식으로 임베드합니다. 네 주소 모두 같은 `?w=` 키를 붙입니다.

| 위젯 | 주소 | Notion 배치 · 높이 |
| --- | --- | --- |
| 이번 주 목표 | `https://kjm9954.github.io/my-notion-widget/sky-lime/Worklog/weekly-goals.html?w=[인스턴스 키]` | 전체 폭 · 약 214px (캐릭터 자리 84px + 카드 130px) |
| 업무일지 | `https://kjm9954.github.io/my-notion-widget/sky-lime/Worklog/worklog-sky-lime.html?w=[인스턴스 키]` | 전체 폭 · 약 900px |
| 이번 주 한 일 | `https://kjm9954.github.io/my-notion-widget/sky-lime/Worklog/week-review.html?w=[인스턴스 키]` | 전체 폭 · 약 330px |
| 메모 | `https://kjm9954.github.io/my-notion-widget/sky-lime/Worklog/notes.html?w=[인스턴스 키]` | 오른쪽 35% 칸 · 약 370px |

- 위젯은 임베드 상자의 가로·세로를 100% 채웁니다. 높이는 내용과 상관없이 고정이고, 위젯 안에 스크롤이 없습니다.
- `store.js`를 `data-store-isolated data-store-coalesce`로 불러옵니다(cream-olive-garden과 같은 방식). 주소의 `w`만 쓰고, 키가 없거나 잘못되면 서버에 요청하지 않습니다.
- 같은 키를 쓰는 cream-olive-garden 위젯과 같은 데이터를 봅니다.

## 데이터 연결

| 화면 | 읽기 | 쓰기 |
| --- | --- | --- |
| 업무일지·목표·한 일 | `Store.loadWorklogState({ fresh:true })` | `Store.patchWorklogState({ upserts, deleteIds })` |
| 상태 변경 | 〃 | `Store.updateWorklogTaskStatus(id, status)`가 있으면 사용, 없으면 위 patch로 status 변경 |
| 메모 | `Store.loadNotesState()` | `Store.patchNotesState({ updates:[{ id, create, changes:{ text, mode, done } }], deleteIds })`, 없으면 `Store.saveNotesState` |
| 다른 위젯 반영 | `Store.watch` (`/api/worklog/`, `/api/notes/`) | 저장 성공 응답을 바로 화면에 반영 |

- 업무 필드: 업무명 `title`, 구분 `proj`(빈 값·`미분류` = 기타), 마감 `due`, 상태 `status`, 메모 `memo`, 완료 `done`·`doneAt`, 번호 `goalId`(`worklog:goal:1~3`, 예전 `goalId === id`는 1번), 업무/일상 `mode`.
- 상태: `wait` 예정 · `doing` 진행중 · `review` 검토 대기 · `done` 완료.

### 현재 운영 서버에서의 동작과 서버 업데이트 후 자동 전환

store.js·worker.js는 바꾸지 않았고, 아래 기능은 서버가 지원한다는 신호가 보이면 코드 수정 없이 켜집니다.

| 기능 | 지금(운영 서버 그대로) | 자동으로 켜지는 조건 |
| --- | --- | --- |
| 상태 변경 | 기존 `patchWorklogState`로 status 저장 | `Store.updateWorklogTaskStatus`가 생기면 그 함수 사용 |
| 검토 대기 | `review`를 그대로 보내고 서버가 돌려준 상태를 표시. 지금 서버는 예정(`wait`)으로 바꿔 저장하므로 예정 열(오류 없음) | 서버가 `review`를 저장해 돌려주면 바로 검토 대기 열. 그 뒤로는 저장 전 화면도 바로 검토 대기 |
| 체크 해제 | `prevStatus`가 없으면 진행중 | 응답에 `prevStatus`가 오면 그 상태로 복원(기존 저장 방식으로 완료할 때도 `prevStatus`를 함께 보냄) |
| 메모 업무/일상 | 메모에 `mode`가 없으면 업무·일상 모두 같은 목록(전환 버튼은 유지) | 메모 응답에 `mode` 필드가 하나라도 있으면 나눠 보여줌(`mode` 없는 기존 메모는 업무). 새 메모에는 항상 `mode`를 함께 보냄 |

- 메모는 기존 메모 위젯과 같은 규칙으로 하루 한 번 지난날 완료한 메모를 정리(`cleanupCompleted`)합니다.
- 저장은 하나씩 순서대로 보내고, 각 저장은 직전 서버 상태를 기준으로 만듭니다. 실패하면 화면을 되돌리고 Store 공통 오류 표시를 띄웁니다. 연결 실패로 이전 자료를 보여주는 동안에는 저장을 막습니다.
- 브라우저 저장소에는 업무/일상 선택값(`sky-lime-worklog-mode-v1:<키>`)만 둡니다. 실제 데이터는 저장하지 않습니다.

## 계산 규칙

- 오늘·D-n·이번 주: 한국 오전 6시 경계(기존 업무일지와 같음). D-n은 보고 있는 날짜와 관계없이 실제 오늘 기준.
- 업무일지 날짜별 목록: `task.date`(기존 업무일지와 같음). 각 열은 마감 지남 → D-day → 가까운 마감 → 마감 없음.
- 이번 주 목표: 이번 주(주말에 끝낸 것 포함) 번호 있는 업무, 1 → 2 → 3.
- 이번 주 한 일: 완료한 업무는 `doneAt` 요일, 없으면 `task.date`. 정렬은 번호 → 완료 먼저 → 우선순위 → 기존 순서.
- 업무일지가 넘치면 그 열만: 메모 줄 숨김 → 업무명 한 줄 + 마감 오른쪽 → 마지막 줄 "외 n개"(누르면 그 열 전체 목록 창).

## 파일

| 파일 | 내용 |
| --- | --- |
| `sky-lime.css` | 테마 색·크기 변수와 공통 부품 |
| `sky-lime-model.mjs` | 날짜·정렬·집계 순수 함수 |
| `sky-lime-common.mjs` | 업무/일상 전환 동기화, Store 연결, 저장 순서 관리 |
| `weekly-goals.*`, `worklog-sky-lime.*`, `week-review.*`, `notes.*` | 위젯 4종 |
| `../assets/character.webp`, `character.gif` | 이번 주 목표 캐릭터(눈 깜빡임·꼬리 살랑). webp를 쓰고, 지원하지 않는 브라우저만 gif |
| `../tests/` | 계산 함수 테스트, 오프라인 브라우저 테스트 |

## 테스트

```bash
node --test sky-lime/tests/sky-lime-model.test.mjs
PLAYWRIGHT_MODULE=<playwright 경로> SKY_LIME_SHOTS=<스크린샷 폴더> node --test --test-concurrency=1 sky-lime/tests/sky-lime.browser.mjs
```

브라우저 테스트는 운영 Worker 주소를 브라우저 안에서 가로채 메모리 테스트 데이터로만 응답합니다. 실제 서버·실데이터를 쓰지 않습니다.

---

# 목표 체크 위젯 3종 (분기 진행도 · 분기 목표 · 습관 점검)

노션 하위 페이지 "목표 체크"에 위에서 아래로 따로 임베드합니다. 업무일지·이번 주 목표 데이터는 읽지도 쓰지도 않습니다(`weekly-goals.*` 등 기존 위젯 수정 없음).

## 주소 · 노션 임베드 높이

세 주소 모두 업무일지와 같은 `?w=` 키를 붙입니다.

| 위젯 | 주소 | 카드 높이 (PC / 모바일) | 노션 임베드 높이 |
| --- | --- | --- | --- |
| 분기 진행도 | `https://kjm9954.github.io/my-notion-widget/sky-lime/Worklog/quarter-progress.html?w=[인스턴스 키]` | 124 / 112px | 124px |
| 분기 목표 | `https://kjm9954.github.io/my-notion-widget/sky-lime/Worklog/quarter-goals.html?w=[인스턴스 키]` | 404 / 404px | 404px |
| 습관 점검 | `https://kjm9954.github.io/my-notion-widget/sky-lime/Worklog/habit-check.html?w=[인스턴스 키]` | 184 / 324px | PC만 보면 184px, 모바일도 보면 324px |

- 폭 700px 이상은 PC 배치, 그보다 좁으면 모바일 배치입니다. 카드 높이는 고정이고 위젯 안 스크롤·펼침이 없습니다.
- 노션 임베드가 카드보다 높으면 카드는 위에 붙고 아래는 투명합니다. 습관 점검을 324px로 두면 PC에서는 184px 카드 아래 140px이 빈칸(페이지 맨 끝)입니다.

## 데이터

| 화면 | 읽기 | 쓰기 |
| --- | --- | --- |
| 세 위젯 | `Store.loadQuarterGoals(mode, quarter)` → `GET /api/quarter-goals/state` | `Store.patchQuarterGoals(mode, quarter, ops)` → `POST /api/quarter-goals/patch` |
| 다른 위젯 반영 | `Store.watch` (`/api/quarter-goals/`), 2분 공유 캐시로 세 위젯 조회를 한 번으로 합침 | 저장 응답(전체 상태)으로 같은 분기 캐시를 바로 갱신 |

- `store.js`에는 위 두 함수와 조회 합치기·저장 캐시 연결 두 줄만 더했습니다. 기존 함수 동작은 같습니다.
- 서버: 기존 Worker를 감싸는 별도 모듈(`quarter-goals-api.mjs`)이 새 주소 두 개만 처리합니다. 저장은 기존 `widget_settings` 표의 행 하나(`instance:<키>:quarterGoals:v1:<work|life>:<YYYY-Qn>`)이고 D1 migration·KV는 쓰지 않습니다. 서버 파일은 이 저장소에 넣지 않았고 운영 배포는 별도로 진행합니다. **배포 전에는 세 위젯이 "불러오지 못했어요"로 표시됩니다.**
- 목표: `id, order, title, steps[{id,title,done}](최대 6), pct, status(doing/done/hold), lastActivityAt, createdAt, doneAt`. 습관: `id, order, name, months[3](good/half/bad/null)`. 분기당 목표 5개·습관 5개(서버에서도 막음).
- 습관 이어가기: 그 분기 행이 아직 없으면(한 번도 저장 안 함) 직전 분기(못 찾으면 최대 1년 전까지) 습관 이름만 빈 기호로 보여주고, 처음 저장할 때 함께 저장합니다. 그 뒤 전부 지워도 다시 복사하지 않습니다. 지난 분기에는 복사하지 않습니다.
- 브라우저 저장소에는 UI 값만 둡니다: 업무/일상(`sky-lime-worklog-mode-v1:<키>`, 업무일지 위젯과 공유)과 고른 분기(`sky-lime-goal-quarter-v1:<키>`, 그 업무일에만 유지).

## 계산 규칙

- 분기: 1~3월 Q1 … 10~12월 Q4, 날짜는 업무일(한국 오전 6시) 기준. 이동 범위는 1년 전(4개 분기 전) ~ 다음 분기 1개.
- 목표 진행도: 달성 100 / 세부 단계가 있으면 체크 비율 / 없으면 pct. 상태는 자동(단계 전부 체크 또는 pct 100이면 달성), 보류만 수동.
- 습관 점수: ◎ 100 · △ 50 · ✕ 0, 점검한 달만 평균(없으면 제외).
- 분기 진행도 = (보류 제외 목표 진행도 + 점수 있는 습관 점수)의 평균, 반올림. 항목이 없으면 0%.
- 경과율 = (오늘까지 지난 날) / 분기 총 일수. 이번 분기이고 진행도 < 경과율이면 막대 뒤에 경과율 띠.
- D-n: 이번 분기는 마지막 날까지 남은 날, 지난 분기 "종료", 다음 분기 "n월 시작".
- 멈춤: 이번 분기 + 진행 중 + 마지막 활동이 업무일 기준 14일 이상 → "2주째 멈춤".
- 습관 점검 기간: 매달 마지막 7일(이번 달 칸) · 다음 달 첫 7일(지난달 칸). 새 분기 첫 7일에는 지난 분기 마지막 달 칸만 열립니다(‹로 이동해서 체크). 이번 분기의 지난달 빈 칸은 "·"을 눌러 언제든 채웁니다. 아직 안 온 달·지난 분기는 누를 수 없습니다.

## 파일

| 파일 | 내용 |
| --- | --- |
| `goal-check-model.mjs` | 분기·진행도·멈춤·점검 기간 순수 함수, 저장 전 화면 반영 |
| `goal-check-common.mjs` | 고른 분기 공유(localStorage + BroadcastChannel), Store 연결, 저장 순서 관리 |
| `goal-check.css` | 세 위젯 공통(고정 높이 카드·헤더) |
| `quarter-progress.*`, `quarter-goals.*`, `habit-check.*` | 위젯 3종 |
| `../tests/goal-check-model.test.mjs`, `../tests/goal-check.browser.mjs` | 계산 테스트, 오프라인 브라우저 테스트 |

## 테스트

```bash
node --test sky-lime/tests/goal-check-model.test.mjs
PLAYWRIGHT_MODULE=<playwright 경로> GOAL_CHECK_SHOTS=<스크린샷 폴더> node --test --test-concurrency=1 sky-lime/tests/goal-check.browser.mjs
# 서버 모듈과 함께: QUARTER_GOALS_SERVER=<quarter-goals-api.mjs 경로> 를 더하면 목업 대신 그 모듈을 메모리 SQLite 위에서 돌립니다.
```

브라우저 테스트는 운영 Worker 주소를 브라우저 안에서 가로채 메모리 테스트 데이터로만 응답합니다. 실제 서버·실데이터를 쓰지 않습니다.
