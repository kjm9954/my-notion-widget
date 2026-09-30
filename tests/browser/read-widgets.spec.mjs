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

async function setup(browser, options = {}, sharedDb = null) {
  const db = sharedDb || fixture();
  db.layouts ||= {};
  db.layoutRequests ||= [];
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
        const mime = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.webp':'image/webp', '.png':'image/png', '.json':'application/json', '.woff2':'font/woff2' }[extname(path)] || 'application/octet-stream';
        return route.fulfill({ body:await readFile(path), contentType:mime });
      } catch { return route.fulfill({ status:404, body:'Not found' }); }
    }
    if (url.hostname === 'notion-widget.wldnjsdkk.workers.dev') {
      const entry = { path:url.pathname, method:req.method(), page:req.frame().url(), instance:url.searchParams.get('w') };
      if (url.pathname === '/api/widget-layout') {
        db.layoutRequests.push(entry);
        const headers = { 'access-control-allow-origin':'*', 'access-control-allow-headers':'*', 'access-control-allow-methods':'GET, POST, OPTIONS', 'access-control-max-age':'86400' };
        if (req.method() === 'OPTIONS') return route.fulfill({status:204,headers});
        if (![instance,originalInstance].includes(entry.instance)) return route.fulfill({status:404,headers,json:{ok:false,error:'unknown fixture instance'}});
        if (db.layoutFail || db.fail === 'all' || db.fail === 'd1') return route.fulfill({status:503,headers,json:{ok:false,error:db.fail === 'd1' ? "D1_ERROR: Your account has exceeded D1's free tier daily row read limit" : 'size offline'}});
        const layouts = db.layouts[entry.instance] ||= {};
        if (req.method() === 'POST') {
          const body = req.postDataJSON();
          assert.deepEqual(Object.keys(body).sort(), ['size','widget']);
          layouts[body.widget] = {size:body.size,updatedAt:new Date().toISOString()};
          return route.fulfill({headers,json:{ok:true,data:{widget:body.widget,...layouts[body.widget]}}});
        }
        return route.fulfill({headers,json:{ok:true,data:{layouts}}});
      }
      db.requests.push(entry);
      const headers = { 'access-control-allow-origin':'*', 'access-control-allow-headers':'*', 'access-control-allow-methods':'GET, POST, OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status:204, headers });
      if (![instance,originalInstance].includes(entry.instance)) return route.fulfill({status:404,headers,json:{ok:false,error:'unknown fixture instance'}});
      const targetDb = entry.instance === instance ? db : originalDb;
      if (db.fail === 'd1') return route.fulfill({ status:500, headers, json:{ok:false,
        error:"Error: D1_ERROR: Your account has exceeded D1's free tier daily row read limit."} });
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
    // Simulate a committed change from another device after the bounded cache
    // freshness window. Same-browser writes are tested through the actual editors.
    db.worklog.revision++;
    await page.clock.setFixedTime(new Date(await page.evaluate(() => Date.now()) + 360001));
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

// Verify glyphs actually come from a downloaded custom font, not just a CSS name.
async function expectPretendard(page, selector) {
  await page.locator(selector).first().waitFor();
  await page.evaluate(async()=>{
    await document.fonts.load('600 13px "Pretendard Variable"','업무 기록 꼼꼼한 검토 1234 ABC');
    await document.fonts.ready;
  });
  assert.match(await page.locator(selector).first().evaluate(n=>getComputedStyle(n).fontFamily),/^"Pretendard Variable"/);
  const session=await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable'); await session.send('CSS.enable');
    const {root}=await session.send('DOM.getDocument');
    const {nodeId}=await session.send('DOM.querySelector',{nodeId:root.nodeId,selector});
    const {fonts}=await session.send('CSS.getPlatformFontsForNode',{nodeId});
    assert.ok(fonts.some(font=>font.isCustomFont&&font.glyphCount>0&&font.familyName.includes('Pretendard')),`${selector}: ${JSON.stringify(fonts)}`);
    assert.ok(fonts.every(font=>!font.glyphCount||font.familyName.includes('Pretendard')),`${selector}: unexpected fallback ${JSON.stringify(fonts)}`);
  } finally {await session.detach();}
}

test('mobile layout restores rendered dimensions, keeps tablet rows and survives viewport changes', {timeout:60000}, async () => {
  const browser = await chromium.launch({ headless:true, ...(process.env.TEST_BROWSER_CHANNEL ? { channel:process.env.TEST_BROWSER_CHANNEL } : {}) });
  try {
      const db=fixture();
      db.notes.items=db.notes.items.filter(n=>!n.done);
      const records=structuredClone({worklog:db.worklog,notes:db.notes,goals:db.goals});
      const sizes={
        worklog:{contentW:1100,frameH:600,listH:373,scale:.8},
        notes:{contentW:500,frameH:500,listH:454,scale:.8},
        deadlines:{contentW:300,frameH:240,scale:1},
      };
      db.layouts={[instance]:Object.fromEntries(Object.entries(sizes).map(([widget,size])=>[widget,{size:{...size,
        widthLocked:true,heightLocked:true,scaleLocked:true,listLocked:true},updatedAt:now.toISOString()}]))};
      const measurements=[];
      for(const [label,width,height,touch,screen] of [
        ['desktop',1440,1000,false],['ipad',768,1024,true],
        ['ipad-split',480,900,true,{width:768,height:1024}],['phone',390,844,true],
        ['small-phone',320,740,true],['phone-landscape',844,390,true,{width:390,height:844}],
      ]) {
        const {context,errors}=await setup(browser,{viewport:{width,height},hasTouch:touch,isMobile:touch,...(screen?{screen}:{})},db);
        try {
          for(const [widget,file] of [['worklog','worklog-cream-olive-garden'],['notes','notes'],['deadlines','deadlines']]) {
            const page=await context.newPage();await page.clock.setFixedTime(now);
            await page.goto(`${origin}${prefix}${file}.html?w=${instance}`);
            await page.waitForFunction(()=>document.querySelector('[data-widget-host]').dataset.widgetSyncState==='ready');
            await page.locator(widget==='worklog'?'[data-toggle-task="t0"]':widget==='notes'?'[data-note-id="n1"]':'.wr-deadline').first().waitFor();
            await page.evaluate(()=>document.fonts.ready);
            await page.waitForTimeout(300);
            const writesBeforeResize=db.writes.length;
            const measure=()=>page.evaluate(()=>{
              const card=document.querySelector('[data-widget-card]'),host=document.querySelector('[data-widget-host]');
              const box=card.getBoundingClientRect();
              return {width:box.width,height:box.height,hostHeight:host.getBoundingClientRect().height,
                logicalHeight:card.offsetHeight,scale:Number(host.style.getPropertyValue('--widget-content-scale')),
                mode:document.body.dataset.widgetLayoutMode,compact:document.body.classList.contains('is-worklog-compact'),
                top:box.top,scroll:document.documentElement.scrollWidth,viewport:innerWidth,viewportHeight:innerHeight};
            });
            const before=await measure();measurements.push({label,widget,...before});
            if(process.env.TEST_SCREENSHOT_DIR) {
              await mkdir(process.env.TEST_SCREENSHOT_DIR,{recursive:true});
              await page.screenshot({path:resolve(process.env.TEST_SCREENSHOT_DIR,`size-${label}-${widget}.png`)});
            }
            // Changing an iframe's viewport does not change the device screen.
            // Playwright setViewportSize does, so preserve screen metrics here.
            const session=await context.newCDPSession(page);
            const resize=h=>session.send('Emulation.setDeviceMetricsOverride',{
              width,height:h,deviceScaleFactor:1,mobile:touch,
              screenWidth:screen?.width||width,screenHeight:screen?.height||height,
            });
            await resize(180);
            await page.waitForTimeout(150);
            await resize(height);
            await page.waitForTimeout(300);
            const after=await measure();
            await session.detach();
            assert.equal(db.writes.length,writesBeforeResize,'viewport changes must not write records');
            assert.ok(Math.abs(after.height-before.height)<2,`${label} ${widget}: height lost after short embed: ${JSON.stringify({before,after})}`);
            assert.ok(before.scroll<=width+1,`${label} ${widget}: horizontal overflow`);
            if(touch)assert.ok(before.top<7,`${label} ${widget}: blank space above the widget`);
          }
          assert.deepEqual(errors,[]);
        } finally {await context.close();}
      }
      for(const m of measurements) {
        const saved=sizes[m.widget];
        const phone=m.label.includes('phone')&&m.widget==='worklog';
        const expectedScale=phone||m.widget==='deadlines'?1:Math.min(saved.scale,m.viewport/saved.contentW);
        const expectedHeight=Math.min(m.viewportHeight,saved.frameH*(phone?saved.scale:expectedScale));
        assert.ok(Math.abs(m.height-expectedHeight)<2,`rendered size ${JSON.stringify(m)}, expected height ${expectedHeight}`);
        assert.ok(Math.abs(m.hostHeight-m.height)<2,`frame mismatch ${JSON.stringify(m)}`);
        if(m.widget==='worklog')assert.equal(m.compact,phone,`tablet must not inflate phone cards: ${JSON.stringify(m)}`);
      }
      assert.equal(db.layoutRequests.filter(r=>r.method==='POST').length,0,'restoring never changes shared sizes');
      assert.deepEqual({worklog:db.worklog,notes:db.notes,goals:db.goals},records,'user records are unchanged');
      // The corner handle can save only scaleLocked, without an axis lock.
      db.layouts[instance].worklog.size={contentW:1350,frameH:595,listH:368,scale:.6,
        scaleLocked:true,widthLocked:true,heightLocked:false,listLocked:false};
      const phone=await setup(browser,{viewport:{width:390,height:844},hasTouch:true,isMobile:true},db);
      try {
        const page=await phone.context.newPage();await page.clock.setFixedTime(now);
        await page.goto(`${origin}${prefix}worklog-cream-olive-garden.html?w=${instance}`);
        await page.waitForFunction(()=>document.querySelector('[data-widget-host]').dataset.widgetSyncState==='ready');
        await page.waitForTimeout(300);
        const height=await page.locator('[data-widget-card]').evaluate(n=>n.getBoundingClientRect().height);
        assert.ok(Math.abs(height-595*.6)<2,`corner-only saved height ignored: ${height}`);
        await page.reload();
        await page.waitForFunction(()=>document.querySelector('[data-widget-host]').dataset.widgetSyncState==='ready');
        await page.waitForTimeout(300);
        assert.ok(Math.abs((await page.locator('[data-widget-card]').boundingBox()).height-height)<2);
        assert.deepEqual(phone.errors,[]);
      } finally {await phone.context.close();}
      assert.equal(db.layoutRequests.filter(r=>r.method==='GET').length,7,'one bounded read per device storage, including reload');
      assert.equal(db.layoutRequests.filter(r=>r.method==='POST').length,0,'mobile restoration never uploads fitted sizes');
  } finally {await browser.close();}
});

test('offline read-widget browser acceptance', { timeout:180000 }, async t => {
  const browser = await chromium.launch({ headless:true, ...(process.env.TEST_BROWSER_CHANNEL ? { channel:process.env.TEST_BROWSER_CHANNEL } : {}) });
  try {
    await t.test('sizes sync across separate PC, iPad and phone storage without writes on restore or repeated focus GETs',async()=>{
      const source=await setup(browser);
      const all=[...files,'worklog-cream-olive-garden','notes'];
      try {
        for(const file of all) {
          const page=await source.context.newPage();await page.clock.setFixedTime(now);
          await page.goto(`${origin}${prefix}${file}.html?w=${instance}`);
          await page.waitForFunction(()=>document.querySelector('[data-widget-host]')?.dataset.widgetSyncState==='ready');
          const handle=page.locator('.widget-width-handle-right');
          await handle.focus();
          for(let i=0;i<4;i++)await handle.press('ArrowLeft');
          await page.waitForFunction(()=>document.querySelector('[data-widget-host]')?.dataset.widgetSyncState==='ready');
        }
        const counted=method=>source.db.layoutRequests.filter(r=>r.method===method).length;
        assert.equal(counted('GET'),1,'one read for all six');
        assert.equal(counted('POST'),6,'four keyboard adjustments merge to one write per widget');
        const saved=structuredClone(source.db.layouts[instance]);
        for(const page of source.context.pages()) await page.evaluate(()=>{for(let i=0;i<12;i++)window.dispatchEvent(new Event('focus'));});
        assert.equal(counted('GET'),1);
        for(const options of [{viewport:{width:1000,height:900}},{viewport:{width:768,height:1000},isMobile:true,hasTouch:true},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]) {
          const target=await setup(browser,options,source.db);
          const before=counted('GET');
          try {
            for(const file of all) {
              const page=await target.context.newPage();await page.clock.setFixedTime(now);
              await page.goto(`${origin}${prefix}${file}.html?w=${instance}`);
              await page.waitForFunction(()=>document.querySelector('[data-widget-host]')?.dataset.widgetSyncState==='ready');
              const restored=await page.evaluate(()=>{
                const host=document.querySelector('[data-widget-host]');
                return {widget:host.dataset.widgetSync,size:JSON.parse(localStorage.getItem(`${host.dataset.widgetKey}:${Store.getWidgetInstanceId()}`)),
                  width:host.getBoundingClientRect().width,viewport:window.innerWidth,scroll:document.documentElement.scrollWidth};
              });
              assert.deepEqual(restored.size,saved[restored.widget].size);
              assert.ok(restored.width<=restored.viewport+2,`${file} overflow ${JSON.stringify(restored)}`);
              assert.ok(restored.scroll<=restored.viewport+2,`${file} page overflow`);
            }
            assert.equal(counted('GET')-before,1,'one read in the fresh device storage');
            assert.equal(counted('POST'),6,'restoring or shrinking to a phone must never save');
            assert.deepEqual(target.errors,[]);
          } finally {await target.context.close();}
        }
        assert.deepEqual(source.db.layouts[instance],saved,'small screens did not replace the shared dimensions');
        assert.deepEqual(source.errors,[]);
      } finally {await source.context.close();}
    });
    await t.test('size failure retains local dimensions and warning without automatic retries or cross-key writes',async()=>{
      const {context,db,open,errors}=await setup(browser);
      try {
        const page=await open('deadlines');
        await page.waitForFunction(()=>document.querySelector('[data-widget-host]').dataset.widgetSyncState==='ready');
        db.layoutFail=true;
        await page.locator('.widget-height-handle-bottom').press('ArrowDown');
        await page.waitForFunction(()=>document.querySelector('[data-widget-host]').dataset.widgetSyncState==='unsaved');
        const before=db.layoutRequests.length;
        for(let i=0;i<10;i++)await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
        await page.reload();
        await page.waitForFunction(()=>document.querySelector('[data-widget-host]').dataset.widgetSyncState==='unsaved');
        assert.equal(db.layoutRequests.length,before);
        assert.match(await page.locator('.widget-layout-status').textContent(),/이 기기에만/);
        db.layoutFail=false;
        await page.locator('.widget-height-handle-bottom').press('ArrowDown');
        await page.waitForFunction(()=>document.querySelector('[data-widget-host]').dataset.widgetSyncState==='ready');
        const isolated=await open('deadlines',`?w=${originalInstance}`);
        await isolated.waitForFunction(()=>document.querySelector('[data-widget-host]').dataset.widgetSyncState==='ready');
        assert.equal(await isolated.evaluate(()=>localStorage.getItem(`${document.querySelector('[data-widget-host]').dataset.widgetKey}:${Store.getWidgetInstanceId()}`)),null);
        assert.deepEqual(db.layouts[originalInstance],{});
        assert.deepEqual(errors,[]);
      } finally {await context.close();}
    });
    await t.test('shared reads collapse focus bursts, reuse successful writes and poll only revision while unchanged',async()=>{
      const {context,db,errors,openAll}=await setup(browser);
      try {
        const pages=await openAll();
        const writer=await context.newPage(); await writer.clock.setFixedTime(now);
        await writer.goto(`${origin}${prefix}worklog-cream-olive-garden.html?w=${instance}`);
        await writer.locator('[data-toggle-task="t0"]').waitFor();
        const reads=()=>db.requests.filter(r=>r.method==='GET');
        assert.equal(reads().filter(r=>r.path==='/api/worklog/state').length,1);
        assert.equal(reads().filter(r=>r.path==='/api/weekly-goals/state').length,1);
        for(const page of pages) await page.evaluate(()=>{for(let i=0;i<8;i++)window.dispatchEvent(new Event('focus'));});
        await writer.locator('[data-toggle-task="t0"]').click();
        await pages[2].waitForFunction(()=>document.querySelector('[data-date="2026-09-29"] .wr-day-count')?.textContent==='1 / 8');
        await pages[1].waitForFunction(()=>!document.querySelector('[data-task-id="t0"]'));
        assert.equal(reads().length,2,'no GET after the successful edit/focus bursts');
        const notes=await context.newPage(); await notes.clock.setFixedTime(now);
        await notes.goto(`${origin}${prefix}notes.html?w=${instance}`);
        await notes.locator('[data-note-id="n1"]').waitFor();
        await notes.locator('[data-note-id="old-done"]').waitFor({state:'detached'});
        assert.equal(reads().filter(r=>r.path.includes('worklog')||r.path.includes('weekly-goals')).length,2,'notes cleanup must not refetch tasks/goals');
        for(const page of [...pages,writer]) await page.clock.setFixedTime(new Date(now.getTime()+121000));
        for(const page of pages) await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
        await pages[0].waitForFunction(()=>document.querySelector('[data-read-widget]').getAttribute('aria-busy')==='false');
        assert.equal(reads().filter(r=>r.path==='/api/worklog/revision').length,1);
        assert.equal(reads().filter(r=>r.path==='/api/worklog/state').length,1);
        assert.deepEqual(errors,[]);
      } finally {await context.close();}
    });

    await t.test('D1 HTTP 500 pauses all six widgets and reloads until reset without misreporting empty data',async()=>{
      const {context,db,errors,openAll}=await setup(browser);
      try {
        const pages=await openAll();
        const writer=await context.newPage(); await writer.clock.setFixedTime(now);
        await writer.goto(`${origin}${prefix}worklog-cream-olive-garden.html?w=${instance}`);
        await writer.locator('[data-toggle-task="t0"]').waitFor();
        const notes=await context.newPage(); await notes.clock.setFixedTime(now);
        await notes.goto(`${origin}${prefix}notes.html?w=${instance}`);
        await notes.locator('[data-note-id="n1"]').waitFor();
        await notes.locator('[data-note-id="old-done"]').waitFor({state:'detached'});
        const writesBefore=db.writes.length;
        db.fail='d1';
        for(const page of [...pages,writer,notes]) await page.clock.setFixedTime(new Date(now.getTime()+360001));
        for(const page of [...pages,writer,notes]) await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
        for(const page of pages) await page.waitForFunction(()=>document.querySelector('[data-read-widget]').dataset.status==='stale');
        assert.match(await text(pages[0],'.wr-error'),/오전 9시/);
        await writer.waitForFunction(()=>document.querySelector('[data-widget-card]').dataset.readStatus==='stale');
        await notes.waitForFunction(()=>document.querySelector('#notesCard').dataset.readStatus==='stale');
        const count=db.requests.length;
        for(const page of pages) {
          await page.reload();
          await page.waitForFunction(()=>document.querySelector('[data-read-widget]').dataset.status==='stale');
          assert.match(await text(page,'.wr-error'),/이전 데이터 표시 중/);
        }
        assert.equal(await pages[0].locator('.wg-row').count(),4);
        assert.equal(await pages[1].locator('.wr-deadline').count(),5);
        assert.equal(await text(pages[2],'[data-date="2026-09-29"] .wr-day-count'),'0 / 8');
        assert.equal(await pages[3].locator('[data-date="2026-09-29"] .wr-dot').count(),5);
        await pages[2].getByRole('button',{name:'이전 주',exact:true}).click();
        const period=await text(pages[2],'.wr-period'); await pages[2].reload();
        await pages[2].waitForFunction(()=>document.querySelector('[data-read-widget]').dataset.status==='stale');
        assert.equal(await text(pages[2],'.wr-period'),period);
        await writer.reload(); await notes.reload();
        await writer.waitForFunction(()=>document.querySelector('[data-widget-card]').dataset.readStatus==='stale');
        await notes.waitForFunction(()=>document.querySelector('#notesCard').dataset.readStatus==='stale');
        assert.equal(await writer.locator('[data-toggle-task="t0"]').isDisabled(),true);
        assert.equal(await notes.locator('[data-note-id="n1"] .check-action').isDisabled(),true);
        assert.equal(await notes.locator('[data-note-id="n1"] .memo-text').textContent(),'기존 메모');
        assert.equal(await writer.locator('#readStatus').isVisible(),true);
        assert.equal(await notes.locator('.notes-live').isVisible(),true);
        const blank=await context.newPage();await blank.clock.setFixedTime(new Date(now.getTime()+360001));
        await blank.goto(`${origin}${prefix}deadlines.html?w=${originalInstance}`);
        await blank.waitForFunction(()=>document.querySelector('[data-read-widget]').dataset.status==='error');
        assert.equal(await blank.locator('.wr-deadline').count(),0,'never show another key’s snapshot');
        assert.equal(db.requests.length,count,'reloads/focuses/new documents cannot hammer an exhausted account');
        assert.equal(db.writes.length,writesBefore,'cached display does not clean up, roll tasks or save');
        db.fail=null; db.worklog.tasks[0].done=true;db.worklog.revision++;
        for(const page of pages) await page.clock.setFixedTime(new Date('2026-09-30T09:00:06+09:00'));
        for(const page of pages) await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
        for(const page of pages) await page.waitForFunction(()=>document.querySelector('[data-read-widget]').dataset.status==='ready');
        assert.equal(await pages[1].locator('[data-task-id="t0"]').count(),0);
        for(const page of [writer,notes]) {
          await page.clock.setFixedTime(new Date('2026-09-30T09:00:06+09:00'));
          await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
        }
        await writer.waitForFunction(()=>document.querySelector('[data-widget-card]').dataset.readStatus==='ready');
        await notes.waitForFunction(()=>document.querySelector('#notesCard').dataset.readStatus==='ready');
        assert.equal(await notes.locator('[data-note-id="n1"] .check-action').isDisabled(),false);
        assert.equal(await writer.locator('#readStatus').isVisible(),false);
        assert.deepEqual(errors,[]);
      } finally {await context.close();}
    });

    await t.test('missing goal cache does not hide available tasks or invent an empty-goal success on mobile',async()=>{
      const {context,db,errors}=await setup(browser,{viewport:{width:390,height:844},hasTouch:true,isMobile:true});
      try {
        db.fail='/api/weekly-goals/state';
        for(const file of files) {
          const page=await context.newPage();await page.clock.setFixedTime(now);
          await page.goto(`${origin}${prefix}${file}.html?w=${instance}`);
          await page.waitForFunction(()=>document.querySelector('[data-read-widget]').dataset.status==='stale');
          assert.match(await text(page,'.wr-error'),/목표 정보는 확인하지 못/);
          if(file==='weekly-goals') assert.match(await text(page,'.wr-message'),/목표 정보를 확인하지 못/);
          if(file==='deadlines') assert.equal(await page.locator('.wr-deadline').count(),5);
          if(file==='week-review') assert.equal(await page.locator('[data-date="2026-09-29"] .wr-task').count(),8);
          if(file==='month-calendar') assert.equal(await page.locator('[data-date="2026-09-29"] .wr-dot').count(),5);
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        }
        assert.deepEqual(db.writes,[]);assert.deepEqual(errors,[]);
      } finally {await context.close();}
    });

    await t.test('all six widgets render bundled Pretendard glyphs, controls and tooltips with external font hosts blocked',async()=>{
      for(const [width,height,touch] of [[1440,1000,false],[768,1024,true],[390,844,true]]) {
        const {context,db,errors,openAll}=await setup(browser,{viewport:{width,height},hasTouch:touch,isMobile:touch});
        try {
          const fontRequests=[],externalFonts=[];
          context.on('request',req=>{
            if(req.resourceType()==='font')fontRequests.push(req.url());
            if(/jsdelivr|cdnjs|unpkg|fonts\.google/.test(req.url()))externalFonts.push(req.url());
          });
          const [goals,due,week,month]=await openAll();
          for(const [page,selector] of [[goals,'.wg-name'],[due,'.wr-ellipsis'],[week,'.wr-task-name'],[month,'.wr-date-number']]) await expectPretendard(page,selector);
          if(!touch) {
            await due.locator('.wr-ellipsis').first().dispatchEvent('pointerover',{pointerType:'mouse'});
            await expectPretendard(due,'.wr-tooltip');
          }
          const writer=await context.newPage(); await writer.clock.setFixedTime(now);
          await writer.goto(`${origin}${prefix}worklog-cream-olive-garden.html?w=${instance}`);
          await expectPretendard(writer,'.task-title-button');
          await expectPretendard(writer,'.mode-pill');
          await writer.locator('[data-inline-start="title"][data-task-id="t0"]').click();
          assert.match(await writer.locator('[data-inline-input]').evaluate(n=>getComputedStyle(n).fontFamily),/^"Pretendard Variable"/);
          await writer.keyboard.press('Escape');
          const notes=await context.newPage(); await notes.clock.setFixedTime(now);
          await notes.goto(`${origin}${prefix}notes.html?w=${instance}`);
          await expectPretendard(notes,'.memo-text');
          await expectPretendard(notes,'.add-row');
          await notes.locator('[data-note-id="n1"] .memo-text').click();
          assert.match(await notes.locator('#activeNoteInput').evaluate(n=>getComputedStyle(n).fontFamily),/^"Pretendard Variable"/);
          // Probe text not limited to the original design preview, in each used weight.
          for(const page of [goals,due,week,month,writer,notes]) {
            const loaded=await page.evaluate(async()=>{
              for(const weight of [400,500,600,700,800]) await document.fonts.load(`${weight} 13px "Pretendard Variable"`,'꼼꼼한 뷰 쀍 ABC 1234');
              return [...document.fonts].filter(f=>f.family.includes('Pretendard')).map(f=>({family:f.family,status:f.status,weight:f.weight}));
            });
            assert.deepEqual(loaded,[{family:'Pretendard Variable',status:'loaded',weight:'45 920'}]);
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          }
          assert.ok(fontRequests.length>=6);
          assert.ok(fontRequests.every(url=>url===`${origin}/cream-olive-garden/assets/fonts/pretendard-1.3.9/PretendardVariable.woff2`));
          assert.deepEqual(externalFonts,[]); assert.deepEqual(errors,[]);
          assert.ok(db.writes.every(write=>write.path==='/api/notes/patch'),'only the existing notes cleanup may write to the memory fixture');
        } finally {await context.close();}
      }
    });

    await t.test('initial static loading text uses the bundled font before widget scripts run',async()=>{
      const {context,db}=await setup(browser,{javaScriptEnabled:false});
      try {
        for(const file of files) {
          const page=await context.newPage();
          await page.goto(`${origin}${prefix}${file}.html?w=${instance}`);
          await expectPretendard(page,'.read-loading');
        }
        assert.deepEqual(db.requests,[]); assert.deepEqual(db.writes,[]);
      } finally {await context.close();}
    });

    await t.test('missing-key and data-error messages use Pretendard including the inline Store indicator',async()=>{
      const {context,db,errors}=await setup(browser);
      try {
        for(const file of [...files,'worklog-cream-olive-garden','notes']) {
          const page=await context.newPage(); await page.clock.setFixedTime(now);
          await page.goto(`${origin}${prefix}${file}.html`);
          if(files.includes(file)) await expectPretendard(page,'.wr-message');
          await expectPretendard(page,'[data-store-error-indicator]');
        }
        assert.deepEqual(db.requests,[]); assert.deepEqual(db.writes,[]); assert.deepEqual(errors,[]);
      } finally {await context.close();}
    });

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

    await t.test('priority choices update the visible number using actual taps and keyboard Enter', async () => {
      for(const [width,height,touch] of [[768,1024,true],[390,844,true],[1440,1000,false]]) {
        const {context,db,errors}=await setup(browser,{viewport:{width,height},hasTouch:touch,isMobile:touch});
        try {
          const writer=await context.newPage(); await writer.clock.setFixedTime(now);
          await writer.goto(`${origin}${prefix}worklog-cream-olive-garden.html?w=${instance}`);
          const cell=writer.locator('[data-cell-task="t0"][data-cell-field="q"]');
          await cell.waitFor();
          for(const q of [1,2,3,4,null]) {
            if(touch) await cell.tap(); else await cell.press('Enter');
            const choice=writer.locator(`[data-q-choice="${q ?? ''}"]`);
            assert.equal(await choice.locator('.q-badge').textContent(),q?String(q):'–');
            await Promise.all([
              writer.waitForResponse(r=>r.url().includes('/api/worklog/patch') && r.request().postDataJSON()?.upserts?.some(task=>task.id==='t0'&&task.q===q),{timeout:3000}),
              touch?choice.tap():choice.press('Enter')
            ]);
            await writer.waitForFunction(expected=>document.querySelector('[data-cell-task="t0"][data-cell-field="q"] .q-badge')?.textContent===expected,q?String(q):'–',{timeout:3000});
            assert.equal(db.worklog.tasks.find(task=>task.id==='t0').q,q);
          }
          await writer.reload(); await cell.waitFor();
          assert.equal(await cell.textContent(),'–'); assert.deepEqual(errors,[]);
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

    await t.test('goal number colors agree across worklog and all four read widgets without color writes', async () => {
      const {context,db,originalDb,errors,openAll}=await setup(browser);
      try {
        const original=structuredClone(originalDb);
        db.goals={week:'2026-9-28',items:[{id:'saved',text:'기존 색 보존',m:'work',color:'#75785D'}]};
        db.worklog.tasks.slice(0,4).forEach((task,i)=>{task.goalId=`worklog:goal:${[1,2,3,1][i]}`;});
        db.worklog.tasks[5].goalId='saved';
        const [goals,due,week,month]=await openAll();
        assert.deepEqual(db.writes,[],'opening the read widgets cannot persist display colors');
        const writer=await context.newPage(); await writer.clock.setFixedTime(now);
        await writer.goto(`${origin}${prefix}worklog-cream-olive-garden.html?w=${instance}`);
        await writer.locator('[data-goal-task="t0"]').waitFor();
        const colors=['rgb(105, 122, 67)','rgb(244, 221, 160)','rgb(154, 107, 82)'];
        const background=locator=>locator.evaluate(n=>getComputedStyle(n).backgroundColor);
        for(let i=0;i<4;i++) {
          const expected=colors[[0,1,2,0][i]];
          for(const marker of [writer.locator(`[data-goal-task="t${i}"] .goal-dot`),goals.locator(`[data-goal-id="t${i}"] .wg-number`),due.locator(`[data-task-id="t${i}"] .wr-dot`),week.locator(`[data-task-id="t${i}"] .wr-dot`),month.locator('[data-date="2026-09-29"] .wr-dot').nth(i)]) assert.equal(await background(marker),expected);
        }
        assert.equal(await background(goals.locator('[data-goal-id="saved"] .wg-number')),'rgb(117, 120, 93)');
        assert.equal(await background(week.locator('[data-task-id="t5"] .wr-dot')),'rgb(117, 120, 93)');
        assert.equal(await background(due.locator('[data-task-id="t4"] .wr-dot')),'rgba(0, 0, 0, 0)');
        assert.equal(await writer.locator('[data-goal-task="t1"] .goal-dot').evaluate(n=>getComputedStyle(n).color),await goals.locator('[data-goal-id="t1"] .wg-number').evaluate(n=>getComputedStyle(n).color));
        for(const number of [2,3,0,1]) {
          await writer.locator('[data-goal-task="t0"]').click();
          await goals.waitForFunction(number=>number?document.querySelector('[data-goal-id="t0"] .wg-number')?.textContent===String(number):!document.querySelector('[data-goal-id="t0"]'),number);
          const expected=number?colors[number-1]:'rgba(0, 0, 0, 0)';
          for(const [page,selector] of [[due,'[data-task-id="t0"] .wr-dot'],[week,'[data-task-id="t0"] .wr-dot'],[month,'[data-date="2026-09-29"] .wr-dot']]) {
            await page.waitForFunction(({selector,expected})=>getComputedStyle(document.querySelector(selector)).backgroundColor===expected,{selector,expected});
          }
          assert.equal(await background(writer.locator('[data-goal-task="t0"] .goal-dot')),expected);
        }
        await writer.reload(); await goals.reload();
        await writer.locator('[data-goal-task="t0"]').waitFor(); await goals.locator('[data-goal-id="t0"]').waitFor();
        assert.equal(await background(goals.locator('[data-goal-id="t0"] .wg-number')),colors[0]);
        assert.equal(await background(writer.locator('[data-goal-task="t0"] .goal-dot')),colors[0]);
        assert.ok(db.worklog.tasks.every(task=>!Object.hasOwn(task,'color')));
        assert.deepEqual(db.goals.items,[{id:'saved',text:'기존 색 보존',m:'work',color:'#75785D'}]);
        assert.deepEqual(originalDb,original); assert.deepEqual(errors,[]);
        if(process.env.TEST_SCREENSHOT_DIR) for(const [name,page] of [['worklog',writer],['goals',goals],['deadlines',due],['week',week],['month',month]]) {
          await mkdir(process.env.TEST_SCREENSHOT_DIR,{recursive:true});
          await page.screenshot({path:resolve(process.env.TEST_SCREENSHOT_DIR,`goal-colors-${name}.png`),fullPage:false});
        }
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
        const key=`widget-size-cream-olive-deadlines-read-v1:${instance}`;
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
            assert.equal(metrics.background, 'rgb(253, 246, 237)');
            assert.equal(metrics.scale, '1');
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
          const widgetWidth=await week.locator('[data-read-widget]').evaluate(n=>n.clientWidth);
          if(widgetWidth>=600) assert.ok(columns.every(c => Math.abs(c.height - columns[0].height) < 1), `${label} unequal weekday heights`);
          assert.equal(new Set(columns.map(c => Math.round(c.y))).size, widgetWidth<600 ? 5 : 1, `${label}: width ${widgetWidth}`);
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

    await t.test('all five companion widgets share the outer card background and keep transparent surrounds', async () => {
      for(const [width,height,touch] of [[1440,1000,false],[768,1024,true],[390,844,true]]) {
        const {context,errors,openAll}=await setup(browser,{viewport:{width,height},hasTouch:touch,isMobile:touch});
        try {
          const pages=await openAll(), notes=await context.newPage(); await notes.clock.setFixedTime(now);
          await notes.goto(`${origin}${prefix}notes.html?w=${instance}`);
          await notes.locator('[data-note-id="n1"]').waitFor(); pages.push(notes);
          for(const page of pages) {
            const actual=await page.evaluate(()=>({
              card:getComputedStyle(document.querySelector('.wr-card, .notes-card')).backgroundColor,
              body:getComputedStyle(document.body).backgroundColor,
              host:getComputedStyle(document.querySelector('[data-widget-host]')).backgroundColor
            }));
            assert.deepEqual(actual,{card:'rgb(253, 246, 237)',body:'rgba(0, 0, 0, 0)',host:'rgba(0, 0, 0, 0)'});
          }
          assert.deepEqual(errors,[]);
        } finally {await context.close();}
      }
    });

    await t.test('read theme sorts deadline ties and completed weekdays without changing stored records', async () => {
      const {context,db,errors,open,notify}=await setup(browser);
      try {
        db.worklog.tasks.slice(0,7).forEach((task,i)=>{task.q=[4,1,2,3,null,4,null][i];task.due='2026-09-29';});
        const original=structuredClone(db.worklog);
        const due=await open('deadlines');
        const ids=(page,selector)=>page.locator(selector).evaluateAll(nodes=>nodes.map(n=>n.dataset.taskId));
        assert.deepEqual(await ids(due,'.wr-deadline'),['t1','t2','t3','t0','t5']);
        assert.deepEqual(db.worklog,original);
        db.worklog.tasks[1].done=true; db.worklog.revision++; await notify(due);
        await due.waitForFunction(()=>!document.querySelector('[data-task-id="t1"]'));
        assert.deepEqual(await ids(due,'.wr-deadline'),['t2','t3','t0','t5','t4']);
        assert.equal(await due.locator('[data-task-id="t7"]').count(),0);
        db.worklog.tasks[0].done=true; db.worklog.tasks[3].done=true;
        const week=await open('week-review');
        await notify(week);
        await week.waitForFunction(()=>document.querySelector('[data-date="2026-09-29"] .wr-day-count')?.textContent==='3 / 8');
        assert.deepEqual(await ids(week,'[data-date="2026-09-29"] .wr-task'),['t1','t3','t0','t2','t5','t4','t6','t7']);
        assert.equal(await week.locator('.is-first-open').count(),1);
        assert.equal(await week.locator('.is-first-open').getAttribute('data-task-id'),'t2');
        assert.equal(await text(week,'.wr-day.is-today .wr-today-tag'),'오늘');
        assert.equal(await week.locator('.wr-day.is-today .wr-day-header').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(244, 221, 160)');
        const heights=await week.locator('.wr-day').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));
        assert.ok(heights.every(h=>Math.abs(h-heights[0])<1));
        const saved=structuredClone(db.worklog); await week.locator('.wr-check').first().click();
        assert.deepEqual(db.worklog,saved); assert.deepEqual(db.writes,[]); assert.deepEqual(errors,[]);
      } finally {await context.close();}
    });

    await t.test('260px deadline labels clamp to two lines and the four badge colors and widths match the supplied design', async () => {
      for(const touch of [false,true]) {
        const {context,db,errors,open}=await setup(browser,{viewport:{width:260,height:800},hasTouch:touch,isMobile:touch});
        try {
          db.worklog.tasks=db.worklog.tasks.slice(0,4).map((task,i)=>({...task,due:['2026-09-29','2026-09-30','2026-10-01','2026-10-02'][i]}));
          const page=await open('deadlines');
          const badges=await page.locator('.wr-dday').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,background:getComputedStyle(n).backgroundColor,color:getComputedStyle(n).color,radius:getComputedStyle(n).borderRadius,font:getComputedStyle(n).fontSize,weight:getComputedStyle(n).fontWeight})));
          assert.deepEqual(badges.map(b=>b.width),[48,48,48,48]);
          assert.deepEqual(badges.map(b=>b.background),['rgb(105, 122, 67)','rgb(244, 221, 160)','rgb(233, 236, 220)','rgb(233, 236, 220)']);
          assert.equal(badges[0].color,'rgb(255, 255, 255)'); assert.ok(badges.every(b=>b.radius==='999px'&&b.font==='10px'&&b.weight==='800'));
          const label=page.locator('[data-task-id="t0"] .wr-ellipsis');
          const size=await label.evaluate(n=>({height:n.clientHeight,scroll:n.scrollHeight,line:parseFloat(getComputedStyle(n).lineHeight),clamp:getComputedStyle(n).webkitLineClamp,font:getComputedStyle(n).fontSize}));
          assert.equal(size.clamp,'2'); assert.equal(size.font,'12px'); assert.ok(Math.abs(size.height-size.line*2)<=1); assert.ok(size.scroll>size.height);
          await label.dispatchEvent('pointerover',{pointerType:touch?'touch':'mouse'});
          assert.equal(await page.locator('.wr-tooltip').isVisible(),!touch);
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          if(process.env.TEST_SCREENSHOT_DIR) await page.screenshot({path:resolve(process.env.TEST_SCREENSHOT_DIR,`260-${touch?'touch':'mouse'}-deadlines.png`)});
          assert.deepEqual(db.writes,[]); assert.deepEqual(errors,[]);
        } finally {await context.close();}
      }
    });

    await t.test('widget-width breakpoints and calendar tiles work at 375px even with old scale settings', async () => {
      for(const touch of [false,true]) {
        const {context,db,errors,openAll}=await setup(browser,{viewport:{width:375,height:900},hasTouch:touch,isMobile:touch,screen:{width:768,height:1024}});
        try {
          await context.addInitScript(()=>{
            if(location.origin!=='http://127.0.0.1:4179') return;
            for(const name of ['weekly-goals','deadlines','week-review','month-calendar']) {
              localStorage.setItem(`widget-size-cream-olive-${name}-read-v1`,JSON.stringify({scale:.5,scaleLocked:true,contentW:1100,widthLocked:true,heightLocked:false}));
            }
          });
          db.worklog.tasks[5].due='2026-09-29';
          const [goals,due,week,month]=await openAll();
          for(const page of [goals,due,week,month]) {
            const style=await page.locator('[data-widget-card]').evaluate(n=>({matrix:new DOMMatrixReadOnly(getComputedStyle(n).transform).a,zoom:getComputedStyle(n).zoom,right:n.getBoundingClientRect().right}));
            assert.equal(style.matrix,1); assert.equal(style.zoom,'1'); assert.ok(style.right<=375);
            assert.equal(await page.locator('.wr-card').evaluate(n=>getComputedStyle(n).borderRadius),'18px');
          }
          assert.equal(await week.locator('.wr-week').evaluate(n=>getComputedStyle(n).flexDirection),'column');
          assert.equal(await week.locator('.wr-task').first().evaluate(n=>getComputedStyle(n).fontSize),'13px');
          const goal=goals.locator('[data-goal-id="2"] .wg-name');
          assert.equal(await goal.textContent(),longName);
          assert.equal(await goal.evaluate(n=>n.scrollHeight<=n.clientHeight+1&&n.scrollWidth<=n.clientWidth+1),true);
          assert.equal(await goals.locator('.wg-count strong').first().evaluate(n=>getComputedStyle(n).color),'rgb(105, 122, 67)');
          const today=month.locator('.wr-date.is-today');
          assert.equal(await today.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(244, 221, 160)');
          assert.equal(await today.locator('.wr-today-tag').isVisible(),false);
          assert.equal(await month.locator('.wr-date.in-last-row').count(),0);
          const cells=await month.locator('.wr-date').evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y,border:getComputedStyle(n).borderRightWidth})));
          assert.equal(new Set(cells.slice(0,7).map(c=>c.y)).size,1); assert.equal(new Set(cells.slice(0,7).map(c=>c.x)).size,7); assert.ok(cells.every(c=>c.border==='0px'));
          const dots=await today.locator('.wr-dot').evaluateAll(nodes=>nodes.map(n=>({y:n.getBoundingClientRect().y,width:n.getBoundingClientRect().width})));
          assert.equal(dots.length,6); assert.equal(dots[0].y,dots[3].y); assert.equal(dots[4].y,dots[5].y); assert.ok(dots[4].y>dots[0].y); assert.ok(dots.every(d=>d.width===6));
          assert.equal(await month.locator('.wr-date.is-weekend:not(.is-other-month)').first().evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(245, 237, 223)');
          const other=await month.locator('.wr-date.is-other-month').first().evaluate(n=>({bg:getComputedStyle(n).backgroundColor,shadow:getComputedStyle(n).boxShadow}));
          assert.equal(other.bg,'rgba(0, 0, 0, 0)'); assert.match(other.shadow,/inset/);
          for(const [width,direction,font] of [[612,'row','12px'],[611,'column','13px'],[768,'row','12px'],[375,'column','13px']]) {
            await week.setViewportSize({width,height:900});
            await week.waitForFunction(expected=>getComputedStyle(document.querySelector('.wr-week')).flexDirection===expected,direction);
            assert.equal(await week.locator('.wr-task').first().evaluate(n=>getComputedStyle(n).fontSize),font);
            assert.equal(await week.locator('[data-widget-host]').evaluate(n=>n.style.getPropertyValue('--widget-content-scale')),'1');
          }
          if(process.env.TEST_SCREENSHOT_DIR) for(const [name,page] of [['goals',goals],['week',week],['calendar',month]]) await page.screenshot({path:resolve(process.env.TEST_SCREENSHOT_DIR,`375-${touch?'ipad':'desktop'}-${name}.png`)});
          assert.deepEqual(db.writes,[]); assert.deepEqual(errors,[]);
        } finally {await context.close();}
      }
    });

    await t.test('read widget corner resizing changes layout without scaling type or writing user data', async () => {
      const {context,db,errors,open}=await setup(browser);
      try {
        const page=await open('week-review');
        const metrics=()=>page.locator('[data-widget-card]').evaluate(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,scale:new DOMMatrixReadOnly(getComputedStyle(n).transform).a,font:getComputedStyle(n.querySelector('.wr-task')).fontSize}));
        const before=await metrics(), handle=page.locator('.widget-size-handle-bottom-right');
        await handle.focus(); await handle.press('ArrowLeft');
        let after=await metrics(); assert.ok(after.width<before.width); assert.equal(after.scale,1); assert.equal(after.font,before.font);
        await page.waitForFunction(()=>Math.abs(document.querySelector('.widget-size-handle-bottom-right').getBoundingClientRect().left-(document.querySelector('[data-widget-card]').getBoundingClientRect().right-20))<2);
        const box=await handle.boundingBox();
        await page.mouse.move(box.x+7,box.y+7); await page.mouse.down();
        await page.mouse.move(box.x-43,box.y-8,{steps:8}); await page.mouse.up();
        const resized=await metrics(); assert.ok(resized.width<after.width-40); assert.equal(resized.scale,1); assert.equal(resized.font,before.font);
        await page.reload(); await page.locator('.wr-task').first().waitFor();
        assert.ok(Math.abs((await metrics()).width-resized.width)<1); assert.equal((await metrics()).scale,1);
        assert.deepEqual(db.writes,[]); assert.deepEqual(errors,[]);
      } finally {await context.close();}
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
          await notify(page); await page.waitForFunction(() => document.querySelector('[data-read-widget]').dataset.status === 'stale');
          assert.match(await text(page, '.wr-error'), /이전 데이터/);
        }
        assert.equal(await pages[1].locator('.wr-header, .wr-title').count(),0);
        // An actually empty prior result is restored, with a persistent stale warning.
        await pages[0].reload();
        await pages[0].waitForFunction(() => document.querySelector('[data-read-widget]').dataset.status === 'stale');
        assert.match(await text(pages[0], '.wr-message'), /목표가 없/);
        assert.equal(await pages[0].locator('.wr-error').isVisible(),true);
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
        const key = `widget-size-cream-olive-weekly-goals-read-v1:${instance}`;
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
