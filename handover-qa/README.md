# 인수인계 Q&A 위젯

노션에 `/embed` 로 넣어 쓰는 질문·답변 위젯 두 개와 공용 파일입니다. 데이터는 Cloudflare Worker(`worker.js`)를 거쳐 D1에 저장되고(이미지 포함), 등록된 접근 키로만 읽고 쓸 수 있습니다.

## 파일

| 파일 | 역할 |
|---|---|
| `index.html` | 목록형. 목록·검색·스레드·답변·상태 변경. `?mode=compose` 로 열면 가이드 페이지용 입력 전용 위젯 |
| `add.html` | 질문형. 질문 등록 전용 폼 |
| `qa-store.js` | 두 위젯이 함께 쓰는 저장 계층(키 처리, API, 이미지 변환, 작성자, 위젯 사이 알림) |
| `qa-config.js` | 공개 설정. 서버 주소·이미지 한도·일반 화면 문구만 있습니다 |
| `private/` | **저장소에 올리지 않는 폴더**(`.gitignore`). 방 설정 원본 `qa-config.private.json` 과 개발용 샘플 `qa-sample.js` |

## 임베드 주소

접근 키는 주소의 `#k=` 뒤에 붙입니다. `#` 뒤는 서버로 전송되지 않고, 위젯은 키를 요청 헤더(`Authorization: Bearer`)로만 보냅니다. 키를 코드·커밋·문서에 적지 마세요.

| 위젯 | 주소 | 높이 |
|---|---|---|
| 질문형 | `https://kjm9954.github.io/my-notion-widget/handover-qa/add.html#k=<접근 키>` | 900 |
| 목록형 | `https://kjm9954.github.io/my-notion-widget/handover-qa/index.html#k=<접근 키>` | 1000 |
| 입력 전용(가이드 페이지 하단) | `https://kjm9954.github.io/my-notion-widget/handover-qa/index.html?mode=compose&cat1=<카테고리>&guide=<페이지 이름>#k=<접근 키>` | 96~268 |

**폭**: 두 위젯은 노션 임베드 블록의 폭을 그대로 채웁니다. 노션에서 블록에 마우스를 올리면 나오는 양옆 손잡이를 끌어 폭을 맞추세요. 폭을 고정하고 싶으면 주소 끝에 `&w=<px>` 를 붙입니다(예: `#k=<접근 키>&w=600`). 그 폭을 넘지 않고 가운데 정렬됩니다. 두 위젯을 같은 폭으로 맞추려면 같은 값을 쓰세요.

이전 형식인 `index.html?room=<접근 키>` 도 계속 열리지만, 키가 주소 경로에 남으므로 `#k=` 형식으로 바꿔 두는 것을 권장합니다.

## 두 위젯의 관계

- 메인 페이지 오른쪽 "질문" 영역에 **질문형을 위, 목록형을 바로 아래**에 같은 폭으로 둡니다.
- 두 위젯은 같은 접근 키, 같은 설정, 같은 작성자 선택(`localStorage["qa.author"]`)을 씁니다. 한쪽에서 작성자를 고르거나 바꾸면 다른 쪽도 바로 바뀝니다.
- 질문형에서 등록하면 같은 페이지의 목록형이 즉시 새로 고칩니다. 다른 컴퓨터의 변경은 목록형이 5초마다 리비전을 확인해 받아옵니다.
- 질문형은 등록만 합니다. 목록·검색·답변·상태 변경은 목록형에서 합니다. 질문형이 읽는 것은 "비슷한 질문" 1건과 "내가 남긴 질문" 최근 3건뿐입니다.
- 새 질문의 상태는 답하는 사람(`role: 'answerer'`)이 쓰면 `답변됨`, 묻는 사람이 쓰면 `대기` 입니다.

## 등록 순서

1. 이미지 업로드 — 붙여넣은 이미지는 긴 변 1600px, JPEG 0.85로 줄여 올립니다. 줄인 뒤 3MB가 넘으면 등록을 막습니다.
2. 질문 생성 — 같은 등록을 다시 시도해도 같은 id를 쓰므로 중복되지 않습니다.
3. 목록 반영 확인 — 새 질문이 목록 요약에 보이는지 확인합니다.

각 단계는 연결 오류·서버 오류 때 간격을 늘려 가며 최대 3번 다시 시도합니다. 실패해도 작성 내용·이미지·카테고리는 그대로 남습니다. 작성 중인 제목·내용·카테고리는 `localStorage["qa.addDraft"]` 에 임시 저장됩니다(이미지 제외).

## 방 설정(이름·카테고리)

사람 이름·역할 설명·카테고리와 그 단어가 들어간 문구는 공개 파일에 두지 않습니다. 접근 키마다 서버(`qa_rooms.config`)에 저장하고, 위젯은 키가 있을 때만 받아 공개 설정 위에 덮어씁니다. 받은 설정은 연결이 끊겼을 때를 위해 그 브라우저에 보관합니다. 방 설정이 비어 있으면 위젯에 "방 설정이 비어 있어요"가 뜹니다.

