// 목표 체크 위젯 3종(분기 진행도·분기 목표·습관 점검) 오프라인 브라우저 검증.
// 모든 요청은 이 저장소 파일과 메모리 테스트 데이터로만 응답한다. 운영 Worker 주소로 나가는 요청은 브라우저 안에서 가로챈다.
// 실행: PLAYWRIGHT_MODULE=<playwright 경로> [GOAL_CHECK_SHOTS=<스크린샷 폴더>] [QUARTER_GOALS_SERVER=<서버 모듈 경로>]
//       node --test --test-concurrency=1 sky-lime/tests/goal-check.browser.mjs
// QUARTER_GOALS_SERVER를 주면 목업 대신 그 서버 모듈(handleQuarterGoals)을 메모리 SQLite 위에서 그대로 돌린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { applyOps, currentQuarter, shiftQuarter, quarterDistance, checkWindow, worklogToday, GOAL_LIMIT, HABIT_LIMIT, STEP_LIMIT } from '../Worklog/goal-check-model.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const shots = process.env.GOAL_CHECK_SHOTS || '';
const realServer = process.env.QUARTER_GOALS_SERVER ? await import(pathToFileURL(resolve(process.env.QUARTER_GOALS_SERVER)).href) : null;
const origin = 'http://127.0.0.1:4181';
const prefix = '/sky-lime/Worklog/';
const KEY = 'w_goalcheck_test_instance_1234567';
const OTHER_KEY = 'w_goalcheck_other_instance_7654321';
const at = text => new Date(`${text}+09:00`);
const NOV28 = at('2026-11-28T10:00:00'); // 4분기 · 11월 점검 기간
const NOV15 = at('2026-11-15T10:00:00'); // 4분기 · 점검 기간 아님
const FILES = { progress:'quarter-progress', goals:'quarter-goals', habits:'habit-check' };
const HEIGHTS = { pc:{ progress:124, goals:404, habits:184 }, mobile:{ progress:112, goals:404, habits:324 } };
const FONT_CSS = `@font-face{font-family:"Pretendard Variable";font-weight:45 920;font-style:normal;font-display:block;src:url("${origin}/cream-olive-garden/assets/fonts/pretendard-1.3.9/PretendardVariable.woff2") format("woff2-variations");}`;

// ───────── 테스트 데이터(시안 예시와 다른 테스트 전용 문구) ─────────
const iso = text => at(text).toISOString();
const steps = (...list) => list.map((value, index) => ({ id:`st${index}`, title:typeof value === 'string' ? value : value[0], done:typeof value !== 'string' }));
const goal = (id, order, title, extra = {}) => ({ id, order, title, steps:[], pct:0, status:'doing',
  lastActivityAt:iso('2026-11-26T10:00:00'), createdAt:iso('2026-10-02T10:00:00'), doneAt:null, ...extra });
const habit = (id, order, name, months = [null, null, null]) => ({ id, order, name, months });
const GOALS = () => [
  goal('g1', 1, '테스트 목표 하나 · 아주 긴 이름이 한 줄을 넘으면 말줄임으로 끝나는지 확인하는 문장입니다', { steps:steps(['단계 가'], ['단계 나'], 'Step C', 'Step D', 'Step E') }),
  goal('g2', 2, '테스트 목표 둘', { steps:steps(['첫 단계'], '둘째 단계') }),
  goal('g3', 3, '테스트 목표 셋 (단계 없음)', { pct:20 }),
  goal('g4', 4, '테스트 목표 넷 (달성)', { steps:steps(['끝 1'], ['끝 2']), status:'done', doneAt:iso('2026-11-20T10:00:00') }),
  goal('g5', 5, '테스트 목표 다섯 (멈춤)', { pct:30, lastActivityAt:iso('2026-11-01T10:00:00') })
];
const HABITS = () => [
  habit('h1', 1, '테스트 습관 하나', ['good', null, null]),
  habit('h2', 2, '테스트 습관 둘 · 이름이 길면 두 줄까지 보이는지 확인', ['half', null, null]),
  habit('h3', 3, '테스트 습관 셋', [null, null, null]),
  habit('h4', 4, '테스트 습관 넷', ['bad', null, null]),
  habit('h5', 5, '테스트 습관 다섯', [null, null, null])
];
// 같은 키의 업무일지 위젯(이번 주 목표·업무일지)이 읽는 테스트 업무. 목표 체크 위젯은 이 데이터를 읽거나 쓰지 않는다.
const workTask = (id, extra = {}) => ({ id, mode:'work', date:'2026-11-27', proj:'', q:null, title:`테스트 업무 ${id}`, due:null, start:null, end:null,
  progress:null, est:null, status:'doing', done:false, doneAt:null, goalId:null, memo:'', rolledFrom:null, progressTouched:false, ...extra });
const worklogFixture = () => ({ revision:1, mode:'work', workView:'time', projects:[], lastRollDay:'2026-11-28', lastRollWeek:'2026-W48', lastRollCount:0,
  bannerDismissedDay:'', bannerDismissedWeek:'', manualOrder:{}, columnSplit:{ work:.73, life:6 / 11 },
  lastUsed:{ work:{ proj:'미분류', q:null }, life:{ proj:'미분류', q:null } },
  tasks:[workTask('t1', { goalId:'worklog:goal:1' }), workTask('t2'), workTask('t3', { mode:'life', title:'테스트 일상 업무', goalId:'worklog:goal:1' })] });
function fixture({ goals = 3, habits = 3 } = {}) {
  return {
    worklog:worklogFixture(),
    rows:{
      'work:2026-Q4':{ goals:GOALS().slice(0, goals), habits:HABITS().slice(0, habits) },
      'life:2026-Q4':{ goals:[goal('l1', 1, '일상 목표 하나', { pct:60 })], habits:[habit('k1', 1, '일상 습관 하나', ['good', null, null])] },
      'work:2026-Q3':{ goals:[goal('p1', 1, '지난 분기 목표', { status:'done', steps:steps(['a'], ['b']), doneAt:iso('2026-09-20T10:00:00') })],
        habits:[habit('h1', 1, '테스트 습관 하나', ['half', 'half', 'good']), habit('h2', 2, '지난 분기 습관', ['good', null, 'half'])] }
    },
    requests:[], writes:[]
  };
}

