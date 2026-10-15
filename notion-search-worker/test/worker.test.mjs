// 검색 Worker 단위 테스트. 노션 API·KV는 메모리 흉내(실제 노션·Cloudflare에 요청하지 않음).
// 실행: node --test notion-search-worker/test/worker.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

const KEY = "w_test_allowed_key_0123456789abcdef";
const ORIGIN = "https://kjm9954.github.io";
const BASE = "https://notion-search.example.workers.dev";

// ───────── 흉내: KV ─────────
function fakeKV() {
  const map = new Map();
  return {
    map, puts: 0,
    async get(key, options) {
      const value = map.get(key);
      if (value == null) return null;
      return options?.type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value) { this.puts += 1; map.set(key, value); },
  };
}
const makeEnv = (kv, extra = {}) => ({
  NOTION_TOKEN: "secret_test_token", ALLOWED_W: KEY,
  NOTION_DATABASE_ID: "3f9b993c8a6180a180c7dbc6927835e3", NOTION_DATA_SOURCE_ID: "ds-test",
  NOTION_MIN_INTERVAL_MS: "0", SEARCH_INDEX: kv, ...extra,
});

// ───────── 흉내: 노션 ─────────
const rt = text => text ? [{ type: "text", plain_text: text, text: { content: text } }] : [];
function page(id, { title, date = null, tags = [], edited = "2026-10-10T00:00:00.000Z", created = "2026-10-01T01:00:00.000Z", trash = false }) {
  return {
    object: "page", id, url: `https://www.notion.so/${id}`, created_time: created, last_edited_time: edited, in_trash: trash,
    properties: {
      "이름": { type: "title", title: rt(title) },
      "날짜": { type: "date", date: date ? { start: date, end: null } : null },
      "태그": { type: "multi_select", multi_select: tags.map(name => ({ name })) },
    },
  };
}
let blockSeq = 0;
// children이 있으면 has_children=true, 노션처럼 하위 블록은 따로 요청해야 받는다.
function block(type, text, children = null) {
  return { object: "block", id: `b${++blockSeq}`, type, has_children: Boolean(children?.length), [type]: type === "divider" ? {} : { rich_text: rt(text) }, children };
}

// 노션 데이터(이 테스트 전용). 목록 응답은 2개씩, 블록 응답은 3개씩 나눠 페이지네이션을 확인한다.
function notionData() {
  blockSeq = 0;
  return {
    pages: [
      page("p1", { title: "스프린트 계획 회의", date: "2026-10-14", tags: ["회의록"] }),
      page("p2", { title: "마케팅 주간 회의", date: "2026-10-09", tags: ["회의록"] }),
      page("p3", { title: "인프라 이관 회의", date: "2026-10-12T10:00:00.000+09:00", tags: ["회의록"] }),
      page("p4", { title: "Weekly Sync", created: "2026-10-05T16:30:00.000Z" }),
      page("p5", { title: "휴지통에 버린 인프라 회의", date: "2026-10-15", trash: true }),
      page("p6", { title: "1:1 면담", date: "2026-10-13", tags: ["면담"] }),
    ],
    blocks: {
      p1: [
        block("heading_3", "📌 한 줄 요약"),
        block("divider", ""),
        block("bulleted_list_item", "온보딩 개선과 결제 오류 수정을 이번 스프린트 목표로 확정"),
        block("heading_3", "논의"),
        block("paragraph", "결제 모듈 리팩터링 일정 논의"),
        block("bulleted_list_item", "QA 일정", [block("bulleted_list_item", "인프라 점검은 다음 주", [block("paragraph", "담당은 운영팀")])]),
      ],
      p2: [
        block("heading_2", "공유"),
        block("paragraph", "지난주 지표 확인. 신규 랜딩 페이지 카피 검수 일정 공유. 인프라 비용 비교는 다음 회의에서 다시 보기로 함"),
      ],
      p3: [
        block("heading_3", "한 줄 요약"),
        block("bulleted_list_item", ""),
        block("paragraph", "서버 이관 일정은 10월 말로 확정"),
      ],
      p4: [block("paragraph", "API Gateway 설정 변경 리뷰")],
      p5: [block("paragraph", "보이면 안 되는 내용")],
      p6: [
        block("to_do", "인프라 계정 발급 요청"),
        block("quote", "다음 면담은 한 달 뒤"),
        block("toggle", "참고", [block("paragraph", "숨은 토글 속 문장")]),
        block("image", ""),
      ],
    },
  };
}

