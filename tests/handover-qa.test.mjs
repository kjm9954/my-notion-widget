import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import worker from "../worker.js";

const root = fileURLToPath(new URL("..", import.meta.url));

const KEY = "qa_test_ACTIVE_0123456789abcdefghijklmnop";
const READONLY = "qa_test_READONLY_0123456789abcdefghijklmn";
const REVOKED = "qa_test_REVOKED_0123456789abcdefghijklmno";
const UNKNOWN = "qa_test_UNKNOWN_0123456789abcdefghijklmno";

// D1 의 prepare/bind/first/all/run/batch 를 node:sqlite 로 흉내 낸다.
function fakeD1(db) {
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args), meta: {} }; },
    async run() { return statement(sql, args).execute(); },
    execute() {
      const prepared = db.prepare(sql);
      if (/^\s*select\b/i.test(sql)) return { results: prepared.all(...args), meta: { changes: 0 } };
      const result = prepared.run(...args);
      return { results: [], meta: { changes: Number(result.changes) } };
    },
  });
  return {
    prepare: sql => statement(sql),
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = statements.map(s => s.execute());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function fakeKV() {
  const map = new Map();
  return {
    map,
    async put(key, value, options) { map.set(key, { value, metadata: options?.metadata || null }); },
    async get(key) { return map.get(key)?.value ?? null; },
    async getWithMetadata(key) {
      const entry = map.get(key);
      return entry ? { value: entry.value, metadata: entry.metadata } : { value: null, metadata: null };
    },
  };
}

async function makeEnv() {
  const db = new DatabaseSync(":memory:");
  for (const name of ["0005_handover_qa.sql", "0006_qa_room_access.sql", "0007_qa_images.sql", "0008_qa_room_config.sql"]) {
    db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  const insert = db.prepare(`INSERT INTO qa_rooms (room, revision, updated_at, status) VALUES (?, 0, 0, ?)`);
  insert.run(KEY, "active");
  insert.run(READONLY, "readonly");
  insert.run(REVOKED, "revoked");
  return { DB: fakeD1(db), KV: fakeKV(), db };
}

async function call(env, method, path, { key = KEY, json, bytes, type, legacyRoom } = {}) {
  const headers = {};
  if (key && !legacyRoom) headers.Authorization = `Bearer ${key}`;
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (bytes !== undefined) { headers["Content-Type"] = type; body = bytes; }
  const url = new URL(`https://worker.example${path}`);
  if (legacyRoom) url.searchParams.set("room", key);
  const response = await worker.fetch(new Request(url, { method, headers, body }), env, { waitUntil() {} });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}

const op = (env, payload, options) => call(env, "POST", "/api/qa/op", { json: payload, ...options });

function newThread(id, who, title, extra = {}) {
  return {
    id,
    cat1: "대분류",
    cat2: "소분류",
    guide: "",
    title,
    status: "대기",
    read: { [who]: true, 상대: false },
    messages: [{ who, at: Date.now(), images: [], text: `${title} 본문` }],
    ...extra,
  };
}

test("등록되지 않았거나 차단된 키는 401, 읽기 전용 키로 쓰면 403", async () => {
  const env = await makeEnv();
  assert.equal((await call(env, "GET", "/api/qa/revision", { key: "" })).status, 401);
  assert.equal((await call(env, "GET", "/api/qa/revision", { key: "qa_short" })).status, 401);
  assert.equal((await call(env, "GET", "/api/qa/revision", { key: UNKNOWN })).status, 401);
  assert.equal((await call(env, "GET", "/api/qa/revision", { key: REVOKED })).status, 401);

  const readonly = await call(env, "GET", "/api/qa/index", { key: READONLY });
  assert.equal(readonly.status, 200);
  assert.equal(readonly.data.data.access, "read");
  assert.equal((await op(env, { type: "create", thread: newThread("t1", "가", "제목") }, { key: READONLY })).status, 403);
  assert.equal((await op(env, { type: "create", thread: newThread("t1", "가", "제목") }, { key: UNKNOWN })).status, 401);
  // 모르는 키로는 방이 새로 생기지 않는다
  const rooms = env.db.prepare(`SELECT COUNT(*) AS n FROM qa_rooms`).get();
  assert.equal(rooms.n, 3);
});

test("질문 생성·메시지·상태·읽음이 반영되고 리비전 기반 동기화가 누락 없이 이어진다", async () => {
  const env = await makeEnv();
  const created = await op(env, { type: "create", thread: newThread("t1", "질문자", "한글 제목 확인") });
  assert.equal(created.status, 200);
  assert.equal(created.data.data.thread.title, "한글 제목 확인");
  assert.equal(created.data.data.revision, 1);

  const full = await call(env, "GET", "/api/qa/state?since=0");
  assert.equal(full.data.data.threads.length, 1);
  assert.equal(full.data.data.since, 1);

  const message = await op(env, {
    type: "message",
    threadId: "t1",
    message: { who: "답변자", text: "1. 첫째\n2. 둘째", images: [], clientId: "c1" },
    status: "답변됨",
    read: { 답변자: true, 질문자: false },
  });
  const thread = message.data.data.thread;
  assert.equal(thread.status, "답변됨");
  assert.deepEqual(thread.read, { 답변자: true, 질문자: false });
  assert.equal(thread.messages.at(-1).text, "1. 첫째\n2. 둘째");
  assert.match(thread.messages.at(-1).date, /^\d+월 \d+일 .요일$/);

  const status = await op(env, { type: "status", threadId: "t1", status: "확인완료", who: "질문자" });
  assert.match(status.data.data.thread.messages.at(-1).text, /^— 질문자님이 확인완료로 변경 · /);
  const read = await op(env, { type: "read", threadId: "t1", who: "질문자" });
  assert.equal(read.data.data.thread.read.질문자, true);

  const delta = await call(env, "GET", "/api/qa/state?since=1");
  assert.equal(delta.data.data.threads.length, 1);
  assert.equal(delta.data.data.since, 4);
  const none = await call(env, "GET", "/api/qa/state?since=4");
  assert.equal(none.data.data.threads.length, 0);
  // 이전 클라이언트가 시각 값을 since 로 보내면 전체 동기화로 받아 준다
  const legacy = await call(env, "GET", "/api/qa/state?since=1789650806955", { legacyRoom: true });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.data.data.threads.length, 1);
  assert.equal(legacy.data.data.since, 4);

  const one = await call(env, "GET", "/api/qa/thread?id=t1");
  assert.equal(one.data.data.thread.messages.length, 3);
  assert.equal((await call(env, "GET", "/api/qa/thread?id=nope")).status, 404);
});

test("거의 동시에 만든 질문이 모두 목록에 남고, 목록은 최근 활동순 요약을 준다", async () => {
  const env = await makeEnv();
  const results = await Promise.all([
    op(env, { type: "create", thread: newThread("a1", "질문자", "첫 번째 질문") }),
    op(env, { type: "create", thread: newThread("b1", "답변자", "두 번째 질문") }),
    op(env, { type: "create", thread: newThread("c1", "질문자", "세 번째 질문") }),
  ]);
  results.forEach(r => assert.equal(r.status, 200));
  const index = await call(env, "GET", "/api/qa/index");
  const items = index.data.data.items;
  assert.deepEqual(items.map(i => i.id).sort(), ["a1", "b1", "c1"]);
  assert.equal(index.data.data.revision, 3);
  const b1 = items.find(i => i.id === "b1");
  assert.equal(b1.author, "답변자");
  assert.equal(b1.replies, 0);
  assert.ok(!("messages" in b1));
  assert.ok(items[0].lastAt >= items[1].lastAt && items[1].lastAt >= items[2].lastAt);
});

test("같은 id 재등록과 같은 clientId 재전송은 중복을 만들지 않는다", async () => {
  const env = await makeEnv();
  await op(env, { type: "create", thread: newThread("t1", "질문자", "원래 제목") });
  const again = await op(env, { type: "create", thread: newThread("t1", "질문자", "다른 제목") });
  assert.equal(again.data.data.duplicate, true);
  assert.equal(again.data.data.thread.title, "원래 제목");
  const message = { who: "답변자", text: "한 번만", images: [], clientId: "same" };
  await op(env, { type: "message", threadId: "t1", message });
  const repeat = await op(env, { type: "message", threadId: "t1", message });
  assert.equal(repeat.data.data.unchanged, true);
  assert.equal(repeat.data.data.thread.messages.length, 2);
});

test("이미지는 D1에 조각으로 저장되고, 올린 방 키로만 읽을 수 있으며 형식과 크기를 검사한다", async () => {
  const env = await makeEnv();
  env.DB.prepare(`INSERT INTO qa_rooms (room, revision, updated_at, status) VALUES (?, 0, 0, 'active')`)
    .bind(UNKNOWN).run();

  // 조각 두 개 이상으로 나뉘는 크기(원본 600KB → base64 800KB)
  const big = new Uint8Array(600 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) % 256;
  const bigBase64 = Buffer.from(big).toString("base64");
  const uploaded = await call(env, "POST", "/api/qa/image", { json: { type: "image/jpeg", data: bigBase64 } });
  assert.equal(uploaded.status, 201);
  const id = uploaded.data.data.id;
  assert.equal(uploaded.data.data.size, big.length);
  const rows = env.db.prepare(`SELECT part, parts FROM qa_images WHERE id = ? ORDER BY part`).all(id);
  assert.ok(rows.length >= 2, "여러 행으로 나뉘어야 한다");
  assert.ok(rows.every(row => row.parts === rows.length));
  assert.equal(env.KV.map.size, 0, "KV 에는 쓰지 않는다");

  const own = await call(env, "GET", `/api/qa/image?id=${encodeURIComponent(id)}`);
  assert.equal(own.status, 200);
  assert.equal(own.data.data.type, "image/jpeg");
  assert.equal(own.data.data.data, bigBase64);
  assert.equal((await call(env, "GET", `/api/qa/image?id=${encodeURIComponent(id)}`, { key: UNKNOWN })).status, 404);

  // 이전 클라이언트의 바이트 업로드도 받는다
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const legacy = await call(env, "POST", "/api/qa/image", { bytes: jpeg, type: "image/jpeg" });
  assert.equal(legacy.status, 201);
  const legacyImage = await call(env, "GET", `/api/qa/image?id=${encodeURIComponent(legacy.data.data.id)}`);
  assert.equal(legacyImage.data.data.data, Buffer.from(jpeg).toString("base64"));

  assert.equal((await call(env, "POST", "/api/qa/image", { bytes: new Uint8Array([1]), type: "text/plain" })).status, 415);
  assert.equal((await call(env, "POST", "/api/qa/image", { json: { type: "image/png", data: "not base64!" } })).status, 400);
  assert.equal((await call(env, "POST", "/api/qa/image", { json: { type: "image/png", data: "" } })).status, 400);
  const tooBig = Buffer.alloc(4 * 1024 * 1024 + 3).toString("base64");
  assert.equal((await call(env, "POST", "/api/qa/image", { json: { type: "image/png", data: tooBig } })).status, 413);
  // data: URL 이나 외부 주소는 메시지 이미지로 저장하지 않는다
  await op(env, { type: "create", thread: newThread("t1", "질문자", "이미지 질문") });
  const bad = await op(env, { type: "message", threadId: "t1", message: { who: "질문자", text: "", images: ["url(\"data:image/png;base64,AA\")"] } });
  assert.equal(bad.status, 400);
  const good = await op(env, { type: "message", threadId: "t1", message: { who: "질문자", text: "", images: [id] } });
  assert.deepEqual(good.data.data.thread.messages.at(-1).images, [id]);
});

test("CORS 가 Authorization 헤더를 허용하고 사전 요청을 캐시한다", async () => {
  const env = await makeEnv();
  const response = await worker.fetch(new Request("https://worker.example/api/qa/index", { method: "OPTIONS" }), env, {});
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /Authorization/);
  assert.equal(response.headers.get("Access-Control-Max-Age"), "86400");
});

