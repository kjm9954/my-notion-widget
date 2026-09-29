// Offline browser acceptance test. Every request is fulfilled from this checkout or
// a memory fixture; production URLs NEVER leave the browser's routing boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'http://127.0.0.1:4179';
const prefix = '/cream-olive-garden/Worklog/';
const files = ['weekly-goals', 'deadlines', 'week-review', 'month-calendar'];
const instance = 'w_readwidget_test_instance_123456';
const originalInstance = 'w_original_test_instance_123456789';
const now = new Date('2026-09-29T12:00:00+09:00');
const longName = '콘텐츠 오픈 현황을 정리하고 분기별 비교 기준을 맞춘 뒤 다음 주 회의에서 바로 검토할 수 있도록 주요 지표와 개선 사항까지 빠짐없이 정리하기';
function fixture() {
  const tasks = Array.from({ length:8 }, (_, i) => ({ id:`t${i}`, mode:'work', date:'2026-09-29',
    title:i === 0 ? `잘린 제목 확인 ${longName}` : `업무 ${i}`, due:['2026-09-29','2026-09-29','2026-09-29','2026-09-29','2026-09-29','2026-09-30','2026-10-02','2026-10-03'][i],
    done:false, status:'wait', doneAt:null, goalId:i === 4 ? null : '1', memo:'' }));
  tasks.push({ ...tasks[0], id:'monday', title:'월요일 완료', date:'2026-09-28', due:null, done:true, status:'done', doneAt:'2026-10-02' });
  tasks.push({ ...tasks[0], id:'life', title:'일상 제외', mode:'life' });
  return { worklog:{ revision:1, mode:'work', workView:'time', tasks, projects:[], lastRollDay:'2026-09-29', lastRollWeek:'2026-W40', lastRollCount:0, manualOrder:{}, columnSplit:{ work:.73, life:6/11 } },
    goals:{ week:'2026-9-28', seq:4, carryHandledWeek:'2026-9-28', items:[
      { id:1, text:'운영 준비', m:'work', done:false }, { id:2, text:longName, m:'work', done:false },
      { id:3, text:'자료 점검', m:'work', done:false }, { id:4, text:'네 번째 목표도 표시', m:'work', done:false }
    ] }, notes:{items:[{id:'n1',text:'기존 메모',done:false,doneAt:null},
      {id:'old-done',text:'이전 날 완료',done:true,doneAt:'2026-09-28'}]}, fail:null, requests:[], writes:[] };
}