function mockNotion(data, { throttleFirst = false, failPage = null } = {}) {
  const calls = [];
  let throttle = throttleFirst;
  const childrenOf = id => {
    if (data.blocks[id]) return data.blocks[id];
    for (const list of Object.values(data.blocks)) {
      const stack = [...list];
      while (stack.length) {
        const item = stack.shift();
        if (item.id === id) return item.children || [];
        stack.push(...(item.children || []));
      }
    }
    return [];
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    calls.push(`${init.method || "GET"} ${url.pathname}`);
    assert.equal(url.origin, "https://api.notion.com");
    assert.equal(init.headers.Authorization, "Bearer secret_test_token");
    assert.ok(init.headers["Notion-Version"]);
    assert.ok(!init.method || init.method === "GET" || url.pathname.endsWith("/query"), "노션에 쓰기 요청 금지");
    if (throttle) { throttle = false; return new Response("{}", { status: 429, headers: { "Retry-After": "0" } }); }
    if (url.pathname === "/v1/data_sources/ds-test/query") {
      const body = JSON.parse(init.body || "{}");
      const start = Number(body.start_cursor || 0);
      const results = data.pages.slice(start, start + 2);
      const next = start + 2 < data.pages.length ? String(start + 2) : null;
      return Response.json({ object: "list", results, has_more: Boolean(next), next_cursor: next });
    }
    const match = url.pathname.match(/^\/v1\/blocks\/([^/]+)\/children$/);
    if (match) {
      if (match[1] === failPage) return new Response("{}", { status: 404 });
      const all = childrenOf(match[1]).map(({ children, ...item }) => item);
      const start = Number(url.searchParams.get("start_cursor") || 0);
      const next = start + 3 < all.length ? String(start + 3) : null;
      return Response.json({ object: "list", results: all.slice(start, start + 3), has_more: Boolean(next), next_cursor: next });
    }
    return new Response("{}", { status: 400 });
  };
  return calls;
}

const call = (env, path, { method = "GET", origin = ORIGIN } = {}) =>
  worker.fetch(new Request(`${BASE}${path}`, { method, headers: origin ? { Origin: origin } : {} }), env);
const search = async (env, q, w = KEY) => {
  const response = await call(env, `/search?q=${encodeURIComponent(q)}&w=${encodeURIComponent(w)}`);
  return { status: response.status, body: await response.json(), headers: response.headers };
};
const reindex = async env => (await call(env, `/reindex?w=${KEY}`, { method: "POST" })).json();
const marked = (text, ranges) => ranges.map(([from, to]) => text.slice(from, to));

test("w 키가 없거나 틀리면 403, 결과 내용은 돌려주지 않고 노션에도 요청하지 않는다", async () => {
  const kv = fakeKV();
  const env = makeEnv(kv);
  const calls = mockNotion(notionData());
  await reindex(env);
  for (const w of ["", "w_wrong", KEY.slice(0, -1) + "x", KEY + "x"]) {
    const result = await search(env, "인프라", w);
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { ok: false, error: "forbidden" });
  }
  const before = calls.length;
  const denied = await call(env, "/reindex?w=nope", { method: "POST" });
  assert.equal(denied.status, 403);
  assert.equal(calls.length, before);
  // ALLOWED_W가 비어 있으면 아무도 허용하지 않는다.
  assert.equal((await search(makeEnv(kv, { ALLOWED_W: "" }), "인프라", "")).status, 403);
});

