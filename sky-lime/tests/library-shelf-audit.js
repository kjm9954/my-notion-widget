async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1320, height: 220 } });
  const checks = [], errors = [];
  const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });
  await context.route('**/store.js*', route => route.fulfill({ contentType: 'text/javascript', body: `{
    const books=[{id:'reading',title:'읽는 책',status:'reading',startDate:'2026-11-01',url:'https://www.notion.so/reading'},...Array.from({length:12},(_,i)=>({id:'b'+i,title:'완독 책 '+i,status:'done',one:'',url:'https://www.notion.so/b'+i}))];
    const quotes=books.filter(b=>b.status==='done').map(b=>({id:'q'+b.id,bookId:b.id,text:'필사 문장 '+b.id}));let notify;
    window.Store={watchReadingLibrary(cb){notify=cb;queueMicrotask(()=>cb({books,quotes}));return()=>{}},async loadReadingLibrary(){return {books,quotes}},async updateReadingBook(id,patch){Object.assign(books.find(b=>b.id===id),patch);notify({books,quotes});return {id}}};
  }` }));
  const tab = await context.newPage(); tab.on('pageerror', e => errors.push(e.message));
  try {
    await tab.clock.install({ time: new Date('2026-11-09T14:59:00Z') });
    await tab.goto(`http://127.0.0.1:4173/sky-lime/Library/bookshelf.html?w=w_${'c'.repeat(32)}`);
    await tab.waitForFunction(() => document.querySelectorAll('[data-book]').length === 4);
    const ids = () => tab.locator('[data-book]').evaluateAll(rows => rows.map(r => r.dataset.book));
    const pc = await ids();
    check('Latest reading book stays first; remaining cards come from quotes', pc[0] === 'reading' && (await tab.locator('.lb-card-one').allTextContents()).every(t => t.startsWith('필사 문장')));
    await tab.setViewportSize({ width: 390, height: 220 });
    await tab.waitForFunction(() => document.querySelectorAll('[data-book]').length === 2);
    check('Mobile is the same-day PC prefix', JSON.stringify(await ids()) === JSON.stringify(pc.slice(0, 2)));
    await tab.setViewportSize({ width: 1130, height: 220 });
    await tab.waitForFunction(() => document.querySelectorAll('[data-book]').length === 4);
    check('iPad has the same four cards', JSON.stringify(await ids()) === JSON.stringify(pc));
    await tab.clock.fastForward(61000);
    const tomorrow = await ids();
    check('Seoul midnight changes cards without reload, avoiding yesterday books', tomorrow[0] === 'reading' && tomorrow.slice(1).every(id => !pc.includes(id)));
    await tab.locator('[data-finish="reading"]').click(); await tab.locator('#one').fill('방금 완독한 한 줄'); await tab.locator('#finish').click();
    await tab.locator('#layer').waitFor({ state: 'hidden' });
    check('Completion removes reading controls and fills four phrase cards', await tab.locator('[data-finish]').count() === 0 && await tab.locator('.lb-card-one').count() === 4);
    for (const width of [1320, 1130, 390]) {
      await tab.setViewportSize({ width, height: 220 });
      check(`Phrase cards fit ${width}x220 without scrolling`, await tab.locator('#app').evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth));
    }
    await tab.screenshot({ path: 'output/playwright/library-daily-phrases-mobile.png' });
    check('No JS errors', !errors.length);
    return { checked: checks.length, failures: checks.filter(c => !c.pass), checks };
  } finally { await context.close(); }
}