test("방 설정은 접근 키로만 읽고, 쓰기 키로 모양을 검사해 저장한다", async () => {
  const env = await makeEnv();
  const empty = await call(env, "GET", "/api/qa/config");
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.data.data.config, {});

  const config = {
    users: [{ name: "가", role: "answerer", desc: "답하는 사람" }, { name: "나", role: "asker" }],
    categories: [{ major: "큰 분류", minors: ["작은 분류"] }],
    text: { add: { titlePlaceholder: "예시 제목" } },
  };
  const saved = await call(env, "POST", "/api/qa/config", { json: config });
  assert.equal(saved.status, 200);
  assert.deepEqual((await call(env, "GET", "/api/qa/config")).data.data.config, config);

  assert.equal((await call(env, "GET", "/api/qa/config", { key: "" })).status, 401);
  assert.equal((await call(env, "GET", "/api/qa/config", { key: UNKNOWN })).status, 401);
  assert.equal((await call(env, "GET", "/api/qa/config", { key: REVOKED })).status, 401);
  // 읽기 전용 키는 자기 방 설정만 읽고, 쓸 수는 없다
  const readonly = await call(env, "GET", "/api/qa/config", { key: READONLY });
  assert.equal(readonly.status, 200);
  assert.deepEqual(readonly.data.data.config, {});
  assert.equal((await call(env, "POST", "/api/qa/config", { key: READONLY, json: config })).status, 403);

  const invalid = [
    [],
    { users: [], categories: config.categories },
    { users: [{ name: "가", role: "boss" }], categories: config.categories },
    { users: [{ name: "가", role: "asker" }, { name: "가", role: "asker" }], categories: config.categories },
    { users: config.users, categories: [{ major: "큰 분류" }, { major: "큰 분류" }] },
    { users: config.users, categories: [{ major: "큰 분류", minors: [""] }] },
    { users: config.users, categories: config.categories, text: "문구" },
  ];
  for (const bad of invalid) {
    assert.equal((await call(env, "POST", "/api/qa/config", { json: bad })).status, 400, JSON.stringify(bad));
  }
  // 소분류 없이 대분류만 있는 설정도 받는다
  const majorsOnly = { users: config.users, categories: [{ major: "큰 분류" }, { major: "다른 분류", minors: [] }] };
  assert.equal((await call(env, "POST", "/api/qa/config", { json: majorsOnly })).status, 200);
  assert.deepEqual((await call(env, "GET", "/api/qa/config")).data.data.config, majorsOnly);
  assert.equal((await call(env, "POST", "/api/qa/config", { json: config })).status, 200);
  const huge = { ...config, text: { add: { titlePlaceholder: "x".repeat(40000) } } };
  assert.equal((await call(env, "POST", "/api/qa/config", { json: huge })).status, 413);
  assert.deepEqual((await call(env, "GET", "/api/qa/config")).data.data.config, config);
});