test("색인: 페이지네이션·하위 블록까지 읽고, 휴지통 페이지는 빼고, 날짜는 날짜 속성(없으면 만든 날 한국 시간)", async () => {
  const kv = fakeKV();
  const env = makeEnv(kv);
  mockNotion(notionData());
  const stats = await reindex(env);
  assert.deepEqual([stats.ok, stats.total, stats.indexed, stats.pending, stats.removed], [true, 5, 5, 0, 0]);
  const index = JSON.parse(kv.map.get("index:v1"));
  const byId = Object.fromEntries(index.pages.map(item => [item.id, item]));
  assert.equal(byId.p5, undefined, "휴지통 페이지 제외");
  assert.equal(byId.p1.summary, "온보딩 개선과 결제 오류 수정을 이번 스프린트 목표로 확정", "구분선은 건너뛰고 제목 아래 첫 텍스트 블록");
  assert.match(byId.p1.body, /인프라 점검은 다음 주\n담당은 운영팀/, "하위 블록의 하위 블록까지");
  assert.equal(byId.p3.summary, "", "한 줄 요약 아래가 비어 있으면 빈 값");
  assert.equal(byId.p2.summary, "", "한 줄 요약 제목이 없으면 빈 값");
  assert.match(byId.p6.body, /인프라 계정 발급 요청\n다음 면담은 한 달 뒤\n참고\n숨은 토글 속 문장/, "체크리스트·인용·토글 하위");
  assert.equal(byId.p3.date, "2026-10-12");
  assert.equal(byId.p4.date, "2026-10-06", "날짜 속성이 없으면 만든 날(한국 시간)");
  assert.deepEqual(byId.p6.tags, ["면담"]);
  assert.equal(byId.p1.url, "https://www.notion.so/p1");
});

test("검색: 제목+본문, 날짜 최신순, 한 줄 요약이 있으면 요약·없으면 검색어 문장", async () => {
  const env = makeEnv(fakeKV());
  mockNotion(notionData());
  await reindex(env);
  const { status, body } = await search(env, "인프라");
  assert.equal(status, 200);
  assert.equal(body.total, 4);
  assert.deepEqual(body.results.map(item => item.date), ["2026-10-14", "2026-10-13", "2026-10-12", "2026-10-09"], "날짜 최신순");
  const [p1, p6, p3, p2] = body.results;
  assert.equal(p1.title, "스프린트 계획 회의");
  assert.equal(p1.line, "온보딩 개선과 결제 오류 수정을 이번 스프린트 목표로 확정", "한 줄 요약이 있으면 요약");
  assert.deepEqual(p1.lineMatches, []);
  assert.equal(p6.line, "인프라 계정 발급 요청 다음 면담은 한 달 뒤 참고 숨은 토글 속 문장");
  assert.deepEqual(marked(p6.line, p6.lineMatches), ["인프라"]);
  assert.deepEqual(marked(p3.title, p3.titleMatches), ["인프라"], "제목에서 찾은 위치");
  assert.equal(p3.line, "서버 이관 일정은 10월 말로 확정", "요약이 비어 있고 본문에 검색어가 없으면 본문 첫 문장(제목 블록 제외)");
  assert.equal(p2.line.startsWith("…인프라 비용 비교는"), true, "찾은 문장 시작부터, 앞이 잘렸으면 …");
  assert.ok(p2.line.length <= 92);
  assert.deepEqual(marked(p2.line, p2.lineMatches), ["인프라"]);
  assert.equal(p2.url, "https://www.notion.so/p2");
  assert.ok(!JSON.stringify(body).includes("보이면 안 되는 내용"), "휴지통 페이지는 검색되지 않음");
});

