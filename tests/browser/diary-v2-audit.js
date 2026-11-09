// playwright-cli run-code --filename tests/browser/diary-v2-audit.js
// Synthetic data only. Every Worker request is intercepted; no production writes.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1320, height: 404 }, timezoneId: 'Asia/Seoul', reducedMotion: 'reduce' });
  const key = `w_${'v2_test_'.repeat(4)}`, otherKey = `w_${'other_'.repeat(5)}`;
  const base = 'http://127.0.0.1:4173/game-log-diary/';
  const records = new Map(), requests = [], errors = [], checks = [];
  const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  let failSave = false, failPhoto = false, failRead = false, delaySave = 0;
  const photoUrl = (date, id) => `https://notion-widget.wldnjsdkk.workers.dev/api/diary-v1/photo?w=${key}&date=${date}&id=${id}`;
  const pub = row => row ? { ...row, photos: row.photos.map((p, position) => ({ id: p.id, type: 'image/png', size: 68, position, url: photoUrl(row.date, p.id) })) } : null;
  const seed = (date, text, mood = null, photos = []) => records.set(date, { date, text, mood, photos, revision: 1, updatedAt: '2026-11-09T03:00:00Z' });
  seed('2026-11-07', '기존 v1 글 기록', 'calm'); seed('2026-11-08', '', 'good');
  seed('2026-10-30', '지난달 첫날'); seed('2026-10-31', '지난달 둘째날');
  const json = (route, data, status = 200) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(data) });
  await context.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin === 'http://127.0.0.1:4173' || u.hostname === 'cdn.jsdelivr.net') return route.continue();
    if (u.hostname !== 'notion-widget.wldnjsdkk.workers.dev' || !u.pathname.startsWith('/api/diary-v1/')) return route.abort();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    requests.push({ path: u.pathname, method: req.method(), body: req.method() === 'POST' ? req.postDataJSON() : null });
    if (u.searchParams.get('w') === otherKey) return json(route, { ok: true, data: u.pathname.endsWith('/range') ? [] : null });
    if (u.searchParams.get('w') !== key) return json(route, { ok: false, error: 'invalid widget instance' }, 400);
    if (failRead && req.method() === 'GET' && !u.pathname.endsWith('/photo')) return json(route, { ok: false, error: 'unavailable' }, 503);
    if (u.pathname.endsWith('/entry')) return json(route, { ok: true, data: pub(records.get(u.searchParams.get('date'))) });
    if (u.pathname.endsWith('/range')) return json(route, { ok: true, data: [...records.values()].filter(e => e.date >= u.searchParams.get('start') && e.date <= u.searchParams.get('end')).map(e => ({ date: e.date, text: e.text, mood: e.mood, revision: e.revision, photoCount: e.photos.length, coverUrl: e.photos[0] ? photoUrl(e.date, e.photos[0].id) : null })) });
    if (u.pathname.endsWith('/photo')) return route.fulfill({ status: 200, contentType: 'image/png', headers: cors, body: Buffer.from(pixel, 'base64') });
    if (u.pathname.endsWith('/save') && req.method() === 'POST') {
      const b = req.postDataJSON();
      if (delaySave) await new Promise(resolve => setTimeout(resolve, delaySave));
      if (failSave || (failPhoto && b.photos.some(p => p.dataUrl))) { failSave = false; failPhoto = false; return json(route, { ok: false, error: 'diary service unavailable' }, 503); }
      const old = records.get(b.date);
      if ((old?.revision ?? null) !== b.expectedRevision) return json(route, { ok: false, error: 'record changed on another device', current: pub(old) }, 409);
      if (b.photos.some(p => !p.dataUrl && !old?.photos.some(x => x.id === p.id))) return json(route, { ok: false, error: 'unknown photo id' }, 400);
      const saved = { date: b.date, text: b.text, mood: b.mood, revision: (old?.revision || 0) + 1, photos: b.photos.map(p => p.dataUrl ? p : old.photos.find(x => x.id === p.id)), updatedAt: new Date().toISOString() };
      records.set(b.date, saved); return json(route, { ok: true, data: pub(saved) });
    }
    if (u.pathname.endsWith('/delete') && req.method() === 'POST') {
      const b = req.postDataJSON(), old = records.get(b.date);
      if (old && old.revision !== b.expectedRevision) return json(route, { ok: false, error: 'record changed on another device' }, 409);
      records.delete(b.date); return json(route, { ok: true, data: null });
    }
    return json(route, { ok: false, error: 'not found' }, 404);
  });
  const check = (name, pass, details) => checks.push({ name, pass: Boolean(pass), ...(details === undefined ? {} : { details }) });
  const make = async (kind, width, height, extra = '', instance = key) => {
    const tab = await context.newPage(); tab.on('pageerror', e => errors.push(e.message)); tab.on('dialog', d => d.accept());
    await tab.setViewportSize({ width, height }); await tab.clock.setFixedTime(new Date('2026-11-09T03:00:00Z'));
    await tab.goto(`${base}diary-v2-${kind}.html${instance ? `?w=${instance}${extra}` : ''}`, { waitUntil: 'networkidle' }); return tab;
  };
  const settled = tab => tab.waitForFunction(() => !document.querySelector('#writing')?.disabled);
  const save = async tab => { await tab.locator('#form').evaluate(el => el.requestSubmit()); await tab.waitForFunction(() => document.querySelector('#status').textContent === '저장 완료'); };
  const layout = tab => tab.evaluate(() => {
    const root = document.querySelector('.root'), r = root.getBoundingClientRect();
    const clipped = [...root.querySelectorAll('button, .head, .toolbar, .grid, .strip')].filter(el => el.getClientRects().length && !el.closest('.card-body')).filter(el => { const b = el.getBoundingClientRect(); return b.right > innerWidth + 1 || b.left < -1 || b.bottom > innerHeight + 1 || b.top < -1; }).map(el => el.id || el.className);
    return { width: r.width, height: r.height, scrollW: root.scrollWidth, scrollH: root.scrollHeight, clientW: root.clientWidth, clientH: root.clientHeight, documentW: document.documentElement.scrollWidth, documentH: document.documentElement.scrollHeight, clipped };
  });
  let stage = 'create widgets';
  try {
    const today = await make('today', 1320, 404), calendar = await make('calendar', 858, 760), mood = await make('mood-trend', 462, 236), days = await make('record-days', 462, 212);
    check('v1 records are read through the shared client', await calendar.locator('.has-record').count() === 2 && await mood.locator('[data-count="good"]').innerText() === '1' && await days.locator('#count').innerText() === '2');
    check('current-month denominator and yesterday streak', await days.locator('#total').innerText() === '/ 9일' && await days.locator('#streak').innerText() === '연속 2일');
    check('future date navigation and empty save disabled', await today.locator('#next').isDisabled() && await today.locator('#save').isDisabled() && await days.locator('#next').isDisabled());
    check('moods immediately below title', await today.locator('.head').evaluate(el => el.nextElementSibling.firstElementChild.classList.contains('mood-row')));
    stage = 'responsive layouts';
    for (const width of [1320, 1130, 390]) {
      for (const [tab, kind, height, fraction] of [[today, 'today', 404, 1], [calendar, 'calendar', 760, .65], [mood, 'mood', 236, .35], [days, 'days', 212, .35]]) {
        const w = width > 620 ? Math.round(width * fraction) : width;
        await tab.setViewportSize({ width: w, height });
        const l = await layout(tab);
        check(`${kind} fills ${w}x${height}, no clipping/double scroll`, l.width === w && l.height === height && l.scrollW <= l.clientW + 1 && l.scrollH <= l.clientH + 1 && !l.clipped.length && l.documentW === w && l.documentH === height, l);
      }
    }
    await today.setViewportSize({ width: 344, height: 404 });
    const narrow = await layout(today); check('344px writing widget also fits', !narrow.clipped.length && narrow.scrollW <= narrow.clientW + 1, narrow);
    await calendar.setViewportSize({ width: 960, height: 760 });
    check('960px calendar fills iframe', (await layout(calendar)).width === 960);
    await today.setViewportSize({ width: 390, height: 404 });
    check('mobile input is 16px and mood/nav/save targets are 44px', await today.evaluate(() => getComputedStyle(document.querySelector('#writing')).fontSize === '16px' && [...document.querySelectorAll('.mood,.nav button:not([hidden]),.save')].filter(el => el.getClientRects().length).every(el => el.getBoundingClientRect().height >= 44)));
    stage = 'photos and failed upload';
    await today.locator('#writing').fill('원본 사진과 함께 쓰는 새 기록'); await today.locator('[data-mood="good"]').click();
    await today.locator('#add').click();
    await today.locator('#file').setInputFiles(Array.from({ length: 5 }, (_, i) => ({ name: `photo-${i}.png`, mimeType: 'image/png', buffer: Buffer.from(pixel, 'base64') })));
    await today.waitForFunction(() => document.querySelectorAll('.slot img').length === 4 && !document.querySelector('#file').disabled);
    check('five photos capped at four with visible notice inside layer', await today.locator('#add-layer [data-editor-status]').innerText().then(t => t.includes('최대 4장')));
    await today.locator('#add-layer .close').click();
    check('four-photo mobile row fits', !(await layout(today)).clipped.length && await today.locator('.photo').count() === 4);
    failPhoto = true; await today.locator('#save').click();
    await today.waitForFunction(() => document.querySelector('#status').textContent.includes('연결하지 못'));
    check('failed image upload retains all text/photos', await today.locator('#writing').inputValue() === '원본 사진과 함께 쓰는 새 기록' && await today.locator('.photo').count() === 4);
    await save(today);
    check('original image data bytes sent unchanged', records.get('2026-11-09').photos.every(p => p.dataUrl === `data:image/png;base64,${pixel}`));
    await calendar.waitForFunction(() => document.querySelectorAll('.has-record').length === 3);
    await days.waitForFunction(() => document.querySelector('#count').textContent === '3');
    await mood.waitForFunction(() => document.querySelector('[data-count="good"]').textContent === '2');
    check('save synchronizes all three other widgets without reload', true);
    await today.reload({ waitUntil: 'networkidle' });
    check('reload retains saved text, mood, all four photos', await today.locator('#writing').inputValue() === '원본 사진과 함께 쓰는 새 기록' && await today.locator('[data-mood="good"]').getAttribute('aria-pressed') === 'true' && await today.locator('.photo').count() === 4);
    await today.locator('#add').click();
    check('photo layer remains accessible at maximum', await today.locator('#add-layer').isVisible());
    await today.locator('[data-remove="3"]').click();
    await today.locator('#file').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from(pixel, 'base64') });
    await today.waitForFunction(() => document.querySelectorAll('.slot img').length === 4 && !document.querySelector('#file').disabled);
    await today.locator('#add-layer .close').click(); await save(today);
    check('replace one photo keeps four and sends existing ids only', requests.filter(r => r.path.endsWith('/save')).at(-1).body.photos.filter(p => p.dataUrl).length === 1);
    await today.locator('[data-view="0"]').click(); check('photo viewer is iframe-contained', !(await layout(today)).clipped.length);
    await today.keyboard.press('Escape');
    stage = 'calendar editing';
    await calendar.locator('[data-date="2026-11-09"]').click(); await calendar.locator('#edit').waitFor();
    check('calendar detail loads every photo', await calendar.locator('#detail .detail-photo').count() === 4);
    await calendar.locator('#edit').click(); await calendar.locator('#quick-text').fill('달력에서 수정한 기록'); await calendar.locator('#quick-save').click();
    await calendar.waitForFunction(() => document.querySelector('#quick').hidden);
    check('calendar edit keeps all existing photos without uploading', records.get('2026-11-09').photos.length === 4 && requests.filter(r => r.path.endsWith('/save')).at(-1).body.photos.every(p => Object.keys(p).join() === 'id'));
    await today.waitForFunction(() => document.querySelector('#writing').value === '달력에서 수정한 기록');
    check('calendar edit refreshes today widget', true);
    await calendar.locator('[data-date="2026-11-06"]').click(); await calendar.locator('#quick-text').fill('빠른 쓰기'); await calendar.locator('#quick-save').click();
    await calendar.waitForFunction(() => document.querySelector('#quick').hidden); check('empty past date quick write saves its own date', records.get('2026-11-06').text === '빠른 쓰기');
    await calendar.locator('[data-date="2026-11-06"]').click(); await calendar.locator('#delete').click();
    await calendar.keyboard.press('Escape'); check('Escape closes only delete confirmation', await calendar.locator('#confirm').isHidden() && await calendar.locator('#detail').isVisible());
    await calendar.locator('#delete').click(); await calendar.locator('#confirm-delete').click();
    await calendar.waitForFunction(() => document.querySelector('#detail').hidden);
    await days.waitForFunction(() => document.querySelector('#count').textContent === '3');
    check('explicit deletion and cross-widget count sync', !records.has('2026-11-06'));
    stage = 'six-week month and statistics';
    await calendar.locator('#prev').click(); await calendar.locator('#prev').click(); await calendar.locator('#prev').click();
    await calendar.waitForFunction(() => document.querySelector('#month').textContent === '2026년 8월');
    check('six-week August renders 42 cells and day31 without clipping', await calendar.locator('#grid > *').count() === 42 && await calendar.locator('[data-date="2026-08-31"]').isVisible() && !(await layout(calendar)).clipped.length);
    await days.locator('#prev').click(); await days.waitForFunction(() => document.querySelector('#month').textContent === '2026년 10월' && document.querySelector('#count').textContent === '2');
    check('past month total and longest run', await days.locator('#total').innerText() === '/ 31일' && await days.locator('#streak').innerText() === '최장 연속 2일');
    await days.locator('#next').click();
    stage = 'draft and conflict';
    await today.locator('#long-open').click(); await today.locator('#long').fill('길게 작성 중인 초안 '.repeat(70));
    await today.locator('#long-layer .close').click(); check('long text offers continuation preview', await today.locator('#preview').isVisible());
    await today.reload({ waitUntil: 'networkidle' }); check('reload restores unsaved draft', (await today.locator('#writing').inputValue()).startsWith('길게 작성 중인 초안'));
    const second = await make('today', 390, 404);
    await second.locator('#long-open').click(); await second.locator('#long').fill('다른 기기의 최신 기록'); await second.locator('#long-save').click();
    await second.waitForFunction(() => document.querySelector('#status').textContent === '저장 완료');
    await today.locator('#save').click(); await today.locator('#conflict').waitFor();
    check('concurrent edit shows latest and retains local draft', (await today.locator('#conflict-body').innerText()).includes('다른 기기의 최신 기록') && (await today.locator('#writing').inputValue()).startsWith('길게 작성 중인 초안'));
    const beforeRebase = requests.filter(r => r.path.endsWith('/save')).length;
    await today.locator('#use-draft').click(); check('rebase does not silently save', requests.filter(r => r.path.endsWith('/save')).length === beforeRebase);
    await save(today); check('explicit rebased save succeeds', records.get('2026-11-09').text.startsWith('길게 작성 중인 초안'));
    // A real 409, not only the broadcast preflight path.
    await today.locator('#long-open').click(); await today.locator('#long').fill('409에서 남길 내 글'); await today.locator('#long-layer .close').click();
    const latest = records.get('2026-11-09'); records.set(latest.date, { ...latest, text: '서버에서 더 새로 쓴 글', revision: latest.revision + 1 });
    await today.locator('#save').click(); await today.locator('#conflict').waitFor();
    check('HTTP409 shows current server record, input remains', (await today.locator('#conflict-body').innerText()).includes('서버에서 더 새로 쓴 글') && await today.locator('#writing').inputValue() === '409에서 남길 내 글');
    await today.locator('#use-draft').click(); await save(today);
    stage = 'failures, locking, and isolation';
    await today.locator('#writing').fill('실패 후 재시도할 글'); failSave = true; await today.locator('#save').click();
    await today.waitForFunction(() => document.querySelector('#status').textContent.includes('연결하지 못'));
    check('failed save preserves draft', await today.locator('#writing').inputValue() === '실패 후 재시도할 글');
    delaySave = 500; await today.locator('#save').click(); check('save locks date, mood and input', await today.locator('#writing').isDisabled() && await today.locator('#prev').isDisabled() && await today.locator('[data-mood="calm"]').isDisabled());
    await today.waitForFunction(() => document.querySelector('#status').textContent === '저장 완료'); delaySave = 0;
    await today.locator('#prev').click(); await settled(today); await today.locator('#writing').fill('날짜를 옮겨도 보관되는 초안'); await today.locator('#prev').click(); await settled(today); await today.locator('#next').click(); await settled(today);
    check('date navigation restores per-date unsaved draft', await today.locator('#writing').inputValue() === '날짜를 옮겨도 보관되는 초안');
    failRead = true; await today.locator('#prev').click(); await settled(today);
    check('failed new date read never exposes/saves previous-date text', await today.locator('#writing').inputValue() !== '날짜를 옮겨도 보관되는 초안' && await today.locator('#save').isDisabled());
    failRead = false; await today.evaluate(() => window.dispatchEvent(new Event('focus'))); await today.waitForFunction(() => !document.querySelector('#status').textContent.includes('연결하지 못'));
    const isolated = await make('today', 390, 404, '', otherKey); check('different instance does not receive records or drafts', await isolated.locator('#writing').inputValue() === '' && await isolated.locator('.photo').count() === 0);
    const noKey = await make('record-days', 390, 212, '', ''); check('missing key has connection guidance', await noKey.locator('.connection').innerText().then(t => t.includes('개인 위젯 연결')));
    check('only existing draft localStorage namespace used', await today.evaluate(() => Object.keys(localStorage).every(k => k === 'diary-v1-drafts-v1')));
    stage = 'photo-only and iframe sandbox';
    const photoOnly = await make('today', 390, 404, '&date=2026-11-05');
    await photoOnly.locator('#file').setInputFiles({ name: 'only.png', mimeType: 'image/png', buffer: Buffer.from(pixel, 'base64') });
    await photoOnly.waitForFunction(() => !document.querySelector('#save').disabled); await save(photoOnly);
    check('photo-only record saved', records.get('2026-11-05').photos.length === 1 && records.get('2026-11-05').text === '');
    const host = await context.newPage(); await host.setViewportSize({ width: 390, height: 500 });
    await host.goto('http://127.0.0.1:4173/index.html');
    await host.setContent(`<style>body{margin:0}iframe{border:0;width:390px;height:404px}</style><iframe sandbox="allow-scripts allow-same-origin allow-forms" src="${base}diary-v2-today.html?w=${key}&date=2026-11-04"></iframe>`);
    const frame = host.frameLocator('iframe'); await frame.locator('#writing').fill('팝업 없이 iframe 내부 저장'); await frame.locator('#save').click();
    await frame.locator('#status').filter({ hasText: '저장 완료' }).waitFor(); check('sandboxed iframe supports writing/saving without popup permission', records.get('2026-11-04').text === '팝업 없이 iframe 내부 저장');
    // Snapshot the supplied dimensions with populated data, no personal entries.
    await today.goto(`${base}diary-v2-today.html?w=${key}`, { waitUntil: 'networkidle' });
    await today.setViewportSize({ width: 1320, height: 404 }); await today.screenshot({ path: 'output/playwright/diary-v2-today-desktop.png' });
    await today.setViewportSize({ width: 390, height: 404 }); await today.screenshot({ path: 'output/playwright/diary-v2-today-mobile.png' });
    await calendar.goto(`${base}diary-v2-calendar.html?w=${key}`, { waitUntil: 'networkidle' });
    await calendar.setViewportSize({ width: 390, height: 760 }); await calendar.screenshot({ path: 'output/playwright/diary-v2-calendar-mobile.png' });
    await mood.screenshot({ path: 'output/playwright/diary-v2-mood-mobile.png' }); await days.screenshot({ path: 'output/playwright/diary-v2-days-mobile.png' });
    check('no browser JavaScript errors', errors.length === 0, errors);
    return { passed: checks.filter(c => c.pass).length, total: checks.length, failed: checks.filter(c => !c.pass) };
  } catch (error) {
    return { stage, error: error.message, passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass), errors };
  } finally { await context.close(); }
}