설정 원본은 `private/qa-config.private.json` 에 두고, 고친 뒤 아래 명령으로 올립니다. 쓰기 권한이 있는 접근 키가 필요합니다.

```bash
curl -X POST -H "Authorization: Bearer <접근 키>" -H "Content-Type: application/json" --data-binary @handover-qa/private/qa-config.private.json https://notion-widget.wldnjsdkk.workers.dev/api/qa/config
```

현재 설정 내려받기:

```bash
curl -H "Authorization: Bearer <접근 키>" https://notion-widget.wldnjsdkk.workers.dev/api/qa/config
```

설정 모양: `users`(1~8명, `name`·`role`(`answerer` 또는 `asker`)·`desc`), `categories`(`major` 한 단계, 이름이 겹치면 안 됨), 선택 항목 `fallbackCategory`·`devComposeCategory`·`text`(공개 문구를 덮어쓸 값). 카테고리는 대분류 한 단계만 씁니다.

## 저장 용량

이미지는 D1의 `qa_images` 테이블에 base64 조각으로 저장됩니다. 무료 플랜의 D1 데이터베이스는 500MB까지이고 다른 위젯과 함께 씁니다. 붙여넣은 이미지는 보통 한 장에 0.1~0.5MB입니다. 용량이 걱정되면 아래 명령으로 방별 사용량을 확인하세요.

```bash
npx wrangler d1 execute notion_widget_db --remote --command "SELECT COUNT(DISTINCT id) AS images, SUM(LENGTH(data)) AS bytes FROM qa_images"
```

KV는 무료 플랜의 하루 쓰기 한도를 다른 위젯과 나눠 쓰므로 Q&A는 KV에 쓰지 않습니다. 예전에 KV에 올린 이미지는 읽기만 합니다.

## 접근 키 관리

키는 `qa_rooms` 테이블에 등록된 것만 유효합니다. 상태는 `active`(읽기·쓰기), `readonly`(읽기만), `revoked`(차단) 중 하나입니다.

새 키 만들기:

```bash
node -e "console.log('qa_' + require('crypto').randomBytes(33).toString('base64url'))"
```

키 등록:

```bash
npx wrangler d1 execute notion_widget_db --remote --command "INSERT INTO qa_rooms (room, revision, updated_at, status) VALUES ('<접근 키>', 0, 0, 'active')"
```

키 차단(위젯에 "접근 키가 만료됐어요"가 뜹니다):

```bash
npx wrangler d1 execute notion_widget_db --remote --command "UPDATE qa_rooms SET status = 'revoked' WHERE room = '<접근 키>'"
```

`status = 'readonly'` 로 바꾸면 질문형에 "저장소에 쓸 권한이 없어요"가 뜹니다.

## 공개 범위

GitHub Pages 저장소는 공개입니다. 공개되는 것은 위젯 코드와 `qa-config.js`(일반 문구)뿐입니다. 이름·카테고리(방 설정)와 질문·답변·이미지는 접근 키가 있어야만 받을 수 있습니다. 임베드 주소를 아는 사람은 누구나 읽고 쓸 수 있으니 노션 페이지 공유 범위를 사용하는 사람으로 제한하세요.

`private/` 폴더의 파일은 커밋하지 마세요. `tests/handover-qa.test.mjs` 는 이 컴퓨터에 비공개 설정이 있으면, 추적되는 Q&A 파일에 그 단어가 들어 있지 않은지 확인합니다.

## 로컬 개발

```bash
npx wrangler d1 migrations apply notion_widget_db --local
```

`.claude/launch.json` 의 `api`(wrangler dev, 8787)와 `widgets`(정적 서버, 8791)를 띄운 뒤, 로컬 D1에 테스트 키를 등록하고 아래처럼 엽니다. `?dev=1` 일 때만 `api` 로 서버 주소를 바꿀 수 있습니다.

```
http://localhost:8791/handover-qa/add.html?dev=1&api=http%3A%2F%2F127.0.0.1%3A8787#k=<테스트 키>
```

키 없이 `index.html?dev=1` 로 열면 브라우저에만 저장하는 로컬 모드와 개발 하네스(폭 전환, 샘플 초기화, 실패 흉내)가 뜹니다. 이때 이름·카테고리는 `private/qa-config.private.json`, 샘플은 `private/qa-sample.js` 에서 읽으므로 이 파일들이 있는 컴퓨터에서만 동작합니다. 키 없이 `?dev=1` 도 없이 열면 두 위젯 모두 "질문 기능이 연결되지 않았어요"만 보여 줍니다.

로컬 테스트 방에 설정 올리기:

```bash
curl -X POST -H "Authorization: Bearer <테스트 키>" -H "Content-Type: application/json" --data-binary @handover-qa/private/qa-config.private.json http://127.0.0.1:8787/api/qa/config
```

테스트:

```bash
node --test tests/handover-qa.test.mjs
```
