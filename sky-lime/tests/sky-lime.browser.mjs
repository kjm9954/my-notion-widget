// sky-lime 위젯 4종 오프라인 브라우저 검증. 모든 요청은 이 저장소 파일과 메모리 테스트 데이터로만 응답한다.
// 운영 Worker 주소로 나가는 요청은 브라우저 안에서 가로채며 실제 서버·실데이터에 닿지 않는다.
// 실행: PLAYWRIGHT_MODULE=<playwright 경로> [SKY_LIME_SHOTS=<스크린샷 폴더>] node --test sky-lime/tests/sky-lime.browser.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const shots = process.env.SKY_LIME_SHOTS || '';
const origin = 'http://127.0.0.1:4180';
const prefix = '/sky-lime/Worklog/';
const KEY = 'w_skylime_test_instance_123456789';
const OTHER_KEY = 'w_skylime_other_instance_98765432';
const NOW = new Date('2026-10-14T10:00:00+09:00');
const TODAY = '2026-10-14';
const FILES = { goals:'weekly-goals', worklog:'worklog-sky-lime', week:'week-review', notes:'notes' };
const HEIGHTS = { goals:214, worklog:900, week:330, notes:370 };
const FONT_CSS = `@font-face{font-family:"Pretendard Variable";font-weight:45 920;font-style:normal;font-display:block;src:url("${origin}/cream-olive-garden/assets/fonts/pretendard-1.3.9/PretendardVariable.woff2") format("woff2-variations");}`;

// 시안 예시와 다른, 테스트 전용 데이터.
function task(id, extra = {}) {
  return { id, mode:'work', date:TODAY, proj:'', q:null, title:`테스트 업무 ${id}`, due:null, start:null, end:null, progress:null, est:null,
    status:'wait', done:false, doneAt:null, goalId:null, memo:'', rolledFrom:null, progressTouched:false, ...extra };
}
function fixture() {
  const tasks = [
    task('a1', { title:'분기 지표 정리 문서 초안 작성', status:'doing', due:'2026-10-16', proj:'문서', goalId:'worklog:goal:1',
      memo:'지표 정의를 먼저 맞추고 표 세 개를 정리한 다음, 공유 전에 숫자 단위와 표기 방식을 한 번 더 확인하기' }),
    task('a2', { title:'신규 기능 점검 회의 자료를 모으고 안건 순서와 참석자 확인까지 마치기', status:'doing', due:TODAY, proj:'회의', goalId:'worklog:goal:2', memo:'참석자 일정 다시 확인' }),
    task('a3', { title:'계약 조건 확인 요청', status:'review', due:'2026-10-15', memo:'회신 기다리는 중' }),
    task('a4', { title:'백로그 우선순위 재정렬', due:'2026-10-12', proj:'문서', goalId:'worklog:goal:3', memo:'다음 주 일정 기준' }),
    task('a5', { title:'사내 안내문 초안', due:TODAY }),
    task('a6', { title:'영수증 묶음 제출', due:'2026-10-17', memo:'세 장 첨부' }),
    task('a7', { title:'행사 장소 후보 찾기' }),
    task('a8', { title:'문의 메일 회신', status:'done', done:true, doneAt:TODAY, prevStatus:'doing', goalId:'worklog:goal:1', memo:'두 건 처리' }),
    task('b1', { title:'지난 회고 작성', date:'2026-10-13', status:'done', done:true, doneAt:'2026-10-13' }),
    task('b2', { title:'배포 체크 점검', date:'2026-10-12', status:'done', done:true, doneAt:'2026-10-12' }),
    task('b3', { title:'어제 시작해 오늘 끝낸 일', date:'2026-10-13', status:'done', done:true, doneAt:TODAY }),
    task('c1', { title:'협력사 미팅 준비', date:'2026-10-15', due:'2026-10-15' }),
    task('c2', { title:'월간 계획 공유', date:'2026-10-16' }),
    task('l1', { mode:'life', title:'저녁 산책 30분', status:'doing', goalId:'worklog:goal:1' }),
    task('l2', { mode:'life', title:'장보기 목록 만들기', due:'2026-10-15' }),
    task('l3', { mode:'life', title:'세탁물 찾기', status:'done', done:true, doneAt:TODAY })
  ];
  return {
    worklog:{ revision:1, mode:'work', workView:'time', tasks, projects:[], lastRollDay:TODAY, lastRollWeek:'2026-W42', lastRollCount:0,
      bannerDismissedDay:'', bannerDismissedWeek:'', manualOrder:{}, columnSplit:{ work:.73, life:6 / 11 }, lastUsed:{ work:{ proj:'미분류', q:null }, life:{ proj:'미분류', q:null } } },
    notes:{ items:[
      { id:'n1', text:'회의실 예약 확인', done:false, doneAt:null },
      { id:'n2', text:'공유 폴더 권한 요청하고 다음 주 일정표에 반영하기, 담당자 회신 오면 체크리스트 갱신', done:false, doneAt:null, mode:'work' },
      { id:'n3', text:'출력물 수령', done:true, doneAt:TODAY, mode:'work' },
      { id:'n4', text:'우유 사기', done:false, doneAt:null, mode:'life' }
    ] },
    goals:{ week:'', items:[], seq:0, carryHandledWeek:'' },
    requests:[], writes:[]
  };
}
const emptyFixture = () => ({ ...fixture(), worklog:{ ...fixture().worklog, tasks:[] }, notes:{ items:[] } });

