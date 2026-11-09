// Local-only browser audit; both Store and the optional body search are mocked.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 268 } });
  const results = [], calls = [], errors = []; let fail = false;
  const check = (name, pass) => results.push({ name, pass: Boolean(pass) });
  await context.route('**/store.js*', route => route.fulfill({ contentType: 'text/javascript', body: `window.Store={watchReadingLibrary(cb){queueMicrotask(()=>cb({books:[{id:'a',title:'공통 제목',url:'https://www.notion.so/a',startDate:'2026-01-01'},{id:'b',title:'본문 책',url:'https://www.notion.so/b',startDate:'2026-02-01'},{id:'c',title:'필사 책',url:'https://www.notion.so/c',startDate:'2026-03-01'}],quotes:[{bookId:'c',text:'공통 필사',note:'노트메모',thought:'생각문장'}]}));return()=>{}}}` }));
  await context.route('https://notion-search.wldnjsdkk.workers.dev/**', async route => {
    const u = new URL(route.request().url()), query = u.searchParams.get('q');
    calls.push({ query, source: u.searchParams.get('source'), method: route.request().method() });
    if (query === '늦은검색') await new Promise(r => setTimeout(r, 600));
    try { await route.fulfill({ status: fail ? 503 : 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, total: 2, results: [{ id: 'b', line: `본문 ${query}` }, { id: 'a', line: `중복 ${query}` }] }) }); } catch { /* request was cancelled */ }
  });
  const tab = await context.newPage(); tab.on('pageerror', e => errors.push(e.message));
  try {
    await tab.goto(`http://127.0.0.1:4173/sky-lime/Library/book-search.html?w=w_${'a'.repeat(32)}`);
    await tab.waitForFunction(() => document.querySelector('#app').dataset.status === 'ready');
    await tab.locator('#query').fill('공통');
    check('Local title/quote matches are immediate before body debounce', await tab.locator('.sl-search-row').count() === 2 && calls.length === 0);
    await tab.waitForFunction(() => document.querySelectorAll('.sl-search-row').length === 3);
    check('Body results merge once, after title and quote matches', JSON.stringify(await tab.locator('.sl-search-row').evaluateAll(rows => rows.map(r => new URL(r.href).pathname))) === JSON.stringify(['/a', '/c', '/b']));
    check('Only GET source=reading is used', calls.every(c => c.source === 'reading' && c.method === 'GET'));
    await tab.locator('#query').fill('늦은검색');
    await tab.waitForTimeout(350); await tab.locator('#query').fill('새검색');
    await tab.waitForFunction(() => document.querySelector('.sl-search-line2')?.textContent.includes('새검색'));
    await tab.waitForTimeout(400);
    check('Cancelled old response never overwrites the latest results', !(await tab.locator('#list').innerText()).includes('늦은검색'));
    fail = true; await tab.locator('#query').fill('노트메모'); await tab.waitForTimeout(450);
    check('Body failure silently preserves quote-note results', await tab.locator('.sl-search-row').count() === 1 && (await tab.locator('#list').innerText()).includes('노트메모'));
    await tab.locator('#query').fill('생각문장');
    check('Quote thought matches immediately', await tab.locator('.sl-search-row').count() === 1);
    await tab.locator('#clear').click(); await tab.waitForTimeout(450);
    check('Clearing restores idle and cannot receive old body hits', (await tab.locator('#list').innerText()) === '책 제목이나 내용으로 찾아보세요');
    check('No JS errors', errors.length === 0);
    return { checked: results.length, failures: results.filter(r => !r.pass), results };
  } finally { await context.close(); }
}