test("검색: 제목에만 있는 경우 / 본문에만 있는 경우", async () => {
  const env = makeEnv(fakeKV());
  mockNotion(notionData());
  await reindex(env);
  const titleOnly = (await search(env, "이관 회의")).body.results;
  assert.deepEqual(titleOnly.map(item => item.title), ["인프라 이관 회의"]);
  assert.deepEqual(marked(titleOnly[0].title, titleOnly[0].titleMatches), ["이관 회의"]);
  const bodyOnly = (await search(env, "카피 검수")).body.results;
  assert.deepEqual(bodyOnly.map(item => item.title), ["마케팅 주간 회의"]);
  assert.deepEqual(bodyOnly[0].titleMatches, []);
  assert.deepEqual(marked(bodyOnly[0].line, bodyOnly[0].lineMatches), ["카피 검수"]);
  assert.ok(bodyOnly[0].line.startsWith("…신규 랜딩 페이지"), "찾은 문장 시작부터");
  assert.deepEqual((await search(env, "없는단어")).body, { ok: true, results: [], total: 0 });
  assert.deepEqual((await search(env, "   ")).body, { ok: true, results: [], total: 0 });
});

test("검색: 대소문자·공백 차이를 무시하고 원문 위치로 표시", async () => {
  const env = makeEnv(fakeKV());
  mockNotion(notionData());
  await reindex(env);
  const results = (await search(env, "api gate way")).body.results;
  assert.equal(results.length, 1);
  assert.deepEqual(marked(results[0].line, results[0].lineMatches), ["API Gateway"]);
  const spaced = (await search(env, "스프린트계획")).body.results;
  assert.deepEqual(marked(spaced[0].title, spaced[0].titleMatches), ["스프린트 계획"]);
  const many = (await search(env, "회의")).body.results;
  assert.ok(many.every(item => marked(item.title, item.titleMatches).every(text => text === "회의")));
});

test("결과는 최대 20건, total에는 전체 개수", async () => {
  const data = { pages: [], blocks: {} };
  for (let day = 1; day <= 25; day += 1) {
    const id = `m${day}`;
    data.pages.push(page(id, { title: `정기 회의 ${day}`, date: `2026-09-${String(day).padStart(2, "0")}` }));
    data.blocks[id] = [block("paragraph", "안건 정리")];
  }
  const env = makeEnv(fakeKV(), { MAX_NOTION_REQUESTS: "100" });
  mockNotion(data);
  await reindex(env);
  const { body } = await search(env, "정기");
  assert.equal(body.total, 25);
  assert.equal(body.results.length, 20);
  assert.equal(body.results[0].date, "2026-09-25");
  assert.equal(body.results[19].date, "2026-09-06");
});

test("다시 갱신할 때 last_edited_time이 바뀐 페이지만 본문을 다시 읽고, 삭제·보관된 페이지는 제거", async () => {
  const kv = fakeKV();
  const env = makeEnv(kv);
  const data = notionData();
  const calls = mockNotion(data);
  await reindex(env);
  calls.length = 0;
  const same = await reindex(env);
  assert.deepEqual(calls, ["POST /v1/data_sources/ds-test/query", "POST /v1/data_sources/ds-test/query", "POST /v1/data_sources/ds-test/query"], "바뀐 게 없으면 목록만");
  assert.equal(same.saved, false);
  assert.equal(kv.puts, 1, "바뀐 게 없으면 KV에 다시 쓰지 않음");
  // p2 내용 수정, p6 삭제, p4 보관
  data.pages[1].last_edited_time = "2026-10-15T01:00:00.000Z";
  data.blocks.p2 = [block("paragraph", "랜딩 페이지 문구 최종 확정")];
  data.pages = data.pages.filter(item => item.id !== "p6");
  data.pages.find(item => item.id === "p4").in_trash = true;
  calls.length = 0;
  const stats = await reindex(env);
  assert.deepEqual(calls.filter(entry => entry.includes("/blocks/")), ["GET /v1/blocks/p2/children"], "바뀐 페이지만 다시 읽음");
  assert.deepEqual([stats.total, stats.indexed, stats.removed], [3, 1, 2]);
  assert.equal((await search(env, "최종 확정")).body.results[0].title, "마케팅 주간 회의");
  assert.equal((await search(env, "카피 검수")).body.total, 0, "예전 본문은 사라짐");
  assert.equal((await search(env, "면담")).body.total, 0, "삭제된 페이지 제거");
  assert.equal((await search(env, "gateway")).body.total, 0, "보관된 페이지 제거");
});