test("공개 파일에는 이름·카테고리가 없고, 비공개 설정과 샘플은 저장소에 올라가지 않는다", async t => {
  const publicSource = await readFile(new URL("../handover-qa/qa-config.js", import.meta.url), "utf8");
  const sandbox = {};
  new Function("window", publicSource)(sandbox);
  const publicConfig = sandbox.QA_CONFIG;
  assert.deepEqual(publicConfig.users, []);
  assert.deepEqual(publicConfig.categories, []);

  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(gitignore, /^handover-qa\/private\/$/m);
  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  assert.ok(!tracked.some(file => file.startsWith("handover-qa/private/")), "비공개 폴더가 추적되면 안 된다");
  assert.ok(!tracked.includes("handover-qa/qa-sample.js"), "샘플은 비공개 폴더로 옮겼다");

  // 이 컴퓨터에 비공개 설정이 있으면, 공개되는 Q&A 파일에 그 단어가 없는지 확인한다.
  let privateConfig = null;
  try {
    privateConfig = JSON.parse(await readFile(new URL("../handover-qa/private/qa-config.private.json", import.meta.url), "utf8"));
  } catch {
    privateConfig = null;
  }
  if (!privateConfig) {
    t.diagnostic("비공개 설정 파일이 없어 단어 검사를 건너뜀");
    return;
  }
  const words = [
    ...privateConfig.users.map(user => user.name),
    ...privateConfig.categories.flatMap(category => [category.major, ...(category.minors || [])]),
  ];
  assert.ok(words.length >= 4);
  const files = tracked.filter(file =>
    file.startsWith("handover-qa/") || file === "worker.js" || file === "tests/handover-qa.test.mjs" || /^migrations\/000[5-9]/.test(file));
  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    for (const word of words) assert.ok(!source.includes(word), `${file} 에 비공개 단어가 있다: ${word}`);
  }
});

