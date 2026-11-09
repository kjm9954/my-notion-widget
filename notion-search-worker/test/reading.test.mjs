import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
const key = 'w_reading_test_key_0123456789abcdef';
function setup(t, budget = 45) {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const map = new Map(), calls = [], env = { ALLOWED_W: key, NOTION_TOKEN: 'test', NOTION_DATA_SOURCE_ID: 'meetings', NOTION_READING_DATA_SOURCE_ID: 'books', NOTION_MIN_INTERVAL_MS: 0, MAX_NOTION_REQUESTS: budget, SEARCH_INDEX: { async get(k) { return map.get(k) || null; }, async put(k, v) { map.set(k, v); } } };
  const pages = { meetings: ['meeting'], books: ['book'] }, edits = { book: 'v1', meeting: 'v1' };
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname; calls.push(path);
    if (path.includes('/data_sources/')) {
      assert.equal(init.method, 'POST');
      return Response.json({ results: pages[path.split('/')[3]].map(id => ({ id, object: 'page', url: `https://www.notion.so/${id}`, last_edited_time: edits[id], created_time: '2026-11-01T00:00:00Z', properties: { '제목': { type: 'title', title: [{ plain_text: `${id} 제목` }] } } })) });
    }
    assert.equal(init.method, undefined);
    const id = path.split('/')[3]; assert.ok(['book', 'meeting'].includes(id), 'child database must not be read');
    return Response.json({ results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: `${id} ${'앞'.repeat(22)} 찾는본문 그다음문장` }] } }, { id: 'quotes-db', type: 'child_database', has_children: true, child_database: { title: '필사' } }] });
  };
  const request = async (path, method = 'GET') => {
    const response = await worker.fetch(new Request(`https://test${path}${path.includes('?') ? '&' : '?'}w=${key}`, { method, headers: { Origin: 'https://kjm9954.github.io' } }), env);
    return { status: response.status, body: await response.json() };
  };
  return { map, calls, env, pages, edits, request };
}
test('reading has a separate KV key, book id + matched body fragment, and no changes to meeting response', async t => {
  const s = setup(t);
  assert.equal((await s.request('/reindex', 'POST')).status, 200);
  const before = s.map.get('index:v1');
  assert.equal((await s.request('/reindex?source=reading', 'POST')).body.indexed, 1);
  assert.equal(s.map.get('index:v1'), before);
  assert.ok(s.map.has('index:reading:v1'));
  const reading = await s.request('/search?source=reading&q=찾는본문');
  assert.equal(reading.body.results[0].id, 'book');
  assert.equal(reading.body.results[0].line, `…${'앞'.repeat(11)} 찾는본문 그다음문장`);
  const meeting = await s.request('/search?q=찾는본문');
  assert.equal(meeting.body.results[0].title, 'meeting 제목');
  assert.equal(Object.hasOwn(meeting.body.results[0], 'id'), false);
  const response = await worker.fetch(new Request('https://test/search?source=reading&q=찾는본문&w=wrong'), s.env);
  assert.equal(response.status, 403);
});
test('unchanged reading pages skip blocks; edited books are refreshed', async t => {
  const s = setup(t); await s.request('/reindex?source=reading', 'POST'); s.calls.length = 0;
  await s.request('/reindex?source=reading', 'POST');
  assert.equal(s.calls.length, 1);
  s.edits.book = 'v2'; s.calls.length = 0;
  await s.request('/reindex?source=reading', 'POST'); assert.equal(s.calls.length, 2);
});
test('scheduled indexes share one budget, prioritize meetings, and resume reading on the next invocation', async t => {
  const s = setup(t, 3);
  const run = async () => { const work = []; await worker.scheduled({}, s.env, { waitUntil(p) { work.push(p); } }); await Promise.all(work); };
  await run(); assert.equal(s.calls.length, 3);
  assert.deepEqual(s.calls.slice(0, 2), ['/v1/data_sources/meetings/query', '/v1/blocks/meeting/children']);
  assert.equal(JSON.parse(s.map.get('index:v1')).complete, true);
  assert.equal(JSON.parse(s.map.get('index:reading:v1')).complete, false);
  s.calls.length = 0; await run(); assert.equal(s.calls.length, 3);
  assert.equal(JSON.parse(s.map.get('index:reading:v1')).complete, true);
});
test('reading listing budget failure preserves the previous reading index', async t => {
  const s = setup(t, 1); s.map.set('index:reading:v1', JSON.stringify({ v: 1, pages: [{ id: 'existing' }] }));
  const previous = s.map.get('index:reading:v1');
  globalThis.fetch = async () => Response.json({ results: [], has_more: true, next_cursor: 'next' });
  assert.equal((await s.request('/reindex?source=reading', 'POST')).status, 502);
  assert.equal(s.map.get('index:reading:v1'), previous);
});
