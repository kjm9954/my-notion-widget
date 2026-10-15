# sky-lime · WORK LOG 위젯 4종

WORK LOG 페이지용 새 테마입니다. 기존 업무일지·메모 데이터를 그대로 쓰며, 새 저장 키나 서버 테이블을 만들지 않습니다.
`sky-lime/` 밖의 파일(store.js, worker.js, widget-frame.*, 다른 테마)은 수정하지 않았습니다.

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
| 검토 대기 | `review`를 서버에 보내지 않고 예정(`wait`)으로 저장·표시. 이미 예정이면 저장 요청 없음 | `Store.updateWorklogTaskStatus`가 있거나, 업무 응답에 `review` 상태·`prevStatus: review`·`statusChangedAt` 필드가 보일 때 |
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
| `../assets/character.png` | 이번 주 목표 캐릭터 |
| `../tests/` | 계산 함수 테스트, 오프라인 브라우저 테스트 |

## 테스트

```bash
node --test sky-lime/tests/sky-lime-model.test.mjs
PLAYWRIGHT_MODULE=<playwright 경로> SKY_LIME_SHOTS=<스크린샷 폴더> node --test --test-concurrency=1 sky-lime/tests/sky-lime.browser.mjs
```

브라우저 테스트는 운영 Worker 주소를 브라우저 안에서 가로채 메모리 테스트 데이터로만 응답합니다. 실제 서버·실데이터를 쓰지 않습니다.