// ───────── 서버 대역 ─────────
// 계약: GET /api/quarter-goals/state?mode&quarter → {mode,quarter,initialized,goals,habits}
//       POST /api/quarter-goals/patch {mode,quarter,ops} → 같은 모양. 5·5·6개 상한, 지난 분기 읽기 전용(새 분기 첫 7일은 지난 분기 마지막 달 칸만).
class Refusal extends Error { constructor(error, extra = {}) { super(error); this.extra = extra; } }
function carried(db, mode, quarter, now) {
  if (quarterDistance(currentQuarter(now), quarter) < 0) return [];
  for (let back = 1; back <= 4; back += 1) {
    const row = db.rows[`${mode}:${shiftQuarter(quarter, -back)}`];
    if (row) return row.habits.map((item, index) => ({ id:item.id, order:index + 1, name:item.name, months:[null, null, null] }));
  }
  return [];
}
function mockState(db, mode, quarter, now) {
  const row = db.rows[`${mode}:${quarter}`];
  return row ? { mode, quarter, initialized:true, ...structuredClone(row) } : { mode, quarter, initialized:false, goals:[], habits:carried(db, mode, quarter, now) };
}
function mockPatch(db, { mode, quarter, ops }, now) {
  const distance = quarterDistance(currentQuarter(now), quarter);
  const window = checkWindow(now);
  const thisMonth = (Number(worklogToday(now).slice(5, 7)) - 1) % 3;
  const current = mockState(db, mode, quarter, now);
  for (const op of ops) {
    if (op.type === 'markHabit') {
      const open = distance === 0 ? op.month <= thisMonth : distance < 0 && window?.quarter === quarter && window.index === op.month;
      if (!open) throw new Refusal('month not open');
    } else if (distance < 0) throw new Refusal('read-only quarter');
    if (op.type === 'addGoal' && current.goals.length >= GOAL_LIMIT) throw new Refusal('limit', { limit:'goals' });
    if (op.type === 'addHabit' && current.habits.length >= HABIT_LIMIT) throw new Refusal('limit', { limit:'habits' });
    if (op.type === 'addStep' && (current.goals.find(item => item.id === op.goalId)?.steps.length || 0) >= STEP_LIMIT) throw new Refusal('limit', { limit:'steps' });
    Object.assign(current, applyOps(current, [op], now.toISOString()));
  }
  db.rows[`${mode}:${quarter}`] = { goals:current.goals, habits:current.habits };
  return mockState(db, mode, quarter, now);
}
async function realD1() {
  const { DatabaseSync } = await import('node:sqlite');
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE widget_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT)');
  return { sql, DB:{ prepare(text) { return { bind(...params) {
    const statement = sql.prepare(text);
    return { async all() { return { results:statement.all(...params) }; }, async first() { return statement.get(...params) ?? null; },
      async run() { const result = statement.run(...params); return { meta:{ changes:result.changes } }; } };
  } }; } } };
}
async function seedReal(d1, db, key) {
  d1.sql.prepare('INSERT INTO widget_settings VALUES (?, ?, ?)').run(`instance-meta:${key}`, '{}', 'seed');
  for (const [scope, row] of Object.entries(db.rows)) {
    const [mode, quarter] = scope.split(':');
    d1.sql.prepare('INSERT INTO widget_settings VALUES (?, ?, ?)').run(`instance:${key}:quarterGoals:v1:${mode}:${quarter}`, JSON.stringify({ v:1, ...row }), 'seed');
  }
}

async function setup(browser, { dbs = { [KEY]:fixture(), [OTHER_KEY]:fixture() }, now = NOV28, viewport = { width:1320, height:900 }, mobile = false } = {}) {
  const context = await browser.newContext({ viewport, timezoneId:'Asia/Seoul', serviceWorkers:'block', ...(mobile ? { isMobile:true, hasTouch:true, deviceScaleFactor:2 } : {}) });
  await context.clock.setFixedTime(now);
  const d1 = {};
  // 실제 서버 모듈일 때는 모든 키가 한 표를 함께 쓴다(키별로 행이 나뉘는지까지 확인).
  if (realServer) {
    const shared = await realD1();
    for (const [key, db] of Object.entries(dbs)) { d1[key] = shared; await seedReal(shared, db, key); }
  }
  const errors = [];
  const external = [];
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !/409|Failed to load resource/.test(message.text())) errors.push(message.text()); });
  });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) {
      if (url.pathname === '/__preview') return route.fulfill({ contentType:'text/html', body:previewHtml(url) });
      const path = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!path.startsWith(resolve(root) + sep)) return route.abort();
      try {
        const type = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' }[extname(path)] || 'application/octet-stream';
        return route.fulfill({ body:await readFile(path), contentType:type });
      } catch { return route.fulfill({ status:404, body:'Not found' }); }
    }
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('pretendard')) return route.fulfill({ contentType:'text/css', body:FONT_CSS });
    if (url.hostname === 'notion-widget.wldnjsdkk.workers.dev') {
      const headers = { 'access-control-allow-origin':'*', 'access-control-allow-headers':'*', 'access-control-allow-methods':'GET, POST, OPTIONS' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status:204, headers });
      const instance = url.searchParams.get('w');
      const db = dbs[instance];
      const entry = { path:url.pathname, method:request.method(), instance, search:url.search, page:request.frame()?.url() || '' };
      if (!db) { (dbs.__unknown ||= []).push(entry); return route.fulfill({ status:404, headers, json:{ ok:false, error:'unknown fixture instance' } }); }
      db.requests.push(entry);
      if (db.fail) return route.fulfill({ status:503, headers, json:{ ok:false, error:'offline fixture' } });
      // 저장 기록은 서버 처리가 끝난 뒤에 남긴다(테스트가 기록 수로 저장 완료를 기다린다).
      const post = request.method() === 'POST';
      if (post) entry.body = request.postDataJSON();
      if (!url.pathname.startsWith('/api/quarter-goals/')) {
        // 업무일지 위젯용(읽기만). 이 테스트에서 업무일지 쓰기가 오면 실패로 남긴다.
        if (post) { db.writes.push(entry); return route.fulfill({ status:500, headers, json:{ ok:false, error:'unexpected worklog write' } }); }
        const data = url.pathname === '/api/worklog/state' ? db.worklog
          : url.pathname === '/api/worklog/revision' ? { revision:db.worklog.revision, day:'2026-11-28' }
            : url.pathname === '/api/widget-layout' ? { layouts:{} } : null;
        if (!data) throw new Error(`예상하지 못한 요청 ${request.method()} ${url.pathname}`);
        return route.fulfill({ headers, json:{ ok:true, data:structuredClone(data) } });
      }
      if (realServer) {
        const response = await realServer.handleQuarterGoals(new Request(url, { method:request.method(), body:post ? request.postData() : undefined }), d1[instance], now.getTime());
        const body = await response.text();
        if (post) db.writes.push(entry);
        return route.fulfill({ status:response.status, headers, body, contentType:'application/json' });
      }
      try {
        let data;
        if (url.pathname === '/api/quarter-goals/state' && !post) data = mockState(db, url.searchParams.get('mode'), url.searchParams.get('quarter'), now);
        else if (url.pathname === '/api/quarter-goals/patch' && post) data = mockPatch(db, entry.body, now);
        else throw new Error(`예상하지 못한 요청 ${request.method()} ${url.pathname}`);
        return route.fulfill({ headers, json:{ ok:true, data } });
      } catch (error) {
        if (error instanceof Refusal) return route.fulfill({ status:409, headers, json:{ ok:false, error:error.message, ...error.extra } });
        throw error;
      } finally {
        if (post) db.writes.push(entry);
      }
    }
    external.push(url.href);
    return route.fulfill({ status:204, body:'' });
  });
  async function open(kind, { key = KEY, width, height, query, wait = true } = {}) {
    const page = await context.newPage();
    if (width) await page.setViewportSize({ width, height:height || HEIGHTS[width < 700 ? 'mobile' : 'pc'][kind] });
    await page.goto(`${origin}${prefix}${FILES[kind]}.html${query ?? `?w=${key}`}`);
    if (wait) await page.waitForFunction(() => ['ready', 'error', 'stale'].includes(document.getElementById('app')?.dataset.status));
    await page.evaluate(() => document.fonts.ready);
    return page;
  }
  async function preview({ width = 1320, key = KEY, withWorklog = false } = {}) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height:1000 });
    await page.goto(`${origin}/__preview?width=${width}&w=${key}${withWorklog ? '&with=worklog' : ''}`);
    for (const kind of [...Object.keys(FILES), ...(withWorklog ? ['weekly', 'worklog'] : [])]) {
      await page.frameLocator(`#${kind}`).locator('#app[data-status="ready"]').waitFor();
    }
    await page.evaluate(() => document.fonts.ready);
    return page;
  }
  const state = (key = KEY, scope = 'work:2026-Q4') => {
    if (!realServer) return dbs[key].rows[scope];
    const [mode, quarter] = scope.split(':');
    const raw = d1[key].sql.prepare('SELECT value FROM widget_settings WHERE key = ?').get(`instance:${key}:quarterGoals:v1:${mode}:${quarter}`);
    return raw ? JSON.parse(raw.value) : undefined;
  };
  return { context, dbs, errors, external, open, preview, state };
}

