// 피드백 모음 위젯 3종(핵심 모아보기·피드백 검색·면담 기록) 오프라인 브라우저 검증.
// 모든 요청은 이 저장소 파일과 메모리 테스트 데이터로만 응답한다. 운영 Worker 주소로 나가는 요청은 브라우저 안에서 가로챈다.
// 실행: PLAYWRIGHT_MODULE=<playwright 경로> [FEEDBACK_SHOTS=<스크린샷 폴더>] [MEETING_NOTES_SERVER=<서버 모듈 경로>]
//       node --test --test-concurrency=1 sky-lime/tests/feedback.browser.mjs
// MEETING_NOTES_SERVER를 주면 목업 대신 그 서버 모듈(handleMeetingNotes)을 메모리 SQLite 위에서 그대로 돌린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const shots = process.env.FEEDBACK_SHOTS || '';
const realServer = process.env.MEETING_NOTES_SERVER ? await import(pathToFileURL(resolve(process.env.MEETING_NOTES_SERVER)).href) : null;
const origin = 'http://127.0.0.1:4182';
const prefix = '/sky-lime/Worklog/';
const KEY = 'w_feedback_test_instance_12345678';
const OTHER_KEY = 'w_feedback_other_instance_8765432';
const NOW = new Date('2026-10-19T10:00:00+09:00');
const FILES = { keys:'feedback-keys', search:'feedback-search', notes:'meeting-notes' };
const HEIGHTS = { keys:300, search:216, notes:700 };
const FONT_CSS = `@font-face{font-family:"Pretendard Variable";font-weight:45 920;font-style:normal;font-display:block;src:url("${origin}/cream-olive-garden/assets/fonts/pretendard-1.3.9/PretendardVariable.woff2") format("woff2-variations");}`;

// ───────── 테스트 데이터(시안 예시와 다른 테스트 전용 문구) ─────────
let seq = 0;
const uid = p => `${p}${++seq}`;
const L = (t, key = false) => ({ id:uid('l'), t, key });
const T = (h, lines, say = '') => ({ id:uid('t'), h, say, lines:lines.map(item => (Array.isArray(item) ? L(item[0], true) : L(item))) });
const D = (...list) => list.map(item => (Array.isArray(item) ? { id:uid('d'), t:item[0], done:true } : { id:uid('d'), t:item, done:false }));
const R = (id, date, title, who, topics, todos = []) => ({ id, date, title, who, topics, todos, rev:1, createdAt:'2026-01-01T00:00:00.000Z', updatedAt:'2026-01-01T00:00:00.000Z' });
const LONG = Array.from({ length:16 }, (_, i) => (i === 1 || i === 5 ? [`상반기 핵심 문장 ${i + 1}`] : `상반기 돌아보기 문장 ${i + 1}`));
function fixture({ empty = false, noNext = false, noStars = false } = {}) {
  seq = 0;
  let notes = empty ? [] : [
    R('n1', '2026-10-23', '팀장 면담 · 4분기 계획', '팀장', [T('4분기 계획', [''], '새 기획 하나 맡고 싶다고 말하기')]),
    R('r1', '2026-10-12', '사수 면담 (세 번째)', '사수', [
      T('회의 진행', ['주간 회의는 짧게 공유하기', ['회의 전에 결론부터 한 줄 정리'], '안건은 하루 전에 올리기', '결정 사항 칸 두기']),
      T('요청하는 법', ['메신저는 결론 먼저', ['요청할 때 의도와 원하는 액션 같이 말하기'], '리뷰 요청 때 볼 곳 짚기']),
      T('다음 분기', ['라이브 대응 인수인계 시점', '신규 기획 하나 맡기'])], D(['주간 회의 시간 잡기'], '요약 템플릿 만들기')),
    R('r2', '2026-09-24', '팀장 면담', '팀장', [T('문서', [['보내기 전에 받는 사람 입장에서 읽기'], ['일정 밀리면 미리 공유'], '숫자는 전 분기 대비'])], D(['관련 책 읽기'], '일정표 공유 루틴')),
    R('r3', '2026-09-03', '사수 면담 (두 번째)', '사수', [T('말하는 법', ['배경부터 길게 말하는 버릇', ['두괄식으로 대화 연습'], '막히면 30분 뒤 바로 묻기'])], D('질문 메모장 만들기')),
    R('r4', '2026-07-15', '상반기 피드백', '팀장', [T('상반기 돌아보기', LONG)], D(['하반기 목표 정리'], '주간 회고 시작')),
    R('r5', '2026-06-10', '사수 면담 (첫 번째)', '사수', [T('기획서', [['결정할 부분을 맨 위에'], '표 머리글 고정'])], D(['기획서 템플릿 정리'])),
    R('r6', '2026-05-20', '동료 면담 · 지민', '동료 지민', [T('리뷰', ['QA 요청 때 재현 순서를 번호로', ['리뷰 요청 때 볼 부분 짚기']])]),
    R('r7', '2026-03-30', '팀장 면담 (1분기)', '팀장', [T('우선순위', [['겹치는 일은 우선순위 확인받기'], '안건은 하루 전에'], '겹칠 때 기준 여쭤보기'), T('보고', ['주간 보고는 다음 주 계획부터'])], D(['주간 우선순위 공유'])),
    R('r8', '2026-02-11', '사수 면담 (온보딩)', '사수', [T('적응', ['처음 한 달은 질문 많이 해도 됨', '회의록은 결정 사항부터'])], D(['팀 위키 정리'])),
    R('r9', '2026-01-20', '팀장 면담 (입사)', '팀장', [T('기대', ['첫 분기엔 라이브 대응으로 흐름 익히기'])])
  ];
  if (noNext) notes = notes.filter(note => note.id !== 'n1');
  if (noStars) notes.forEach(note => note.topics.forEach(topic => topic.lines.forEach(line => { line.key = false; })));
  return { notes:new Map(notes.map(note => [note.id, note])), revision:notes.length ? 1 : 0, requests:[], writes:[] };
}

