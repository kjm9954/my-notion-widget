import test from 'node:test';
import assert from 'node:assert/strict';
import entry from '../entry.mjs';
import production from '../meeting-production.mjs';
const key = 'w_entry_test_0123456789abcdef';
const rt = text => [{ plain_text: text }];

test('explicit reading-only access key does not grant meeting access or change the meeting key', async () => {
  const readingKey = 'w_reading_test_0123456789abcdef';
  const env = { ALLOWED_W: key, READING_ALLOWED_W: readingKey, SEARCH_INDEX: { async get() { return JSON.stringify({ pages: [] }); } } };
  for (const [source, given, status] of [['reading', readingKey, 200], ['reading', key, 403], ['reading', '', 403], ['', key, 200], ['', readingKey, 403]]) {
    const response = await entry.fetch(new Request(`https://test/search?source=${source}&w=${given}`), env);
    assert.equal(response.status, status);
  }
  const forbiddenIndex = await entry.fetch(new Request(`https://test/reindex?source=reading&w=${key}`, { method: 'POST' }), env);
  assert.equal(forbiddenIndex.status, 403);
});
test('production meeting search, desktop errors, OPTIONS and unknown routes pass through unchanged', async () => {
  const index = { pages: [{ id: 'm', title: '기존 회의', date: '2026-11-09', body: '검색 문장', summary: '기존 요약', lead: '', tags: ['회의록'], lastEdited: '1' }] };
  const env = { ALLOWED_W: key, NOTION_TOKEN: 'test', NOTION_DATA_SOURCE_ID: '3f9b993c8a6180bd851e000bf5cc87ab', SEARCH_INDEX: { async get() { return JSON.stringify(index); } } };
  for (const [path, method] of [['/search?q=검색', 'GET'], [`/search?q=검색&w=${key}`, 'GET'], ['/resolve?page=invalid', 'GET'], ['/meetings', 'GET'], ['/unknown', 'GET'], ['/search', 'OPTIONS']]) {
    const req = new Request(`https://test${path}`, { method, headers: { Origin: 'https://kjm9954.github.io' } });
    const expected = await production.fetch(req.clone(), env), actual = await entry.fetch(req, env);
    assert.equal(actual.status, expected.status); assert.deepEqual([...actual.headers], [...expected.headers]);
    assert.equal(await actual.text(), await expected.text());
  }
});
test('entry cron preserves meeting continuation and shares its remaining request budget with reading', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const data = new Map(), calls = [];
  const env = { ALLOWED_W: key, NOTION_TOKEN: 'test', NOTION_DATA_SOURCE_ID: 'meeting-ds', NOTION_READING_DATA_SOURCE_ID: 'reading-ds', MAX_NOTION_REQUESTS: 3, NOTION_MIN_INTERVAL_MS: 0,
    SEARCH_INDEX: { async get(k) { return data.get(k) || null; }, async put(k, v) { data.set(k, v); } } };
  globalThis.fetch = async url => {
    const path = new URL(url).pathname; calls.push(path);
    if (path.includes('/query')) {
      const id = path.includes('meeting-ds') ? 'meeting' : 'book';
      return Response.json({ results: [{ id, object: 'page', created_time: '2026-11-09T00:00:00Z', last_edited_time: 'v1', properties: { '제목': { type: 'title', title: rt(id) } } }], has_more: false });
    }
    return Response.json({ results: [{ type: 'paragraph', paragraph: { rich_text: rt('본문') } }], has_more: false });
  };
  async function run() { const work = []; entry.scheduled({}, env, { waitUntil(p) { work.push(p); } }); await Promise.all(work); }
  await run(); assert.equal(calls.length, 3); assert.ok(data.has('index:v1')); assert.equal(data.has('index:reading:v1'), false);
  calls.length = 0; await run(); assert.ok(calls.length <= 3); assert.equal(JSON.parse(data.get('index:reading:v1')).complete, true);
  const response = await entry.fetch(new Request(`https://test/search?source=reading&q=본문&w=${key}`), env);
  const body = await response.json(); assert.equal(body.results[0].id, 'book');
  calls.length = 0;
  const refreshed = await entry.fetch(new Request(`https://test/reindex?source=reading&w=${key}`, { method: 'POST' }), env);
  assert.equal(refreshed.status, 200); assert.equal(calls.length, 1);
});