// legacy=true: review·prevStatus·메모 mode를 모르는 기존 서버처럼 응답한다.
function normalizeTask(raw, legacy) {
  const next = { ...raw };
  if (legacy) {
    if (!['doing', 'done', 'wait'].includes(next.status)) next.status = 'wait';
    delete next.prevStatus;
    delete next.statusChangedAt;
  }
  if (next.done || next.status === 'done') { next.done = true; next.status = 'done'; }
  return next;
}

async function setup(browser, { dbs = { [KEY]:fixture(), [OTHER_KEY]:fixture() }, legacy = false, viewport = { width:1450, height:900 } } = {}) {
  const context = await browser.newContext({ viewport, timezoneId:'Asia/Seoul', serviceWorkers:'block' });
  const errors = [];
  const external = [];
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) {
      if (url.pathname.startsWith('/__preview/')) return route.fulfill({ contentType:'text/html', body:previewHtml(url) });
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
      const entry = { path:url.pathname, method:request.method(), instance, page:request.frame()?.url() || '' };
      if (!db) { (dbs.__unknown ||= []).push(entry); return route.fulfill({ status:404, headers, json:{ ok:false, error:'unknown fixture instance' } }); }
      db.requests.push(entry);
      if (db.fail) return route.fulfill({ status:503, headers, json:{ ok:false, error:'offline fixture' } });
      let data;
      if (request.method() === 'POST') {
        db.writes.push(entry);
        const body = request.postDataJSON();
        if (url.pathname === '/api/worklog/patch') {
          for (const upsert of body.upserts || []) {
            const next = normalizeTask(upsert, legacy);
            const index = db.worklog.tasks.findIndex(item => item.id === next.id);
            if (index >= 0) db.worklog.tasks[index] = next; else db.worklog.tasks.push(next);
          }
          db.worklog.tasks = db.worklog.tasks.filter(item => !(body.deleteIds || []).includes(item.id));
          if (body.meta) Object.assign(db.worklog, body.meta);
          db.worklog.revision += 1;
          data = db.worklog;
        } else if (url.pathname === '/api/worklog/status') {
          const target = db.worklog.tasks.find(item => item.id === body.id);
          if (target) {
            const before = target.done ? 'done' : target.status;
            if (body.status === 'done') Object.assign(target, { status:'done', done:true, doneAt:TODAY, prevStatus:before });
            else Object.assign(target, { status:body.status, done:false, doneAt:null });
            target.statusChangedAt = NOW.toISOString();
          }
          db.worklog.revision += 1;
          data = db.worklog;
        } else if (url.pathname === '/api/notes/patch') {
          for (const update of body.updates || []) {
            let note = db.notes.items.find(item => item.id === update.id);
            if (!note && update.create) { note = { id:update.id, text:'', done:false, doneAt:null }; db.notes.items.push(note); }
            if (!note) continue;
            const changes = { ...update.changes };
            if (legacy) delete changes.mode;
            Object.assign(note, changes);
            if ('done' in changes) note.doneAt = note.done ? TODAY : null;
          }
          db.notes.items = db.notes.items.filter(item => !(body.deleteIds || []).includes(item.id)
            && !(body.cleanupCompleted && item.done && item.doneAt && item.doneAt < TODAY));
          data = db.notes;
        } else if (url.pathname === '/api/weekly-goals/state') { db.goals = body; data = db.goals; }
        else throw new Error(`예상하지 못한 쓰기 ${url.pathname}`);
      } else if (url.pathname === '/api/worklog/state') data = db.worklog;
      else if (url.pathname === '/api/worklog/revision') data = { revision:db.worklog.revision, day:TODAY };
      else if (url.pathname === '/api/notes/state') data = db.notes;
      else if (url.pathname === '/api/weekly-goals/state') data = db.goals;
      else if (url.pathname === '/api/widget-layout') data = { layouts:{} };
      else throw new Error(`예상하지 못한 읽기 ${url.pathname}`);
      return route.fulfill({ headers, json:{ ok:true, data:structuredClone(data) } });
    }
    external.push(url.href);
    return route.fulfill({ status:204, body:'' });
  });
  async function open(kind, { key = KEY, width, height, query } = {}) {
    const page = await context.newPage();
    await page.clock.setFixedTime(NOW);
    if (width) await page.setViewportSize({ width, height:height || HEIGHTS[kind] });
    const search = query ?? (key ? `?w=${key}` : '');
    await page.goto(`${origin}${prefix}${FILES[kind]}.html${search}`);
    await page.waitForFunction(() => ['ready', 'error', 'stale'].includes(document.getElementById('app')?.dataset.status));
    await page.evaluate(() => document.fonts.ready);
    return page;
  }
  return { context, dbs, errors, external, open };
}