test("두 위젯은 임베드 폭을 채우고, w 값으로만 같은 방식으로 최대 폭을 정한다", async () => {
  const storeSource = await readFile(new URL("../handover-qa/qa-store.js", import.meta.url), "utf8");
  const addSource = await readFile(new URL("../handover-qa/add.html", import.meta.url), "utf8");
  const listSource = await readFile(new URL("../handover-qa/index.html", import.meta.url), "utf8");
  assert.match(storeSource, /function applyFrameWidth/);
  for (const source of [addSource, listSource]) {
    assert.match(source, /S\.applyFrameWidth\(\)/);
    assert.match(source, /max-width:var\(--qa-max-width,none\)/);
    assert.doesNotMatch(source, /max-width:600px/);
  }
});

test("질문형 위젯은 키를 주소 해시에서만 읽고 헤더로만 보내며 기록하지 않는다", async () => {
  const storeSource = await readFile(new URL("../handover-qa/qa-store.js", import.meta.url), "utf8");
  const addSource = await readFile(new URL("../handover-qa/add.html", import.meta.url), "utf8");
  assert.match(storeSource, /location\.hash/);
  assert.match(storeSource, /Authorization/);
  assert.match(storeSource, /cache: 'no-store'/);
  assert.doesNotMatch(storeSource, /console\./);
  assert.doesNotMatch(addSource, /console\./);
  assert.doesNotMatch(addSource, /location\.(search|hash)/);
  assert.match(addSource, /<script src="qa-config\.js(\?v=[\w-]+)?"><\/script>/);
  assert.match(addSource, /<script src="qa-store\.js(\?v=[\w-]+)?"><\/script>/);
  // 방 키를 요청 주소에 싣지 않는다
  assert.doesNotMatch(storeSource, /searchParams\.set\('room'/);
});
