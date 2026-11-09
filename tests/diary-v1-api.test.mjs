import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleDiaryV1, withDiaryV1 } from '../diary-v1-api.mjs';

const INSTANCE_A = 'w_aaaaaaaaaaaaaaaaaaaaaaaa';
const INSTANCE_B = 'w_bbbbbbbbbbbbbbbbbbbbbbbb';

class D1Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.values = []; }
  bind(...values) { this.values = values; return this; }
  async first() { return this.db.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.values) }; }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class D1Database {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('CREATE TABLE widget_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT)');
    this.db.exec(readFileSync(new URL('../migrations/0009_diary_v1.sql', import.meta.url), 'utf8'));
    for (const instance of [INSTANCE_A, INSTANCE_B]) {
      this.db.prepare('INSERT INTO widget_settings (key, value, updatedAt) VALUES (?, ?, ?)')
        .run(`instance-meta:${instance}`, '{}', new Date().toISOString());
    }
  }
  prepare(sql) { return new D1Statement(this.db, sql); }
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function env() { return { DB: new D1Database() }; }
function url(path, instance = INSTANCE_A) { return `https://worker.example${path}${path.includes('?') ? '&' : '?'}w=${instance}`; }
async function json(response) { return { status: response.status, body: await response.json() }; }
async function save(DB, body, instance = INSTANCE_A) {
  return json(await handleDiaryV1(new Request(url('/api/diary-v1/save', instance), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), DB));
}

test('wrapper leaves unrelated routes and scheduled handler untouched', async () => {
  const scheduled = () => 'scheduled';
  const wrapped = withDiaryV1({
    async fetch() { return new Response('old'); },
    scheduled,
  });
  assert.equal(await (await wrapped.fetch(new Request('https://worker.example/old'), {})).text(), 'old');
  assert.equal(wrapped.scheduled, scheduled);
});

test('OPTIONS works without a key and other keyless requests are rejected', async () => {
  const DB = env();
  const options = await handleDiaryV1(new Request('https://worker.example/api/diary-v1/save', { method: 'OPTIONS' }), DB);
  assert.equal(options.status, 204);
  const result = await json(await handleDiaryV1(new Request('https://worker.example/api/diary-v1/entry?date=2026-11-09'), DB));
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'invalid widget instance');
});

test('text, mood and original image bytes save and load together', async () => {
  const DB = env();
  const created = await save(DB, {
    date: '2026-11-09', text: '오늘의 기록', mood: 'calm', expectedRevision: null,
    photos: [{ id: 'photo_1', dataUrl: 'data:image/png;base64,SGVsbG8=' }],
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.data.revision, 1);
  assert.equal(created.body.data.photos.length, 1);

  const loaded = await json(await handleDiaryV1(new Request(url('/api/diary-v1/entry?date=2026-11-09')), DB));
  assert.equal(loaded.body.data.text, '오늘의 기록');
  assert.equal(loaded.body.data.mood, 'calm');
  const photo = await handleDiaryV1(new Request(loaded.body.data.photos[0].url), DB);
  assert.equal(photo.status, 200);
  assert.equal(await photo.text(), 'Hello');
});

test('text-only and mood-only records are valid, while a fully empty record is rejected', async () => {
  const DB = env();
  const textOnly = await save(DB, {
    date: '2026-11-07', text: '글만 남긴 날', mood: null, expectedRevision: null, photos: [],
  });
  const moodOnly = await save(DB, {
    date: '2026-11-08', text: '', mood: 'tired', expectedRevision: null, photos: [],
  });
  const empty = await save(DB, {
    date: '2026-11-09', text: '', mood: null, expectedRevision: null, photos: [],
  });
  assert.equal(textOnly.status, 200);
  assert.equal(textOnly.body.data.text, '글만 남긴 날');
  assert.equal(moodOnly.status, 200);
  assert.equal(moodOnly.body.data.mood, 'tired');
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error, 'empty diary');
});

test('keeping a stored photo while editing text does not re-upload it', async () => {
  const DB = env();
  await save(DB, {
    date: '2026-11-09', text: '첫 글', mood: null, expectedRevision: null,
    photos: [{ id: 'photo_keep', dataUrl: 'data:image/jpeg;base64,SGVsbG8=' }],
  });
  const updated = await save(DB, {
    date: '2026-11-09', text: '수정한 글', mood: 'good', expectedRevision: 1,
    photos: [{ id: 'photo_keep' }],
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.revision, 2);
  assert.equal(updated.body.data.photos[0].id, 'photo_keep');
});

test('a stale revision returns 409 without overwriting the newer record', async () => {
  const DB = env();
  await save(DB, { date: '2026-11-09', text: '최신', mood: 'good', photos: [], expectedRevision: null });
  const stale = await save(DB, { date: '2026-11-09', text: '오래된 수정', mood: 'tired', photos: [], expectedRevision: null });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.current.text, '최신');
  const loaded = await json(await handleDiaryV1(new Request(url('/api/diary-v1/entry?date=2026-11-09')), DB));
  assert.equal(loaded.body.data.text, '최신');
});

test('range and export return real records with a representative photo URL', async () => {
  const DB = env();
  await save(DB, { date: '2026-11-01', text: '사진 날', mood: 'calm', expectedRevision: null,
    photos: [{ id: 'cover', dataUrl: 'data:image/png;base64,SGVsbG8=' }] });
  await save(DB, { date: '2026-11-02', text: '글만', mood: null, expectedRevision: null, photos: [] });
  const range = await json(await handleDiaryV1(new Request(url('/api/diary-v1/range?start=2026-11-01&end=2026-11-30')), DB));
  assert.equal(range.body.data.length, 2);
  assert.match(range.body.data[0].coverUrl, /photo/);
  assert.equal(range.body.data[1].coverUrl, null);
  const exported = await json(await handleDiaryV1(new Request(url('/api/diary-v1/export')), DB));
  assert.equal(exported.body.data.entries.length, 2);
  assert.equal(exported.body.data.entries[0].photos.length, 1);
});

test('instances are isolated and photo count is limited to four', async () => {
  const DB = env();
  await save(DB, { date: '2026-11-09', text: 'A', mood: null, expectedRevision: null, photos: [] }, INSTANCE_A);
  const other = await json(await handleDiaryV1(new Request(url('/api/diary-v1/entry?date=2026-11-09', INSTANCE_B)), DB));
  assert.equal(other.body.data, null);
  const tooMany = await save(DB, {
    date: '2026-11-10', text: '사진', mood: null, expectedRevision: null,
    photos: Array.from({ length: 5 }, (_, index) => ({ id: `p${index}`, dataUrl: 'data:image/png;base64,SGVsbG8=' })),
  });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.body.error, 'invalid photos');
});

test('delete is revision guarded', async () => {
  const DB = env();
  await save(DB, { date: '2026-11-09', text: '삭제', mood: null, expectedRevision: null, photos: [] });
  const stale = await json(await handleDiaryV1(new Request(url('/api/diary-v1/delete'), {
    method: 'POST', body: JSON.stringify({ date: '2026-11-09', expectedRevision: 2 }),
  }), DB));
  assert.equal(stale.status, 409);
  const removed = await json(await handleDiaryV1(new Request(url('/api/diary-v1/delete'), {
    method: 'POST', body: JSON.stringify({ date: '2026-11-09', expectedRevision: 1 }),
  }), DB));
  assert.equal(removed.status, 200);
  const loaded = await json(await handleDiaryV1(new Request(url('/api/diary-v1/entry?date=2026-11-09')), DB));
  assert.equal(loaded.body.data, null);
});
