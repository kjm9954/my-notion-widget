import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../store.js", import.meta.url), "utf8");

test("업무일지는 입력 포커스 중에도 외부 동기화를 허용할 수 있다", () => {
  assert.match(source,/function watch\(callback, interval = MIN_WATCH_INTERVAL_MS, options = \{\}\)/);
  assert.match(source,/Math\.max\(MIN_WATCH_INTERVAL_MS, Number\(interval\)/);
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
  const intervalDurations = [];
  const windowEvents = new Map();
  const instanceStorage = options.instanceStorage || new Map();
  const cacheApi = {
    async open() {
      return {
        async match(url) {
          const entry = persisted.get(String(url));
          return entry === undefined ? undefined : typeof entry === 'string'
            ? new Response(entry) : new Response(entry.body, { headers:entry.headers });
        },
        async put(url, response) {
          const body = await response.text();
          persisted.set(String(url), response.headers.has('X-Store-Validated-At')
            ? { body, headers:Object.fromEntries(response.headers) } : body);
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
    navigator: { locks:options.locks },
    addEventListener(type, callback) {
      if (!windowEvents.has(type)) windowEvents.set(type, new Set());
      windowEvents.get(type).add(callback);
    },
    removeEventListener(type, callback) { windowEvents.get(type)?.delete(callback); },
  };
  const document = options.document || {
    currentScript: { hasAttribute:name => (options.isolated === true && name === 'data-store-isolated') || (options.coalesce === true && name === 'data-store-coalesce') },
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
    AbortController,
    structuredClone,
    fetch: fetchImpl,
    setInterval: (callback, duration) => { intervalCallbacks.push(callback); intervalDurations.push(duration); return intervalCallbacks.length; },
    clearInterval() {},
    setTimeout,
    clearTimeout,
  };
  if (options.now) context.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : [options.now()])); }
    static now() { return options.now(); }
  };
  if (options.noCache) delete window.caches;
  vm.runInNewContext(source, context);
  window.Store.__runIntervals = () => intervalCallbacks.forEach(callback => callback());
  window.Store.__intervalDurations = intervalDurations;
  window.Store.__event = type => windowEvents.get(type)?.forEach(callback => callback({ type }));
  return window.Store;
}

function createTrackedDocument(indicators) {
  return {
    referrer: "https://www.notion.so/work-log-page",
    hidden: false,
    activeElement: null,
    body: {
      appendChild(element) { indicators.push(element); },
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) {
      if (selector !== "[data-store-error-indicator]") return null;
      return indicators.find(element => !element.removed) || null;
    },
    createElement() {
      return {
        dataset: {},
        style: {},
        setAttribute() {},
        remove() { this.removed = true; },
      };
    },
  };
}

test("독립 세트는 기존 키·캐시를 가져오지 않고 키 없는 읽기와 쓰기를 차단한다", async () => {
  const oldId = 'w_abcdefghijklmnopqrstuvwxyz123456';
  const persisted = new Map([['https://kjm9954.github.io/__notion-widget-worklog-instance-v1__', oldId]]);
  const instanceStorage = new Map([['notion-widget-instance-v1', oldId]]);
  const openedChannels = [];
  const before = [...persisted], beforeStorage = [...instanceStorage];
  let calls = 0;
  const store = createStore(async () => { calls++; throw new Error('must not fetch'); }, persisted, {
    search:`?worklog_w=${oldId}`, instanceStorage, isolated:true,
    BroadcastChannel:class { constructor(name) { openedChannels.push(name); } addEventListener() {} postMessage() {} }
  });
  assert.equal(store.getWidgetInstanceId(), null);
  for (const read of [() => store.loadWorklogState({fresh:true}), () => store.loadNotesState(),
    () => store.loadWeeklyGoalsState({fresh:true,worklogInstance:true}), () => store.patchNotesState({cleanupCompleted:true}),
    () => store.patchWorklogState({upserts:[]})]) await assert.rejects(read(), /인스턴스/);
  assert.equal(calls, 0);
  assert.deepEqual([...persisted], before);
  assert.deepEqual([...instanceStorage], beforeStorage);
  assert.ok(!openedChannels.includes('notion-widget-instance-discovery-v1'));
});

test("독립 세트는 명시한 새 키만 사용하고 예전 키와 업무 연결 캐시를 덮어쓰지 않는다", async () => {
  const oldId = 'w_abcdefghijklmnopqrstuvwxyz123456', newId = 'w_new_set_abcdefghijklmnopqrstuvwxyz';
  const cacheUrl = 'https://kjm9954.github.io/__notion-widget-worklog-instance-v1__';
  const persisted = new Map([[cacheUrl, oldId]]);
  const instanceStorage = new Map([['notion-widget-instance-v1', oldId]]);
  const urls = [];
  const store = createStore(async url => {
    urls.push(String(url)); return Response.json({ok:true,data:{tasks:[],items:[]}});
  }, persisted, { search:`?w=${newId}&worklog_w=${oldId}`, instanceStorage, isolated:true,
    href:'https://kjm9954.github.io/my-notion-widget/cream-olive-garden/Worklog/notes.html' });
  await store.loadWorklogState({fresh:true});
  await store.loadWeeklyGoalsState({fresh:true,worklogInstance:true});
  await store.patchNotesState({updates:[]});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(urls.length >= 3 && urls.every(url => new URL(url).searchParams.get('w') === newId));
  assert.equal(instanceStorage.get('notion-widget-instance-v1'), oldId);
  assert.equal(persisted.get(cacheUrl), oldId);
});

test("읽기 위젯의 fresh 목표 조회는 캐시가 있어도 연결 실패를 전달하고 업무 인스턴스를 따른다", async () => {
  const persisted = new Map();
  const instanceId = 'w_abcdefghijklmnopqrstuvwxyz123456';
  const urls = [];
  const options = { search:`?worklog_w=${instanceId}`, instanceStorage:new Map() };
  const store = createStore(async url => {
    urls.push(String(url));
    return Response.json({ ok:true, data:{ week:'2026-9-28', items:[] } });
  }, persisted, options);
  await store.loadWeeklyGoalsState({ fresh:true, worklogInstance:true });
  assert.equal(new URL(urls[0]).searchParams.get('w'), instanceId);
  await new Promise(resolve => setTimeout(resolve, 0));
  const offline = createStore(async () => { throw new Error('offline'); }, persisted, options);
  await assert.rejects(offline.loadWeeklyGoalsState({ fresh:true, worklogInstance:true }), /offline/);
});

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

test("성장 기록의 worklog_w는 업무 API에만 적용된다", async () => {
  const instanceId = "w_abcdefghijklmnopqrstuvwxyz123456";
  const requestedUrls = [];
  const store = createStore(async url => {
    requestedUrls.push(String(url));
    return Response.json({ ok:true, data:{ revision:12, tasks:[] } });
  }, new Map(), {
    search:`?worklog_w=${instanceId}`,
    href:`https://kjm9954.github.io/my-notion-widget/growth-page/record.html?worklog_w=${instanceId}`,
    instanceStorage:new Map(),
  });

  assert.equal((await store.loadWorklogState()).revision, 12);
  await store.loadReadingNotesState();
  assert.equal(store.getWidgetInstanceId(), null);
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

test("캐시가 있으면 일시적인 백그라운드 조회 실패를 사용자에게 표시하지 않는다", async () => {
  const persisted = new Map();
  const seeded = createStore(async () => Response.json({ ok: true, data: { revision: 1 } }), persisted);
  await seeded.loadWorklogState();
  await new Promise(resolve => setTimeout(resolve, 0));

  const indicators = [];
  const cached = createStore(async () => { throw new Error("temporary offline"); }, persisted, {
    document: createTrackedDocument(indicators),
  });
  assert.equal((await cached.loadWorklogState()).revision, 1);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(indicators.length, 0);
});

test("캐시가 없어서 실제 데이터를 불러올 수 없을 때는 연결 실패를 표시한다", async () => {
  const indicators = [];
  const store = createStore(async () => { throw new Error("offline"); }, new Map(), {
    document: createTrackedDocument(indicators),
  });
  await assert.rejects(store.loadWorklogState(), /offline/);
  assert.equal(indicators.length, 1);
  assert.equal(indicators[0].textContent, "서버 연결 실패 · 다시 시도 중");
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
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requests, 1);

  response.resolve(Response.json({ ok: true, data: { revision: 3 } }));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.revision, 3);
  assert.equal(b.revision, 3);
});

test("무료 요청 한도 초과 뒤에는 다음 초기화 전까지 서버를 다시 호출하지 않는다", async () => {
  const persisted = new Map();
  let requests = 0;
  const store = createStore(async () => {
    requests += 1;
    return new Response("error code: 1027", { status:429 });
  }, persisted);

  await assert.rejects(store.loadWorklogState(), /1027/);
  await assert.rejects(store.loadWorklogState(), /오전 9시 자동 재시도/);
  assert.equal(requests, 1);

  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal([...persisted.keys()].some(key => key.endsWith("/__notion-widget-server-backoff-v1__")), true);
});

function sharedLocks() {
  const tails = new Map();
  return { request(name, callback) {
    const run = (tails.get(name) || Promise.resolve()).then(callback);
    tails.set(name, run.catch(() => {}));
    return run;
  } };
}
function sharedChannels() {
  const channels = new Map();
  return class {
    constructor(name) {
      this.name = name;
      if (!channels.has(name)) channels.set(name, new Set());
      channels.get(name).add(this);
    }
    addEventListener(_, callback) { this.callback = callback; }
    postMessage(data) { for (const peer of channels.get(this.name)) if (peer !== this) peer.callback?.({ data }); }
  };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const fixtureDay = '2026-09-29';
const fixtureTime = Date.parse('2026-09-29T12:00:00+09:00');

test('다섯 위젯의 업무/목표 동시 조회를 각각 한 번으로 합치고 변경 없으면 revision만 읽는다', async () => {
  const persisted = new Map(), locks = sharedLocks(), BroadcastChannel = sharedChannels();
  let now = fixtureTime, revision = 1;
  const paths = [];
  const fetch = async url => {
    const path = new URL(url).pathname; paths.push(path);
    return Response.json({ ok:true, data:path.endsWith('/revision') ? {revision,day:fixtureDay}
      : path.includes('weekly-goals') ? {week:fixtureDay,items:[]}
        : {revision,lastRollDay:fixtureDay,tasks:[{id:'task',done:revision>1}]} });
  };
  const readers = Array.from({length:5}, () => createStore(fetch, persisted,
    {coalesce:true,isolated:true,locks,BroadcastChannel,now:()=>now}));
  const load = () => Promise.all(readers.map(store => Promise.all([
    store.loadWorklogState({fresh:true}), store.loadWeeklyGoalsState({fresh:true})
  ])));
  await load(); assert.equal(paths.length,2);
  await load(); assert.equal(paths.length,2,'focus/reload bursts reuse confirmed data');
  now += 120001;
  await load(); assert.equal(paths.length,3); assert.equal(paths.at(-1),'/api/worklog/revision');
  now += 120001; revision++;
  const changed = await load();
  assert.equal(paths.length,5); assert.ok(changed.every(([state])=>state.tasks[0].done));
  now += 120001;
  await load(); assert.equal(paths.length,7,'one revision plus one goals refresh, not five full reads');
});

test('저장 응답을 공유한 다음 알리므로 완료/목표 수정은 추가 GET 없이 즉시 반영된다', async () => {
  const persisted = new Map(), locks = sharedLocks(), BroadcastChannel = sharedChannels();
  const options = {coalesce:true,isolated:true,locks,BroadcastChannel,now:()=>fixtureTime};
  let state = {revision:1,lastRollDay:fixtureDay,tasks:[{id:'task',done:false}]}, gets=0;
  const fetch = async (_, request) => {
    if (request?.method === 'POST') state = {...state,revision:2,tasks:[{id:'task',done:true,goalId:'worklog:goal:2'}]};
    else gets++;
    return Response.json({ok:true,data:state});
  };
  const writer=createStore(fetch,persisted,options), reader=createStore(fetch,persisted,options);
  await reader.loadWorklogState({fresh:true});
  let observed;
  const stop=reader.watch(async()=>{observed=await reader.loadWorklogState({fresh:true});},120000,
    {initial:false,paths:['/api/worklog/']});
  await writer.patchWorklogState({upserts:[{id:'task',done:true}]}); await settle(); stop();
  assert.equal(observed.tasks[0].done,true); assert.equal(observed.tasks[0].goalId,'worklog:goal:2');
  assert.equal(gets,1);
});

test('같은 잠금 안에서 늦은 GET과 저장을 순서대로 처리해 저장 결과를 옛 조회가 덮지 않는다', async () => {
  const response=deferred(), persisted=new Map(), locks=sharedLocks();
  const options={coalesce:true,isolated:true,locks,now:()=>fixtureTime};
  let posts=0;
  const fetch=async(_,request)=>{
    if(request?.method==='POST'){posts++;return Response.json({ok:true,data:{revision:2,tasks:[{done:true}]}});}
    return response.promise;
  };
  const reader=createStore(fetch,persisted,options),writer=createStore(fetch,persisted,options);
  const read=reader.loadWorklogState({fresh:true}); await settle();
  const write=writer.patchWorklogState({upserts:[]}); await settle(); assert.equal(posts,0);
  response.resolve(Response.json({ok:true,data:{revision:1,tasks:[{done:false}]}}));
  await Promise.all([read,write]);
  assert.equal((await reader.loadWorklogState({fresh:true})).revision,2);
});

test('HTTP 500 D1 읽기/쓰기 한도도 다른 위젯·새 문서까지 공유해 오전 9시 이후에만 재시도한다', async () => {
  for(const operation of ['read','write']) {
    const persisted=new Map(),locks=sharedLocks(),BroadcastChannel=sharedChannels();
    let now=fixtureTime, requests=0, failing=true;
    const fetch=async()=>{
      requests++;
      return failing ? Response.json({ok:false,error:`Error: D1_ERROR: Your account has exceeded D1's free tier daily row ${operation} limit.`},{status:500})
        : Response.json({ok:true,data:{revision:2,tasks:[]}});
    };
    const options={coalesce:true,isolated:true,locks,BroadcastChannel,now:()=>now};
    const stores=Array.from({length:4},()=>createStore(fetch,persisted,options));
    const results=await Promise.allSettled(stores.map(store=>store.loadWorklogState({fresh:true})));
    assert.ok(results.every(result=>result.status==='rejected'&&result.reason.dailyLimit));
    assert.equal(requests,1); await settle();
    const next=createStore(fetch,persisted,options);
    await assert.rejects(next.loadWorklogState({fresh:true}),/오전 9시/);
    await assert.rejects(next.patchWorklogState({upserts:[]}),/오전 9시/);
    assert.equal(requests,1);
    now=Date.parse('2026-09-30T09:00:06+09:00'); failing=false;
    assert.equal((await next.loadWorklogState({fresh:true})).revision,2); assert.equal(requests,2);
  }
});

test('서버 quota 대체 스냅샷을 최신 성공 자료로 간주하거나 대기 해제하지 않는다', async () => {
  let now=fixtureTime, fallback=false, calls=0;
  const store=createStore(async url=>{
    calls++;
    return Response.json({ok:true,data:new URL(url).pathname.endsWith('/revision')
      ? {revision:1,day:fixtureDay,cached:fallback}
      : {revision:1,lastRollDay:fixtureDay,tasks:[]}});
  },new Map(),{coalesce:true,now:()=>now});
  await store.loadWorklogState({fresh:true}); now+=120001; fallback=true;
  await assert.rejects(store.loadWorklogState({fresh:true}),error=>error.dailyLimit===true);
  await assert.rejects(store.loadWorklogState({fresh:true}),/오전 9시/); assert.equal(calls,2);
});

test('공유 캐시는 키별로 격리되고 Web Locks/Cache Storage가 없어도 정상 읽기와 저장을 유지한다', async () => {
  for(const noCache of [false,true]) {
    const persisted=new Map(); let requests=0;
    const fetch=async url=>{requests++;return Response.json({ok:true,data:{tasks:[],key:new URL(url).searchParams.get('w')}});};
    const options={coalesce:true,isolated:true,noCache,now:()=>fixtureTime};
    const a=createStore(fetch,persisted,options);
    const b=createStore(fetch,persisted,{...options,search:'?w=w_different_abcdefghijklmnopqrstuvwx'});
    assert.notEqual((await a.loadWorklogState()).key,(await b.loadWorklogState()).key);
    await a.loadWorklogState(); assert.equal(requests,2);
    await a.patchWorklogState({upserts:[]}); assert.equal(requests,3);
  }
});

test('유효기간 이후 연결 실패는 빈 상태/성공으로 숨기지 않고 한국 오전 6시에 다시 확인한다', async () => {
  let now=Date.parse('2026-09-30T05:59:50+09:00'), fail=false, calls=0;
  const store=createStore(async()=>{
    calls++; if(fail)throw new Error('offline');
    return Response.json({ok:true,data:{revision:1,lastRollDay:fixtureDay,tasks:[]}});
  },new Map(),{coalesce:true,now:()=>now});
  await store.loadWorklogState({fresh:true}); fail=true; now+=20000;
  await assert.rejects(store.loadWorklogState({fresh:true}),/offline/); assert.equal(calls,2);
});

test('새 위젯 감시는 2분 주기이며 메모 변경으로 업무/목표를 다시 조회하지 않는다', async () => {
  const BroadcastChannel=sharedChannels(),persisted=new Map();
  const options={coalesce:true,BroadcastChannel};
  const writer=createStore(async()=>Response.json({ok:true,data:{items:[]}}),persisted,options);
  const reader=createStore(async()=>Response.json({ok:true,data:{}}),persisted,options);
  let reads=0;
  const stop=reader.watch(()=>{reads++;},1500,{initial:false,paths:['/api/worklog/','/api/weekly-goals/']});
  await writer.patchNotesState({updates:[]}); await settle(); assert.equal(reads,0);
  reader.__event('focus'); await settle(); assert.equal(reads,1);
  assert.deepEqual(reader.__intervalDurations,[120000]); stop();
});

test('임베드가 Web Locks 접근을 거절하면 안전하게 조회하며 실패한 저장 자체를 재전송하지 않는다', async () => {
  const denied=Object.assign(new Error('embedded policy'),{name:'SecurityError'});
  let gets=0,posts=0;
  const fetch=async(_,options)=>{
    if(options?.method==='POST'){posts++;throw denied;}
    gets++;return Response.json({ok:true,data:{tasks:[]}});
  };
  const store=createStore(fetch,new Map(),{coalesce:true,locks:{request:async()=>{throw denied;}}});
  await store.loadWorklogState({fresh:true}); assert.equal(gets,1);
  await assert.rejects(store.patchWorklogState({upserts:[]}),/embedded policy/); assert.equal(posts,1);
  const permitted=createStore(fetch,new Map(),{coalesce:true,locks:sharedLocks()});
  await assert.rejects(permitted.patchWorklogState({upserts:[]}),/embedded policy/); assert.equal(posts,2);
});

test('한도 초과와 새로고침 이후 같은 키의 마지막 데이터를 오류와 함께 제공하고 저장 실패는 캐시를 덮지 않는다', async () => {
  const persisted=new Map(); let now=fixtureTime,fail=false,calls=0;
  const snapshot={revision:1,lastRollDay:fixtureDay,tasks:[{id:'task',title:'마지막 저장',done:false}]};
  const fetch=async()=>{calls++;return fail
    ? Response.json({ok:false,error:"D1_ERROR: Your account has exceeded D1's free tier daily row read limit."},{status:500})
    : Response.json({ok:true,data:snapshot});};
  const options={coalesce:true,isolated:true,now:()=>now};
  const first=createStore(fetch,persisted,options);
  await first.loadWorklogState({fresh:true}); now+=120001;fail=true;
  const check=error=>{assert.deepEqual(error.cachedData,snapshot);assert.equal(error.dailyLimit,true);return true;};
  await assert.rejects(first.loadWorklogState({fresh:true}),check); await settle();
  const reloaded=createStore(fetch,persisted,options);
  await assert.rejects(reloaded.loadWorklogState({fresh:true}),check);
  await assert.rejects(reloaded.patchWorklogState({upserts:[{id:'task',done:true}]}),/오전 9시/);
  await assert.rejects(reloaded.loadWorklogState({fresh:true}),check); assert.equal(calls,2);
  const other=createStore(fetch,persisted,{...options,search:'?w=w_other_abcdefghijklmnopqrstuvwx'});
  await assert.rejects(other.loadWorklogState({fresh:true}),error=>error.cachedData===undefined);
  now=Date.parse('2026-09-30T09:00:06+09:00');fail=false;
  assert.deepEqual(await reloaded.loadWorklogState({fresh:true}),snapshot);
});

test('서버의 업무 대체 스냅샷은 fresh 성공이 아닌 이전 데이터로 보존하며 403에는 캐시를 내주지 않는다', async () => {
  const persisted=new Map(); let now=fixtureTime;
  const store=createStore(async()=>Response.json({ok:true,cached:true,data:{tasks:[{id:'backup'}]}}),persisted,{coalesce:true,now:()=>now});
  await assert.rejects(store.loadWorklogState({fresh:true}),error=>error.dailyLimit&&error.cachedData.tasks[0].id==='backup'&&error.cachedAt===0);
  await settle(); now=Date.parse('2026-09-30T09:00:06+09:00');
  const forbidden=createStore(async()=>Response.json({ok:false,error:'forbidden'},{status:403}),persisted,{coalesce:true,now:()=>now});
  await assert.rejects(forbidden.loadWorklogState({fresh:true}),error=>error.status===403&&error.cachedData===undefined);
});
