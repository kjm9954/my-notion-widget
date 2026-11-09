// Run with playwright-cli run-code --filename sky-lime/tests/library-browser-audit.js.
// Real Store, mocked Worker/Notion. No production writes or real instance keys.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1320, height: 220 }, timezoneId: 'Asia/Seoul' });
  const key = `w_${'a'.repeat(32)}`, otherKey = `w_${'b'.repeat(32)}`;
  const year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date()));
  const notionUrl = id => `https://www.notion.so/${id}`;
  const books = [
    { id: 'read-new', title: '아주 긴 책 제목도 카드 밖으로 나가지 않는지 확인하는 읽는 중 책', status: 'reading', created: '2026-11-09T00:00:00Z', year, author: 'Author One', url: notionUrl('read-new'), one: '', star: 0 },
    { id: 'read-old', title: '두 번째 읽는 책', status: 'reading', created: '2026-01-01T00:00:00Z', year, url: notionUrl('read-old'), one: '' },
    { id: 'done-new', title: '최근 완독 책', status: 'done', year, endDate: '2026-10-01', one: '작은 습관이 삶을 바꾼다', learned: '내 생각도 찾을 수 있어요', url: notionUrl('done-new') },
    { id: 'done-start', title: '시작일로 정렬하는 책', status: 'done', year: year - 1, startDate: '2026-09-01', one: '앞부분이 아주 길어서 검색 결과에서 생략되어야 하는 문장 작은   습관을 배웠다', url: notionUrl('done-start') },
    { id: 'done-edit', title: '수정일로 정렬하는 책', status: 'done', year: year - 4, edited: '2026-08-01', created: '2026-03-01T00:00:00Z', learned: '작은 습관을 메모', url: notionUrl('done-edit') },
    { id: 'done-no-year', title: '연도 없는 완독 책', status: 'done', year: null, startDate: '2026-07-01', author: '작은 습관', url: notionUrl('done-no-year') },
    { id: 'wishlist', title: '표시하지 않을 구입 전 책', status: 'wishlist', year, url: notionUrl('wishlist') },
    { id: 'dropped', title: '표시하지 않을 중도포기 책', status: 'dropped', year, url: notionUrl('dropped') },
  ];
  const requests = [], errors = [], results = [];
  let failSave = false, failCreate = false;
  const check = (name, pass, details) => { results.push({ name, pass: Boolean(pass), details }); };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  await context.addInitScript(() => {
    window.__libraryStorageWrites = [];
    const nativeSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { window.__libraryStorageWrites.push(key); return nativeSet.call(this, key, value); };
  });
  context.on('page', tab => tab.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4173' || url.hostname === 'cdn.jsdelivr.net') return route.continue();
    if (url.hostname === 'www.notion.so') return route.fulfill({ contentType: 'text/html', body: '<title>Notion test page</title><p>Saved book</p>' });
    if (url.hostname !== 'notion-widget.wldnjsdkk.workers.dev') return route.abort();
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(data) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    requests.push({ method: request.method(), path: url.pathname, instance: url.searchParams.get('w') === key ? 'a' : 'b' });
    const instance = url.searchParams.get('w');
    if (![key, otherKey].includes(instance)) return json({ ok: false, error: 'invalid widget instance' }, 400);
    if (url.pathname === '/api/reading/library') return json({ ok: true, data: { books: instance === key ? books : [], quotes: [], fetchedAt: new Date().toISOString() } });
    if (url.pathname === '/api/reading/books/create' && request.method() === 'POST') {
      if (failCreate) { failCreate = false; return json({ ok: false, error: 'Notion temporary failure' }, 503); }
      const input = request.postDataJSON();
      await new Promise(resolve => setTimeout(resolve, 120));
      const id = `created-${books.length}`;
      const book = { ...input, id, url: notionUrl(id), created: new Date().toISOString(), one: '', author: '', learned: '' };
      books.push(book); return json({ ok: true, data: book }, 201);
    }
    if (url.pathname === '/api/reading/books/update' && request.method() === 'POST') {
      if (failSave) { failSave = false; return json({ ok: false, error: 'Notion temporary failure' }, 503); }
      const { id, patch } = request.postDataJSON();
      await new Promise(resolve => setTimeout(resolve, 120));
      Object.assign(books.find(book => book.id === id), patch, { edited: new Date().toISOString() });
      return json({ ok: true, data: { id } });
    }
    return json({ ok: false, error: 'Unexpected request' }, 404);
  });
  const url = (name, instance = key) => `http://127.0.0.1:4173/sky-lime/Library/${name}.html${instance ? `?w=${instance}` : ''}`;
  const tabs = {};
  let stage = 'layout';
  try {
    const heights = { 'new-book': 72, bookshelf: 220, 'reading-count': 140, 'book-search': 268 };
    for (const [name, height] of Object.entries(heights)) {
      const tab = tabs[name] = await context.newPage();
      await tab.setViewportSize({ width: 1320, height });
      await tab.goto(url(name), { waitUntil: 'networkidle' });
      if (name !== 'new-book') await tab.waitForFunction(() => document.getElementById('app').dataset.status === 'ready');
      for (const width of [1320, 1130, 450, 390]) {
        await tab.setViewportSize({ width, height });
        const bounds = await tab.locator('#app').evaluate(root => ({ width: root.getBoundingClientRect().width, height: root.getBoundingClientRect().height, pageW: document.documentElement.scrollWidth, pageH: document.documentElement.scrollHeight, clientW: root.clientWidth, scrollW: root.scrollWidth, clientH: root.clientHeight, scrollH: root.scrollHeight }));
        check(`${name} fills ${width}×${height} with the shared 1px inset and no root/page scrolling`, bounds.width === width - 1 && bounds.height === height - 1 && bounds.pageW <= width && bounds.pageH <= height && bounds.scrollW <= bounds.clientW && bounds.scrollH <= bounds.clientH, bounds);
        if ([1320, 390].includes(width)) await tab.screenshot({ path: `output/playwright/library-${name}-${width}.png` });
      }
    }
    const add = tabs['new-book'], shelf = tabs.bookshelf, count = tabs['reading-count'], search = tabs['book-search'];
    check('Mobile add input uses 16px text, 44px controls and the short placeholder', await add.locator('#title').getAttribute('placeholder') === '책 제목' && await add.locator('#title').evaluate(el => getComputedStyle(el).fontSize === '16px' && el.offsetHeight === 44));
    check('Mobile shelf has two reading cards, with 44px completion hit targets', await shelf.locator('.lb-card').count() === 2 && await shelf.locator('.lb-done-hit').first().evaluate(el => el.offsetWidth === 44 && el.offsetHeight === 44));
    await shelf.setViewportSize({ width: 1130, height: 220 });
    await shelf.waitForFunction(() => document.querySelectorAll('[data-book]').length === 4);
    const shelfOrder = await shelf.locator('[data-book]').evaluateAll(els => els.map(el => el.dataset.book));
    check('PC shelf sorts reading first, then done dates, with exactly four visible cards', JSON.stringify(shelfOrder) === JSON.stringify(['read-new', 'read-old', 'done-new', 'done-start']), shelfOrder);
    check('Counts include only done books with API year and never count the undated/unlinked example', await count.locator('#count').innerText() === '1' && await count.locator('.lb-bar').count() === 5 && await count.locator('#next').isDisabled());
    await count.locator('#prev').click();
    check('Previous year and year bar selection use the correct count', await count.locator('#count').innerText() === '1' && (await count.locator('#year').innerText()).includes(String(year - 1)));
    await count.locator(`[data-year="${year}"]`).click();

    stage = 'search';
    await search.locator('#query').fill('작은습관');
    await search.locator('#query').press('Enter');
    check('Search ignores spaces, caps to three at 268px, and shows the refine hint', await search.locator('.sl-search-row').count() === 3 && await search.locator('#more').isVisible());
    check('Search highlights the matched excerpt with a leading ellipsis', (await search.locator('a[href="https://www.notion.so/done-start"] .sl-search-line2').innerText()).startsWith('…') && await search.locator('.sl-search-line2 b').count() >= 2);
    await search.screenshot({ path: 'output/playwright/library-search-results-390.png' });
    const popupPromise = context.waitForEvent('page');
    await search.locator('.sl-search-row').first().click();
    const popup = await popupPromise; await popup.waitForLoadState();
    check('Search result opens its own Notion URL in a new tab', popup.url().startsWith('https://www.notion.so/'));
    await popup.close();
    await search.locator('#query').fill('내 생각'); await search.locator('#query').press('Enter');
    check('Learned field is searchable and is shown as the highlighted result line', (await search.locator('.sl-search-line2').innerText()).includes('내 생각') && await search.locator('.sl-search-line2 b').count() === 1);
    await search.locator('#query').fill('authorone'); await search.locator('#query').press('Enter');
    check('Author field is searchable', await search.locator('.sl-search-row').count() === 1);
    await search.locator('#query').fill('없는단어'); await search.locator('#query').press('Enter');
    check('No-results copy is correct', await search.locator('#list').innerText() === '찾는 내용이 없어요');

    stage = 'complete';
    await shelf.setViewportSize({ width: 390, height: 220 });
    await shelf.locator('[data-finish="read-new"]').click();
    const layerBounds = await shelf.locator('#layer').evaluate(layer => ({ width: layer.offsetWidth, height: layer.offsetHeight, rootW: layer.parentElement.clientWidth, rootH: layer.parentElement.clientHeight, scrollH: layer.scrollHeight, clientH: layer.clientHeight, stars: layer.querySelector('.lb-star').offsetWidth, close: layer.querySelector('.lb-close').offsetWidth }));
    check('Completion layer fills only its own iframe and keeps 44px mobile controls', layerBounds.width === layerBounds.rootW && layerBounds.height === layerBounds.rootH && layerBounds.scrollH <= layerBounds.clientH && layerBounds.stars === 44 && layerBounds.close === 44, layerBounds);
    await shelf.locator('[data-star="4"]').click(); await shelf.locator('#one').fill('완독 한 줄');
    await shelf.locator('#one').press('Shift+Enter');
    check('Shift+Enter adds a newline without saving', (await shelf.locator('#one').inputValue()).includes('\n') && !requests.some(req => req.path.endsWith('/update')));
    await shelf.screenshot({ path: 'output/playwright/library-completion-390.png' });
    failSave = true;
    await shelf.locator('#finish').click(); await shelf.locator('#saveError').waitFor({ state: 'visible' });
    check('A failed completion leaves the layer, text and stars intact', await shelf.locator('#layer').isVisible() && (await shelf.locator('#one').inputValue()).includes('완독 한 줄') && await shelf.locator('.lb-star.is-on').count() === 4);
    await shelf.locator('#one').press('Enter');
    await shelf.locator('#layer').waitFor({ state: 'hidden' });
    await count.waitForFunction(() => document.getElementById('count').textContent === '2');
    check('Completion persists the exact status/star/one patch and updates the open count widget', books.find(book => book.id === 'read-new').status === 'done' && books.find(book => book.id === 'read-new').star === 4 && books.find(book => book.id === 'read-new').one === '완독 한 줄');
    await shelf.reload({ waitUntil: 'networkidle' });
    check('Saved completion survives refresh', await shelf.locator('[data-finish="read-new"]').count() === 0);

    stage = 'create';
    const before = requests.filter(req => req.path.endsWith('/create')).length;
    await add.locator('#add').click();
    check('Empty title makes no request', requests.filter(req => req.path.endsWith('/create')).length === before);
    await add.locator('#title').fill('브라우저 검증용 새 책');
    await add.evaluate(() => { document.getElementById('app').requestSubmit(); document.getElementById('app').requestSubmit(); });
    await add.waitForFunction(() => document.getElementById('notice').textContent.includes('저장했어요'));
    const created = books.find(book => book.title === '브라우저 검증용 새 책');
    check('Double submit creates one book, as reading with Seoul current year', requests.filter(req => req.path.endsWith('/create')).length === before + 1 && created.status === 'reading' && created.year === year && await add.locator('#title').inputValue() === '');
    await shelf.waitForFunction(() => document.querySelector('.lb-card-title')?.textContent === '브라우저 검증용 새 책');
    check('New record reaches an already-open shelf via Store.watchReadingLibrary', (await shelf.locator('.lb-card-title').first().innerText()) === '브라우저 검증용 새 책');
    for (const extra of context.pages().filter(tab => !Object.values(tabs).includes(tab))) await extra.close();
    await add.evaluate(() => { window.open = () => null; });
    await add.locator('#title').fill('팝업 차단 때 저장되는 책'); await add.locator('#title').press('Enter');
    await add.locator('#savedLink').waitFor({ state: 'visible' });
    check('Popup-blocked create succeeds and provides a safe Notion link without a duplicate create', (await add.locator('#savedLink').getAttribute('href')).startsWith('https://www.notion.so/') && await add.locator('#add').innerText() === '새 기록');
    await add.locator('#add').click();
    failCreate = true; await add.locator('#title').fill('실패해도 남아 있는 제목'); await add.locator('#title').press('Enter');
    await add.waitForFunction(() => document.getElementById('notice').textContent.includes('저장하지 못했어요'));
    check('Create failure preserves the title and reenables retry', await add.locator('#title').inputValue() === '실패해도 남아 있는 제목' && !await add.locator('#add').isDisabled());
    await add.locator('#title').press('Escape');
    check('Escape clears the input', await add.locator('#title').inputValue() === '');

    stage = 'iframe boundaries';
    const host = await context.newPage(); await host.setViewportSize({ width: 1320, height: 900 });
    await host.setContent(`<iframe title="Library embed" src="${url('bookshelf')}" style="border:0;width:390px;height:220px" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>`);
    const frame = host.locator('iframe').contentFrame();
    await frame.locator('.lb-card').first().waitFor();
    check('A 390px iframe uses two cards even inside a 1320px parent page', await frame.locator('.lb-card').count() === 2);
    await host.locator('iframe').evaluate(el => { el.style.width = '1130px'; });
    await frame.locator('.lb-card').nth(3).waitFor();
    const frameSize = await frame.locator('#app').evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, view: innerWidth }));
    check('Resizing the iframe grows the actual root and restores four cards', frameSize.width === 1129 && frameSize.height === 219 && frameSize.view === 1130, frameSize);
    await host.setContent(`<iframe title="Popup-blocked Library embed" src="${url('new-book')}" style="border:0;width:390px;height:72px" sandbox="allow-scripts allow-forms allow-same-origin"></iframe>`);
    const blocked = host.locator('iframe').contentFrame();
    await blocked.locator('#title').fill('sandbox 팝업 금지에서도 저장'); await blocked.locator('#add').click();
    await blocked.locator('#savedLink').waitFor({ state: 'visible' });
    check('An actual iframe without allow-popups saves successfully and exposes the fallback link', (await blocked.locator('#savedLink').getAttribute('href')).startsWith('https://www.notion.so/'));

    stage = 'empty and key boundary';
    const empty = await context.newPage(); await empty.setViewportSize({ width: 390, height: 220 });
    await empty.goto(url('bookshelf', otherKey), { waitUntil: 'networkidle' });
    check('An independent key uses its own client cache and empty state in the fixture', await empty.locator('#grid').innerText() === '기록한 책이 없어요');
    const countBefore = requests.length;
    await empty.goto(url('bookshelf', ''), { waitUntil: 'networkidle' });
    check('Missing key does not call the Worker or inherit another widget key', requests.length === countBefore && (await empty.locator('#grid').innerText()).includes('주소'));
    check('No Library widget writes record data or keys to localStorage', (await Promise.all(Object.values(tabs).map(tab => tab.evaluate(() => window.__libraryStorageWrites)))).every(keys => keys.length === 0));
    check('No page JavaScript errors', errors.length === 0, errors);
    await context.close();
    return { checked: results.length, failures: results.filter(result => !result.pass), results };
  } catch (error) {
    await context.close();
    return { stage, error: error.message, checked: results.length, failures: results.filter(result => !result.pass), results };
  }
}