// 노션 "목표 체크" 페이지처럼 세 위젯을 위에서 아래로 따로 임베드(서로 다른 iframe).
function previewHtml(url) {
  const width = Number(url.searchParams.get('width')) || 1320;
  const key = url.searchParams.get('w') || KEY;
  const withWorklog = url.searchParams.get('with') === 'worklog';
  const mobile = width < 700;
  const pad = mobile ? '20px 14px 28px' : '36px 40px 44px';
  const heights = HEIGHTS[mobile ? 'mobile' : 'pc'];
  const frame = kind => `<iframe id="${kind}" title="${kind}" src="${prefix}${FILES[kind]}.html?w=${key}" style="display:block;width:100%;height:${heights[kind]}px;border:0"></iframe>`;
  // 같은 키의 업무일지 페이지 위젯(이번 주 목표 214px · 업무일지 900px)
  const worklog = withWorklog ? `<iframe id="weekly" title="weekly" src="${prefix}weekly-goals.html?w=${key}" style="display:block;width:100%;height:214px;border:0"></iframe>`
    + `<iframe id="worklog" title="worklog" src="${prefix}worklog-sky-lime.html?w=${key}" style="display:block;width:100%;height:900px;border:0"></iframe>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#FFFFFF;font-family:"Pretendard Variable",sans-serif}
    .page{box-sizing:border-box;width:${width}px;padding:${pad};display:flex;flex-direction:column;gap:16px}
    h1{margin:0;padding:0 4px 4px;font-size:${mobile ? 24 : 30}px;font-weight:700;letter-spacing:-.03em;color:#1F1F1D}</style>
    <style>${FONT_CSS}</style></head><body><div class="page"><h1>목표 체크</h1>${frame('progress')}${frame('goals')}${frame('habits')}${worklog}</div></body></html>`;
}

const browser = await chromium.launch();
test.after(() => browser.close());
const shot = async (target, name) => {
  if (!shots) return;
  await mkdir(shots, { recursive:true });
  await target.screenshot({ path:resolve(shots, `${name}.png`) });
};
const settle = page => page.waitForTimeout(350);
async function fits(page) {
  return page.evaluate(() => {
    const root = document.getElementById('app');
    const inner = [...root.querySelectorAll('*')].filter(node => node.offsetParent !== null);
    const clipped = inner.filter(node => {
      const box = node.getBoundingClientRect(), card = root.getBoundingClientRect();
      return box.height > 0 && (box.bottom > card.bottom + .5 || box.right > card.right + .5);
    }).map(node => node.className || node.tagName);
    return {
      scroll:document.scrollingElement.scrollHeight > innerHeight + 1 || document.scrollingElement.scrollWidth > innerWidth + 1,
      inner:root.scrollHeight > root.clientHeight + 1, sh:root.scrollHeight, ch:root.clientHeight, height:Math.round(root.getBoundingClientRect().height), clipped
    };
  });
}
const goalIds = page => page.locator('[data-goal]').evaluateAll(nodes => nodes.map(node => node.dataset.goal));
const waitSaved = async (h, count) => { const start = Date.now(); while (h.dbs[KEY].writes.length < count && Date.now() - start < 4000) await new Promise(done => setTimeout(done, 50)); };

test('세 위젯이 고정 높이(PC·모바일) 안에 0·3·5개 모두 잘림·스크롤 없이 들어간다', { timeout:180000 }, async () => {
  for (const [goals, habits] of [[0, 0], [3, 3], [5, 5]]) {
    const h = await setup(browser, { dbs:{ [KEY]:fixture({ goals, habits }) } });
    for (const width of [1320, 1130, 390]) {
      for (const kind of Object.keys(FILES)) {
        const page = await h.open(kind, { width });
        const result = await fits(page);
        const height = HEIGHTS[width < 700 ? 'mobile' : 'pc'][kind];
        assert.equal(result.scroll, false, `${kind} ${width} ${goals}개 스크롤`);
        assert.equal(result.inner, false, `${kind} ${width} ${goals}개 안쪽 넘침 ${JSON.stringify(result)}`);
        assert.deepEqual(result.clipped, [], `${kind} ${width} ${goals}개 잘림`);
        // 소수점 임베드에서 끝선이 잘리지 않도록 아래 1px 여유(기존 sky-lime 규칙)
        assert.equal(result.height, height - 1, `${kind} ${width} 높이`);
        await page.close();
      }
    }
    // 모바일 높이로 둔 습관 임베드(324px)를 PC에서 열면 카드는 184px로 위에 붙는다.
    const tall = await h.open('habits', { width:1320, height:324 });
    assert.equal((await fits(tall)).height, 184);
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.external, []);
    await h.context.close();
  }
});