function previewHtml(url) {
  const width = Number(url.searchParams.get('width')) || 1450;
  const key = url.searchParams.get('w') || KEY;
  const mode = url.searchParams.get('mode') || 'work';
  const frame = (kind, style) => `<iframe title="${kind}" src="${prefix}${FILES[kind]}.html?w=${key}" style="display:block;border:0;${style}"></iframe>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#FFFFFF;font:13px sans-serif;color:#999}
    .page{width:${width}px;display:flex;flex-direction:column;gap:14px}.row{display:flex;gap:14px}.slot{flex:0 0 calc(65% - 14px);height:370px;border:1px dashed #DDD;border-radius:20px;display:flex;align-items:center;justify-content:center}</style>
    <script>try{localStorage.setItem('sky-lime-worklog-mode-v1:${key}','${mode}')}catch(e){}</script></head><body><div class="page">
    ${frame('goals', `width:100%;height:${HEIGHTS.goals}px`)}
    ${frame('worklog', `width:100%;height:${HEIGHTS.worklog}px`)}
    ${frame('week', `width:100%;height:${HEIGHTS.week}px`)}
    <div class="row"><div class="slot">2단계 캘린더 검색 자리</div>${frame('notes', `flex:1 1 35%;height:${HEIGHTS.notes}px`)}</div>
    </div></body></html>`;
}

const browser = await chromium.launch();
test.after(() => browser.close());
const shot = async (target, name) => {
  if (!shots) return;
  await mkdir(shots, { recursive:true });
  await target.screenshot({ path:resolve(shots, `${name}.png`) });
};
async function noOverflow(page) {
  return page.evaluate(() => ({
    scroll:document.scrollingElement.scrollHeight > innerHeight + 1 || document.scrollingElement.scrollWidth > innerWidth + 1,
    rootHeight:document.getElementById('app').closest('main').getBoundingClientRect().height
  }));
}