// ───────── 서버 대역 ─────────
// 계약: GET /revision → {revision} · GET /all → {revision, notes(최신 날짜순)} · POST /save {note, baseRev} → {revision, note}
//       POST /delete {id, baseRev} → {id, removed, revision}. 버전이 다르면 409 {error:'conflict', note:현재(없으면 null)}.
class Conflict extends Error { constructor(note) { super('conflict'); this.note = note; } }
const sortNotes = list => [...list].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
function mock(db, path, body) {
  if (path === '/api/meeting-notes/revision') return { revision:db.revision };
  if (path === '/api/meeting-notes/all') return { revision:db.revision, notes:sortNotes(db.notes.values()) };
  const id = path.endsWith('/save') ? body.note.id : body.id;
  const current = db.notes.get(id) || null;
  if ((current?.rev || 0) !== body.baseRev) throw new Conflict(current);
  if (path.endsWith('/delete')) {
    if (!current) return { id, removed:false };
    db.notes.delete(id);
    return { id, removed:true, revision:++db.revision };
  }
  const note = { ...structuredClone(body.note), rev:body.baseRev + 1, createdAt:current?.createdAt || NOW.toISOString(), updatedAt:NOW.toISOString() };
  db.notes.set(id, note);
  return { revision:++db.revision, note };
}
async function realD1() {
  const { DatabaseSync } = await import('node:sqlite');
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE widget_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT)');
  const exec = (text, params) => {
    if (/^\s*SELECT|RETURNING/i.test(text)) { const results = sql.prepare(text).all(...params); return { results, meta:{ changes:/RETURNING/i.test(text) ? results.length : 0 } }; }
    return { results:[], meta:{ changes:sql.prepare(text).run(...params).changes } };
  };
  const statement = (text, params) => ({ text, params, async all() { return { results:sql.prepare(text).all(...params) }; }, async run() { return exec(text, params); } });
  return { sql, DB:{ prepare(text) { return { bind(...params) { return statement(text, params); } }; },
    async batch(list) { sql.exec('BEGIN'); try { const out = list.map(s => exec(s.text, s.params)); sql.exec('COMMIT'); return out; } catch (e) { sql.exec('ROLLBACK'); throw e; } } } };
}
function seedReal(d1, db, key) {
  d1.sql.prepare('INSERT INTO widget_settings VALUES (?, ?, ?)').run(`instance-meta:${key}`, '{}', 'seed');
  for (const note of db.notes.values()) d1.sql.prepare('INSERT INTO widget_settings VALUES (?, ?, ?)').run(`instance:${key}:meetingNotes:v1:note:${note.id}`, JSON.stringify(note), 'seed');
  if (db.revision) d1.sql.prepare('INSERT INTO widget_settings VALUES (?, ?, ?)').run(`instance:${key}:meetingNotes:v1:rev`, JSON.stringify({ rev:db.revision }), 'seed');
}