test('분기 진행도: 섞인 % 계산 · 경과율 띠 · D-n · 지난/다음 분기 · 이동 범위(1년 전 ~ 다음 분기)', { timeout:90000 }, async () => {
  const h = await setup(browser, { dbs:{ [KEY]:fixture({ goals:5, habits:5 }) } });
  const page = await h.open('progress', { width:1320 });
  // 목표: 40, 50, 20, 100(달성), 30 · 습관 점수: 100, 50, 0 → (40+50+20+100+30+100+50+0)/8 = 48.75 → 49
  assert.equal(await page.locator('#percent').textContent(), '49%');
  assert.equal(await page.locator('#dday').textContent(), 'D-33');
  assert.equal(await page.locator('#quarter').textContent(), '2026 Q4');
  // 49% < 경과율 64% → 띠 64%
  assert.equal(await page.locator('#lag').evaluate(node => node.style.width), '64%');
  assert.equal(await page.locator('#fill').evaluate(node => node.style.width), '49%');
  assert.equal(await page.locator('#lag').evaluate(node => getComputedStyle(node).backgroundColor), await page.evaluate(() => {
    const probe = document.createElement('div'); probe.style.color = 'oklch(0.93 0.035 235)'; document.body.append(probe);
    const color = getComputedStyle(probe).color; probe.remove(); return color;
  }));
  await shot(page, 'progress-1320-q4');
  // 보류로 바꾸면 그 목표는 계산에서 빠진다: (40+50+20+100+100+50+0)/7 = 51.4 → 51
  h.dbs[KEY].rows['work:2026-Q4'].goals[4].status = 'hold';
  if (realServer) await page.evaluate(() => window.Store.patchQuarterGoals('work', '2026-Q4', [{ type:'updateGoal', id:'g5', hold:true }]));
  await page.evaluate(() => caches.delete('notion-widget-store-cache-v1')); // 고정 시각이라 2분 공유 캐시가 안 지나므로 비운다
  await page.reload();
  await page.waitForFunction(() => document.getElementById('app').dataset.status === 'ready');
  assert.equal(await page.locator('#percent').textContent(), '51%');
  // 지난 분기: 종료 · 띠 없음
  await page.locator('[data-shift="-1"]').click();
  await page.waitForFunction(() => document.getElementById('quarter').textContent === '2026 Q3' && document.getElementById('app').dataset.status === 'ready');
  assert.equal(await page.locator('#dday').textContent(), '종료');
  assert.equal(await page.locator('#lag').evaluate(node => node.style.width), '0%');
  // 지난 분기 진행도: 목표 100 + 습관 (50+50+100)/3=67, (100+50)/2=75 → (100+67+75)/3 = 80.7 → 81
  assert.equal(await page.locator('#percent').textContent(), '81%');
  await shot(page, 'progress-1320-q3-past');
  // 1년 전(2025 Q4)까지만
  for (let i = 0; i < 3; i += 1) await page.locator('[data-shift="-1"]').click();
  assert.equal(await page.locator('#quarter').textContent(), '2025 Q4');
  assert.equal(await page.locator('[data-shift="-1"]').isDisabled(), true);
  // 다음 분기는 1개까지: n월 시작
  for (let i = 0; i < 5; i += 1) await page.locator('[data-shift="1"]').click();
  await page.waitForFunction(() => document.getElementById('quarter').textContent === '2027 Q1' && document.getElementById('app').dataset.status === 'ready');
  assert.equal(await page.locator('#dday').textContent(), '1월 시작');
  assert.equal(await page.locator('[data-shift="1"]').isDisabled(), true);
  // 진행도가 경과율 이상이면 띠 없음
  const ahead = await setup(browser, { dbs:{ [KEY]:{ ...fixture(), rows:{ 'work:2026-Q4':{ goals:[goal('a', 1, '앞선 목표', { pct:90 })], habits:[] } } } } });
  const fast = await ahead.open('progress', { width:1320 });
  assert.equal(await fast.locator('#percent').textContent(), '90%');
  assert.equal(await fast.locator('#lag').evaluate(node => node.style.width), '0%');
  // 고른 분기는 그 업무일에만 유지: 어제 고른 값이면 이번 분기로 시작
  await page.evaluate(key => localStorage.setItem(`sky-lime-goal-quarter-v1:${key}`, JSON.stringify({ quarter:'2026-Q3', day:'2026-11-27' })), KEY);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('app').dataset.status === 'ready');
  assert.equal(await page.locator('#quarter').textContent(), '2026 Q4');
  // 0개면 0%
  const none = await setup(browser, { dbs:{ [KEY]:fixture({ goals:0, habits:0 }) } });
  const zero = await none.open('progress', { width:390 });
  assert.equal(await zero.locator('#percent').textContent(), '0%');
  // 누르면 아무 동작 없음(읽기 전용): 쓰기 0건
  await zero.locator('.gc-row').click();
  assert.equal(none.dbs[KEY].writes.length, 0);
  for (const x of [h, ahead, none]) { assert.deepEqual(x.errors, []); await x.context.close(); }
});

