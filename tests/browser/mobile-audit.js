// Run through playwright-cli run-code --filename tests/browser/mobile-audit.js.
// All data lives in this isolated browser context. No production API is called.
async (page) => {
  const files = ['Worklog/worklog','Worklog/weekly','Worklog/important-calendar','growth-page/goals','growth-page/record','game-log-diary/empty','Worklog/notes','Worklog/weekly-goals','Worklog/schedule','Worklog/history','Worklog/deadline-horizon','thought-box/thoughts','thought-box/find','thought-box/add','reading-notes/wishlist','reading-notes/session','reading-notes/reading-count','reading-notes/quote-drawer','reading-notes/life-books','reading-notes/library','reading-notes/drawer','reading-notes/book-add','public-connect','index','growth-page/stats','game-log-diary/today','game-log-diary/mood','game-log-diary/material','game-log-diary/calendar','game-log-diary/achieve'];
  const browser = page.context().browser();
  const context = await browser.newContext({ viewport:{ width:375, height:900 }, isMobile:true, hasTouch:true, deviceScaleFactor:1, timezoneId:'Asia/Seoul', reducedMotion:'reduce' });
  const mockRoute = route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:4173/')) {
      if (url.includes('/store.js')) return route.fulfill({ contentType:'text/javascript', body:'/* Store supplied by isolated UI fixture. */' });
      return route.continue();
    }
    if (url.startsWith('https://cdn.jsdelivr.net/')) return route.continue();
    return route.abort();
  };
  const init = () => {
    const full = new URLSearchParams(location.search).get('qa') === 'full';
    const text = '아주긴제목과메모를모바일에서도끝까지안전하게확인하는검증문장'.repeat(3).slice(0,60);
    const key = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const now = new Date(), today = key(now), monday = new Date(now);
    monday.setDate(now.getDate()-((now.getDay()+6)%7));
    const rows = full ? Array.from({length:30}, (_,i)=>({id:`qa-${i}`,title:`${i+1} ${text}`,text:`${i+1} ${text}`,done:i%3===2})) : [];
    const tasks = rows.map((r,i)=>({...r,mode:'work',date:today,due:today,proj:'프로젝트',q:i%4+1,status:r.done?'done':'wait',start:'09:00',end:'11:30',progress:2.5,est:3,memo:text}));
    const library = {books:rows.map((r,i)=>({...r,status:i%3===0?'wishlist':'reading',keep:true,isLifeBook:true,one:text,tags:['인생책'],author:text,year:now.getFullYear(),created:now.toISOString(),updated:now.toISOString()})),quotes:rows.map(r=>({...r,bookId:r.id,page:10,thought:text,created:now.toISOString()}))};
    let schedules=rows.map(r=>({...r,name:r.title,project:text,kind:'once',date:today,scheduleTime:'18:00',leadMinutes:60,nextOccurrence:{createAt:now.toISOString()}}));
    let worklog = {tasks,mode:'work',workView:'time',revision:1,projects:['프로젝트','두번째 구분'],lastRollDay:today,manualOrder:{}};
    let goals = {goals:rows.map((r,i)=>({...r,t:r.title,scope:['year','h1','h2','month'][i%4],parent:null,createdAt:Date.now()}))};
    let thoughts = {items:rows.map(r=>({...r,one:r.title,detail:text,cat:'방향성',created:Date.now()-40*86400000,opened:Date.now()})),cats:full?['방향성',text]:[],catOpened:{}};
    let notes = {items:rows};
    const diary = full ? {date:today,mode:'quest',type:'quest',mood:3,quest:{moodTags:['평온'],main:rows.map(r=>({...r,t:r.text})),ending:text},achievements:rows.map(r=>r.text)} : null;
    window.__writes = [];
    const copy = value => structuredClone(value);
    const write = (method, value) => { window.__writes.push({method,value:copy(value)}); return Promise.resolve(copy(value)); };
    window.Store = {
      watch:()=>()=>{}, watchReadingLibrary:callback=>{ setTimeout(()=>callback(copy(library)),0); return ()=>{}; },
      loadWorklogState:async()=>copy(worklog),
      patchWorklogState:async patch=>{ const removed=new Set(patch.deleteIds),updated=new Map((patch.upserts||[]).map(t=>[t.id,t])); worklog={...worklog,...patch.meta,tasks:[...worklog.tasks.filter(t=>!removed.has(t.id)&&!updated.has(t.id)),...updated.values()],revision:worklog.revision+1}; await write('patchWorklogState',patch); return copy(worklog); },
      saveWorklogView:async view=>{worklog.workView=view;return write('saveWorklogView',view);}, saveWorklogColumnSplit:async()=>({}),
      loadGoalState:async()=>copy(goals), saveGoalState:async value=>{goals=copy(value);return write('saveGoalState',value);},
      loadThoughtState:async()=>copy(thoughts), saveThoughtState:async value=>{thoughts=copy(value);return write('saveThoughtState',value);},
      loadNotesState:async()=>copy(notes), saveNotesState:async value=>{notes=copy(value);return write('saveNotesState',value);},
      loadWeeklyGoalsState:async()=>({week:`${monday.getFullYear()}-${monday.getMonth()+1}-${monday.getDate()}`,seq:30,items:rows.map((r,i)=>({...r,id:i+1,m:'work'}))}), saveWeeklyGoalsState:async value=>write('saveWeeklyGoalsState',value),
      loadImportantCalendarState:async()=>({tasks:copy(tasks)}), saveImportantCalendarState:async value=>write('saveImportantCalendarState',value),
      loadSchedules:async()=>copy(schedules), deleteSchedule:async id=>{schedules=schedules.filter(s=>s.id!==id);return write('deleteSchedule',id);},
      loadStatsSettings:async()=>({start:'2026-01-01',urls:{}}), saveStatsSettings:async value=>write('saveStatsSettings',value),
      getWrittenDates:async()=>full?[today]:[], getHP:async()=>full?80:20,
      loadDiary:async()=>copy(diary), loadDiaryRange:async()=>diary?[copy(diary)]:[], getMoodOfDate:async()=>full?3:null, loadMoodWords:async()=>[],
      getMaterials:async()=>copy(thoughts.items), getAchievements:async()=>rows.map(r=>({...r,t:r.text,date:today})),
      loadReadingNotesState:async()=>({byDate:full?{[today]:30}:{}}),
      loadIndexState:async()=>({scope:'week',items:rows.map(r=>({...r,t:r.title,scope:'week',q:null}))}),
      updateIndexItem:async(id,value)=>write('updateIndexItem',{id,...value}),
      updateReadingQuote:async(id,value)=>write('updateReadingQuote',{id,...value}), deleteReadingQuote:async id=>write('deleteReadingQuote',{id}),
      saveDiary:async value=>write('saveDiary',value), deleteDiary:async date=>write('deleteDiary',{date})
    };
    window.fetch = async () => new Response(JSON.stringify({results:rows.map(r=>({...r,body:text,date:today,project:text})),items:[],books:[],quotes:[]}),{headers:{'Content-Type':'application/json'}});
    window.__sizeWrites=[];
    const setItem=Storage.prototype.setItem;
    // Include the pre-migration saved shape; merely opening must not change it.
    setItem.call(localStorage,'widget-size-quote-drawer.html',JSON.stringify({contentW:1060,scale:1,frameH:560,listH:512,quoteDrawerLayoutVersion:1}));
    Storage.prototype.setItem=function(k,v){if(/^widget-(size|width)-/.test(k))window.__sizeWrites.push(k);return setItem.call(this,k,v);};
  };
  await context.route('**/*',mockRoute);
  await context.addInitScript(init);
  const audit = await context.newPage();
  const results = [];
  let errors=[];
  audit.on('pageerror', e=>errors.push(e.message));
  const focused = page.url().includes('#focused');
  for (const width of focused?[390]:[375,390,430]) {
    await audit.setViewportSize({width,height:900});
    for (const scenario of width===375?['empty','full']:['full']) {
      for (const file of focused?files.slice(0,7).concat(['reading-notes/quote-drawer','Worklog/schedule']):files) {
        errors=[];
        await audit.goto(`http://127.0.0.1:4173/${file}.html?qa=${scenario}`,{waitUntil:'networkidle'});
        const data=await audit.evaluate(()=>{
          const card=document.querySelector('[data-widget-card]');
          const visible=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
          const rect=card?.getBoundingClientRect();
          const overflow=card?[...card.querySelectorAll('*')].filter(el=>{
            if(!visible(el))return false;
            const r=el.getBoundingClientRect();
            if(r.right<=rect.right+1&&r.left>=rect.left-1)return false;
            // Content in an explicit scroll/clip region is intentionally bounded.
            for(let p=el.parentElement;p&&p!==card;p=p.parentElement){if(/auto|scroll|hidden/.test(getComputedStyle(p).overflowX)&&p.getBoundingClientRect().right<=rect.right+1)return false;}
            return true;
          }).map(el=>({tag:el.tagName,cls:el.className,right:Math.round(el.getBoundingClientRect().right)})):[];
          const clippedFilters=[...document.querySelectorAll('.filters, .chips')].filter(el=>visible(el)&&el.scrollWidth>el.clientWidth+1&&getComputedStyle(el).overflowX==='hidden').map(el=>el.className);
          const smallTargets = /mobile|reflow/.test(document.body.dataset.widgetLayoutMode||'') && card ? [...card.querySelectorAll('button,a,[role="button"]')].filter(el=>visible(el)&&!el.disabled&&getComputedStyle(el).pointerEvents!=='none'&&!el.matches('[data-widget-list-handle]')&& (el.getBoundingClientRect().width<43.5||el.getBoundingClientRect().height<43.5)).map(el=>el.className).slice(0,8):[];
          const quoteList=document.querySelector('#quoteList');
          const quoteRect=quoteList?.getBoundingClientRect();
          const hiddenQuoteList=!!quoteList?.querySelector('.quote-item')&&Math.min(quoteRect.bottom,rect.bottom)-Math.max(quoteRect.top,rect.top)<120;
          const rowTextOverflow=[...document.querySelectorAll('.management-item .name-line strong,.management-item .project-pill')].some(el=>el.getBoundingClientRect().right>el.closest('.item-body').getBoundingClientRect().right+1);
          return {mode:document.body.dataset.widgetLayoutMode,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,cardWidth:rect?.width,overflow:overflow.slice(0,8),sizeWrites:window.__sizeWrites,clippedFilters,smallTargets,hiddenQuoteList,rowTextOverflow};
        });
        const result={width,scenario,file,...data,errors:[...errors]};
        results.push(result);
        if(width===390 || result.overflow.length || result.scrollWidth>width || result.errors.length) await audit.screenshot({path:`output/playwright/${width}-${scenario}-${file.replaceAll('/','-')}.png`});
      }
    }
  }
  const report={checked:results.length,failures:results.filter(r=>r.scrollWidth>r.width||r.overflow.length||r.sizeWrites.length||r.errors.length||r.clippedFilters.length||r.smallTargets.length||r.hiddenQuoteList||r.rowTextOverflow),checks:[]};
  const check=(name,pass,details)=>report.checks.push({name,pass,details});
  // Functional checks operate only on the mocked Store above.
  await audit.setViewportSize({width:390,height:900});
  await audit.goto('http://127.0.0.1:4173/reading-notes/quote-drawer.html?qa=full',{waitUntil:'networkidle'});
  await audit.locator('#filters .more').click();
  const expandedFilters=await audit.evaluate(()=>{
    const filters=document.querySelector('#filters'),list=document.querySelector('#quoteList');
    const card=document.querySelector('[data-widget-card]').getBoundingClientRect(),rect=list.getBoundingClientRect();
    return {count:filters.querySelectorAll('[data-book]').length,height:filters.getBoundingClientRect().height,visibleListHeight:Math.min(card.bottom,rect.bottom)-rect.top,overflow:getComputedStyle(filters).overflowX};
  });
  check('Quote filters expand without hiding the list',expandedFilters.count===31&&expandedFilters.height<60&&expandedFilters.visibleListHeight>=120&&expandedFilters.overflow==='auto',expandedFilters);
  await audit.goto('http://127.0.0.1:4173/Worklog/worklog.html?qa=full',{waitUntil:'networkidle'});
  await audit.locator('[data-inline-start="title"]').first().click();
  check('Mobile title enters editing on one tap',await audit.locator('[data-inline-input]').count()===1);
  await audit.locator('[data-inline-input]').fill('한 번 탭 편집 검증');
  await audit.locator('[data-inline-input]').press('Enter');
  await audit.waitForFunction(()=>window.__writes.some(w=>w.value.upserts?.some(t=>t.title==='한 번 탭 편집 검증')));
  check('Mobile title Enter saves',true);
  await audit.locator('[data-mobile-add-form] input').fill('모바일 추가 검증');
  await audit.locator('[data-mobile-add-form] input').press('Enter');
  await audit.waitForFunction(()=>window.__writes.some(w=>w.value.upserts?.some(t=>t.title==='모바일 추가 검증')));
  check('Mobile add keeps optional fields empty',await audit.evaluate(()=>{const task=window.__writes.flatMap(w=>w.value.upserts||[]).find(t=>t.title==='모바일 추가 검증');return task&&task.q===null&&task.start===null&&task.end===null&&!task.proj;}));
  await audit.locator('[data-toggle-task]').first().click();
  await audit.waitForFunction(()=>window.__writes.some(w=>w.value.upserts?.some(t=>t.done&&t.status==='done')));
  check('Mobile completion updates done and status',true);
  await audit.goto('http://127.0.0.1:4173/game-log-diary/empty.html?qa=empty',{waitUntil:'networkidle'});
  const emptyBefore=await audit.locator('[data-widget-card]').boundingBox();
  await audit.locator('[data-more]').click();
  const emptyAfter=await audit.locator('[data-widget-card]').boundingBox();
  check('Empty expansion keeps 128px height',emptyBefore.height===128&&emptyAfter.height===128,{before:emptyBefore.height,after:emptyAfter.height,count:await audit.locator('#content a').count()});
  // Compare real coarse-pointer iPad with a separate fine-pointer desktop.
  const desktopContext=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,timezoneId:'Asia/Seoul',reducedMotion:'reduce'});
  await desktopContext.route('**/*',mockRoute);
  await desktopContext.addInitScript(init);
  const desktop=await desktopContext.newPage();
  const shape=()=>{const card=document.querySelector('[data-widget-card]');const rules=['.task-row.work','.week-grid','.goals-grid','.month-grid','.days'];return{width:card.offsetWidth,height:card.offsetHeight,padding:getComputedStyle(card).padding,layout:rules.map(s=>{const el=document.querySelector(s);return el?getComputedStyle(el).gridTemplateColumns:null;}),dates:[...document.querySelectorAll('.day-date,.task-progress')].map(el=>getComputedStyle(el).display)};};
  for(const file of files.slice(0,7)){
    await desktop.goto(`http://127.0.0.1:4173/${file}.html?qa=full`,{waitUntil:'networkidle'});
    await audit.setViewportSize({width:820,height:1000});
    await audit.goto(`http://127.0.0.1:4173/${file}.html?qa=full`,{waitUntil:'networkidle'});
    const d=await desktop.evaluate(shape),t=await audit.evaluate(shape);
    check(`${file} iPad preserves desktop columns and width`,d.width===t.width&&JSON.stringify(d.layout)===JSON.stringify(t.layout)&&JSON.stringify(d.dates)===JSON.stringify(t.dates),{desktop:d,tablet:t});
    await desktop.screenshot({path:`output/playwright/1440-full-${file.replaceAll('/','-')}.png`});
    await audit.screenshot({path:`output/playwright/820-full-${file.replaceAll('/','-')}.png`});
  }
  await desktop.goto('http://127.0.0.1:4173/Worklog/worklog.html?qa=full',{waitUntil:'networkidle'});
  for(const field of ['project','q','status']){
    const cell=desktop.locator(`.task-row [data-cell-field="${field}"]`).first();
    const id=await cell.getAttribute('data-cell-task'),before=await cell.innerText();
    await cell.click();
    await desktop.waitForFunction(({field,before,id})=>document.querySelector(`.task-row [data-cell-task="${id}"][data-cell-field="${field}"]`).innerText!==before,{field,before,id});
    check(`Worklog ${field} cycles on first click`,await desktop.locator('#cellPopover:visible').count()===0);
  }
  await desktop.locator('[data-cell-field="start"]').first().click();
  check('Desktop time edits on first click',await desktop.locator('[data-inline-field="start"]').count()===1);
  await desktop.locator('[data-inline-field="start"]').fill('10:15');
  await desktop.locator('[data-inline-field="start"]').press('Enter');
  await desktop.waitForFunction(()=>window.__writes.some(w=>w.value.upserts?.some(t=>t.start==='10:15')));
  const beforeDelete=await desktop.locator('.task-row').count();
  await desktop.locator('.task-row').first().hover();
  await desktop.locator('[data-row-delete]').first().click();
  await desktop.waitForFunction(n=>document.querySelectorAll('.task-row').length===n-1,beforeDelete);
  check('Worklog deletes on first click',true);
  await desktop.goto('http://127.0.0.1:4173/Worklog/schedule.html?qa=full',{waitUntil:'networkidle'});
  await desktop.locator('.management-item').first().hover();
  await desktop.locator('.management-item [data-action="delete"]').first().click();
  await desktop.waitForFunction(()=>document.querySelectorAll('.management-item').length===29);
  check('Schedule deletes with one row-end cross',true);
  await desktop.locator('.management-item [data-action="edit"]').first().click();
  check('Schedule editor closes from header cross',await desktop.locator('#headActions [aria-label="닫기"]').innerText()==='✕');
  await desktop.locator('#headActions [aria-label="닫기"]').click();
  check('Schedule header cross closes editor',await desktop.locator('#scheduleForm').count()===0);
  await desktop.goto('http://127.0.0.1:4173/thought-box/thoughts.html?qa=full',{waitUntil:'networkidle'});
  await desktop.locator('#itemList [data-open]').first().click();
  check('Thought editor keeps delete at bottom and close at top',await desktop.locator('.overlay-foot [data-delete]').count()===1&&await desktop.locator('.overlay-top [data-close]').count()===1);
  await desktop.locator('.overlay-foot [data-delete]').click();
  await desktop.waitForFunction(()=>document.querySelectorAll('#itemList [data-open]').length===29);
  check('Thought editor deletes on first click',true);
  await desktop.goto('http://127.0.0.1:4173/game-log-diary/today.html?qa=full',{waitUntil:'networkidle'});
  await desktop.locator('.header').hover();
  check('Diary delete uses a cross at the end',await desktop.locator('.header-actions > :last-child').innerText()==='✕');
  await desktop.locator('[data-delete-request]').click();
  await desktop.waitForFunction(()=>window.__writes.some(w=>w.method==='deleteDiary'));
  check('Diary deletes on first click',true);
  await desktopContext.close();
  await context.close();
  return report;
}