async function setup(browser, { dbs = { [KEY]:fixture(), [OTHER_KEY]:fixture({ empty:true }) }, now = NOW, viewport = { width:1320, height:900 }, mobile = false } = {}) {
  const context = await browser.newContext({ viewport, timezoneId:'Asia/Seoul', serviceWorkers:'block', ...(mobile ? { isMobile:true, hasTouch:true, deviceScaleFactor:2 } : {}) });
  await context.clock.setFixedTime(now);
  let shared = null;
  if (realServer) { shared = await realD1(); for (const [key, db] of Object.entries(dbs)) seedReal(shared, db, key); }
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
        const type = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.woff2':'font/woff2' }[extname(path)] || 'application/octet-stream';
        return route.fulfill({ body:await readFile(path), contentType:type });
      } catch { return route.fulfill({ status:404, body:'Not found' }); }
    }
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('pretendard')) return route.fulfill({ contentType:'text/css', body:FONT_CSS });
    if (url.hostname === 'notion-widget.wldnjsdkk.workers.dev') {
      const headers = { 'access-control-allow-origin':'*', 'access-control-allow-headers':'*', 'access-control-allow-methods':'GET, POST, OPTIONS' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status:204, headers });
      const instance = url.searchParams.get('w');
      const db = dbs[instance];
      const entry = { path:url.pathname, method:request.method(), instance, page:request.frame()?.url() || '' };
      if (!db) { (dbs.__unknown ||= []).push(entry); return route.fulfill({ status:404, headers, json:{ ok:false, error:'unknown fixture instance' } }); }
      db.requests.push(entry);
      if (db.fail) return route.fulfill({ status:503, headers, json:{ ok:false, error:'offline fixture' } });
      if (!url.pathname.startsWith('/api/meeting-notes/')) throw new Error(`예상하지 못한 요청 ${request.method()} ${url.pathname}`);
      const post = request.method() === 'POST';
      if (post) entry.body = request.postDataJSON();
      try {
        if (realServer) {
          const response = await realServer.handleMeetingNotes(new Request(url, { method:request.method(), body:post ? request.postData() : undefined }), shared, now.getTime());
          return route.fulfill({ status:response.status, headers, body:await response.text(), contentType:'application/json' });
        }
        return route.fulfill({ headers, json:{ ok:true, data:structuredClone(mock(db, url.pathname, entry.body)) } });
      } catch (error) {
        if (error instanceof Conflict) return route.fulfill({ status:409, headers, json:{ ok:false, error:'conflict', note:error.note } });
        throw error;
      } finally {
        if (post) db.writes.push(entry);
      }
    }
    external.push(url.href);
    return route.fulfill({ status:204, body:'' });
  });
  async function open(kind, { key = KEY, width = 1320, height, query } = {}) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height:height || HEIGHTS[kind] });
    await page.goto(`${origin}${prefix}${FILES[kind]}.html${query ?? `?w=${key}`}`);
    await page.waitForFunction(() => ['ready', 'error', 'stale'].includes(document.getElementById('app')?.dataset.status));
    await page.evaluate(() => document.fonts.ready);
    return page;
  }
  async function preview({ width = 1320, key = KEY, kinds = ['keys', 'search', 'notes'] } = {}) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height:1400 });
    await page.goto(`${origin}/__preview?width=${width}&w=${key}&kinds=${kinds.join(',')}`);
    for (const kind of kinds) await page.frameLocator(`#${kind}`).locator('#app[data-status="ready"]').waitFor();
    await page.evaluate(() => document.fonts.ready);
    return page;
  }
  // 서버에 저장된 면담(목업이든 실제 서버 모듈이든)
  const stored = (id, key = KEY) => {
    if (!realServer) return dbs[key].notes.get(id);
    const row = shared.sql.prepare('SELECT value FROM widget_settings WHERE key = ?').get(`instance:${key}:meetingNotes:v1:note:${id}`);
    return row ? JSON.parse(row.value) : undefined;
  };
  // 다른 기기에서 바꾼 것처럼 서버 쪽 면담을 직접 바꾼다(버전 +1).
  const editElsewhere = (id, edit, key = KEY) => {
    const note = structuredClone(stored(id, key));
    edit(note);
    note.rev += 1;
    if (!realServer) { dbs[key].notes.set(id, note); dbs[key].revision += 1; return; }
    shared.sql.prepare('UPDATE widget_settings SET value = ? WHERE key = ?').run(JSON.stringify(note), `instance:${key}:meetingNotes:v1:note:${id}`);
    shared.sql.prepare(`UPDATE widget_settings SET value = json_set(value, '$.rev', json_extract(value, '$.rev') + 1) WHERE key = ?`).run(`instance:${key}:meetingNotes:v1:rev`);
  };
  const deleteElsewhere = (id, key = KEY) => {
    if (!realServer) { dbs[key].notes.delete(id); dbs[key].revision += 1; return; }
    shared.sql.prepare('DELETE FROM widget_settings WHERE key = ?').run(`instance:${key}:meetingNotes:v1:note:${id}`);
    shared.sql.prepare(`UPDATE widget_settings SET value = json_set(value, '$.rev', json_extract(value, '$.rev') + 1) WHERE key = ?`).run(`instance:${key}:meetingNotes:v1:rev`);
  };
  return { context, dbs, errors, external, open, preview, stored, editElsewhere, deleteElsewhere };
}

// 노션 "피드백 모음" 페이지처럼 세 위젯을 위에서 아래로 따로 임베드(서로 다른 iframe).
function previewHtml(url) {
  const width = Number(url.searchParams.get('width')) || 1320;
  const key = url.searchParams.get('w') || KEY;
  const kinds = (url.searchParams.get('kinds') || 'keys,search,notes').split(',');
  const mobile = width < 500;
  const frame = kind => `<iframe id="${kind}" title="${kind}" src="${prefix}${FILES[kind]}.html?w=${key}" style="display:block;width:100%;height:${HEIGHTS[kind]}px;border:0"></iframe>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_CSS}body{margin:0;background:#FFFFFF;font-family:"Pretendard Variable",sans-serif}
    .page{box-sizing:border-box;width:${width}px;padding:${mobile ? '20px 14px 28px' : '36px 40px 44px'};display:flex;flex-direction:column;gap:16px}
    h1{margin:0;padding:0 4px 4px;font-size:${mobile ? 24 : 30}px;font-weight:700;letter-spacing:-.03em;color:#1F1F1D}</style></head>
    <body><div class="page"><h1>피드백 모음</h1>${kinds.map(frame).join('')}</div></body></html>`;
}

const browser = await chromium.launch();
test.after(() => browser.close());
const shot = async (target, name) => {
  if (!shots) return;
  await mkdir(shots, { recursive:true });
  await target.screenshot({ path:resolve(shots, `${name}.png`) });
};
async function fits(page) {
  return page.evaluate(() => {
    const root = document.getElementById('app');
    const card = root.getBoundingClientRect();
    const clipped = [...root.querySelectorAll('*')].filter(node => node.offsetParent !== null).filter(node => {
      const box = node.getBoundingClientRect();
      return box.height > 0 && (box.bottom > card.bottom + .5 || box.right > card.right + .5);
    }).map(node => node.className || node.tagName);
    const scrollers = [...root.querySelectorAll('*')].filter(node => node.scrollHeight > node.clientHeight + 1 && getComputedStyle(node).overflowY !== 'visible' && node.clientHeight > 0)
      .map(node => node.className);
    return { scroll:document.scrollingElement.scrollHeight > innerHeight + 1 || document.scrollingElement.scrollWidth > innerWidth + 1,
      height:Math.round(card.height), clipped, scrollers };
  });
}
const ok = (result, label) => assert.deepEqual([result.scroll, result.clipped], [false, []], `${label} ${JSON.stringify(result)}`);
const waitWrites = async (h, count, key = KEY) => { const start = Date.now(); while (h.dbs[key].writes.length < count && Date.now() - start < 5000) await new Promise(done => setTimeout(done, 50)); };
const sleep = ms => new Promise(done => setTimeout(done, ms));