async function setup(browser, options = {}) {
  const db = fixture();
  const originalDb = fixture();
  const context = await browser.newContext({ viewport:{ width:1440, height:1000 }, timezoneId:'Asia/Seoul', serviceWorkers:'block', ...options });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === origin) {
      const path = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!path.startsWith(resolve(root) + sep)) return route.abort();
      try {
        const mime = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.webp':'image/webp', '.png':'image/png', '.json':'application/json' }[extname(path)] || 'application/octet-stream';
        return route.fulfill({ body:await readFile(path), contentType:mime });
      } catch { return route.fulfill({ status:404, body:'Not found' }); }
    }
    if (url.hostname === 'notion-widget.wldnjsdkk.workers.dev') {
      const entry = { path:url.pathname, method:req.method(), page:req.frame().url(), instance:url.searchParams.get('w') };
      db.requests.push(entry);
      const headers = { 'access-control-allow-origin':'*', 'access-control-allow-headers':'*', 'access-control-allow-methods':'GET, POST, OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status:204, headers });
      if (![instance,originalInstance].includes(entry.instance)) return route.fulfill({status:404,headers,json:{ok:false,error:'unknown fixture instance'}});
      const targetDb = entry.instance === instance ? db : originalDb;
      if (db.fail === url.pathname || db.fail === 'all') return route.fulfill({ status:503, headers, json:{ ok:false, error:'isolated offline test' } });
      let data;
      if (req.method() === 'POST') {
        db.writes.push(entry);
        // Only explicit interactions in the old editors may write to this fixture.
        if (files.some(file => entry.page.includes(`${prefix}${file}.html`))) throw new Error('Read-only widget issued a write');
        const body = req.postDataJSON();
        if (url.pathname === '/api/worklog/patch') {
          for (const update of body.upserts || []) {
            const target = targetDb.worklog.tasks.find(task => task.id === update.id);
            if (target) Object.assign(target, update);
          }
          if (body.meta) Object.assign(targetDb.worklog, body.meta);
          targetDb.worklog.revision += 1; data = targetDb.worklog;
        } else if (url.pathname === '/api/weekly-goals/state') { targetDb.goals = body; data = targetDb.goals; }
        else if (url.pathname === '/api/worklog/view') { targetDb.worklog.workView = body.view; data = targetDb.worklog; }
        else if (url.pathname === '/api/notes/patch') {
          const notes = targetDb.notes.items;
          for (const update of body.updates || []) {
            let note = notes.find(n => n.id === update.id);
            if (!note && update.create) { note = {id:update.id,text:'',done:false,doneAt:null}; notes.push(note); }
            if (note) {
              Object.assign(note, update.changes);
              if ('done' in update.changes) note.doneAt = note.done ? '2026-09-29' : null;
            }
          }
          targetDb.notes.items = notes.filter(n => !(body.deleteIds || []).includes(n.id) &&
            !(body.cleanupCompleted && n.done && n.doneAt < '2026-09-29'));
          data = targetDb.notes;
        }
        else throw new Error(`Unexpected fixture write ${url.pathname}`);
      } else if (url.pathname === '/api/worklog/state') data = targetDb.worklog;
      else if (url.pathname === '/api/worklog/revision') data = { revision:targetDb.worklog.revision, day:'2026-09-29' };
      else if (url.pathname === '/api/weekly-goals/state') data = targetDb.goals;
      else if (url.pathname === '/api/notes/state') data = targetDb.notes;
      else throw new Error(`Unexpected fixture read ${url.pathname}`);
      return route.fulfill({ headers, json:{ ok:true, data } });
    }
    // Offline font fallback; no CDN, analytics or other external requests.
    return route.fulfill({ body:'', contentType:'text/css' });
  });
  async function open(file, query = `?w=${instance}`) {
    const page = await context.newPage(); await page.clock.setFixedTime(now);
    await page.goto(`${origin}${prefix}${file}.html${query}`);
    await page.waitForFunction(() => document.getElementById('read-widget')?.dataset.status === 'ready');
    return page;
  }
  async function notify(page) {
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
  }
  async function openAll() {
    // Clock installation writes the shared context init script; serialize setup.
    const pages = [];
    for (const file of files) pages.push(await open(file));
    return pages;
  }
  return { context, db, originalDb, errors, open, openAll, notify };
}
const text = (page, selector) => page.locator(selector).textContent();