test('분기 목표: 순서·달성·보류·멈춤 표시, 팝업에서 단계·%·보류·삭제·제목, 추가와 5개 상한', { timeout:120000 }, async () => {
  const h = await setup(browser, { dbs:{ [KEY]:fixture({ goals:5, habits:0 }) } });
  const page = await h.open('goals', { width:1320 });
  assert.deepEqual(await goalIds(page), ['g1', 'g2', 'g3', 'g5', 'g4'], '달성은 아래로');
  const row = id => page.locator(`[data-goal="${id}"]`);
  assert.equal(await row('g4').locator('.sl-num').textContent(), '✓');
  assert.equal(await row('g1').locator('.sl-num').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(206, 241, 140)');
  assert.equal(await row('g5').locator('.gc-goal-right').textContent(), '2주째 멈춤');
  assert.equal(await row('g5').evaluate(node => getComputedStyle(node).opacity), '0.6');
  assert.equal(await row('g1').locator('.gc-goal-right').textContent(), '40%');
  assert.equal(await row('g3').locator('.gc-goal-right').textContent(), '20%');
  assert.equal(await page.locator('.gc-full').isVisible(), true, '5개면 입력 줄 자리에 안내');
  assert.equal(await page.locator('#goalInput').isVisible(), false);
  await shot(page, 'goals-1320-5');
  // 팝업(세부 단계)
  await row('g2').click();
  await page.waitForSelector('#layer:not([hidden])');
  assert.equal(await page.locator('#popPct').textContent(), '50%');
  await shot(page, 'goals-1320-popup-steps');
  await page.locator('.gc-step[data-step="st1"]').click();
  await page.waitForFunction(() => document.getElementById('popPct').textContent === '100%');
  assert.equal(await page.locator('#popNum').textContent(), '✓', '전부 체크하면 자동 달성');
  await waitSaved(h, 1);
  assert.equal(h.state().goals.find(item => item.id === 'g2').status, 'done');
  await page.locator('.gc-step[data-step="st1"]').click();
  await waitSaved(h, 2);
  assert.equal(h.state().goals.find(item => item.id === 'g2').status, 'doing');
  // 세부 단계 추가(Enter) · 삭제(✕)
  await page.locator('#stepInput').fill('새 단계');
  await page.locator('#stepInput').press('Enter');
  await waitSaved(h, 3);
  assert.equal(h.state().goals.find(item => item.id === 'g2').steps.length, 3);
  await page.locator('[data-step-delete="st0"]').click();
  await waitSaved(h, 4);
  assert.deepEqual(h.state().goals.find(item => item.id === 'g2').steps.map(step => step.title), ['둘째 단계', '새 단계']);
  // 보류 → 보류 풀기
  await page.locator('#popHold').click();
  await waitSaved(h, 5);
  assert.equal(h.state().goals.find(item => item.id === 'g2').status, 'hold');
  assert.equal(await page.locator('#popHold').textContent(), '보류 풀기');
  await page.locator('#popHold').click();
  await waitSaved(h, 6);
  // 제목 바로 수정(Enter)
  await page.locator('#popTitle').fill('바꾼 목표 이름');
  await page.locator('#popTitle').press('Enter');
  await waitSaved(h, 7);
  assert.equal(h.state().goals.find(item => item.id === 'g2').title, '바꾼 목표 이름');
  // 닫기: Esc
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#layer').isHidden(), true);
  // 세부 단계 없는 목표: 10칸 막대, 같은 칸 다시 누르면 한 칸 내려감
  await row('g3').click();
  assert.equal(await page.locator('.gc-cell.is-on').count(), 2);
  await shot(page, 'goals-1320-popup-cells');
  await page.locator('[data-pct="50"]').click();
  await waitSaved(h, 8);
  assert.equal(h.state().goals.find(item => item.id === 'g3').pct, 50);
  await page.locator('[data-pct="50"]').click();
  await waitSaved(h, 9);
  assert.equal(h.state().goals.find(item => item.id === 'g3').pct, 40);
  await page.locator('[data-pct="100"]').click();
  await waitSaved(h, 10);
  assert.equal(h.state().goals.find(item => item.id === 'g3').status, 'done', 'pct 100이면 달성');
  // 닫기: 바깥(어두운 곳) 클릭
  await page.mouse.click(660, 30);
  assert.equal(await page.locator('#layer').isHidden(), true);
  // 삭제 → 4개 → 입력 줄 다시 보임 · 추가(Enter·버튼)
  await row('g5').click();
  await page.locator('[data-close]').click();
  assert.equal(await page.locator('#layer').isHidden(), true, '✕로 닫기');
  await row('g5').click();
  await page.locator('#popDelete').click();
  await waitSaved(h, 11);
  assert.equal(h.state().goals.length, 4);
  await page.locator('#goalInput').fill('엔터로 추가한 목표');
  await page.locator('#goalInput').press('Enter');
  await waitSaved(h, 12);
  assert.equal(h.state().goals.length, 5);
  assert.equal(await page.locator('.gc-full').isVisible(), true);
  // 서버도 6번째를 막는다
  const refused = await page.evaluate(() => window.Store.patchQuarterGoals('work', '2026-Q4', [{ type:'addGoal', id:'six', title:'여섯 번째' }]).then(() => 'saved', error => error.status));
  assert.equal(refused, 409);
  assert.equal(h.state().goals.length, 5);
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('분기 목표: 빈 상태 · 버튼으로 추가 · 지난 분기는 읽기 전용 · 모바일 팝업은 위젯 전체', { timeout:90000 }, async () => {
  const h = await setup(browser, { dbs:{ [KEY]:fixture({ goals:0, habits:0 }) }, mobile:true, viewport:{ width:390, height:404 } });
  const page = await h.open('goals', { width:390 });
  assert.equal(await page.locator('#list').textContent(), '이번 분기 목표를 적어 보세요');
  await shot(page, 'goals-390-0');
  await page.locator('#goalInput').fill('버튼으로 추가');
  await page.locator('#goalAdd').click();
  await waitSaved(h, 1);
  assert.deepEqual(h.state().goals.map(item => item.title), ['버튼으로 추가']);
  await page.locator('[data-goal]').first().click();
  const [pop, card] = await Promise.all([page.locator('#pop').boundingBox(), page.locator('#app').boundingBox()]);
  assert.ok(Math.abs(pop.width - card.width) < 3 && Math.abs(pop.height - card.height) < 3, '모바일 팝업은 위젯 전체');
  await shot(page, 'goals-390-popup');
  await page.locator('[data-close]').tap();
  assert.equal(await page.locator('#layer').isHidden(), true);
  // 지난 분기: 줄을 눌러도 팝업 없음, 입력 줄 숨김
  const past = await setup(browser, { dbs:{ [KEY]:fixture() } });
  const pastPage = await past.open('goals', { width:1320 });
  await pastPage.evaluate(() => localStorage.setItem(`sky-lime-goal-quarter-v1:${new URL(location.href).searchParams.get('w')}`, JSON.stringify({ quarter:'2026-Q3', day:'2026-11-28' })));
  await pastPage.reload();
  await pastPage.waitForFunction(() => document.getElementById('app').dataset.quarter === '2026-Q3' && document.getElementById('app').dataset.status === 'ready');
  assert.equal(await pastPage.locator('[data-goal]').first().isDisabled(), true);
  await pastPage.locator('[data-goal]').first().click({ force:true });
  assert.equal(await pastPage.locator('#layer').isHidden(), true);
  assert.equal(await pastPage.locator('#goalInput').isVisible(), false);
  assert.equal(await pastPage.locator('.gc-full').isVisible(), false);
  await shot(pastPage, 'goals-1320-q3-past');
  for (const x of [h, past]) { assert.deepEqual(x.errors, []); await x.context.close(); }
});

test('습관 점검: 점검 기간 전·후 기호, 고르기·수정, 지난달 채우기, 아직 안 온 달, 툴팁, ✕ 회색', { timeout:120000 }, async () => {
  // 11/15: 점검 기간 아님 → 10월 빈 칸은 "·"(눌러서 채우기), 11·12월은 연한 "·"
  const before = await setup(browser, { now:NOV15, dbs:{ [KEY]:fixture({ habits:5 }) } });
  const page = await before.open('habits', { width:1320 });
  const months = (id, index) => page.locator(`[data-habit-card="${id}"] .gc-month`).nth(index).locator('.gc-mark');
  assert.deepEqual(await months('h3', 0).allTextContents(), ['·']);
  assert.equal(await months('h3', 0).isDisabled(), false);
  assert.equal(await months('h3', 1).isDisabled(), true);
  assert.equal(await months('h3', 2).isDisabled(), true);
  assert.equal(await months('h1', 0).getAttribute('title'), '10월 잘 지킴');
  assert.equal(await months('h1', 0).isDisabled(), true, '점검 기간이 지난 고른 기호는 고정');
  assert.equal(await months('h3', 0).getAttribute('title'), '10월 · 눌러서 채우기');
  await shot(page, 'habits-1320-nov15-before');
  // 지난달 빈 칸 채우기
  await months('h3', 0).click();
  assert.deepEqual(await months('h3', 0).allTextContents(), ['◎', '△', '✕']);
  await months('h3', 0).nth(1).click();
  await waitSaved(before, 1);
  assert.deepEqual(before.state().habits.find(item => item.id === 'h3').months, ['half', null, null]);
  // ✕도 회색(빨강 금지)
  const bad = await months('h4', 0).evaluate(node => getComputedStyle(node).color);
  assert.equal(bad, 'rgb(142, 142, 138)');
  assert.deepEqual(before.errors, []);
  await before.context.close();

  // 11/28: 11월 칸 점검 기간 → 세 기호 연하게, 하나 고르면 그 기호만, 다시 누르면 펼쳐져 수정
  const during = await setup(browser, { now:NOV28 });
  const live = await during.open('habits', { width:1320 });
  const cell = (id, index) => live.locator(`[data-habit-card="${id}"] .gc-month`).nth(index).locator('.gc-mark');
  assert.deepEqual(await cell('h1', 1).allTextContents(), ['◎', '△', '✕']);
  assert.equal(await cell('h1', 1).first().evaluate(node => getComputedStyle(node).color), 'rgb(200, 200, 196)', '연하게');
  assert.equal(await cell('h1', 1).nth(0).getAttribute('title'), '11월 잘 지킴');
  await shot(live, 'habits-1320-nov28-open');
  await cell('h1', 1).nth(0).click();
  await waitSaved(during, 1);
  assert.deepEqual(await cell('h1', 1).allTextContents(), ['◎']);
  assert.equal(await cell('h1', 1).getAttribute('title'), '11월 잘 지킴 · 누르면 수정');
  await cell('h2', 1).nth(2).click();
  await cell('h3', 1).nth(1).click();
  await waitSaved(during, 3);
  await shot(live, 'habits-1320-nov28-chosen');
  await cell('h1', 1).click();
  assert.deepEqual(await cell('h1', 1).allTextContents(), ['◎', '△', '✕']);
  await cell('h1', 1).nth(1).click();
  await waitSaved(during, 4);
  assert.deepEqual(during.state().habits.find(item => item.id === 'h1').months, ['good', 'half', null]);
  // 아직 안 온 달(12월)은 서버도 거부
  const refused = await live.evaluate(() => window.Store.patchQuarterGoals('work', '2026-Q4', [{ type:'markHabit', id:'h1', month:2, value:'good' }]).then(() => 'saved', error => error.status));
  assert.equal(refused, 409);
  assert.deepEqual(during.errors, []);
  await during.context.close();
});

test('습관 점검: 이름 수정·삭제, + 습관(Enter·Esc·빈 칸 blur), 5개 상한(UI·서버), 빈 상태, 모바일 목록', { timeout:120000 }, async () => {
  const h = await setup(browser, { dbs:{ [KEY]:fixture({ habits:4 }) } });
  const page = await h.open('habits', { width:1320 });
  await page.locator('[data-name="h2"]').click();
  const input = page.locator('[data-rename="h2"]');
  await input.fill('이름 바꾼 습관');
  await input.press('Enter');
  await waitSaved(h, 1);
  assert.equal(h.state().habits.find(item => item.id === 'h2').name, '이름 바꾼 습관');
  await page.locator('[data-name="h2"]').click();
  await page.locator('[data-rename="h2"]').press('Escape');
  assert.equal(await page.locator('[data-rename]').count(), 0, 'Esc로 닫기');
  await page.locator('[data-name="h4"]').click();
  await page.locator('[data-remove="h4"]').click();
  await waitSaved(h, 2);
  assert.deepEqual(h.state().habits.map(item => item.id), ['h1', 'h2', 'h3']);
  // + 습관: Esc 취소, 빈 칸 blur 취소, Enter 추가
  await page.locator('#plus').click();
  await page.locator('#habitInput').press('Escape');
  assert.equal(await page.locator('#plus').isVisible(), true);
  await page.locator('#plus').click();
  await page.mouse.click(300, 15);
  assert.equal(await page.locator('#plus').isVisible(), true);
  await page.locator('#plus').click();
  await page.locator('#habitInput').fill('새 습관 넷');
  await shot(page, 'habits-1320-adding');
  await page.locator('#habitInput').press('Enter');
  await waitSaved(h, 3);
  await page.locator('#plus').click();
  await page.locator('#habitInput').fill('새 습관 다섯');
  await page.locator('#habitInput').press('Enter');
  await waitSaved(h, 4);
  assert.equal(h.state().habits.length, 5);
  assert.equal(await page.locator('#limit').isVisible(), true);
  assert.equal(await page.locator('#slot').isVisible(), false);
  await shot(page, 'habits-1320-5');
  const refused = await page.evaluate(() => window.Store.patchQuarterGoals('work', '2026-Q4', [{ type:'addHabit', id:'six', name:'여섯' }]).then(() => 'saved', error => error.status));
  assert.equal(refused, 409);
  assert.deepEqual(h.errors, []);
  await h.context.close();

  const empty = await setup(browser, { dbs:{ [KEY]:fixture({ habits:0 }) } });
  const blank = await empty.open('habits', { width:1320 });
  assert.equal(await blank.locator('#empty').isVisible(), true);
  await shot(blank, 'habits-1320-0');
  await empty.context.close();

  const phone = await setup(browser, { dbs:{ [KEY]:fixture({ habits:5 }) }, mobile:true, viewport:{ width:390, height:324 } });
  const mobile = await phone.open('habits', { width:390 });
  const rows = await mobile.locator('.gc-habit').evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().height)));
  assert.deepEqual(rows, [44, 44, 44, 44, 44]);
  assert.equal(await mobile.locator('.gc-mark[title]').count(), 0, '모바일은 툴팁 없음');
  assert.equal(await mobile.locator('.gc-name').first().evaluate(node => getComputedStyle(node).textOverflow), 'ellipsis');
  await shot(mobile, 'habits-390-5');
  assert.deepEqual(phone.errors, []);
  await phone.context.close();
});

