import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../store.js", import.meta.url), "utf8");

test("업무일지는 입력 포커스 중에도 외부 동기화를 허용할 수 있다", () => {
  assert.match(source,/function watch\(callback, interval = 3000, options = \{\}\)/);
  assert.match(source,/!allowWhileEditing && active/);
});

test("노션 페이지 캐시 복원 시 공통 감시를 유지하고 즉시 다시 조회한다", () => {
  assert.match(source,/window\.addEventListener\("pageshow", run\)/);
  assert.match(source,/if \(!event\.persisted\) stop\(\)/);
  assert.match(source,/const initialTimer = options\?\.initial === false \? null : setTimeout\(run, 0\)/);
});

test("독서 응답의 fetchedAt만 바뀌면 외부 변경으로 다시 알리지 않는다", () => {
  assert.match(source,/function comparablePayload\(path, serialized\)/);
  assert.match(source,/path\.startsWith\("\/api\/reading\/library"\)/);
  assert.match(source,/comparablePayload\(path, cached\.serialized\) !== comparablePayload\(path, serialized\)/);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function createStore(fetchImpl, persisted = new Map()) {
  const intervalCallbacks = [];
  const cacheApi = {
    async open() {
      return {
        async match(url) {
          return persisted.has(String(url)) ? new Response(persisted.get(String(url))) : undefined;
        },
        async put(url, response) {
          persisted.set(String(url), await response.text());
        },
        async delete(url) {
          return persisted.delete(String(url));
        },
      };
    },
  };
  const window = {
    location: { search: "?w=w_abcdefghijklmnopqrstuvwx", hash: "" },
    caches: cacheApi,
    addEventListener() {},
    removeEventListener() {},
  };
  const document = {
    hidden: false,
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
  };
  class BroadcastChannel {
    addEventListener() {}
    postMessage() {}
  }
  const context = {
    window,
    document,
    caches: cacheApi,
    BroadcastChannel,
    URL,
    URLSearchParams,
    Response,
    structuredClone,
    fetch: fetchImpl,
    setInterval: callback => { intervalCallbacks.push(callback); return intervalCallbacks.length; },
    clearInterval() {},
    setTimeout,
  };
  vm.runInNewContext(source, context);
  window.Store.__runIntervals = () => intervalCallbacks.forEach(callback => callback());
  return window.Store;
}

test("독서 감시는 내용이 달라질 때만 위젯 렌더를 호출한다", async () => {
  let title = "원씽";
  let fetchedAt = 0;
  const store = createStore(async () => Response.json({
    ok:true,
    data:{ books:[{ id:"book-1", title }], quotes:[], fetchedAt:String(++fetchedAt) },
  }));
  let renders = 0;
  store.watchReadingLibrary(() => { renders += 1; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(renders, 1);

  store.__runIntervals();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(renders, 1);

  title = "원씽 개정";
  store.__runIntervals();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(renders, 2);
});

test("저장된 응답은 다음 위젯 진입에서 느린 서버보다 먼저 표시된다", async () => {
  const persisted = new Map();
  const firstStore = createStore(async () => Response.json({ ok: true, data: { revision: 1 } }), persisted);
  assert.equal((await firstStore.loadWorklogState()).revision, 1);
  await new Promise(resolve => setTimeout(resolve, 0));

  const slow = deferred();
  const nextStore = createStore(() => slow.promise, persisted);
  const cached = await Promise.race([
    nextStore.loadWorklogState(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("캐시 표시 시간 초과")), 500)),
  ]);
  assert.equal(cached.revision, 1);

  slow.resolve(Response.json({ ok: true, data: { revision: 2 } }));
  await new Promise(resolve => setTimeout(resolve, 0));
});

test("동시에 들어온 동일 조회는 서버 요청 한 번으로 합친다", async () => {
  const response = deferred();
  let requests = 0;
  const store = createStore(() => {
    requests += 1;
    return response.promise;
  });

  const first = store.loadWorklogState();
  const second = store.loadWorklogState();
  assert.equal(requests, 1);

  response.resolve(Response.json({ ok: true, data: { revision: 3 } }));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.revision, 3);
  assert.equal(b.revision, 3);
});