test('높이: 핵심 300 · 검색 216 고정, 면담 기록은 임베드 100%(404·700·1000) · 잘림·스크롤 없음', { timeout:180000 }, async () => {
  const h = await setup(browser);
  for (const width of [1320, 1130]) {
    const keys = await h.open('keys', { width });
    let result = await fits(keys);
    ok(result, `keys ${width}`);
    assert.equal(result.height, 299);
    assert.equal(await keys.locator('#app').getAttribute('data-count'), '6', 'PC 3칸 × 2줄');
    const search = await h.open('search', { width });
    result = await fits(search);
    ok(result, `search ${width}`);
    assert.equal(result.height, 215);
    await keys.close(); await search.close();
  }
  const counts = {};
  for (const height of [404, 700, 1000]) {
    const notes = await h.open('notes', { width:1320, height });
    const result = await fits(notes);
    ok(result, `notes ${height}`);
    assert.equal(result.height, height - 1);
    counts[height] = Number(await notes.locator('#app').getAttribute('data-count'));
    // 팝업: 꽉 찬 주제(16줄)는 높이에 들어가는 만큼만 + "외 n줄 · + 주제로 나눠 적어요"
    await notes.locator('[data-id="r4"]').click();
    const shown = await notes.locator('.fb-line').count();
    const more = await notes.locator('.fb-more-line').textContent();
    // 다 들어가면(1000px) "+ 들은 말", 아니면 숨긴 줄 수와 함께 "+ 주제로 나눠 적어요"
    assert.equal(more, shown === 16 ? '+ 들은 말' : `외 ${16 - shown}줄 · + 주제로 나눠 적어요`);
    ok(await fits(notes), `notes popup ${height}`);
    counts[`p${height}`] = shown;
    await shot(notes, `notes-1320-h${height}-popup-full`);
    await notes.keyboard.press('Escape');
    await shot(notes, `notes-1320-h${height}`);
    await notes.close();
  }
  // 목록: 한 줄 54px 기준으로 높이에 따라 늘어남(404 → 5줄, 700 → 10줄, 1000 → 기록 수 10개 전부)
  assert.deepEqual([counts[404], counts[700], counts[1000]], [5, 10, 10]);
  assert.ok(counts.p404 < counts.p700 && counts.p700 < counts.p1000, JSON.stringify(counts));
  // 모바일: 핵심 1칸, 검색 216 그대로
  const phone = await setup(browser, { mobile:true, viewport:{ width:390, height:300 } });
  const mk = await phone.open('keys', { width:390 });
  ok(await fits(mk), 'keys 390');
  assert.equal(await mk.locator('#app').getAttribute('data-count'), '2', '모바일 1칸 × 2줄');
  const ms = await phone.open('search', { width:390 });
  ok(await fits(ms), 'search 390');
  const mn = await phone.open('notes', { width:390, height:700 });
  ok(await fits(mn), 'notes 390');
  await mn.locator('[data-id="r1"]').click();
  const [pop, card] = await Promise.all([mn.locator('#pop').boundingBox(), mn.locator('#app').boundingBox()]);
  assert.ok(Math.abs(pop.width - card.width) < 3 && Math.abs(pop.height - card.height) < 3, '모바일 팝업은 위젯 전체');
  for (const x of [h, phone]) { assert.deepEqual(x.errors, []); assert.deepEqual(x.external, []); await x.context.close(); }
});

test('핵심 모아보기: 오늘까지 면담의 ★만 최신순 · 문장 + MM/DD · 준 사람 · 빈 상태', { timeout:60000 }, async () => {
  const h = await setup(browser);
  const page = await h.open('keys');
  const texts = await page.locator('.fb-key-text').allTextContents();
  assert.deepEqual(texts, ['회의 전에 결론부터 한 줄 정리', '요청할 때 의도와 원하는 액션 같이 말하기', '보내기 전에 받는 사람 입장에서 읽기', '일정 밀리면 미리 공유', '두괄식으로 대화 연습', '상반기 핵심 문장 2']);
  assert.equal(await page.locator('.fb-key-meta').first().textContent(), '10/12 · 사수');
  await shot(page, 'keys-1320-full');
  const none = await setup(browser, { dbs:{ [KEY]:fixture({ noStars:true }) } });
  const empty = await none.open('keys');
  assert.equal(await empty.locator('#message').textContent(), '면담 기록에서 ☆를 누르면 여기에 모여요');
  await shot(empty, 'keys-1320-0');
  for (const x of [h, none]) { assert.deepEqual(x.errors, []); await x.context.close(); }
});

