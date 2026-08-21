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

function createStore(fetchImpl, persisted = new Map(), options = {}) {
  const intervalCallbacks = [];
  const instanceStorage = options.instanceStorage || new Map();
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
    location: {
      search: options.search ?? "?w=w_abcdefghijklmnopqrstuvwx",
      hash: "",
      href: options.href ?? "https://kjm9954.github.io/my-notion-widget/growth-page/record.html",
      replace(url) { options.onReplace?.(String(url)); },
      reload() {},
    },
    localStorage: {
      getItem(key) { return instanceStorage.has(key) ? instanceStorage.get(key) : null; },
      setItem(key, value) { instanceStorage.set(key, String(value)); },
      removeItem(key) { instanceStorage.delete(key); },
    },
    caches: cacheApi,
    addEventListener() {},
    removeEventListener() {},
  };
  const document = {
    referrer: "https://www.notion.so/work-log-page",
    hidden: false,
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
  };
  const BroadcastChannel = options.BroadcastChannel || class {
    addEventListener() {}
    postMessage() {}
  };
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
    clearTimeout,
  };
  vm.runInNewContext(source, context);
  window.Store.__runIntervals = () => intervalCallbacks.forEach(callback => callback());
  return window.Store;
}

test("같은 노션 페이지의 기존 무키 위젯도 저장된 개인 인스턴스를 이어 쓴다", async () => {
  const instanceStorage = new Map();
  const instanceId = "w_abcdefghijklmnopqrstuvwxyz123456";
  const seeded = createStore(async () => Response.json({ ok:true, data:{} }), new Map(), {
    search:`?w=${instanceId}`,
    instanceStorage,
  });
  assert.equal(seeded.getWidgetInstanceId(), instanceId);
  assert.equal(instanceStorage.get("notion-widget-instance-v1"), instanceId);

  let requestedUrl = "";
  const inherited = createStore(async url => {
    requestedUrl = String(url);
    return Response.json({ ok:true, data:{ revision:7, tasks:[] } });
  }, new Map(), { search:"", instanceStorage });
  assert.equal(inherited.getWidgetInstanceId(), instanceId);
  assert.equal((await inherited.loadWorklogState()).revision, 7);
  assert.equal(new URL(requestedUrl).searchParams.get("w"), instanceId);
});

test("성장 기록은 Worklog 전용 키만 이어 쓰고 다른 데이터 인스턴스는 바꾸지 않는다", async () => {
  const persisted = new Map();
  const instanceId = "w_abcdefghijklmnopqrstuvwxyz123456";
  createStore(async () => Response.json({ ok:true, data:{} }), persisted, {
    search:`?w=${instanceId}`,
    href:`https://kjm9954.github.io/my-notion-widget/Worklog/worklog.html?w=${instanceId}`,
    instanceStorage:new Map(),
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  const requestedUrls = [];
  const inherited = createStore(async url => {
    requestedUrls.push(String(url));
    return Response.json({ ok:true, data:{ revision:11, tasks:[] } });
  }, persisted, {
    search:"",
    instanceStorage:new Map(),
  });

  assert.equal((await inherited.loadWorklogState()).revision, 11);
  await inherited.loadStatsSettings();
  assert.equal(inherited.getWidgetInstanceId(), null);
  assert.equal(new URL(requestedUrls[0]).searchParams.get("w"), instanceId);
  assert.equal(new URL(requestedUrls[1]).searchParams.has("w"), false);
});

test("저장소가 막혀도 같은 페이지의 위젯끼리 개인 인스턴스를 전달한다", () => {
  const listeners = new Map();
  class SharedBroadcastChannel {
    constructor(name) {
      this.name = name;
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(this);
    }
    addEventListener(type, callback) {
      if (type === "message") this.callback = callback;
    }
    postMessage(data) {
      listeners.get(this.name)?.forEach(channel => {
        if (channel !== this) channel.callback?.({ data });
      });
    }
  }

  const instanceId = "w_abcdefghijklmnopqrstuvwxyz123456";
  let replacedUrl = "";
  createStore(async () => Response.json({ ok:true, data:{} }), new Map(), {
    search:"",
    BroadcastChannel:SharedBroadcastChannel,
    onReplace:url => { replacedUrl = url; },
  });
  createStore(async () => Response.json({ ok:true, data:{} }), new Map(), {
    search:`?w=${instanceId}`,
    BroadcastChannel:SharedBroadcastChannel,
  });

  assert.equal(new URL(replacedUrl).searchParams.get("w"), instanceId);
});

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