test('4개 위젯이 키 주소로 테스트 데이터를 읽고, 고정 높이 안에서 잘림·스크롤이 없다', { timeout:120000 }, async () => {
  const h = await setup(browser);
  for (const width of [1450, 1050]) {
    for (const kind of Object.keys(FILES)) {
      const page = await h.open(kind, { width:kind === 'notes' ? Math.round(width * .35) : width });
      assert.equal(await page.locator('#app').getAttribute('data-status'), 'ready', kind);
      const { scroll, rootHeight } = await noOverflow(page);
      assert.equal(scroll, false, `${kind} ${width} 스크롤`);
      assert.equal(Math.round(rootHeight), HEIGHTS[kind], `${kind} 높이`);
      await page.close();
    }
  }
  assert.ok(h.dbs[KEY].requests.every(entry => entry.instance === KEY), '다른 키 요청 없음');
  assert.equal(h.dbs[OTHER_KEY].requests.length, 0);
  assert.deepEqual(h.external, []);
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('업무일지: 3열 보드, 정렬, 번호 원, D-day, 완료 줄, n개 남음', { timeout:60000 }, async () => {
  const h = await setup(browser);
  const page = await h.open('worklog', { width:1450, height:900 });
  const lane = status => page.locator(`[data-lane="${status}"] [data-task]`).evaluateAll(nodes => nodes.map(node => node.dataset.task));
  assert.deepEqual(await lane('doing'), ['a2', 'a1']);
  assert.deepEqual(await lane('review'), ['a3']);
  assert.deepEqual(await lane('wait'), ['a4', 'a5', 'a6', 'a7']);
  assert.equal(await page.locator('#remain').textContent(), '7개 남음');
  assert.equal(await page.locator('#title').textContent(), '오늘의 업무');
  assert.match(await page.locator('[data-task="a4"] .sl-due').textContent(), /D\+2 지남/);
  assert.equal(await page.locator('[data-task="a4"] .sl-due').evaluate(node => getComputedStyle(node).color), 'rgb(217, 59, 59)');
  assert.equal(await page.locator('[data-task="a5"] .sl-due').textContent(), 'D-day');
  assert.equal(await page.locator('[data-task="a1"] .sl-num').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(206, 241, 140)');
  // 번호가 있든 없든 오른쪽 칸 글자 시작선이 같다.
  const lefts = await page.locator('.sl-card-title').evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().left - node.closest('.sl-card').getBoundingClientRect().left)));
  assert.equal(new Set(lefts).size, 1);
  assert.deepEqual(await page.locator('.sl-done [data-task]').evaluateAll(nodes => nodes.map(node => node.dataset.task)), ['a8']);
  await shot(page, 'worklog-1450');
  // 900px 미만은 상태별 세로 목록
  await page.setViewportSize({ width:860, height:900 });
  await page.waitForFunction(() => document.getElementById('app').classList.contains('is-narrow'));
  assert.equal(await page.locator('.sl-lanes').evaluate(node => getComputedStyle(node).flexDirection), 'column');
  assert.equal((await noOverflow(page)).scroll, false);
  await shot(page, 'worklog-860-list');
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('체크하면 완료, 해제하면 prevStatus(없으면 진행중)로 복원 · 다른 위젯과 새로고침에 반영', { timeout:60000 }, async () => {
  const h = await setup(browser);
  const worklog = await h.open('worklog', { width:1450 });
  const goals = await h.open('goals', { width:1450 });
  const week = await h.open('week', { width:1450 });
  await worklog.locator('[data-toggle="a3"]').click();
  await worklog.waitForFunction(() => document.querySelector('.sl-done [data-task="a3"]'));
  await goals.waitForFunction(() => true);
  let saved = h.dbs[KEY].worklog.tasks.find(item => item.id === 'a3');
  await worklog.waitForFunction(() => !document.querySelector('[data-lane="review"] [data-task="a3"]'));
  await new Promise(done => setTimeout(done, 300));
  saved = h.dbs[KEY].worklog.tasks.find(item => item.id === 'a3');
  assert.deepEqual([saved.status, saved.done, saved.doneAt, saved.prevStatus], ['done', true, TODAY, 'review']);
  // 이번 주 한 일(오늘 칸)에 바로 반영: 남은 개수 7 → 6
  await week.waitForFunction(() => document.querySelector('[data-date="2026-10-14"] .sl-day-count')?.textContent === '6개 남음');
  // 체크 해제 → 검토 대기로 복원
  await worklog.locator('.sl-done [data-toggle="a3"]').click();
  await worklog.waitForFunction(() => document.querySelector('[data-lane="review"] [data-task="a3"]'));
  await new Promise(done => setTimeout(done, 300));
  assert.equal(h.dbs[KEY].worklog.tasks.find(item => item.id === 'a3').status, 'review');
  // prevStatus 없는 완료 업무는 진행중으로
  delete h.dbs[KEY].worklog.tasks.find(item => item.id === 'a8').prevStatus;
  await worklog.reload();
  await worklog.waitForFunction(() => document.getElementById('app').dataset.status === 'ready');
  await worklog.locator('.sl-done [data-toggle="a8"]').click();
  await worklog.waitForFunction(() => document.querySelector('[data-lane="doing"] [data-task="a8"]'));
  // 새로고침 후에도 서버 값 유지
  await new Promise(done => setTimeout(done, 300));
  await worklog.reload();
  await worklog.waitForFunction(() => document.getElementById('app').dataset.status === 'ready');
  assert.ok(await worklog.locator('[data-lane="doing"] [data-task="a8"]').count());
  assert.ok(h.dbs[KEY].writes.every(entry => entry.path === '/api/worklog/patch' || entry.path === '/api/notes/patch'));
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('상태 전용 함수(updateWorklogTaskStatus)가 있으면 그것으로 저장', { timeout:60000 }, async () => {
  const h = await setup(browser);
  const page = await h.open('worklog', { width:1450 });
  await page.evaluate(KEY => {
    // 서버 작업에서 추가될 함수를 흉내 낸다(테스트 전용).
    window.Store.updateWorklogTaskStatus = async (id, status) => {
      const response = await fetch(`https://notion-widget.wldnjsdkk.workers.dev/api/worklog/status?w=${KEY}`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ id, status }) });
      return (await response.json()).data;
    };
  }, KEY);
  await page.locator('[data-toggle="a1"]').click();
  await page.waitForFunction(() => document.querySelector('.sl-done [data-task="a1"]'));
  await new Promise(done => setTimeout(done, 300));
  assert.ok(h.dbs[KEY].writes.some(entry => entry.path === '/api/worklog/status'));
  assert.ok(!h.dbs[KEY].writes.some(entry => entry.path === '/api/worklog/patch'));
  assert.equal(h.dbs[KEY].worklog.tasks.find(item => item.id === 'a1').prevStatus, 'doing');
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('review를 모르는 기존 서버에서도 오류 없이 동작', { timeout:60000 }, async () => {
  const h = await setup(browser, { legacy:true });
  const page = await h.open('worklog', { width:1450 });
  await page.locator('[data-task="a5"]').click();
  await page.locator('[data-pick-status="review"]').click();
  await new Promise(done => setTimeout(done, 400));
  // 서버가 review를 예정(wait)으로 돌려주면 화면도 그 값을 따른다.
  assert.equal(h.dbs[KEY].worklog.tasks.find(item => item.id === 'a5').status, 'wait');
  await page.locator('.sl-close[data-close-detail]').click();
  await page.waitForFunction(() => document.querySelector('[data-lane="wait"] [data-task="a5"]'));
  await page.locator('[data-toggle="a6"]').click();
  await new Promise(done => setTimeout(done, 300));
  await page.locator('.sl-done [data-toggle="a6"]').click();
  await page.waitForFunction(() => document.querySelector('[data-lane="doing"] [data-task="a6"]'));
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('세부 정보: 번호·구분·마감·상태·메모·삭제와 이번 주 목표 반영', { timeout:90000 }, async () => {
  const h = await setup(browser);
  const page = await h.open('worklog', { width:1050, height:900 });
  const goals = await h.open('goals', { width:1050 });
  await page.locator('[data-task="a1"] .sl-card-title').click();
  await page.locator('.sl-detail').waitFor();
  await shot(page, 'worklog-1050-detail');
  // 번호 1 → 3
  await page.locator('[data-pick-number="3"]').click();
  await goals.waitForFunction(() => [...document.querySelectorAll('.sl-goal[data-goal-id]')].map(node => node.dataset.goalId).join(',') === 'a8,a2,a1,a4');
  // 구분 추가(최대 6개)
  await page.locator('[data-cat-add]').click();
  await page.locator('[data-cat-input]').fill('검토');
  await page.locator('[data-cat-input]').press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-pick-cat="검토"]')?.classList.contains('is-on'));
  // 마감: 내일 → 달력에서 20일
  await page.locator('[data-pick-due="2026-10-15"]').click();
  await page.waitForFunction(() => document.querySelector('[data-pick-due="2026-10-15"]')?.classList.contains('is-on'));
  await page.locator('[data-open-cal]').click();
  await page.locator('[data-pick-date="2026-10-20"]').click();
  await page.waitForFunction(() => document.querySelector('[data-open-cal]')?.classList.contains('is-on'));
  // 상태 검토 대기
  await page.locator('[data-pick-status="review"]').click();
  // 제목·메모(blur 시 저장)
  await page.locator('[data-field="title"]').fill('분기 지표 정리 문서 최종본');
  await page.locator('[data-field="memo"]').fill('표 정리 완료');
  await page.locator('[data-field="title"]').focus();
  await page.locator('[data-close-detail].sl-close').click();
  await new Promise(done => setTimeout(done, 500));
  const saved = h.dbs[KEY].worklog.tasks.find(item => item.id === 'a1');
  assert.deepEqual([saved.goalId, saved.proj, saved.due, saved.status, saved.title, saved.memo],
    ['worklog:goal:3', '검토', '2026-10-20', 'review', '분기 지표 정리 문서 최종본', '표 정리 완료']);
  assert.ok(await page.locator('[data-lane="review"] [data-task="a1"]').count());
  // 삭제(한 번에)
  await page.locator('[data-task="a7"]').click();
  await page.locator('[data-detail-delete]').click();
  await page.waitForFunction(() => !document.querySelector('[data-task="a7"]'));
  await new Promise(done => setTimeout(done, 300));
  assert.ok(!h.dbs[KEY].worklog.tasks.some(item => item.id === 'a7'));
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('카드를 다른 열로 끌어 놓으면 상태가 바뀐다(마우스)', { timeout:60000 }, async () => {
  const h = await setup(browser);
  const page = await h.open('worklog', { width:1450, height:900 });
  const card = await page.locator('[data-task="a6"]').boundingBox();
  const lane = await page.locator('[data-lane="doing"]').boundingBox();
  await page.mouse.move(card.x + 120, card.y + 12);
  await page.mouse.down();
  await page.mouse.move(card.x + 100, card.y + 30, { steps:4 });
  await page.mouse.move(lane.x + 80, lane.y + 300, { steps:8 });
  assert.equal(await page.locator('#ghost').isVisible(), true);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-lane="doing"] [data-task="a6"]'));
  await new Promise(done => setTimeout(done, 300));
  assert.equal(h.dbs[KEY].worklog.tasks.find(item => item.id === 'a6').status, 'doing');
  assert.equal(await page.locator('.sl-detail').count(), 0, '끌기 뒤 세부 정보 창이 열리지 않는다');
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('메모가 8개를 넘게 저장돼 있으면 8줄만 보이고 안내문에 외 n개', { timeout:60000 }, async () => {
  const db = fixture();
  db.notes.items = Array.from({ length:10 }, (_, i) => ({ id:`m${i}`, text:`저장된 메모 ${i + 1}`, done:false, doneAt:null }));
  const h = await setup(browser, { dbs:{ [KEY]:db } });
  const page = await h.open('notes', { width:500, height:370 });
  assert.equal(await page.locator('.sl-note').count(), 8);
  assert.equal(await page.locator('#full').textContent(), '완료한 메모를 지우면 추가할 수 있어요 · 외 2개');
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('말줄임된 메모 말풍선은 0.3초 뒤, 위젯 안에 표시', { timeout:60000 }, async () => {
  const h = await setup(browser);
  const page = await h.open('worklog', { width:1050, height:900 });
  await page.locator('[data-task="a1"] [data-memo]').hover();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#tip').isVisible(), false);
  await page.waitForFunction(() => document.getElementById('tip').classList.contains('is-on'));
  const box = await page.locator('#tip').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 1050 && box.width <= 281);
  await page.waitForTimeout(250);
  await shot(page, 'worklog-1050-tooltip');
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('한 열 12개 이상이면 그 열만 단계적으로 압축하고 외 n개 → 전체 목록 창', { timeout:60000 }, async () => {
  const db = fixture();
  for (let i = 0; i < 14; i += 1) db.worklog.tasks.push(task(`w${i}`, { title:`대기 업무 ${i + 1} 길게 적은 업무명이 두 줄까지 넘어가는지 확인`, due:i % 3 ? `2026-10-${String(15 + i).padStart(2, '0')}` : null, memo:'메모 한 줄' }));
  const h = await setup(browser, { dbs:{ [KEY]:db } });
  const page = await h.open('worklog', { width:1450, height:900 });
  assert.equal(await page.locator('[data-lane="wait"]').getAttribute('data-stage'), '3');
  assert.equal(await page.locator('[data-lane="doing"]').getAttribute('data-stage'), '0');
  assert.match(await page.locator('[data-more="wait"]').textContent(), /^외 \d+개$/);
  assert.equal((await noOverflow(page)).scroll, false);
  await shot(page, 'worklog-1450-compressed');
  await page.locator('[data-more="wait"]').click();
  assert.equal(await page.locator('.sl-lane-panel .sl-panel-row').count(), 18);
  await shot(page, 'worklog-1450-lane-panel');
  await page.locator('[data-close-lane].sl-close').click();
  // 업무가 줄면 원래 모양으로 돌아온다.
  // 다른 기기에서 업무를 정리한 뒤 다음 확인 주기(캐시 2분 이후)에 반영되는 상황
  db.worklog.tasks = db.worklog.tasks.filter(item => !item.id.startsWith('w'));
  db.worklog.revision += 1;
  await page.clock.setFixedTime(new Date(NOW.getTime() + 360001));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => document.querySelector('[data-lane="wait"]')?.dataset.stage === '0');
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('업무/일상 전환이 4개 위젯에서 함께 바뀌고 메모는 mode로 나뉜다', { timeout:60000 }, async () => {
  const h = await setup(browser);
  const pages = {};
  for (const kind of Object.keys(FILES)) pages[kind] = await h.open(kind, { width:kind === 'notes' ? 500 : 1450 });
  await pages.notes.locator('[data-mode="life"]').click();
  for (const kind of Object.keys(FILES)) await pages[kind].waitForFunction(() => document.getElementById('app').dataset.mode === 'life');
  assert.equal(await pages.worklog.locator('#title').textContent(), '오늘의 일상');
  assert.deepEqual(await pages.notes.locator('.sl-note').evaluateAll(nodes => nodes.map(node => node.dataset.noteId)), ['n4']);
  assert.deepEqual(await pages.goals.locator('.sl-goal[data-goal-id]').evaluateAll(nodes => nodes.map(node => node.dataset.goalId)), ['l1']);
  // 일상 메모 추가 → mode 함께 저장
  await pages.notes.locator('#addInput').fill('화분 물 주기');
  await pages.notes.locator('#addInput').press('Enter');
  await new Promise(done => setTimeout(done, 300));
  assert.equal(h.dbs[KEY].notes.items.at(-1).mode, 'life');
  await pages.goals.locator('[data-mode="work"]').click();
  for (const kind of Object.keys(FILES)) await pages[kind].waitForFunction(() => document.getElementById('app').dataset.mode === 'work');
  // mode 없는 기존 메모는 업무
  assert.ok(await pages.notes.locator('[data-note-id="n1"]').count());
  // 저장된 값은 전환 상태뿐
  const keys = await pages.notes.evaluate(() => Object.keys(localStorage));
  assert.deepEqual(keys, [`sky-lime-worklog-mode-v1:${'w_skylime_test_instance_123456789'}`]);
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('메모: 체크·삭제·8줄 제한 문구', { timeout:60000 }, async () => {
  const h = await setup(browser);
  const page = await h.open('notes', { width:500, height:370 });
  await page.locator('[data-toggle="n1"]').click();
  await page.waitForFunction(() => document.querySelector('[data-note-id="n1"]').classList.contains('is-done'));
  assert.equal(await page.locator('[data-note-id="n1"] .sl-note-text').evaluate(node => getComputedStyle(node).textDecorationLine), 'line-through');
  await page.locator('[data-delete="n3"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-note-id="n3"]'));
  for (let i = 0; i < 6; i += 1) { await page.locator('#addInput').fill(`추가 메모 ${i + 1}`); await page.locator('#addInput').press('Enter'); }
  await page.waitForFunction(() => document.querySelectorAll('.sl-note').length === 8);
  assert.equal(await page.locator('#full').isVisible(), true);
  assert.equal(await page.locator('#addForm').isVisible(), false);
  assert.equal((await noOverflow(page)).scroll, false);
  // 8번째 줄까지 목록 영역 안에 온전히 보인다.
  const clipped = await page.evaluate(() => {
    const list = document.getElementById('list').getBoundingClientRect();
    return [...document.querySelectorAll('.sl-note')].some(row => row.getBoundingClientRect().bottom > list.bottom + .5);
  });
  assert.equal(clipped, false);
  await new Promise(done => setTimeout(done, 400));
  assert.equal(h.dbs[KEY].notes.items.filter(item => (item.mode || 'work') === 'work').length, 8);
  await shot(page, 'notes-full');
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('다른 키의 데이터와 섞이지 않고, 키 없는 주소는 서버 요청을 하지 않는다', { timeout:60000 }, async () => {
  const other = fixture();
  other.worklog.tasks = [task('x1', { title:'다른 세트 업무', status:'doing' })];
  other.notes.items = [];
  const h = await setup(browser, { dbs:{ [KEY]:fixture(), [OTHER_KEY]:other } });
  const page = await h.open('worklog', { key:OTHER_KEY, width:1450 });
  assert.deepEqual(await page.locator('[data-task]').evaluateAll(nodes => nodes.map(node => node.dataset.task)), ['x1']);
  assert.equal(h.dbs[KEY].requests.length, 0);
  for (const kind of Object.keys(FILES)) {
    const keyless = await h.open(kind, { query:'' });
    assert.equal(await keyless.locator('#app').getAttribute('data-status'), 'error');
    assert.doesNotMatch(await keyless.content(), /w_skylime/);
    await keyless.close();
  }
  assert.equal(h.dbs.__unknown, undefined);
  assert.equal(h.dbs[KEY].requests.length, 0);
  await h.context.close();
});

test('데이터가 없을 때 빈 상태 문구와 높이 유지', { timeout:60000 }, async () => {
  const h = await setup(browser, { dbs:{ [KEY]:emptyFixture() } });
  const goals = await h.open('goals', { width:1450 });
  assert.equal(await goals.locator('.sl-message').textContent(), '업무일지에서 번호를 지정하면 여기에 표시돼요');
  const notes = await h.open('notes', { width:500 });
  assert.equal(await notes.locator('.sl-message').textContent(), '메모가 없어요');
  const week = await h.open('week', { width:1450 });
  assert.equal(await week.locator('.sl-day-empty').count(), 5);
  const worklog = await h.open('worklog', { width:1450 });
  assert.equal(await worklog.locator('.sl-lane-empty').count(), 3);
  for (const [kind, page] of Object.entries({ goals, notes, week, worklog })) {
    const { scroll, rootHeight } = await noOverflow(page);
    assert.equal(scroll, false);
    assert.equal(Math.round(rootHeight), HEIGHTS[kind]);
  }
  if (shots) {
    const preview = await h.context.newPage();
    await preview.clock.setFixedTime(NOW);
    await preview.setViewportSize({ width:1450 + 48, height:1880 });
    await preview.goto(`${origin}/__preview/page.html?width=1450`);
    await preview.waitForTimeout(1500);
    await shot(preview, 'page-1450-empty');
  }
  assert.deepEqual(h.errors, []);
  await h.context.close();
});

test('기존 cream-olive-garden 업무일지와 같은 키·같은 데이터', { timeout:60000 }, async () => {
  const h = await setup(browser);
  const cream = await h.context.newPage();
  await cream.clock.setFixedTime(NOW);
  await cream.goto(`${origin}/cream-olive-garden/Worklog/worklog-cream-olive-garden.html?w=${KEY}`);
  await cream.waitForFunction(() => document.querySelector('[data-widget-card]')?.dataset.readStatus === 'ready', null, { timeout:15000 });
  const page = await h.open('worklog', { width:1450 });
  await page.locator('[data-toggle="a5"]').click();
  await new Promise(done => setTimeout(done, 400));
  // 기존 위젯은 같은 서버 기록을 읽는다(같은 키·같은 API).
  await cream.reload();
  await cream.waitForFunction(() => document.querySelector('[data-widget-card]')?.dataset.readStatus === 'ready', null, { timeout:15000 });
  const creamText = await cream.locator('body').innerText();
  assert.match(creamText, /사내 안내문 초안/);
  assert.equal(h.dbs[KEY].worklog.tasks.find(item => item.id === 'a5').done, true);
  assert.equal(await cream.locator('[data-toggle-task="a5"]').getAttribute('aria-checked'), 'true');
  // 기존 위젯에서 완료 해제 → 새 위젯에 반영
  await cream.locator('[data-toggle-task="a5"]').click();
  await page.waitForFunction(() => document.querySelector('[data-lane] [data-task="a5"]'), null, { timeout:15000 });
  assert.deepEqual(h.errors.filter(message => !/favicon/.test(message)), []);
  await h.context.close();
});

test('스크린샷: 1450px · 1050px 페이지 배치', { timeout:90000, skip:!shots }, async () => {
  const h = await setup(browser);
  for (const width of [1450, 1050]) {
    for (const mode of ['work', 'life']) {
      const page = await h.context.newPage();
      await page.clock.setFixedTime(NOW);
      await page.setViewportSize({ width:width + 48, height:1880 });
      await page.goto(`${origin}/__preview/page.html?width=${width}&mode=${mode}`);
      for (const frame of page.frames().slice(1)) await frame.waitForFunction(() => document.getElementById('app')?.dataset.status === 'ready');
      await page.waitForTimeout(400);
      await shot(page, `page-${width}-${mode}`);
      await page.close();
    }
  }
  assert.deepEqual(h.errors, []);
  await h.context.close();
});
