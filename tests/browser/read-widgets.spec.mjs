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
            else targetDb.worklog.tasks.push(structuredClone(update));
          }
          targetDb.worklog.tasks=targetDb.worklog.tasks.filter(task=>!(body.deleteIds || []).includes(task.id));
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
        assert.equal(db.worklog.tasks.find(t => t.id === 't4').goalId, 'worklog:goal:1');
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

    await t.test('priority changes reorder saved manual rows immediately and persist without changing other days or instances', async () => {
      for(const [label,width,height,touch] of [['desktop',1440,1000,false],['ipad',768,1024,true],['phone',390,844,true]]) {
        const {context,db,originalDb,errors}=await setup(browser,{viewport:{width,height},hasTouch:touch,isMobile:touch});
        try {
          db.worklog.tasks.slice(0,8).forEach((task,i)=>{task.q=[4,2,1,3,2,null,null,null][i];});
          const manual=['t4','t0','t1','t3','t2','t5','t6','t7'];
          db.worklog.manualOrder={'work:2026-09-29':manual,'work:2026-09-28':['monday'],'life:2026-09-29':['life']};
          const original=structuredClone(originalDb);
          const writer=await context.newPage(); await writer.clock.setFixedTime(now);
          await writer.goto(`${origin}${prefix}worklog-cream-olive-garden.html?w=${instance}`);
          const rows=()=>writer.locator('.task-row[data-task-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.taskId));
          await writer.locator('[data-cell-task="t0"][data-cell-field="q"]').waitFor();
          assert.deepEqual(await rows(),manual,`${label}: preserve manual drag order before a Q change`);
          await writer.locator('[data-cell-task="t0"][data-cell-field="q"]').click();
          await Promise.all([
            writer.waitForResponse(r=>r.url().includes('/api/worklog/patch') && r.request().postDataJSON()?.upserts?.some(t=>t.id==='t0' && t.q===1)),
            writer.locator('[data-q-choice="1"]').click()
          ]);
          const priorityOrder=['t0','t2','t4','t1','t3','t5','t6','t7'];
          assert.deepEqual(await rows(),priorityOrder,`${label}: Q1 first, then Q2/Q3/Q4/unset`);
          assert.deepEqual(db.worklog.manualOrder['work:2026-09-29'],priorityOrder);
          await writer.reload(); await writer.locator('[data-cell-task="t0"][data-cell-field="q"]').waitFor();
          assert.deepEqual(await rows(),priorityOrder,`${label}: order survives reload`);
          await writer.locator('[data-cell-task="t0"][data-cell-field="q"]').click();
          await Promise.all([
            writer.waitForResponse(r=>r.url().includes('/api/worklog/patch') && r.request().postDataJSON()?.upserts?.some(t=>t.id==='t0' && t.q===null)),
            writer.locator('[data-q-choice=""]').click()
          ]);
          assert.deepEqual(await rows(),['t2','t4','t1','t3','t0','t5','t6','t7'],`${label}: unset priority follows assigned priorities`);
          assert.deepEqual(db.worklog.manualOrder['work:2026-09-28'],['monday']);
          assert.deepEqual(db.worklog.manualOrder['life:2026-09-29'],['life']);
          assert.deepEqual(originalDb,original); assert.deepEqual(errors,[]);
          assert.ok(db.writes.every(r=>r.instance===instance && r.path==='/api/worklog/patch'));
        } finally {await context.close();}
      }
    });

    await t.test('manual dragging survives goal edits; full-form Q edits and added tasks restore priority order', async () => {
      const {context,db,errors}=await setup(browser);
      try {
        db.worklog.tasks=db.worklog.tasks.slice(0,4);
        db.worklog.tasks.forEach((task,i)=>{task.q=i+1; task.goalId=null;});
        const writer=await context.newPage(); await writer.clock.setFixedTime(now);
        await writer.goto(`${origin}${prefix}worklog-cream-olive-garden.html?w=${instance}`);
        const rows=()=>writer.locator('.task-row[data-task-id]:not(.quick-add-row)').evaluateAll(nodes=>nodes.map(n=>n.dataset.taskId));
        await writer.locator('[data-cell-task="t0"][data-cell-field="q"]').waitFor();
        const from=await writer.locator('[data-inline-start="title"][data-task-id="t0"]').boundingBox();
        const to=await writer.locator('.task-row[data-task-id="t2"]').boundingBox();
        await writer.mouse.move(from.x+from.width/2,from.y+from.height/2); await writer.mouse.down();
        await writer.mouse.move(from.x+from.width/2,to.y+to.height-3,{steps:8});
        await Promise.all([writer.waitForResponse(r=>r.url().includes('/api/worklog/patch') && r.request().postDataJSON()?.meta?.manualOrder),writer.mouse.up()]);
        await writer.clock.setFixedTime(new Date(now.getTime()+1000));
        const manual=['t1','t2','t0','t3']; assert.deepEqual(await rows(),manual);
        await writer.locator('[data-goal-task="t0"]').click();
        assert.deepEqual(await rows(),manual,'goal selection does not undo a drag');
        await writer.locator('[data-inline-start="title"][data-task-id="t2"]').click({modifiers:['Shift']});
        await writer.locator('[data-task-form] [name="q"]').selectOption('1');
        await Promise.all([
          writer.waitForResponse(r=>r.url().includes('/api/worklog/patch') && r.request().postDataJSON()?.upserts?.some(t=>t.id==='t2'&&t.q===1)),
          writer.locator('[data-task-form] button[type="submit"]').click()
        ]);
        assert.deepEqual(await rows(),['t2','t0','t1','t3']);
        await writer.locator('[data-add-task]').click();
        await writer.locator('[data-quick-add-form] [data-cell-field="q"]').click();
        await writer.locator('[data-q-choice="1"]').click();
        await writer.locator('[data-quick-add-form] [name="title"]').fill('우선순위 추가 테스트');
        await Promise.all([
          writer.waitForResponse(r=>r.url().includes('/api/worklog/patch') && r.request().postDataJSON()?.upserts?.some(t=>t.title==='우선순위 추가 테스트')),
          writer.locator('[data-quick-add-form] [name="title"]').press('Enter')
        ]);
        const added=db.worklog.tasks.find(t=>t.title==='우선순위 추가 테스트');
        assert.ok(added); assert.deepEqual(await rows(),['t2','t0',added.id,'t1','t3']);
        await writer.reload(); await writer.locator('[data-goal-task="t0"]').waitFor();
        assert.deepEqual(await rows(),['t2','t0',added.id,'t1','t3']);
        assert.equal(db.worklog.tasks.find(t=>t.id==='t0').goalId,'worklog:goal:1');
        assert.deepEqual(errors,[]);
      } finally {await context.close();}
    });

    await t.test('worklog goal numbers cycle through 1/2/3, sort duplicates, and follow completion and reload', async () => {
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
        const cycle=async(id,number)=>{
          await writer.locator(`[data-goal-task="${id}"]`).click();
          await goals.waitForFunction(({id,number})=>document.querySelector(`[data-goal-id="${id}"] .wg-number`)?.textContent===String(number),{id,number});
          assert.equal(await text(writer,`[data-goal-task="${id}"] .goal-dot`),String(number));
        };
        await cycle('t0',2); await cycle('t0',3);
        await cycle('t1',1); await cycle('t1',2);
        await cycle('t2',1); await cycle('t3',1);
        assert.deepEqual(await goals.locator('.wg-row').evaluateAll(nodes=>nodes.map(n=>[n.dataset.goalId,n.querySelector('.wg-number').textContent])),[['t2','1'],['t3','1'],['t1','2'],['t0','3']]);
        assert.equal(await text(goals,'[data-goal-id="t2"] .wg-count'),'업무 0/1');
        assert.equal(await text(goals,'[data-goal-id="t3"] .wg-count'),'업무 0/1');
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
        assert.equal(await text(writer,'[data-goal-task="t0"] .goal-dot'),'3');
        await writer.locator('[data-goal-task="t0"]').click();
        await goals.waitForFunction(()=>!document.querySelector('[data-goal-id="t0"]'));
        assert.deepEqual(await goals.locator('.wg-number').allTextContents(),['1','1','2']);
        assert.equal(db.worklog.tasks[0].done,true,'deselecting a goal must not change completion');
        assert.equal(db.worklog.tasks[0].goalId,null);
        assert.deepEqual(db.goals.items,[],'no secondary goal save or sample goal');
        assert.ok(db.writes.every(r=>r.instance===instance && r.path==='/api/worklog/patch'));
        assert.deepEqual(originalDb,original); assert.deepEqual(errors,[]);
      } finally {await context.close();}
    });

    await t.test('goal cycling supports touch and keyboard and preserves legacy checkbox selections', async () => {
      for(const [width,height,touch] of [[1440,1000,false],[768,1024,true],[390,844,true]]) {
        const {context,db,errors,open}=await setup(browser,{viewport:{width,height},hasTouch:touch,isMobile:touch});
        try {
          db.goals={week:'',items:[]}; db.worklog.tasks.forEach(task=>{task.goalId=null;});
          db.worklog.tasks[0].goalId='t0';
          const goals=await open('weekly-goals'), writer=await context.newPage(); await writer.clock.setFixedTime(now);
          await writer.goto(`${origin}${prefix}worklog-cream-olive-garden.html?w=${instance}`);
          const button=writer.locator('[data-goal-task="t0"]'); await button.waitFor();
          assert.equal(await button.locator('.goal-dot').textContent(),'1');
          for(const number of [2,3,0,1]) {
            if(touch) await button.tap(); else {await button.focus(); await button.press(number===3?'Space':'Enter');}
            await goals.waitForFunction(number=>number===0?!document.querySelector('[data-goal-id="t0"]'):document.querySelector('[data-goal-id="t0"] .wg-number')?.textContent===String(number),number);
            assert.equal(await button.locator('.goal-dot').textContent(),number?String(number):'');
            if(!number) assert.match(await text(goals,'.wr-message'),/목표가 없/);
          }
          assert.deepEqual(errors,[]);
        } finally {await context.close();}
      }
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
            font:getComputedStyle(document.querySelector('.wr-content')).fontSize,
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

    await t.test('week-review height handles preserve width, five equal columns, navigation and saved height', async () => {
      const {context,db,errors,open,notify}=await setup(browser);
      try {
        const page=await open('week-review'), handle=page.locator('.widget-height-handle-bottom');
        const metrics=()=>page.evaluate(()=>{
          const frame=document.querySelector('[data-widget-card]').getBoundingClientRect();
          const list=document.querySelector('.wr-content');
          return {width:frame.width,height:frame.height,font:getComputedStyle(document.querySelector('.wr-title')).fontSize,
            scroll:list.scrollHeight,client:list.clientHeight,headerTop:document.querySelector('.wr-header').getBoundingClientRect().top};
        });
        const before=await metrics(); assert.equal(await handle.isVisible(),true);
        await handle.focus(); for(let i=0;i<8;i++) await handle.press('ArrowDown');
        const tall=await metrics(); assert.ok(tall.height>before.height+50); assert.equal(tall.width,before.width); assert.equal(tall.font,before.font);
        await page.waitForFunction(h=>Number(document.querySelector('.widget-height-handle-bottom').getAttribute('aria-valuenow'))===Math.round(h),tall.height);
        const box=await handle.boundingBox();
        await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down();
        await page.mouse.move(box.x+box.width/2,box.y+box.height/2-70,{steps:8}); await page.mouse.up();
        assert.ok((await metrics()).height<tall.height-40,'pointer drag changes height');
        await handle.focus(); for(let i=0;i<40;i++) await handle.press('ArrowUp');
        const short=await metrics(); assert.equal(short.height,180); assert.equal(short.width,before.width); assert.equal(short.font,before.font);
        assert.ok(short.scroll>short.client);
        const columns=await page.locator('.wr-day').evaluateAll(nodes=>nodes.map(n=>({y:n.getBoundingClientRect().y,height:n.getBoundingClientRect().height})));
        assert.equal(new Set(columns.map(c=>Math.round(c.y))).size,1);
        assert.ok(columns.every(c=>Math.abs(c.height-columns[0].height)<1));
        assert.equal(await page.locator('[data-date="2026-09-29"] .wr-task').count(),8);
        await page.locator('.wr-content').evaluate(n=>{n.scrollTop=60;});
        assert.equal((await metrics()).headerTop,short.headerTop);
        await page.getByRole('button',{name:'이전 주',exact:true}).click();
        const period=await text(page,'.wr-period'); db.worklog.revision++; await notify(page);
        await page.reload(); await page.waitForFunction(()=>document.querySelector('#read-widget').dataset.status==='ready');
        assert.equal((await metrics()).height,180); assert.equal(await text(page,'.wr-period'),period);
        await page.getByRole('button',{name:'다음 주',exact:true}).click();
        await page.locator('[data-date="2026-09-29"] .wr-task').first().waitFor();
        assert.equal((await metrics()).height,180);
        if(process.env.TEST_SCREENSHOT_DIR) {
          await mkdir(process.env.TEST_SCREENSHOT_DIR,{recursive:true});
          await page.screenshot({path:resolve(process.env.TEST_SCREENSHOT_DIR,'week-height-handle.png'),fullPage:false});
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
          assert.equal(await due.locator('.wr-header, .wr-title').count(),0,`${label}: deadline title and header spacing removed`);
          assert.equal(await due.locator('.wr-card').getAttribute('aria-label'),'3일 안 마감');
          assert.equal(await due.title(),'3일 안 마감');
          const listAtTop=await due.locator('.wr-card').evaluate(card=>{
            const style=getComputedStyle(card);
            return Math.abs(card.querySelector('.wr-content').getBoundingClientRect().top-card.getBoundingClientRect().top-parseFloat(style.paddingTop)-parseFloat(style.borderTopWidth))<1;
          });
          assert.equal(listAtTop,true,`${label}: no empty header gap`);
          for(const page of [goals,week,month]) assert.equal(await page.locator('.wr-title').count(),1);
          for(const resizable of [due,week]) assert.equal(await resizable.locator('.widget-height-handle-bottom').isVisible(),!touch,`${label} vertical handle visibility`);
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
        assert.equal(await pages[1].locator('.wr-header, .wr-title').count(),0);
        assert.equal(await pages[2].locator('.wr-day-empty').count(), 5);
        assert.equal(await pages[3].locator('.wr-dot').count(), 0);
        assert.equal(await pages[3].locator('.wr-date').count(), 35);
        db.fail = '/api/weekly-goals/state';
        for (const page of pages) {
          await notify(page); await page.waitForFunction(() => document.querySelector('[data-read-widget]').dataset.status === 'error');
          assert.match(await text(page, '.wr-error'), /갱신하지 못/);
        }
        assert.equal(await pages[1].locator('.wr-header, .wr-title').count(),0);
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
