// Focused layout regression; all diary API traffic uses an in-memory fixture.
async (page) => {
  const context = await page.context().browser().newContext();
  let empty = true;
  await context.route('**/api/diary-v1/**', async route => {
    if (route.request().method() !== 'GET') return route.abort();
    const start = new URL(route.request().url()).searchParams.get('start');
    const date = start?.slice(0, 7) === '2026-11' ? '2026-11-01' : '2026-11-02';
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, data: empty ? [] : [{ date, mood: 'good', text: '', revision: 1, photoCount: 0 }] }) });
  });
  const checks = [], errors = [];
  try {
    const tab = await context.newPage(); tab.on('pageerror', error => errors.push(error.message));
    await tab.clock.setFixedTime(new Date('2026-11-09T03:00:00Z'));
    for (const width of [1320, 1130, 462, 396, 390]) {
      empty = true;
      await tab.setViewportSize({ width, height: 236 });
      await tab.goto(`http://127.0.0.1:4173/game-log-diary/diary-v2-mood-trend.html?w=w_${'alignment'.repeat(4)}`, { waitUntil: 'networkidle' });
      const measured = await tab.evaluate(() => {
        const list = document.querySelector('#list').getBoundingClientRect(), text = document.querySelector('.empty'), box = text.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(text); const ink = range.getBoundingClientRect();
        return { text: text.textContent, xOffset: (ink.left + ink.right - list.left - list.right) / 2, yOffset: (box.top + box.bottom - list.top - list.bottom) / 2, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      checks.push({ width, state: 'empty', pass: Math.abs(measured.xOffset) < 1 && Math.abs(measured.yOffset) < 1 && !measured.overflow, ...measured });
      if (width === 390) await tab.screenshot({ path: 'output/playwright/diary-v2-mood-empty-centered.png' });
      empty = false; await tab.reload({ waitUntil: 'networkidle' });
      checks.push({ width, state: 'populated', pass: await tab.locator('.mood-stat').count() === 5 && await tab.locator('[data-count="good"]').innerText() === '1' && await tab.locator('.empty').count() === 0 && await tab.locator('#list').evaluate(el => el.scrollHeight <= el.clientHeight) });
    }
    return { checked: checks.length, failures: checks.filter(c => !c.pass), errors, checks };
  } finally { await context.close(); }
}