test("429 응답은 기다렸다가 다시 시도", async () => {
  const env = makeEnv(fakeKV());
  const calls = mockNotion(notionData(), { throttleFirst: true });
  const stats = await reindex(env);
  assert.equal(stats.total, 5);
  assert.equal(calls[0], calls[1], "같은 요청을 다시 보냄");
});

test("요청 수 상한에 걸리면 최근 날짜부터 읽고, 나머지는 다음 실행(크론)에서 이어 읽는다", async () => {
  const kv = fakeKV();
  const env = makeEnv(kv, { MAX_NOTION_REQUESTS: "8" });
  mockNotion(notionData());
  const first = await reindex(env);
  assert.equal(first.total, 5);
  assert.ok(first.pending > 0 && first.indexed > 0);
  assert.equal((await search(env, "Weekly")).body.total, 1, "본문을 아직 못 읽은 페이지도 제목으로는 찾음");
  const index = JSON.parse(kv.map.get("index:v1"));
  assert.equal(index.pages.find(item => item.id === "p1").edited, "2026-10-10T00:00:00.000Z", "가장 최근 날짜(p1)부터 읽음");
  // 크론으로 이어서
  for (let run = 0; run < 5; run += 1) {
    const waits = [];
    await worker.scheduled({ cron: "*/30 * * * *" }, env, { waitUntil: promise => waits.push(promise) });
    await Promise.all(waits);
  }
  const done = JSON.parse(kv.map.get("index:v1"));
  assert.equal(done.complete, true);
  assert.equal((await search(env, "api gateway")).body.total, 1);
});

test("연동이 못 읽는 페이지(404)는 건너뛰고 나머지는 색인", async () => {
  const env = makeEnv(fakeKV());
  mockNotion(notionData(), { failPage: "p2" });
  const stats = await reindex(env);
  assert.deepEqual([stats.total, stats.indexed, stats.pending], [5, 4, 1]);
});

test("CORS는 https://kjm9954.github.io 출처만 허용", async () => {
  const env = makeEnv(fakeKV());
  mockNotion(notionData());
  await reindex(env);
  const allowedResponse = await search(env, "회의");
  assert.equal(allowedResponse.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const other = await call(env, `/search?q=a&w=${KEY}`, { origin: "https://evil.example" });
  assert.equal(other.headers.get("Access-Control-Allow-Origin"), null);
  const preflight = await call(env, "/search", { method: "OPTIONS" });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal((await call(env, "/nope")).status, 404);
});

test("토큰이 없거나 노션 연결이 안 되면 오류만 알리고 키·토큰은 응답에 없다", async () => {
  const kv = fakeKV();
  const missing = await call(makeEnv(kv, { NOTION_TOKEN: "" }), `/reindex?w=${KEY}`, { method: "POST" });
  assert.equal(missing.status, 502);
  globalThis.fetch = async () => new Response("{}", { status: 401 });
  const denied = await call(makeEnv(kv), `/reindex?w=${KEY}`, { method: "POST" });
  const text = await denied.text();
  assert.equal(denied.status, 502);
  assert.deepEqual(JSON.parse(text), { ok: false, error: "notion connection" });
  assert.ok(!text.includes(KEY) && !text.includes("secret_test_token"));
  assert.equal(kv.puts, 0, "실패하면 색인을 덮어쓰지 않음");
});