test('피드백 검색: 우선순위·접두어·문장 자르기·굵게·★, 3개 초과 문구, 상태 문구', { timeout:60000 }, async () => {
  const h = await setup(browser);
  const page = await h.open('search');
  assert.equal(await page.locator('#results').textContent(), '면담 내용이나 준 사람으로 찾아보세요');
  await shot(page, 'search-idle');
  await page.locator('#query').fill('두괄식');
  assert.equal(await page.locator('.fb-result').count(), 1);
  assert.equal(await page.locator('.fb-date').textContent(), '09/03');
  assert.equal(await page.locator('.fb-name').textContent(), '사수 면담 (두 번째) · 사수');
  assert.equal(await page.locator('.fb-line2').textContent(), '★ 두괄식으로 대화 연습');
  assert.equal(await page.locator('.fb-line2 b').textContent(), '두괄식');
  await shot(page, 'search-hit');
  // 내가 할 말 · 할 일 접두어
  await page.locator('#query').fill('기준 여쭤');
  assert.equal(await page.locator('.fb-line2').textContent(), '내가 할 말 · 겹칠 때 기준 여쭤보기', '접두어는 자르지 않는다');
  await page.locator('#query').fill('템플릿');
  assert.deepEqual(await page.locator('.fb-line2').allTextContents(), ['할 일 · 요약 템플릿 만들기', '할 일 · 기획서 템플릿 정리']);
  // 대소문자·공백 무시
  await page.locator('#query').fill('qa요청');
  assert.equal(await page.locator('.fb-line2 b').textContent(), 'QA 요청');
  // 3개 넘으면 헤더 오른쪽 문구, 결과는 최신 3개
  await page.locator('#query').fill('면담');
  assert.equal(await page.locator('.fb-result').count(), 3);
  assert.equal(await page.locator('#more').isVisible(), true);
  assert.deepEqual(await page.locator('.fb-date').allTextContents(), ['10/23', '10/12', '09/24']);
  await shot(page, 'search-more');
  // 긴 문장: 찾은 단어 앞 12자부터, 앞이 잘리면 …
  await page.locator('#query').fill('흐름');
  assert.equal(await page.locator('.fb-line2').textContent(), '…기엔 라이브 대응으로 흐름 익히기');
  await page.locator('#query').fill('연봉');
  assert.equal(await page.locator('#results').textContent(), '찾는 내용이 없어요');
  await shot(page, 'search-none');
  await page.locator('#clear').click();
  assert.equal(await page.locator('#query').inputValue(), '');
  // 면담 기록 위젯이 없으면 회색 한 줄
  await page.locator('#query').fill('회의');
  await page.locator('.fb-result').first().click();
  await page.waitForSelector('.fb-message.is-nolink');
  assert.equal(await page.locator('#results').textContent(), '아래 면담 기록에서 열 수 없어요');
  await shot(page, 'search-nolink');
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('핵심·검색 → 면담 기록 열기(다른 iframe): 그 면담·주제·줄 1.5초 강조, ★ 누르면 핵심에 바로 반영', { timeout:90000 }, async () => {
  const h = await setup(browser);
  const page = await h.preview({ width:1320 });
  const frame = kind => page.frameLocator(`#${kind}`);
  // 검색 "액션" → 사수 면담 (세 번째)의 2번째 주제 "요청하는 법", 찾은 줄 강조
  await frame('search').locator('#query').fill('액션');
  await frame('search').locator('.fb-result').first().click();
  await frame('notes').locator('#layer:not([hidden])').waitFor();
  assert.equal(await frame('notes').locator('.fb-pop-title').inputValue(), '사수 면담 (세 번째)');
  assert.equal(await frame('notes').locator('.fb-topic-name').inputValue(), '요청하는 법');
  assert.equal(await frame('notes').locator('.fb-line.is-hl .fb-line-input').inputValue(), '요청할 때 의도와 원하는 액션 같이 말하기');
  assert.equal(await frame('notes').locator('.fb-pager span').textContent(), '2 / 3');
  await shot(page.locator('.page'), 'page-1320-search-open');
  await sleep(1700);
  assert.equal(await frame('notes').locator('.fb-line.is-hl').count(), 0, '1.5초 뒤 강조 끝');
  assert.equal(await frame('search').locator('.fb-message.is-nolink').count(), 0);
  // ★ 켜기 → 핵심 모아보기에 바로(2분 기다리지 않고)
  const before = await frame('keys').locator('.fb-key-text').allTextContents();
  await frame('notes').locator('.fb-line').first().locator('[data-act="star"]').click();
  await frame('keys').locator('.fb-key-text', { hasText:'메신저는 결론 먼저' }).waitFor({ timeout:4000 });
  assert.notDeepEqual(await frame('keys').locator('.fb-key-text').allTextContents(), before);
  await frame('notes').locator('[data-act="close"]').click();
  // 핵심 모아보기 항목 → 면담 기록에서 열기
  await frame('keys').locator('.fb-key', { hasText:'두괄식으로 대화 연습' }).click();
  await frame('notes').locator('.fb-line.is-hl').waitFor();
  assert.equal(await frame('notes').locator('.fb-pop-title').inputValue(), '사수 면담 (두 번째)');
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('면담 기록: 목록(다음 면담·★·할 일), 추가 → 팝업 · 첫 줄 커서, Enter 새 줄, 빈 줄 Backspace, ★, 주제, 내가 할 말, 닫을 때 정리', { timeout:120000 }, async () => {
  const h = await setup(browser);
  const page = await h.open('notes', { height:700 });
  const rows = page.locator('.fb-row');
  assert.equal(await rows.first().locator('.fb-next').textContent(), '다음');
  assert.equal(await rows.first().locator('.fb-row-date').textContent(), '10/23');
  assert.equal(await page.locator('[data-id="r1"] .fb-row-stars').textContent(), '★ 2');
  assert.equal(await page.locator('[data-id="r1"] .fb-row-todo').textContent(), '할 일 1');
  assert.equal(await page.locator('[data-id="r6"] .fb-row-todo').count(), 0);
  await shot(page, 'notes-list-next');
  // 추가: 날짜 오늘, 바로 팝업, 첫 들은 말 줄에 커서
  await page.locator('#titleInput').fill('새 면담 테스트');
  await page.locator('#titleInput').press('Enter');
  await page.locator('#layer:not([hidden])').waitFor();
  assert.equal(await page.locator('.fb-pop-title').inputValue(), '새 면담 테스트');
  assert.equal(await page.locator('.fb-date-input').inputValue(), '2026-10-19');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'fb-line-input');
  await waitWrites(h, 1);
  const id = h.dbs[KEY].writes[0].body.note.id;
  await shot(page, 'notes-popup-new');
  await page.keyboard.type('첫 줄');
  await page.keyboard.press('Enter');
  await page.keyboard.type('둘째 줄');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.fb-line').count(), 3);
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('.fb-line').count(), 2, '빈 줄 Backspace = 줄 삭제');
  assert.equal(await page.evaluate(() => document.activeElement.value), '둘째 줄', '윗줄로');
  // 한글 조합 중 Enter는 무시
  await page.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', isComposing:true, bubbles:true })));
  assert.equal(await page.locator('.fb-line').count(), 2);
  // ★
  await page.locator('.fb-line').first().locator('[data-act="star"]').click();
  assert.equal(await page.locator('.fb-line.is-key').count(), 1);
  assert.equal(await page.locator('.fb-line.is-key .fb-mark').textContent(), '★');
  await shot(page, 'notes-popup-star');
  // 내가 할 말 · 주제명
  await page.locator('.fb-say-input').fill('먼저 꺼낼 말');
  await page.locator('.fb-topic-name').fill('첫 주제');
  // + 주제 → 새 주제로 바로 이동, 주제명에 커서
  await page.locator('.fb-foot [data-act="add-topic"]').click();
  assert.equal(await page.locator('.fb-pager span').textContent(), '2 / 2');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'fb-topic-name');
  await page.keyboard.type('둘째 주제');
  await page.locator('[data-act="prev"]').click();
  assert.equal(await page.locator('.fb-topic-name').inputValue(), '첫 주제');
  assert.equal(await page.locator('[data-act="prev"]').isDisabled(), true, '끝에서는 화살표 흐리게');
  // + 주제를 하나 더 만들고 비워 둔 채 닫으면 정리된다
  await page.locator('.fb-foot [data-act="add-topic"]').click();
  await page.keyboard.press('Escape');
  await page.locator('#layer[hidden]').waitFor({ state:'attached' });
  await sleep(1500);
  // 셋째(완전히 빈) 주제는 지워지고, 둘째 주제는 주제명이 있어 남되 빈 줄은 지워진다.
  const saved = h.stored(id);
  assert.deepEqual(saved.topics.map(topic => [topic.h, topic.say, topic.lines.map(line => [line.t, line.key])]),
    [['첫 주제', '먼저 꺼낼 말', [['첫 줄', true], ['둘째 줄', false]]], ['둘째 주제', '', []]], '빈 주제·빈 줄 정리');
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('할 일 화면: 버튼(남은/전체·+ 할 일), 체크·취소선, Enter 새 줄, × 삭제, ← 돌아가기', { timeout:90000 }, async () => {
  const h = await setup(browser);
  const page = await h.open('notes', { height:700 });
  await page.locator('[data-id="r6"]').click();
  assert.equal(await page.locator('.fb-todo-button').textContent(), '+ 할 일');
  assert.equal(await page.locator('.fb-todo-button.is-left').count(), 0, '할 일 없으면 회색');
  await shot(page, 'notes-popup-todo0');
  await page.keyboard.press('Escape');
  await page.locator('[data-id="r1"]').click();
  assert.equal(await page.locator('.fb-todo-button').textContent(), '할 일 1/2');
  assert.equal(await page.locator('.fb-todo-button.is-left').count(), 1, '남은 게 있으면 연한 하늘색');
  await page.locator('[data-act="todo"]').click();
  assert.equal(await page.locator('.fb-sub').textContent(), '사수 면담 (세 번째)');
  assert.equal(await page.locator('.fb-todo.is-done .fb-todo-input').inputValue(), '주간 회의 시간 잡기');
  assert.equal(await page.locator('.fb-todo.is-done .fb-todo-input').evaluate(node => getComputedStyle(node).textDecorationLine), 'line-through');
  await shot(page, 'notes-popup-todo');
  const before = h.dbs[KEY].writes.length;
  await page.locator('.fb-todo').nth(1).locator('[data-act="check"]').click();
  await waitWrites(h, before + 1);
  assert.deepEqual(h.stored('r1').todos.map(todo => todo.done), [true, true]);
  await page.locator('.fb-todo-input').nth(1).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('새 할 일');
  assert.equal(await page.locator('.fb-todo').count(), 3);
  await page.locator('.fb-todo').first().hover();
  await page.locator('.fb-todo').first().locator('[data-act="todo-x"]').click();
  assert.equal(await page.locator('.fb-todo').count(), 2);
  await page.locator('[data-act="back"]').click();
  assert.equal(await page.locator('.fb-todo-button').textContent(), '할 일 1/2');
  await page.locator('[data-act="close"]').click();
  await sleep(1500);
  assert.deepEqual(h.stored('r1').todos.map(todo => [todo.t, todo.done]), [['요약 템플릿 만들기', true], ['새 할 일', false]]);
  assert.equal(await page.locator('[data-id="r1"] .fb-row-todo').textContent(), '할 일 1');
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('준 사람 자동완성 · 줄 ×/주제 삭제 · 꽉 찬 주제 Enter · 기록 삭제 두 번', { timeout:90000 }, async () => {
  const h = await setup(browser);
  const page = await h.open('notes', { height:700 });
  await page.locator('[data-id="r8"]').click();
  await page.locator('.fb-who').click();
  assert.equal(await page.locator('#sug').isHidden(), true, '입력과 똑같은 이름(사수)만 있으면 목록 없음');
  await page.locator('.fb-who').fill('');
  assert.deepEqual(await page.locator('.fb-sug-item').allTextContents(), ['팀장', '사수', '동료 지민'], '다른 기록에서 많이 쓴 순');
  await page.locator('.fb-who').fill('지');
  assert.deepEqual(await page.locator('.fb-sug-item').allTextContents(), ['동료 지민']);
  await shot(page, 'notes-popup-who');
  await page.locator('.fb-who').press('Enter');
  assert.equal(await page.locator('.fb-who').inputValue(), '동료 지민');
  assert.equal(await page.locator('#sug').isHidden(), true);
  // 줄 끝 ×(마우스 올리면)
  await page.locator('.fb-line').first().hover();
  await page.locator('.fb-line').first().locator('[data-act="line-x"]').click();
  assert.equal(await page.locator('.fb-line').count(), 1);
  await page.keyboard.press('Escape');
  await sleep(1500);
  assert.equal(h.stored('r8').who, '동료 지민');
  assert.deepEqual(h.stored('r8').topics[0].lines.map(line => line.t), ['회의록은 결정 사항부터']);
  // 주제 삭제(주제 2개 이상, 마우스 올리면)
  await page.locator('[data-id="r7"]').click();
  await page.locator('.fb-topic').hover();
  assert.equal(await page.locator('[data-act="topic-del"]').isVisible(), true);
  await page.locator('[data-act="topic-del"]').click();
  assert.equal(await page.locator('.fb-pager').count(), 0, '주제 1개면 ‹ n / 전체 › 숨김');
  await page.locator('.fb-topic').hover();
  assert.equal(await page.locator('[data-act="topic-del"]').count(), 0);
  await page.keyboard.press('Escape');
  // 꽉 찬 주제에서는 Enter로 새 줄이 생기지 않는다
  await page.locator('[data-id="r4"]').click();
  const lines = await page.locator('.fb-line').count();
  await page.locator('.fb-line-input').last().click();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.fb-line').count(), lines);
  await page.locator('.fb-more-line.is-full').click();
  assert.equal(await page.locator('.fb-pager span').textContent(), '2 / 2', '"+ 주제로 나눠 적어요" → 새 주제');
  await page.keyboard.press('Escape');
  // 기록 삭제: 한 번 → "정말 삭제?" 2초, 그 안에 한 번 더 → 삭제
  await page.locator('[data-id="r9"]').click();
  await page.locator('[data-act="del-note"]').click();
  assert.equal(await page.locator('[data-act="del-note"]').textContent(), '정말 삭제?');
  await shot(page, 'notes-popup-delete-armed');
  await sleep(2200);
  assert.equal(await page.locator('[data-act="del-note"]').textContent(), '기록 삭제', '2초 지나면 원래대로');
  await page.locator('[data-act="del-note"]').click();
  await page.locator('[data-act="del-note"]').click();
  assert.equal(await page.locator('#layer').isHidden(), true);
  await sleep(500);
  assert.equal(h.stored('r9'), undefined);
  assert.equal(await page.locator('[data-id="r9"]').count(), 0);
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('버전 충돌: ★·체크·삭제는 최신 위에 다시 적용해 저장, 글자 수정은 다시 입력 안내, 다른 곳에서 지우면 닫힘', { timeout:90000 }, async () => {
  const h = await setup(browser);
  const page = await h.open('notes', { height:700 });
  // ① 단순 동작(★): 다른 기기가 제목을 바꾼 뒤 ★를 누름 → 409 → 최신 제목 + ★ 다시 적용해 저장
  await page.locator('[data-id="r2"]').click();
  h.editElsewhere('r2', note => { note.title = '다른 기기에서 바꾼 제목'; });
  await page.locator('.fb-line').nth(2).locator('[data-act="star"]').click();
  await page.waitForFunction(() => document.querySelector('.fb-pop-title')?.value === '다른 기기에서 바꾼 제목');
  await sleep(800);
  let saved = h.stored('r2');
  assert.equal(saved.title, '다른 기기에서 바꾼 제목');
  assert.deepEqual(saved.topics[0].lines.map(line => line.key), [true, true, true], '★ 다시 적용');
  assert.equal(await page.locator('.fb-conflict').textContent(), '', '단순 동작만이면 안내 없음');
  await page.keyboard.press('Escape');
  // ② 글자 수정: 최신 내용으로 바뀌고 다시 입력 안내
  await page.locator('[data-id="r3"]').click();
  h.editElsewhere('r3', note => { note.topics[0].h = '다른 기기 주제명'; });
  await page.locator('.fb-line-input').first().fill('여기서 고친 글자');
  await page.locator('.fb-conflict', { hasText:'고친 글자는 다시 입력해 주세요' }).waitFor({ timeout:5000 });
  assert.equal(await page.locator('.fb-topic-name').inputValue(), '다른 기기 주제명');
  assert.equal(await page.locator('.fb-line-input').first().inputValue(), '배경부터 길게 말하는 버릇');
  await shot(page, 'notes-popup-conflict');
  saved = h.stored('r3');
  assert.equal(saved.topics[0].h, '다른 기기 주제명');
  assert.ok(!JSON.stringify(saved).includes('여기서 고친 글자'), '덮어쓰지 않음');
  await page.keyboard.press('Escape');
  // ③ 섞인 경우: 할 일 체크 + 글자 → 체크만 다시 적용, 안내 표시
  await page.locator('[data-id="r5"]').click();
  h.editElsewhere('r5', note => { note.who = '다른 사수'; });
  await page.locator('.fb-say-input').fill('붙여 둘 말');
  await page.locator('[data-act="todo"]').click();
  await page.locator('.fb-todo').first().locator('[data-act="check"]').click();
  await page.locator('[data-act="back"]').click();
  await page.locator('.fb-conflict', { hasText:'다시 입력' }).waitFor({ timeout:5000 });
  await sleep(800);
  saved = h.stored('r5');
  assert.deepEqual([saved.who, saved.todos[0].done, saved.topics[0].say], ['다른 사수', false, ''], '체크 해제 다시 적용 · 글자는 반영 안 함');
  await page.keyboard.press('Escape');
  // ④ 다른 곳에서 지운 면담에서 ★ → 닫히고 목록에서 바로 빠짐
  await page.locator('[data-id="r6"]').click();
  h.deleteElsewhere('r6');
  await page.locator('.fb-line').first().locator('[data-act="star"]').click();
  await page.locator('#layer').waitFor({ state:'hidden' });
  assert.equal(await page.locator('[data-id="r6"]').count(), 0);
  assert.equal(h.stored('r6'), undefined);
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('다른 기기 변경 반영 · 연결 실패(이전 자료 보기만) · 다른 키와 안 섞임 · 브라우저 저장소 안 씀', { timeout:90000 }, async () => {
  const h = await setup(browser);
  const page = await h.open('notes', { height:700 });
  await page.locator('[data-id="r9"]').click();
  h.editElsewhere('r9', note => { note.title = '다른 기기 제목'; });
  await h.context.clock.setFixedTime(new Date(NOW.getTime() + 3 * 60000)); // 2분 공유 캐시가 지난 뒤
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => document.querySelector('.fb-pop-title')?.value === '다른 기기 제목');
  await page.keyboard.press('Escape');
  // 연결 실패: 이전 자료는 보여주되 고치거나 추가할 수 없다
  h.dbs[KEY].fail = true;
  await h.context.clock.setFixedTime(new Date(NOW.getTime() + 6 * 60000));
  await page.reload();
  await page.waitForFunction(() => ['stale', 'error'].includes(document.getElementById('app').dataset.status));
  assert.equal(await page.locator('#app').getAttribute('data-status'), 'stale');
  assert.equal(await page.locator('#notice').textContent(), '이전 데이터 표시 중 · 연결되면 갱신');
  assert.equal(await page.locator('#titleInput').isDisabled(), true);
  await page.locator('[data-id="r1"]').click();
  assert.equal(await page.locator('.fb-line-input').first().getAttribute('readonly'), '');
  assert.equal(await page.locator('[data-act="star"]').first().isDisabled(), true);
  const fresh = await setup(browser, { dbs:{ [KEY]:{ ...fixture(), fail:true } } });
  const failed = await fresh.open('keys');
  assert.equal(await failed.locator('#message').textContent(), '불러오지 못했어요 · 잠시 후 다시 확인해요');
  // 다른 키: 그 키의 기록만
  const other = await setup(browser);
  const mine = await other.open('notes', { height:700 });
  const theirs = await other.open('notes', { key:OTHER_KEY, height:700 });
  assert.equal(await theirs.locator('#list').textContent(), '면담이 끝나면 들은 내용을 적어 두세요');
  await shot(theirs, 'notes-empty');
  await theirs.locator('#titleInput').fill('다른 키 기록');
  await theirs.locator('#addButton').click();
  await waitWrites(other, 1, OTHER_KEY);
  await theirs.keyboard.press('Escape');
  assert.equal(await mine.locator('.fb-row-title', { hasText:'다른 키 기록' }).count(), 0);
  assert.ok(other.dbs[KEY].requests.every(entry => new URL(entry.page).searchParams.get('w') === KEY));
  assert.ok(other.dbs[OTHER_KEY].requests.every(entry => new URL(entry.page).searchParams.get('w') === OTHER_KEY));
  assert.deepEqual(await mine.evaluate(() => Object.keys(localStorage)), [], '브라우저 저장소에 아무것도 두지 않음');
  for (const x of [h, fresh, other]) { assert.deepEqual(x.external, []); await x.context.close(); }
});

test('스크린샷: 페이지 1320 · 1130 · 390, 목록·팝업 상태', { timeout:240000, skip:!shots }, async () => {
  for (const width of [1320, 1130, 390]) {
    const h = await setup(browser, { mobile:width < 500, viewport:{ width, height:1400 } });
    const page = await h.preview({ width });
    await shot(page.locator('.page'), `page-${width}`);
    // 시안 상태: 주제 3개 중 2번째 · 내가 할 말 · ★
    await page.frameLocator('#notes').locator('[data-id="r1"]').click();
    await page.frameLocator('#notes').locator('[data-act="next"]').click();
    await shot(page.locator('.page'), `page-${width}-popup-topic2`);
    await page.frameLocator('#notes').locator('[data-act="close"]').click();
    await page.frameLocator('#notes').locator('[data-id="r7"]').click();
    await shot(page.locator('.page'), `page-${width}-popup-say`);
    await h.context.close();
  }
  for (const [name, options] of [['nonext', { noNext:true }], ['nostars', { noStars:true }]]) {
    const h = await setup(browser, { dbs:{ [KEY]:fixture(options) } });
    const page = await h.preview({ width:1320 });
    await shot(page.locator('.page'), `page-1320-${name}`);
    await h.context.close();
  }
});