test('offline read-widget browser acceptance', { timeout:120000 }, async t => {
  const browser = await chromium.launch({ headless:true, ...(process.env.TEST_BROWSER_CHANNEL ? { channel:process.env.TEST_BROWSER_CHANNEL } : {}) });
  try {
    await t.test('actual worklog completion and goal editor propagate through Store/BroadcastChannel', async () => {
      const { context, db, errors, openAll } = await setup(browser);
      try {
        const [goals, due, week, month] = await openAll();
        assert.equal(await goals.locator('.wg-row').count(), 4);
        assert.equal(await text(goals, '[data-goal-id="1"] .wg-count strong'), '1');
        assert.equal(await text(week, '[data-date="2026-09-29"] .wr-day-count'), '0 / 8');
        assert.deepEqual(await due.locator('.wr-deadline').evaluateAll(rows => rows.map(row => row.dataset.taskId)), ['t0','t1','t2','t3','t4']);
        assert.equal(await month.locator('[data-date="2026-09-29"] .wr-dot').count(), 5);
        assert.equal(await week.locator('[role="checkbox"]').count(), 0);
        const writer = await context.newPage(); await writer.clock.setFixedTime(now);
        await writer.goto(`${origin}/Worklog/worklog.html?w=${instance}`);
        await writer.locator('[data-toggle-task="t0"]').click();
        await goals.waitForFunction(() => document.querySelector('[data-goal-id="1"] .wg-count strong')?.textContent === '2');
        await week.waitForFunction(() => document.querySelector('[data-date="2026-09-29"] .wr-day-count')?.textContent === '1 / 8');
        await due.waitForFunction(() => !!document.querySelector('.wr-deadline[data-task-id="t5"]'));
        assert.equal(await due.locator('[data-task-id="t0"]').count(), 0);
        assert.equal(await due.locator('[data-task-id="t7"]').count(), 0);
        await month.waitForFunction(() => document.querySelectorAll('[data-date="2026-09-29"] .wr-dot').length === 4);
        const editor = await context.newPage(); await editor.clock.setFixedTime(now);
        await editor.goto(`${origin}/Worklog/weekly-goals.html?w=${instance}`);
        await editor.locator('[data-edit="1"]').click();
        await editor.locator('#goalEdit').fill('목표 문구 동기화 확인');
        await editor.locator('[data-save-edit]').click();
        await goals.waitForFunction(() => document.querySelector('[data-goal-id="1"] .wg-name')?.textContent === '목표 문구 동기화 확인');
        assert.ok(db.writes.length >= 2);
        assert.ok(db.requests.every(r => r.instance === instance));
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('new worklog and notes edit only the copied instance; original data and connection remain unchanged', async () => {
      const {context,db,originalDb,errors,openAll} = await setup(browser);
      try {
        const before = structuredClone(originalDb);
        const old = await context.newPage(); await old.clock.setFixedTime(now);
        await old.goto(`${origin}/Worklog/worklog.html?w=${originalInstance}`);
        await old.locator('[data-toggle-task="t0"]').waitFor();
        await old.evaluate(key => localStorage.setItem('notion-widget-instance-v1', key), originalInstance);
        const [goals,due,week,month] = await openAll();
        const writer = await context.newPage(); await writer.clock.setFixedTime(now);
        await writer.goto(`${origin}${prefix}worklog-cream-olive-garden.html?w=${instance}`);
        await writer.locator('[data-toggle-task="t0"]').click();
        await goals.waitForFunction(() => document.querySelector('[data-goal-id="1"] .wg-count strong')?.textContent === '2');
        await due.waitForFunction(() => !document.querySelector('[data-task-id="t0"]'));
        await week.waitForFunction(() => document.querySelector('[data-date="2026-09-29"] .wr-day-count')?.textContent === '1 / 8');
        await month.waitForFunction(() => document.querySelectorAll('[data-date="2026-09-29"] .wr-dot').length === 4);
        await writer.locator('[data-goal-task="t4"]').click();
        await goals.waitForSelector('[data-goal-id="t4"]');
        assert.equal(await text(goals,'[data-goal-id="t4"] .wg-name'),'업무 4');
        assert.equal(db.worklog.tasks.find(t => t.id === 't4').goalId, 't4');
        const notes = await context.newPage(); await notes.clock.setFixedTime(now);
        await notes.goto(`${origin}${prefix}notes.html?w=${instance}`);
        await notes.locator('[data-note-id="n1"]').waitFor();
        assert.equal(await notes.locator('[data-note-id="old-done"]').count(), 0);
        await notes.locator('[data-add-note]').click();
        await notes.locator('#activeNoteInput').fill('새 세트에서만 추가');
        await Promise.all([
          notes.waitForResponse(r => r.url().includes('/api/notes/patch') && r.request().postData()?.includes('새 세트에서만 추가')),
          notes.locator('#activeNoteInput').press('Enter')
        ]);
        await notes.keyboard.press('Escape');
        await notes.waitForFunction(() => [...document.querySelectorAll('.memo-text')].some(n => n.textContent === '새 세트에서만 추가'));
        await Promise.all([
          notes.waitForResponse(r => r.url().includes('/api/notes/patch') && r.request().postData()?.includes('n1')),
          notes.locator('[data-check="n1"]').click()
        ]);
        await notes.reload(); await notes.locator('[data-check="n1"][aria-checked="true"]').waitFor();
        assert.equal(await notes.getByRole('button',{name:'메모 편집: 새 세트에서만 추가',exact:true}).count(),1);
        const goalEditor = await context.newPage(); await goalEditor.clock.setFixedTime(now);
        await goalEditor.goto(`${origin}/Worklog/weekly-goals.html?w=${instance}&isolated=1`);
        await goalEditor.locator('[data-edit="1"]').click();
        await goalEditor.locator('#goalEdit').fill('새 세트 목표만 편집');
        await goalEditor.locator('[data-save-edit]').click();
        await goals.waitForFunction(() => document.querySelector('[data-goal-id="1"] .wg-name')?.textContent === '새 세트 목표만 편집');
        assert.deepEqual(originalDb, before);
        assert.equal(await old.locator('[data-toggle-task="t0"]').getAttribute('aria-checked'), 'false');
        assert.ok(db.writes.every(r => r.instance === instance));
        assert.equal(await writer.evaluate(() => localStorage.getItem('notion-widget-instance-v1')), originalInstance);
        const cachedKey = await writer.evaluate(async () => {
          const response = await (await caches.open('notion-widget-store-cache-v1')).match(new URL('/__notion-widget-worklog-instance-v1__', location.href));
          return response.text();
        });
        assert.equal(cachedKey, originalInstance);
        assert.equal(await notes.locator('[data-widget-host]').getAttribute('data-widget-key'), 'widget-size-cream-olive-notes-v9');
        assert.equal(await writer.locator('[data-widget-host]').getAttribute('data-widget-key'), 'widget-size-cream-olive-worklog-v8');
        assert.deepEqual(errors,[]);
      } finally { await context.close(); }
    });

    await t.test('all six isolated pages without an explicit key make no API requests, despite a stored legacy key', async () => {
      const {context,db,errors} = await setup(browser);
      try {
        await context.addInitScript(key => {
          if (location.origin === 'http://127.0.0.1:4179') localStorage.setItem('notion-widget-instance-v1',key);
        },originalInstance);
        for(const file of [...files,'worklog-cream-olive-garden','notes']) {
          const page = await context.newPage(); await page.clock.setFixedTime(now);
          await page.goto(`${origin}${prefix}${file}.html`);
          if(files.includes(file)) await page.waitForFunction(() => document.querySelector('[data-read-widget]')?.dataset.status === 'error');
          else if(file === 'notes') await page.getByText('불러오지 못했습니다',{exact:true}).waitFor();
          else await page.locator('[data-store-error-indicator]').waitFor();
          assert.equal(await page.evaluate(() => Store.getWidgetInstanceId()),null);
          assert.equal(await page.evaluate(() => localStorage.getItem('notion-widget-instance-v1')),originalInstance);
          await page.close();
        }
        assert.deepEqual(db.requests,[]); assert.deepEqual(errors,[]);
      } finally { await context.close(); }
    });

    await t.test('worklog goal selection works with no pre-created goals and follows completion, reload and deselection', async () => {
      const {context,db,originalDb,errors,openAll}=await setup(browser);
      try {
        db.goals={week:'',items:[],seq:0,carryHandledWeek:''};
        db.worklog.tasks.forEach(task=>{task.goalId=null;});
        const original=structuredClone(originalDb);
        const [goals,due,week,month]=await openAll();
        const writer=await context.newPage(); await writer.clock.setFixedTime(now);
        await writer.goto(`${origin}${prefix}worklog-cream-olive-garden.html?w=${instance}`);
        await writer.locator('[data-goal-task="t0"]').click();
        await goals.waitForSelector('[data-goal-id="t0"]');
        assert.equal(await text(goals,'[data-goal-id="t0"] .wg-name'),db.worklog.tasks[0].title);
        assert.equal(await text(goals,'[data-goal-id="t0"] .wg-count'),'업무 0/1');
        assert.equal(await writer.locator('[data-goal-task="t0"]').getAttribute('aria-pressed'),'true');
        if(process.env.TEST_SCREENSHOT_DIR) {
          await mkdir(process.env.TEST_SCREENSHOT_DIR,{recursive:true});
          await goals.screenshot({path:resolve(process.env.TEST_SCREENSHOT_DIR,'selected-task-goal.png'),fullPage:false});
        }
        await writer.locator('[data-toggle-task="t0"]').click();
        await goals.waitForFunction(()=>document.querySelector('[data-goal-id="t0"] .wg-count strong')?.textContent==='1');
        await due.waitForFunction(()=>!document.querySelector('[data-task-id="t0"]'));
        await month.waitForFunction(()=>document.querySelectorAll('[data-date="2026-09-29"] .wr-dot').length===4);
        await writer.reload(); await goals.reload();
        await writer.locator('[data-goal-task="t0"][aria-pressed="true"]').waitFor();
        await goals.locator('[data-goal-id="t0"]').waitFor();
        assert.equal(await text(goals,'[data-goal-id="t0"] .wg-count'),'업무 1/1');
        await writer.locator('[data-goal-task="t0"]').click();
        await goals.waitForFunction(()=>document.querySelectorAll('.wg-row').length===0);
        assert.match(await text(goals,'.wr-message'),/목표가 없/);
        assert.equal(db.worklog.tasks[0].done,true,'deselecting a goal must not change completion');
        assert.equal(db.worklog.tasks[0].goalId,null);
        assert.deepEqual(db.goals.items,[],'no secondary goal save or sample goal');
        assert.ok(db.writes.every(r=>r.instance===instance && r.path==='/api/worklog/patch'));
        assert.deepEqual(originalDb,original); assert.deepEqual(errors,[]);
      } finally {await context.close();}
    });

    await t.test('deadline vertical handles resize only height and persist through reload and live updates', async () => {
      const {context,db,errors,open,notify}=await setup(browser);
      try {
        const page=await open('deadlines');
        const metrics=()=>page.evaluate(()=>{
          const frame=document.querySelector('[data-widget-card]').getBoundingClientRect();
          const card=document.querySelector('.wr-card').getBoundingClientRect();
          const list=document.querySelector('.wr-content');
          return {width:frame.width,height:frame.height,cardHeight:card.height,
            font:getComputedStyle(document.querySelector('.wr-title')).fontSize,
            scale:document.querySelector('[data-widget-host]').style.getPropertyValue('--widget-content-scale'),
            scroll:list.scrollHeight,client:list.clientHeight};
        });
        const before=await metrics(),handle=page.locator('.widget-height-handle-bottom');
        assert.equal(await handle.isVisible(),true);
        await handle.focus(); await handle.press('ArrowDown');
        await page.waitForFunction(h=>document.querySelector('[data-widget-card]').getBoundingClientRect().height>h+10,before.height);
        let current=await metrics();
        assert.equal(current.width,before.width); assert.equal(current.font,before.font); assert.equal(current.scale,before.scale);
        // The frame styles update before the queued viewport handle positions.
        await page.waitForFunction(h=>Number(document.querySelector('.widget-height-handle-bottom').getAttribute('aria-valuenow'))===Math.round(h),current.height);
        const box=await handle.boundingBox();
        await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down();
        assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('is-widget-scaling')),true);
        await page.mouse.move(box.x+box.width/2,box.y+box.height/2+80,{steps:5}); await page.mouse.up();
        await page.waitForFunction(h=>document.querySelector('[data-widget-card]').getBoundingClientRect().height>h+60,current.height);
        const key='widget-size-cream-olive-deadlines-read-v1';
        const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
        assert.equal(saved.heightLocked,true); assert.equal(saved.contentW,before.width);
        await page.reload(); await page.locator('.wr-deadline').first().waitFor();
        current=await metrics(); assert.ok(Math.abs(current.height-saved.frameH)<1);
        assert.ok(Math.abs(current.height-current.cardHeight-12)<1);
        const tasks=db.worklog.tasks; db.worklog.tasks=[]; await notify(page);
        await page.getByText('3일 안에 마감할 업무가 없어요.').waitFor();
        assert.ok(Math.abs((await metrics()).height-saved.frameH)<1);
        db.worklog.tasks=tasks; await notify(page); await page.locator('.wr-deadline').first().waitFor();
        await handle.focus(); for(let i=0;i<30;i++) await handle.press('ArrowUp');
        current=await metrics(); assert.equal(current.height,160); assert.equal(current.width,before.width);
        assert.ok(current.scroll>current.client,'short frame scrolls its list without losing rows');
        assert.ok(Math.abs(current.height-current.cardHeight-12)<1);
        assert.equal(await page.locator('.wr-deadline').count(),5);
        if(process.env.TEST_SCREENSHOT_DIR) {
          await mkdir(process.env.TEST_SCREENSHOT_DIR,{recursive:true});
          await page.screenshot({path:resolve(process.env.TEST_SCREENSHOT_DIR,'deadline-height-handle.png'),fullPage:false});
        }
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        assert.deepEqual(db.writes,[]); assert.deepEqual(errors,[]);
      } finally {await context.close();}
    });

    await t.test('desktop/iPad/mobile: wrapping, equal weekday heights, dot rows, no overflow, mouse-only tooltip', async () => {
      for (const [label, width, height, touch, screen] of [['desktop',1440,1000,false], ['ipad',768,1024,true], ['mobile',390,844,true], ['small-mobile',320,740,true], ['narrow-desktop',480,900,false], ['ipad-split',480,900,true,{width:768,height:1024}], ['phone-landscape',844,390,true,{width:390,height:844}]]) {
        const { context, db, errors, openAll } = await setup(browser, { viewport:{ width, height }, hasTouch:touch, isMobile:touch, ...(screen ? { screen } : {}) });
        try {
          // Rich colors are an isolated contract fixture, not a claim that the legacy Worker stores them.
          db.goals.items.forEach((g, i) => { g.color = ['#6b7b49','#bd9671','#8298a0','#e4d18b'][i]; });
          const pages = await openAll();
          const [goals, due, week, month] = pages;
          assert.equal(await due.locator('.widget-height-handle-bottom').isVisible(),!touch,`${label} vertical handle visibility`);
          for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const metrics = await page.evaluate(() => {
              const frame = document.querySelector('[data-widget-card]').getBoundingClientRect();
              const card = document.querySelector('.wr-card').getBoundingClientRect();
              return { width:innerWidth, scroll:document.documentElement.scrollWidth, left:frame.left, right:frame.right, frameH:frame.height, cardH:card.height,
                padding:getComputedStyle(document.querySelector('[data-widget-card]')).padding,
                background:getComputedStyle(document.querySelector('.wr-card')).backgroundColor,
                scale:document.querySelector('[data-widget-host]').style.getPropertyValue('--widget-content-scale') };
            });
            assert.ok(metrics.scroll <= width + 1, `${label} ${files[i]} horizontal scroll ${JSON.stringify(metrics)}`);
            assert.ok(metrics.left >= -1 && metrics.right <= width + 1, `${label} frame outside viewport`);
            assert.ok(Math.abs(metrics.frameH - metrics.cardH - 12) < 3, `${label} ${files[i]} frame content mismatch ${JSON.stringify(metrics)}`);
            assert.equal(metrics.background, 'rgb(250, 247, 239)');
            if (touch) assert.equal(metrics.scale, '1');
            if (process.env.TEST_SCREENSHOT_DIR && ['desktop','ipad','mobile'].includes(label)) {
              await mkdir(process.env.TEST_SCREENSHOT_DIR, { recursive:true });
              // Capture the actual device viewport, without a full-page resize.
              await page.screenshot({ path:resolve(process.env.TEST_SCREENSHOT_DIR, `${label}-${files[i]}.png`), fullPage:false });
            }
          }
          assert.equal(await text(goals, '[data-goal-id="2"] .wg-name'), longName);
          const name = await goals.locator('[data-goal-id="2"] .wg-name').evaluate(el => ({ width:el.clientWidth, scroll:el.scrollWidth, height:el.clientHeight, scrollH:el.scrollHeight }));
          assert.ok(name.scroll <= name.width + 1 && name.scrollH <= name.height + 1);
          const columns = await week.locator('.wr-day').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { y:r.y, height:r.height }; }));
          assert.ok(columns.every(c => Math.abs(c.height - columns[0].height) < 1), `${label} unequal weekday heights`);
          const media = await week.evaluate(() => ({ width:innerWidth, coarse:matchMedia('(any-pointer:coarse)').matches, small:matchMedia('(max-width:599px)').matches, device:document.body.dataset.widgetLayoutMode }));
          const phone = touch && Math.min(screen?.width || width, screen?.height || height) < 640;
          assert.equal(new Set(columns.map(c => Math.round(c.y))).size, phone ? 5 : 1, `${label} ${JSON.stringify(media)}`);
          assert.equal(await week.locator('[data-date="2026-09-29"] .wr-task').count(), 8);
          const dots = await month.locator('[data-date="2026-09-29"] .wr-dot').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().y));
          assert.equal(dots[0], dots[3]); assert.ok(dots[4] > dots[0]);
          const badges = await due.locator('.wr-dday').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().width));
          assert.ok(badges.every(w => w === badges[0]));
          await due.locator('[data-task-id="t0"] .wr-ellipsis').dispatchEvent('pointerover', { pointerType:touch ? 'touch' : 'mouse' });
          assert.equal(await due.locator('.wr-tooltip').isVisible(), !touch);
          if (!touch) assert.equal(await text(due, '.wr-tooltip'), db.worklog.tasks[0].title);
          assert.deepEqual(db.writes, []); assert.deepEqual(errors, []);
        } finally { await context.close(); }
      }
    });

    await t.test('new worklog and v9 notes retain their desktop/tablet/phone layout and assets', async () => {
      for (const [label,width,height,touch] of [['desktop',1440,1000,false],['ipad',768,1024,true],['mobile',390,844,true],['small-mobile',320,740,true]]) {
        const {context,errors} = await setup(browser,{viewport:{width,height},hasTouch:touch,isMobile:touch});
        try {
          for (const file of ['worklog-cream-olive-garden','notes']) {
            const page = await context.newPage(); await page.clock.setFixedTime(now);
            await page.goto(`${origin}${prefix}${file}.html?w=${instance}`);
            await page.locator(file === 'notes' ? '[data-note-id="n1"]' : '[data-toggle-task="t0"]').waitFor();
            const metrics = await page.evaluate(() => {
              const box = document.querySelector('[data-widget-card]').getBoundingClientRect();
              return {width:innerWidth,scroll:document.documentElement.scrollWidth,left:box.left,right:box.right};
            });
            assert.ok(metrics.scroll <= width + 1 && metrics.left >= -1 && metrics.right <= width + 1,`${label} ${file}: ${JSON.stringify(metrics)}`);
            if(process.env.TEST_SCREENSHOT_DIR && label !== 'small-mobile') {
              await mkdir(process.env.TEST_SCREENSHOT_DIR,{recursive:true});
              await page.screenshot({path:resolve(process.env.TEST_SCREENSHOT_DIR,`${label}-${file}.png`),fullPage:false});
            }
          }
          assert.deepEqual(errors,[]);
        } finally { await context.close(); }
      }
    });

    await t.test('week/month navigation persists through synchronization, reload and clock changes', async () => {
      const { context, db, errors, open, notify } = await setup(browser);
      try {
        const week = await open('week-review'), month = await open('month-calendar');
        await week.getByRole('button', { name:'이전 주', exact:true }).click();
        await month.getByRole('button', { name:'다음 달', exact:true }).click();
        const weekText = await text(week, '.wr-period'), monthText = await text(month, '.wr-period');
        db.worklog.revision++;
        await notify(week); await notify(month);
        assert.equal(await text(week, '.wr-period'), weekText); assert.equal(await text(month, '.wr-period'), monthText);
        await week.reload(); await month.reload();
        await week.waitForSelector('.wr-period'); await month.waitForSelector('.wr-period');
        assert.equal(await text(week, '.wr-period'), weekText); assert.equal(await text(month, '.wr-period'), monthText);
        await week.clock.setFixedTime(new Date('2026-10-05T12:00:00+09:00'));
        await month.clock.setFixedTime(new Date('2026-11-01T12:00:00+09:00'));
        await notify(week); await notify(month);
        assert.equal(await text(week, '.wr-period'), weekText); assert.equal(await text(month, '.wr-period'), monthText);
        await week.getByRole('button', { name:'다음 주', exact:true }).click();
        await month.getByRole('button', { name:'이전 달', exact:true }).click();
        assert.equal(await text(week, '.wr-period'), '9.28 – 10.2');
        assert.equal(await text(month, '.wr-period'), '2026년 9월');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('empty states, loading errors, stale failures and recovery are distinct; no writes', async () => {
      const { context, db, errors, openAll, notify } = await setup(browser);
      try {
        db.worklog.tasks = []; db.goals.items = [];
        const pages = await openAll();
        assert.match(await text(pages[0], '.wr-message'), /목표가 없/);
        assert.match(await text(pages[1], '.wr-message'), /마감할 업무가 없/);
        assert.equal(await pages[2].locator('.wr-day-empty').count(), 5);
        assert.equal(await pages[3].locator('.wr-dot').count(), 0);
        assert.equal(await pages[3].locator('.wr-date').count(), 35);
        db.fail = '/api/weekly-goals/state';
        for (const page of pages) {
          await notify(page); await page.waitForFunction(() => document.querySelector('[data-read-widget]').dataset.status === 'error');
          assert.match(await text(page, '.wr-error'), /갱신하지 못/);
        }
        // A new document with cached data still shows an initial error, not an empty result.
        await pages[0].reload();
        await pages[0].waitForFunction(() => document.querySelector('[data-read-widget]').dataset.status === 'error');
        assert.match(await text(pages[0], '.wr-message'), /불러오지 못/);
        db.fail = null;
        for (const page of pages) {
          await notify(page); await page.waitForFunction(() => document.querySelector('[data-read-widget]').dataset.status === 'ready');
          assert.equal(await page.locator('.wr-error').isVisible(), false);
        }
        assert.deepEqual(db.writes, []); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('shared frame resize restores unique keys and leaves new rows visible', async () => {
      const { context, db, errors, open, notify } = await setup(browser);
      try {
        const page = await open('weekly-goals');
        const before = await page.locator('.wr-card').boundingBox();
        const handle = page.locator('.widget-width-handle-right');
        await handle.focus(); await handle.press('ArrowLeft');
        const key = 'widget-size-cream-olive-weekly-goals-read-v1';
        await page.waitForFunction(k => !!localStorage.getItem(k), key);
        const saved = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
        assert.ok(saved.contentW < before.width + 12);
        assert.equal(saved.heightLocked, false);
        db.goals.items.push({ id:5, m:'work', text:longName.repeat(3), done:false });
        await notify(page); await page.waitForSelector('[data-goal-id="5"]');
        const bounds = await page.evaluate(() => ({ frame:document.querySelector('[data-widget-card]').getBoundingClientRect().bottom, row:document.querySelector('[data-goal-id="5"]').getBoundingClientRect().bottom }));
        assert.ok(bounds.row <= bounds.frame);
        await page.reload(); await page.waitForSelector('[data-goal-id="5"]');
        assert.equal(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).contentW, key), saved.contentW);
        const other = await open('deadlines');
        assert.equal(await other.evaluate(() => localStorage.getItem('widget-size-cream-olive-deadlines-read-v1')), null);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
