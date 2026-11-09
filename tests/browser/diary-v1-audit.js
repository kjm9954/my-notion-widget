// Run through playwright-cli run-code --filename tests/browser/diary-v1-audit.js.
// All diary data is held in this browser-run fixture; production is never called.
async (page) => {
  const browser = page.context().browser();
  const context = await browser.newContext({
    viewport: { width: 1320, height: 1100 },
    deviceScaleFactor: 1,
    timezoneId: 'Asia/Seoul',
    reducedMotion: 'reduce',
    acceptDownloads: true,
  });
  const key = `w_${'a'.repeat(32)}`;
  const entries = new Map();
  let failNextSave = false;
  const requests = [];
  const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(data) });
  const photoUrl = (date, id) => `https://notion-widget.wldnjsdkk.workers.dev/api/diary-v1/photo?w=${key}&date=${date}&id=${id}`;
  const publicEntry = entry => entry ? {
    date: entry.date, text: entry.text, mood: entry.mood, revision: entry.revision,
    createdAt: entry.createdAt, updatedAt: entry.updatedAt,
    photos: entry.photos.map((photo, position) => ({ id: photo.id, type: 'image/png', size: 68, position, url: photoUrl(entry.date, photo.id) })),
  } : null;

  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4173') return route.continue();
    if (url.hostname === 'cdn.jsdelivr.net') return route.continue();
    if (url.hostname !== 'notion-widget.wldnjsdkk.workers.dev' || !url.pathname.startsWith('/api/diary-v1/')) return route.abort();
    requests.push({ method: request.method(), path: url.pathname });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.searchParams.get('w') !== key) return json(route, { ok: false, error: 'invalid widget instance' }, 400);
    if (url.pathname.endsWith('/entry')) return json(route, { ok: true, data: publicEntry(entries.get(url.searchParams.get('date'))) });
    if (url.pathname.endsWith('/range')) {
      const start = url.searchParams.get('start'), end = url.searchParams.get('end');
      const rows = [...entries.values()].filter(entry => entry.date >= start && entry.date <= end).map(entry => ({
        date: entry.date, text: entry.text, mood: entry.mood, revision: entry.revision,
        photoCount: entry.photos.length, coverUrl: entry.photos[0] ? photoUrl(entry.date, entry.photos[0].id) : null,
        updatedAt: entry.updatedAt,
      }));
      return json(route, { ok: true, data: rows });
    }
    if (url.pathname.endsWith('/export')) return json(route, { ok: true, data: { exportedAt: new Date().toISOString(), entries: [...entries.values()].map(publicEntry) } });
    if (url.pathname.endsWith('/photo')) return route.fulfill({ status: 200, contentType: 'image/png', headers: cors, body: Buffer.from(pixel, 'base64') });
    if (url.pathname.endsWith('/save') && request.method() === 'POST') {
      if (failNextSave) { failNextSave = false; return json(route, { ok: false, error: 'diary service unavailable' }, 503); }
      const body = request.postDataJSON();
      const current = entries.get(body.date);
      if ((current?.revision ?? null) !== (body.expectedRevision ?? null)) return json(route, { ok: false, error: 'record changed on another device', current: publicEntry(current) }, 409);
      const now = new Date().toISOString();
      const saved = {
        date: body.date, text: body.text, mood: body.mood, revision: (current?.revision || 0) + 1,
        createdAt: current?.createdAt || now, updatedAt: now,
        photos: body.photos.map(photo => ({ id: photo.id, dataUrl: photo.dataUrl || current?.photos.find(item => item.id === photo.id)?.dataUrl || `data:image/png;base64,${pixel}` })),
      };
      entries.set(body.date, saved);
      return json(route, { ok: true, data: publicEntry(saved) });
    }
    return json(route, { ok: false, error: 'not found' }, 404);
  });

  const results = [];
  let stage = 'initial layout';
  try {
  const check = (name, pass, details) => results.push({ name, pass: Boolean(pass), details });
  const noHorizontalOverflow = tab => tab.evaluate(() => ({
    document: document.documentElement.scrollWidth <= innerWidth + 1,
    card: document.querySelector('.widget-card').scrollWidth <= document.querySelector('.widget-card').clientWidth + 1,
    width: document.querySelector('.widget-card').getBoundingClientRect().width,
  }));
  const todayUrl = date => `http://127.0.0.1:4173/game-log-diary/diary-v1-today.html?w=${key}${date ? `&date=${date}` : ''}`;
  const calendarUrl = month => `http://127.0.0.1:4173/game-log-diary/diary-v1-calendar.html?w=${key}${month ? `&month=${month}` : ''}`;
  const today = await context.newPage();
  const errors = [];
  today.on('pageerror', error => errors.push(error.message));
  await today.setViewportSize({ width: 344, height: 900 });
  await today.goto(todayUrl('2026-08-10'), { waitUntil: 'networkidle' });
  let overflow = await noHorizontalOverflow(today);
  check('344px record widget has no horizontal clipping', overflow.document && overflow.card && Math.round(overflow.width) === 344, overflow);
  const placement = await today.evaluate(() => {
    const title = document.querySelector('.record-head'), mood = document.querySelector('.mood-field');
    return { adjacent: title.nextElementSibling === mood, titleBottom: title.getBoundingClientRect().bottom, moodTop: mood.getBoundingClientRect().top };
  });
  check('Mood selector is directly below 오늘의 기록', placement.adjacent && placement.moodTop >= placement.titleBottom, placement);
  check('Mood choices are exactly 차분/좋음/피곤', JSON.stringify(await today.locator('[data-mood]').allTextContents()) === JSON.stringify(['차분', '좋음', '피곤']));
  check('Today, previous and next date controls remain visible at 344px', await today.locator('[data-today]').isVisible() && await today.locator('[data-shift="-1"]').isVisible() && await today.locator('[data-shift="1"]').isVisible());
  await today.locator('[data-shift="-1"]').click();
  await today.waitForFunction(() => {
    const text = document.querySelector('[data-text]');
    return document.querySelector('.date-label')?.textContent.includes('8월 9일') && text && !text.disabled;
  });
  check('Previous date loads its own record slot', (await today.locator('.date-label').innerText()).includes('8월 9일') && await today.locator('[data-text]').inputValue() === '');
  await today.locator('[data-shift="1"]').click();
  await today.waitForFunction(() => {
    const text = document.querySelector('[data-text]');
    return document.querySelector('.date-label')?.textContent.includes('8월 10일') && text && !text.disabled;
  });

  await today.locator('[data-text]').fill('사진과 함께 남기는 실제 기록');
  check('Text remains in the editor after input', await today.locator('[data-text]').inputValue() === '사진과 함께 남기는 실제 기록', { value: await today.locator('[data-text]').inputValue() });
  await today.locator('[data-mood="good"]').click();
  check('Mood rerender preserves current text', await today.locator('[data-text]').inputValue() === '사진과 함께 남기는 실제 기록', { value: await today.locator('[data-text]').inputValue() });
  await today.locator('[data-photo-open]').click();
  check('Opening photos preserves current text', await today.locator('[data-text]').inputValue() === '사진과 함께 남기는 실제 기록', { value: await today.locator('[data-text]').inputValue() });
  const files = Array.from({ length: 5 }, (_, index) => ({ name: `photo-${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(pixel, 'base64') }));
  await today.locator('[data-files]').setInputFiles(files);
  await today.waitForFunction(() => document.querySelectorAll('.photo-item').length === 4);
  check('Adding photos preserves current text', await today.locator('[data-text]').inputValue() === '사진과 함께 남기는 실제 기록', { value: await today.locator('[data-text]').inputValue() });
  const photoCount = await today.locator('.photo-item').count();
  const photoStatus = await today.locator('.save-status').innerText();
  check('Five selected photos are capped at four', photoCount === 4 && photoStatus.includes('최대 4장'), { photoCount, photoStatus });
  stage = 'wait for first save';
  await today.locator('[data-form]').evaluate(form => form.requestSubmit());
  await today.waitForTimeout(1200);
  const firstSaveStatus = await today.locator('.save-status').innerText();
  if (!firstSaveStatus.includes('저장 완료')) throw new Error(JSON.stringify({ firstSaveStatus, requests, errors, hasEntry: entries.has('2026-08-10') }));
  const firstEntry = entries.get('2026-08-10');
  check('Text, mood and four photos save together', firstEntry?.text === '사진과 함께 남기는 실제 기록' && firstEntry?.mood === 'good' && firstEntry?.photos.length === 4, { entry: firstEntry, dates: [...entries.keys()] });
  await today.reload({ waitUntil: 'networkidle' });
  const refreshedText = await today.locator('[data-text]').inputValue();
  check('Refresh restores saved record', refreshedText === '사진과 함께 남기는 실제 기록' && await today.locator('.photo-summary.has-photo img').count() === 1, { refreshedText });
  await today.locator('[data-photo-open]').click();
  check('Refresh restores all saved photo previews', await today.locator('.photo-item').count() === 4);
  await today.locator('[data-remove]').last().click();
  await today.locator('[data-form]').evaluate(form => form.requestSubmit());
  await today.waitForFunction(() => document.querySelector('.save-status')?.textContent.includes('저장 완료'));
  await today.reload({ waitUntil: 'networkidle' });
  await today.locator('[data-photo-open]').click();
  check('Deleting a photo persists after save and refresh', await today.locator('.photo-item').count() === 3 && entries.get('2026-08-10')?.photos.length === 3);
  await today.locator('[data-files]').setInputFiles([{ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from(pixel, 'base64') }]);
  await today.locator('[data-form]').evaluate(form => form.requestSubmit());
  await today.waitForFunction(() => document.querySelector('.save-status')?.textContent.includes('저장 완료'));
  check('A replacement photo preview and saved result agree', await today.locator('.photo-item').count() === 4 && entries.get('2026-08-10')?.photos.length === 4);
  await today.locator('[data-long]').click();
  check('길게 쓰기 enables 2000 characters and taller editor', await today.locator('[data-text]').getAttribute('maxlength') === '2000' && await today.locator('[data-text]').evaluate(element => element.classList.contains('is-long')));

  const downloadPromise = today.waitForEvent('download');
  await today.locator('[data-export]').click();
  const download = await downloadPromise;
  check('Export downloads the real record and photos', download.suggestedFilename().startsWith('diary-') && requests.some(item => item.path.endsWith('/export')) && requests.filter(item => item.path.endsWith('/photo')).length >= 4);

  entries.set('2026-08-11', { date: '2026-08-11', text: '글만 있는 기록', mood: null, revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), photos: [] });
  entries.set('2026-08-12', { date: '2026-08-12', text: '', mood: 'calm', revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), photos: [] });
  const calendar = await context.newPage();
  calendar.on('pageerror', error => errors.push(error.message));
  await calendar.setViewportSize({ width: 960, height: 900 });
  await calendar.goto(calendarUrl('2026-08'), { waitUntil: 'networkidle' });
  check('August 2026 renders all six calendar weeks', await calendar.locator('.day-cell').count() === 42);
  overflow = await noHorizontalOverflow(calendar);
  check('960px calendar has no horizontal clipping', overflow.document && overflow.card && Math.round(overflow.width) === 960, overflow);
  const savedCell = calendar.locator('[data-date="2026-08-10"]');
  check('Calendar receives the record and representative first photo', await savedCell.locator('.day-photo').count() === 1 && await savedCell.locator('.mood-mark').count() === 1);
  check('Text-only and mood-only records remain visibly marked', await calendar.locator('[data-date="2026-08-11"] .text-mark').count() === 1 && await calendar.locator('[data-date="2026-08-12"] .mood-mark').count() === 1);
  await savedCell.click();
  const detailText = await calendar.locator('.detail-copy').innerText();
  check('Selecting a recorded date opens readable detail and edit flow', await calendar.locator('.detail-panel').isVisible() && detailText.includes('실제 기록') && (await calendar.locator('.edit-link').getAttribute('href')).includes('date=2026-08-10'), { detailText });

  await calendar.setViewportSize({ width: 390, height: 900 });
  overflow = await noHorizontalOverflow(calendar);
  check('390px calendar keeps seven columns without clipping', overflow.document && overflow.card && Math.round(overflow.width) === 390, overflow);
  await calendar.screenshot({ path: 'output/playwright/diary-v1-calendar-390.png', fullPage: true });
  await today.setViewportSize({ width: 1320, height: 900 });
  overflow = await noHorizontalOverflow(today);
  check('1320px page keeps record widget at 344px', overflow.document && Math.round(overflow.width) === 344, overflow);
  await calendar.setViewportSize({ width: 1130, height: 900 });
  overflow = await noHorizontalOverflow(calendar);
  check('1130px page keeps calendar widget at 960px', overflow.document && Math.round(overflow.width) === 960, overflow);
  await today.screenshot({ path: 'output/playwright/diary-v1-today-1320.png', fullPage: true });
  await calendar.screenshot({ path: 'output/playwright/diary-v1-calendar-1130.png', fullPage: true });

  await today.setViewportSize({ width: 344, height: 900 });
  await today.locator('[data-text]').fill('열린 달력에도 바로 반영되는 기록');
  await today.locator('[data-form]').evaluate(form => form.requestSubmit());
  await today.waitForFunction(() => document.querySelector('.save-status')?.textContent.includes('저장 완료'));
  await calendar.waitForFunction(() => document.querySelector('.detail-copy')?.textContent.includes('열린 달력에도 바로 반영'));
  check('Saving in the editor refreshes an already-open calendar', (await calendar.locator('.detail-copy').innerText()).includes('열린 달력에도 바로 반영'));

  await today.goto(todayUrl('2026-08-10'), { waitUntil: 'networkidle' });
  entries.set('2026-08-10', { ...entries.get('2026-08-10'), text: '다른 기기 최신 내용', revision: entries.get('2026-08-10').revision + 1, updatedAt: new Date().toISOString() });
  await today.locator('[data-text]').fill('이 기기의 오래된 초안');
  stage = 'wait for conflict response';
  await today.locator('[data-form]').evaluate(form => form.requestSubmit());
  await today.waitForFunction(() => document.querySelector('.save-status')?.textContent.includes('다른 기기'));
  check('Stale update is rejected and draft text is preserved', await today.locator('[data-text]').inputValue() === '이 기기의 오래된 초안' && entries.get('2026-08-10').text === '다른 기기 최신 내용');
  await today.locator('[data-latest]').click();
  check('Conflict flow can show latest and keep a restorable draft', await today.locator('[data-text]').inputValue() === '다른 기기 최신 내용' && await today.locator('[data-restore-draft]').isVisible());
  await today.locator('[data-restore-draft]').click();
  check('Conflict draft can be restored on top of latest revision', await today.locator('[data-text]').inputValue() === '이 기기의 오래된 초안');

  failNextSave = true;
  await today.locator('[data-text]').fill('네트워크 실패에도 남는 내용');
  stage = 'wait for failed save';
  await today.locator('[data-form]').evaluate(form => form.requestSubmit());
  await today.waitForFunction(() => document.querySelector('.save-status')?.classList.contains('is-error'));
  const draft = await today.evaluate(date => JSON.parse(localStorage.getItem('diary-v1-drafts-v1') || '{}')?.[`w_${'a'.repeat(32)}`]?.[date], '2026-08-10');
  check('Save failure keeps editor content and a retryable local draft', await today.locator('[data-text]').inputValue() === '네트워크 실패에도 남는 내용' && draft?.text === '네트워크 실패에도 남는 내용');

  const iframeHost = await context.newPage();
  await iframeHost.setViewportSize({ width: 390, height: 920 });
  await iframeHost.setContent(`<iframe title="노션 임베드" src="${todayUrl('2026-08-10')}" style="border:0;width:344px;height:700px"></iframe>`);
  stage = 'wait for iframe';
  const embedded = iframeHost.locator('iframe').contentFrame();
  await embedded.locator('.record-card').waitFor();
  const frameOverflow = await embedded.locator('html').evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  check('Core editor works inside a 344px iframe without horizontal scroll', frameOverflow.width === 344 && frameOverflow.scrollWidth <= 344, frameOverflow);
  await iframeHost.screenshot({ path: 'output/playwright/diary-v1-notion-iframe.png', fullPage: true });

  check('Browser raised no page errors', errors.length === 0, errors);
  await context.close();
  return { checked: results.length, failures: results.filter(result => !result.pass), results };
  } catch (error) {
    await context.close();
    return { stage, error: error.message, stack: error.stack, checked: results.length, failures: results.filter(result => !result.pass), results };
  }
}