test('습관 이어가기: 새 분기는 직전 분기 이름만(점수 빈 칸) · 전부 지우면 다시 복사 안 함 · 새 분기 첫 7일엔 지난 분기 마지막 달만', { timeout:90000 }, async () => {
  const JAN3 = at('2027-01-03T10:00:00');
  const h = await setup(browser, { now:JAN3 });
  const page = await h.open('habits', { width:1320 });
  assert.equal(await page.locator('#app').getAttribute('data-quarter'), '2027-Q1');
  assert.deepEqual(await page.locator('.gc-name').allTextContents(), ['테스트 습관 하나', '테스트 습관 둘 · 이름이 길면 두 줄까지 보이는지 확인', '테스트 습관 셋']);
  assert.equal(await page.locator('.gc-mark:not(.is-dot)').count(), 0, '점수는 빈 상태');
  assert.equal(h.state(KEY, 'work:2027-Q1'), undefined, '보기만 해서는 저장 안 함');
  await shot(page, 'habits-1320-q1-carried');
  for (const id of ['h1', 'h2', 'h3']) {
    await page.locator(`[data-name="${id}"]`).click();
    await page.locator(`[data-remove="${id}"]`).click();
  }
  await waitSaved(h, 3);
  assert.deepEqual(h.state(KEY, 'work:2027-Q1').habits, []);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('app').dataset.status === 'ready');
  assert.equal(await page.locator('.gc-habit').count(), 0, '다시 복사 안 됨');
  assert.equal(await page.locator('#empty').isVisible(), true);
  // 1/3에는 지난 분기(Q4)의 12월 칸만 열림
  const progress = await h.open('progress', { width:1320 });
  await progress.locator('[data-shift="-1"]').click();
  await page.waitForFunction(() => document.getElementById('app').dataset.quarter === '2026-Q4' && document.getElementById('app').dataset.status === 'ready');
  const dec = page.locator('[data-habit-card="h3"] .gc-month').nth(2).locator('.gc-mark');
  assert.deepEqual(await dec.allTextContents(), ['◎', '△', '✕']);
  assert.equal(await page.locator('[data-habit-card="h3"] .gc-month').nth(0).locator('.gc-mark').isDisabled(), true);
  assert.equal(await page.locator('[data-name="h1"]').isDisabled(), true, '지난 분기 이름은 수정 불가');
  assert.equal(await page.locator('#slot').isVisible(), false);
  await dec.nth(0).click();
  await waitSaved(h, 4);
  assert.deepEqual(h.state().habits.find(item => item.id === 'h3').months, [null, null, 'good']);
  await shot(page, 'habits-1320-q4-jan3-grace');
  // 지난 분기 보기(Q3): 같은 카드, 기호 읽기 전용
  await progress.locator('[data-shift="-1"]').click();
  await page.waitForFunction(() => document.getElementById('app').dataset.quarter === '2026-Q3' && document.getElementById('app').dataset.status === 'ready');
  assert.equal(await page.locator('.gc-mark:not(:disabled)').count(), 0);
  await shot(page, 'habits-1320-q3-past');
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('세 위젯(서로 다른 iframe) 분기·업무/일상 연동, 저장이 다른 위젯에 반영, 조회는 한 번으로 합침', { timeout:120000 }, async () => {
  const h = await setup(browser, { dbs:{ [KEY]:fixture(), [OTHER_KEY]:fixture() } });
  const page = await h.preview({ width:1320 });
  const frame = kind => page.frameLocator(`#${kind}`);
  const gets = () => h.dbs[KEY].requests.filter(entry => entry.method === 'GET').map(entry => entry.search.replace(/&w=.*/, ''));
  assert.equal(gets().length, 1, `처음 조회 1번: ${gets()}`);
  await shot(page, 'page-1320-work');
  // 일상으로 → 세 위젯 모두 일상
  await frame('progress').locator('[data-mode="life"]').click();
  for (const kind of ['goals', 'habits']) await frame(kind).locator('#app[data-mode="life"][data-status="ready"]').waitFor();
  assert.deepEqual(await frame('goals').locator('[data-goal]').evaluateAll(nodes => nodes.map(node => node.dataset.goal)), ['l1']);
  await shot(page, 'page-1320-life');
  await frame('progress').locator('[data-mode="work"]').click();
  // 지난 분기로 → 세 위젯 모두 Q3
  await frame('progress').locator('[data-shift="-1"]').click();
  for (const kind of ['goals', 'habits']) await frame(kind).locator('#app[data-quarter="2026-Q3"][data-status="ready"]').waitFor();
  await shot(page, 'page-1320-q3');
  await frame('progress').locator('[data-shift="1"]').click();
  for (const kind of ['goals', 'habits']) await frame(kind).locator('#app[data-quarter="2026-Q4"][data-status="ready"]').waitFor();
  // 분기 목표에서 단계를 체크하면 진행도 위젯 %가 바로 바뀐다(추가 조회 없이)
  const before = await frame('progress').locator('#percent').textContent();
  const getsBefore = gets().length;
  await frame('goals').locator('[data-goal="g2"]').click();
  await frame('goals').locator('.gc-step[data-step="st1"]').click();
  await frame('goals').locator('[data-close]').click();
  await frame('progress').locator('#percent').filter({ hasNotText:before }).waitFor();
  // 목표 40·100·20 + 습관 100·50·(없음) = 310/5 = 62
  assert.equal(await frame('progress').locator('#percent').textContent(), '62%');
  assert.equal(gets().length, getsBefore, '저장 응답으로 갱신(추가 조회 없음)');
  // 다른 키 요청 없음 · 브라우저 저장소에는 UI 값만
  assert.equal(h.dbs[OTHER_KEY].requests.length, 0);
  const keys = await frame('progress').locator('body').evaluate(() => Object.keys(localStorage).sort());
  assert.deepEqual(keys, [`sky-lime-goal-quarter-v1:${KEY}`, `sky-lime-worklog-mode-v1:${KEY}`].sort());
  assert.deepEqual(h.external, []);
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('같은 키: 업무일지 위젯과 업무/일상 전환이 함께 바뀌고, 데이터는 서로 읽거나 쓰지 않는다', { timeout:120000 }, async () => {
  const h = await setup(browser);
  const page = await h.preview({ width:1320, withWorklog:true });
  const frame = id => page.frameLocator(`#${id}`);
  const modeOf = id => frame(id).locator('#app').getAttribute('data-mode');
  const all = ['progress', 'goals', 'habits', 'weekly', 'worklog'];
  assert.deepEqual(await Promise.all(all.map(modeOf)), ['work', 'work', 'work', 'work', 'work']);
  // 목표 체크에서 일상으로 → 업무일지 위젯도 일상
  await frame('progress').locator('[data-mode="life"]').click();
  for (const id of all) await frame(id).locator('#app[data-mode="life"]').waitFor();
  // 업무일지에서 업무로 → 목표 체크 세 위젯도 업무
  await frame('worklog').locator('#modeToggle [data-mode="work"]').click();
  for (const id of all) await frame(id).locator('#app[data-mode="work"]').waitFor();
  // 목표 체크에서 저장해도 업무일지 데이터는 그대로
  const before = JSON.stringify(h.dbs[KEY].worklog);
  await frame('goals').locator('#goalInput').fill('같은 키 연동 확인 목표');
  await frame('goals').locator('#goalInput').press('Enter');
  await waitSaved(h, 1);
  await frame('progress').locator('#percent').filter({ hasNotText:'52%' }).waitFor();
  assert.equal(JSON.stringify(h.dbs[KEY].worklog), before, '업무일지 데이터 무변경');
  // 모든 요청은 같은 키 · 목표 체크는 분기 목표 API만, 업무일지 위젯은 업무일지 API만
  const requests = h.dbs[KEY].requests;
  assert.ok(requests.every(entry => entry.instance === KEY));
  const goalCheck = requests.filter(entry => /quarter-progress|quarter-goals|habit-check/.test(entry.page));
  const worklog = requests.filter(entry => /weekly-goals|worklog-sky-lime/.test(entry.page));
  assert.ok(goalCheck.length && goalCheck.every(entry => entry.path.startsWith('/api/quarter-goals/')), JSON.stringify(goalCheck.map(entry => entry.path)));
  assert.ok(worklog.length && worklog.every(entry => entry.path.startsWith('/api/worklog/') || entry.path === '/api/widget-layout'), JSON.stringify(worklog.map(entry => entry.path)));
  assert.deepEqual(h.dbs[KEY].writes.map(entry => entry.path), ['/api/quarter-goals/patch']);
  assert.deepEqual(h.external, []);
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('다른 키: 분기 목표·습관 데이터와 분기·업무/일상 선택이 섞이지 않는다', { timeout:120000 }, async () => {
  const other = fixture({ goals:0, habits:0 });
  other.rows = { 'work:2026-Q4':{ goals:[goal('o1', 1, '다른 키 목표', { pct:70 })], habits:[habit('oh1', 1, '다른 키 습관', ['good', null, null])] } };
  const h = await setup(browser, { dbs:{ [KEY]:fixture(), [OTHER_KEY]:other } });
  const mine = await h.preview({ width:1320, key:KEY });
  const theirs = await h.preview({ width:1320, key:OTHER_KEY });
  const ids = (page, kind, selector, attr) => page.frameLocator(`#${kind}`).locator(selector).evaluateAll((nodes, name) => nodes.map(node => node.dataset[name]), attr);
  assert.deepEqual(await ids(mine, 'goals', '[data-goal]', 'goal'), ['g1', 'g2', 'g3']);
  assert.deepEqual(await ids(theirs, 'goals', '[data-goal]', 'goal'), ['o1']);
  assert.deepEqual(await ids(theirs, 'habits', '[data-habit-card]', 'habitCard'), ['oh1']);
  assert.equal(await theirs.frameLocator('#progress').locator('#percent').textContent(), '85%');
  // 다른 키에서 추가·체크 → 내 키 데이터는 그대로
  const mineBefore = JSON.stringify(h.state(KEY));
  await theirs.frameLocator('#goals').locator('#goalInput').fill('다른 키에만 추가');
  await theirs.frameLocator('#goals').locator('#goalInput').press('Enter');
  await theirs.frameLocator('#goals').locator('[data-goal]').nth(1).waitFor();
  await new Promise(done => setTimeout(done, 300));
  assert.equal(JSON.stringify(h.state(KEY)), mineBefore, '내 키 무변경');
  assert.deepEqual(h.state(OTHER_KEY).goals.map(item => item.title), ['다른 키 목표', '다른 키에만 추가']);
  // 다른 키에서 일상·지난 분기로 바꿔도 내 키 위젯은 업무 · 이번 분기
  await theirs.frameLocator('#progress').locator('[data-mode="life"]').click();
  await theirs.frameLocator('#progress').locator('[data-shift="-1"]').click();
  await theirs.frameLocator('#habits').locator('#app[data-mode="life"][data-quarter="2026-Q3"]').waitFor();
  await mine.waitForTimeout(400);
  for (const kind of Object.keys(FILES)) {
    const app = mine.frameLocator(`#${kind}`).locator('#app');
    assert.deepEqual([await app.getAttribute('data-mode'), await app.getAttribute('data-quarter')], ['work', '2026-Q4'], kind);
  }
  assert.deepEqual(await ids(mine, 'goals', '[data-goal]', 'goal'), ['g1', 'g2', 'g3']);
  // 요청은 각자 자기 키로만
  const pagesOf = key => h.dbs[key].requests.map(entry => new URL(entry.page).searchParams.get('w'));
  assert.ok(pagesOf(KEY).every(value => value === KEY));
  assert.ok(pagesOf(OTHER_KEY).every(value => value === OTHER_KEY));
  assert.deepEqual(h.dbs[KEY].writes, []);
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('연결 실패: 이전 자료가 있으면 보여주고 저장은 막음 · 처음부터 실패면 안내 · 키 없는 주소는 요청 안 함', { timeout:90000 }, async () => {
  const h = await setup(browser);
  const page = await h.open('goals', { width:1320 });
  h.dbs[KEY].fail = true;
  await h.context.clock.setFixedTime(new Date(NOV28.getTime() + 3 * 60000)); // 2분 공유 캐시가 지난 뒤
  await page.reload();
  await page.waitForFunction(() => ['stale', 'error'].includes(document.getElementById('app').dataset.status));
  assert.equal(await page.locator('#app').getAttribute('data-status'), 'stale');
  assert.equal(await page.locator('#notice').textContent(), '이전 데이터 표시 중 · 연결되면 갱신');
  assert.deepEqual(await goalIds(page), ['g1', 'g2', 'g3']);
  const writes = h.dbs[KEY].writes.length;
  await page.locator('#goalInput').fill('막혀야 하는 추가');
  await page.locator('#goalInput').press('Enter');
  await page.waitForTimeout(300);
  assert.equal(h.dbs[KEY].writes.length, writes, '이전 자료를 보여주는 동안 저장 안 함');
  const fresh = await setup(browser, { dbs:{ [KEY]:{ ...fixture(), fail:true } } });
  const failed = await fresh.open('progress', { width:1320 });
  assert.equal(await failed.locator('#app').getAttribute('data-status'), 'error');
  assert.equal(await failed.locator('#message').textContent(), '불러오지 못했어요 · 잠시 후 다시 확인해요');
  const noKey = await fresh.open('habits', { width:1320, query:'' });
  assert.equal(await noKey.locator('#app').getAttribute('data-status'), 'error');
  assert.equal(fresh.dbs.__unknown, undefined);
  assert.ok(fresh.dbs[KEY].requests.every(entry => entry.instance === KEY));
  await h.context.close();
  await fresh.context.close();
});

test('스크린샷: 페이지 전체 1320 · 1130 · 390 (업무·일상, 0·3·5개, 점검 기간 전·후)', { timeout:180000, skip:!shots }, async () => {
  for (const width of [1320, 1130, 390]) {
    for (const [name, db, now] of [['3', fixture(), NOV28], ['5', fixture({ goals:5, habits:5 }), NOV28], ['0', fixture({ goals:0, habits:0 }), NOV28], ['3-nov15', fixture(), NOV15]]) {
      const h = await setup(browser, { dbs:{ [KEY]:db }, now, mobile:width < 700, viewport:{ width, height:1000 } });
      const page = await h.preview({ width });
      await settle(page);
      await shot(page.locator('.page'), `page-${width}-work-${name}`);
      if (name === '3') {
        await page.frameLocator('#progress').locator('[data-mode="life"]').click();
        await page.frameLocator('#habits').locator('#app[data-mode="life"][data-status="ready"]').waitFor();
        await settle(page);
        await shot(page.locator('.page'), `page-${width}-life-${name}`);
      }
      assert.deepEqual(h.errors, []);
      await h.context.close();
    }
  }
});
