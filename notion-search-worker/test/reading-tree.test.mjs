import test from 'node:test';
import assert from 'node:assert/strict';
import entry from '../entry.mjs';

const W = 'w_reading_tree_test_0123456789abcdef';
const rt = text => [{ plain_text: text }];
const page = (id, parent, title = id) => ({ object: 'page', id, parent, last_edited_time: 'v1', created_time: '2026-11-10T00:00:00Z', properties: { 제목: { type: 'title', title: rt(title) } } });
const paragraph = text => ({ id: `block-${text.length}`, type: 'paragraph', paragraph: { rich_text: rt(text) } });
const list = (results, next = null) => ({ results, has_more: Boolean(next), next_cursor: next });

function fixture(t, budget = 45) {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const kv = new Map([['index:v1', 'meeting index must not change']]), calls = [], writes = [];
  const roots = [page('book', { data_source_id: 'library' }, '책 제목')];
  const pages = new Map([
    ['child', page('child', { page_id: 'book' }, '하위 페이지')],
    ['grandchild', page('grandchild', { page_id: 'child' }, '손자 페이지')],
    ['row1', page('row1', { data_source_id: 'quotes' }, '필사 페이지 하나')],
    ['row2', page('row2', { data_source_id: 'quotes' }, '필사 페이지 둘')],
  ]);
  const blocks = new Map([
    ['book', [paragraph('책의 본문'), { id: 'child', type: 'child_page', has_children: false, child_page: { title: '하위 페이지' } },
      { id: 'db', type: 'child_database', has_children: false, child_database: { title: '필사 갤러리' } },
      { id: 'outside', type: 'link_to_page', has_children: true },
      { id: 'synced', type: 'synced_block', has_children: true, synced_block: { synced_from: { block_id: 'outside' } } }]],
    ['child', [paragraph('자식만의 고유문장'), { id: 'grandchild', type: 'child_page', child_page: { title: '손자 페이지' } }]],
    ['grandchild', [paragraph('손자만의 고유문장')]],
    ['row1', [paragraph('필사첫째본문')]], ['row2', [paragraph('필사둘째본문')]],
  ]);
  const denied = new Map(), failedWrites = new Set();
  const makeEnv = () => ({ ALLOWED_W: 'meeting-only', READING_ALLOWED_W: W, NOTION_TOKEN: 'test', NOTION_DATA_SOURCE_ID: 'meetings', NOTION_READING_DATA_SOURCE_ID: 'library', MAX_NOTION_REQUESTS: budget, NOTION_MIN_INTERVAL_MS: 0,
    SEARCH_INDEX: { async get(k) { return kv.get(k) || null; }, async put(k, v) { if (failedWrites.has(k)) throw new Error('storage unavailable'); writes.push(k); kv.set(k, v); } } });
  let env = makeEnv();
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url), path = u.pathname.slice(3), cursor = init.body ? JSON.parse(init.body).start_cursor : u.searchParams.get('start_cursor');
    calls.push({ path, method: init.method || 'GET', cursor });
    if (denied.has(path)) return Response.json({}, { status: denied.get(path) });
    if (path === '/data_sources/library/query') return Response.json(list(roots));
    if (path === '/databases/db') return Response.json({ id: 'db', parent: { page_id: 'book' }, data_sources: [{ id: 'quotes' }, { id: 'foreign-ds' }] });
    if (path === '/data_sources/quotes') return Response.json({ id: 'quotes', parent: { database_id: 'db' } });
    if (path === '/data_sources/foreign-ds') return Response.json({ id: 'foreign-ds', parent: { database_id: 'elsewhere' } });
    if (path === '/data_sources/quotes/query') return Response.json(cursor ? list([pages.get('row2')].filter(Boolean)) : list([pages.get('row1')].filter(Boolean), 'row2'));
    if (path.startsWith('/pages/')) {
      const p = pages.get(path.split('/')[2]); return Response.json(p || {}, { status: p ? 200 : 404 });
    }
    if (path.startsWith('/blocks/')) {
      const id = path.split('/')[2]; assert.ok(blocks.has(id), `must not follow external link: ${path}`);
      const content = blocks.get(id);
      // Exercise block pagination while preserving order.
      return Response.json(id === 'book' && !cursor ? list(content.slice(0, 2), 'rest') : list(id === 'book' ? content.slice(2) : content));
    }
    throw new Error(`Unexpected test request ${path}`);
  };
  const request = async (path, method = 'GET', body) => {
    const response = await entry.fetch(new Request(`https://test${path}&w=${W}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
    return { status: response.status, body: await response.json() };
  };
  const index = continuation => request('/reindex?source=reading', 'POST', continuation ? { continuation } : undefined);
  return { kv, calls, writes, roots, pages, blocks, denied, failedWrites, request, index, cold() { env = makeEnv(); }, get stored() { return JSON.parse(kv.get('index:reading:v1')); } };
}

test('descendant pages, grandchildren and paginated child DB pages are searchable once per book', async t => {
  const s = fixture(t); const indexed = await s.index();
  assert.equal(indexed.status, 200); assert.equal(indexed.body.pending, 0);
  assert.equal(s.stored.pages.length, 1); assert.equal(s.stored.pages[0].readingTree.pages, 5);
  assert.equal(s.stored.pages[0].readingTree.databases, 1);
  for (const query of ['자식만의', '손자만의', '필사첫째본문', '필사둘째본문', '고유문장']) {
    const found = await s.request(`/search?source=reading&q=${query}`);
    assert.equal(found.body.total, 1); assert.equal(found.body.results[0].id, 'book');
    assert.ok(found.body.results[0].line.includes(query));
  }
  assert.equal(s.kv.get('index:v1'), 'meeting index must not change');
  assert.ok(!s.calls.some(c => c.path.includes('foreign-ds/query') || c.path.includes('/outside') || c.path.includes('/synced')));
  assert.ok(s.calls.every(c => c.method === 'GET' || (c.method === 'POST' && c.path.endsWith('/query'))));
});

test('child-only edits refresh while parent timestamp is unchanged; unchanged page bodies are cached', async t => {
  const s = fixture(t); await s.index(); s.calls.length = 0;
  await s.index(); assert.equal(s.calls.filter(c => c.path.startsWith('/blocks/')).length, 0);
  s.pages.get('grandchild').last_edited_time = 'v2'; s.blocks.set('grandchild', [paragraph('변경된손자본문')]);
  s.pages.get('row2').last_edited_time = 'v2'; s.blocks.set('row2', [paragraph('변경된필사본문')]);
  s.calls.length = 0; await s.index();
  assert.equal(s.calls.filter(c => c.path.startsWith('/blocks/')).length, 2);
  assert.ok(s.stored.pages[0].body.includes('변경된손자본문')); assert.ok(s.stored.pages[0].body.includes('변경된필사본문'));
  assert.ok(!s.stored.pages[0].body.includes('필사둘째본문'));
});

test('deleted, moved or inaccessible descendants drop their stale text without failing other books', async t => {
  const s = fixture(t); await s.index();
  s.denied.set('/pages/child', 404); s.pages.delete('row2');
  await s.index(); const text = s.stored.pages[0].body;
  assert.ok(!text.includes('자식만의') && !text.includes('손자만의') && !text.includes('필사둘째본문'));
  assert.ok(text.includes('필사첫째본문'));
  s.pages.get('row1').parent = { data_source_id: 'different-source' }; await s.index();
  assert.ok(!s.stored.pages[0].body.includes('필사첫째본문'));
});

test('cold Workers resume a large tree under the request budget, preserving the published index until completion', async t => {
  const s = fixture(t, 2);
  s.kv.set('index:reading:v1', JSON.stringify({ v: 1, updatedAt: 'before', pages: [{ id: 'book', title: '이전 책', tags: [], body: '이전 검색내용' }] }));
  let completed = false;
  for (let i = 0; i < 25; i++) {
    s.calls.length = 0; const result = await s.index();
    assert.equal(result.status, 200); assert.ok(result.body.requests <= 2 && s.calls.length <= 2);
    if (result.body.pending === 0) { completed = true; break; }
    assert.equal(s.stored.pages[0].body, '이전 검색내용');
    assert.ok(s.kv.get('index:reading:checkpoint:v1')); s.cold();
  }
  assert.ok(completed); assert.equal(s.stored.pages[0].readingTree.pages, 5);
  assert.ok(!s.kv.get('index:reading:checkpoint:v1'));
});

test('large root text does not truncate later child-page matches at the old 20,000 character limit', async t => {
  const s = fixture(t); s.blocks.get('book')[0] = paragraph('가'.repeat(22000)); await s.index();
  assert.ok(s.stored.pages[0].body.length > 22000);
  assert.equal((await s.request('/search?source=reading&q=필사둘째본문')).body.total, 1);
});

test('transient Notion errors and index storage failures preserve the last successful search index', async t => {
  const s = fixture(t); await s.index(); const before = s.kv.get('index:reading:v1');
  s.denied.set('/pages/child', 401); const failed = await s.index();
  assert.equal(failed.status, 502); assert.equal(s.kv.get('index:reading:v1'), before);
  assert.equal(failed.body.error, 'notion connection');
  s.denied.clear(); s.pages.get('child').last_edited_time = 'v2'; s.blocks.set('child', [paragraph('새본문')]);
  s.failedWrites.add('index:reading:v1'); const storage = await s.index();
  assert.equal(storage.status, 503); assert.equal(s.kv.get('index:reading:v1'), before);
  s.failedWrites.clear(); assert.equal((await s.index()).status, 200);
});

test('nested blocks deeper than four levels are traversed and cyclic child references cannot loop', async t => {
  const s = fixture(t);
  const nest = id => ({ id, type: 'toggle', has_children: true, toggle: { rich_text: rt('토글') } });
  s.blocks.set('book', [nest('deep0')]);
  for (let i = 0; i < 7; i++) s.blocks.set(`deep${i}`, [nest(`deep${i + 1}`)]);
  s.blocks.set('deep7', [{ id: 'child', type: 'child_page', child_page: { title: '하위' } }]);
  s.blocks.get('grandchild').push({ id: 'child', type: 'child_page', child_page: { title: '순환' } });
  assert.equal((await s.index()).body.pending, 0);
  assert.ok(s.stored.pages[0].body.includes('손자만의 고유문장'));
  assert.equal(s.calls.filter(c => c.path === '/pages/child').length, 1);
});

test('removing a root book also removes its descendants from the reading index only', async t => {
  const s = fixture(t); await s.index(); s.roots.length = 0; await s.index();
  assert.equal(s.stored.pages.length, 0); assert.equal(s.kv.get('index:v1'), 'meeting index must not change');
});

test('stale automatic checkpoints restart safely; malformed caller continuations are rejected', async t => {
  const s = fixture(t); s.kv.set('index:reading:checkpoint:v1', 'expired-or-invalid');
  assert.equal((await s.index()).body.pending, 0);
  const previous = s.kv.get('index:reading:v1');
  const invalid = await s.index('invalid-caller-token');
  assert.equal(invalid.status, 400); assert.equal(s.kv.get('index:reading:v1'), previous);
});
