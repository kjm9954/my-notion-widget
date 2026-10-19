// Server draft check against a real SQLite (node:sqlite) shaped like D1 (prepare/bind/all/run/batch). Mock data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleMeetingNotes, withMeetingNotes, LIMITS } from '../meeting-notes-api.mjs';

const W = 'w_meeting_notes_test_instance_01';
const W2 = 'w_meeting_notes_test_instance_01X'; // the first key is a prefix of this one
const NOW = Date.parse('2026-10-19T10:00:00+09:00');
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE widget_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT)`);
  for (const w of [W, W2]) db.prepare(`INSERT INTO widget_settings VALUES (?, ?, ?)`).run(`instance-meta:${w}`, '{}', 'x');
  db.prepare(`INSERT INTO widget_settings VALUES (?, ?, ?)`).run(`instance:${W}:worklog`, 'private fixture', 'x');
  const statement = (sql, params) => ({
    sql, params,
    async all() { return { results:db.prepare(sql).all(...params) }; },
    async first() { return db.prepare(sql).get(...params) ?? null; },
    async run() { return exec(sql, params); }
  });
  const exec = (sql, params) => {
    if (/^\s*SELECT|RETURNING/i.test(sql)) { const results = db.prepare(sql).all(...params); return { results, meta:{ changes:/RETURNING/i.test(sql) ? results.length : 0 } }; }
    const result = db.prepare(sql).run(...params);
    return { results:[], meta:{ changes:result.changes } };
  };
  const DB = {
    prepare(sql) { return { bind(...params) { return statement(sql, params); } }; },
    async batch(statements) {
      db.exec('BEGIN');
      try { const out = statements.map(s => exec(s.sql, s.params)); db.exec('COMMIT'); return out; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  };
  return { env:{ DB }, db };
}
const call = async (env, method, path, body, w = W) => {
  const response = await handleMeetingNotes(new Request(`https://x.test${path}?w=${w}`, { method, ...(body ? { body:JSON.stringify(body) } : {}) }), env, NOW);
  return { status:response.status, body:await response.json() };
};
const note = (id, extra = {}) => ({ id, date:'2026-10-12', title:`면담 ${id}`, who:'사수',
  topics:[{ id:'t1', h:'주제', say:'', lines:[{ id:'l1', t:'들은 말', key:false }] }], todos:[], ...extra });

test('wrapper leaves other routes to the existing worker', async () => {
  const existing = { scheduled() {}, fetch() { return new Response('legacy'); } };
  const wrapped = withMeetingNotes(existing);
  assert.equal(wrapped.scheduled, existing.scheduled);
  assert.equal(await (await wrapped.fetch(new Request('https://x.test/api/quarter-goals/state'), {}, {})).text(), 'legacy');
});

test('save, update, version conflict, delete, revision', async () => {
  const { env, db } = d1();
  assert.deepEqual((await call(env, 'GET', '/api/meeting-notes/revision')).body.data, { revision:0 });
  assert.deepEqual((await call(env, 'GET', '/api/meeting-notes/all')).body.data, { revision:0, notes:[] });
  let r = await call(env, 'POST', '/api/meeting-notes/save', { note:note('m1'), baseRev:0 });
  assert.equal(r.status, 200); assert.equal(r.body.data.revision, 1); assert.equal(r.body.data.note.rev, 1);
  r = await call(env, 'POST', '/api/meeting-notes/save', { note:note('m1', { title:'바꾼 제목' }), baseRev:1 });
  assert.equal(r.body.data.note.rev, 2); assert.equal(r.body.data.revision, 2);
  // a stale device (still at rev 1) cannot overwrite
  r = await call(env, 'POST', '/api/meeting-notes/save', { note:note('m1', { title:'오래된 화면' }), baseRev:1 });
  assert.equal(r.status, 409); assert.equal(r.body.error, 'conflict'); assert.equal(r.body.note.title, '바꾼 제목');
  // creating with an id that already exists is a conflict too
  assert.equal((await call(env, 'POST', '/api/meeting-notes/save', { note:note('m1'), baseRev:0 })).status, 409);
  await call(env, 'POST', '/api/meeting-notes/save', { note:note('m2', { date:'2026-10-23' }), baseRev:0 });
  r = await call(env, 'GET', '/api/meeting-notes/all');
  assert.deepEqual(r.body.data.notes.map(n => n.id), ['m2', 'm1'], 'newest date first');
  assert.equal(r.body.data.revision, (await call(env, 'GET', '/api/meeting-notes/revision')).body.data.revision);
  // delete needs the current version; deleting again is a no-op
  assert.equal((await call(env, 'POST', '/api/meeting-notes/delete', { id:'m1', baseRev:1 })).status, 409);
  r = await call(env, 'POST', '/api/meeting-notes/delete', { id:'m1', baseRev:2 });
  assert.equal(r.body.data.removed, true);
  assert.deepEqual((await call(env, 'POST', '/api/meeting-notes/delete', { id:'m1', baseRev:0 })).body.data, { id:'m1', removed:false });
  // saving a note that another device deleted is a conflict (note:null)
  r = await call(env, 'POST', '/api/meeting-notes/save', { note:note('m1'), baseRev:2 });
  assert.equal(r.status, 409); assert.equal(r.body.note, null);
  assert.deepEqual((await call(env, 'GET', '/api/meeting-notes/all')).body.data.notes.map(n => n.id), ['m2']);
  assert.equal(db.prepare(`SELECT value FROM widget_settings WHERE key = ?`).get(`instance:${W}:worklog`).value, 'private fixture');
});

test('input is normalized; bad input never writes', async () => {
  const { env, db } = d1();
  const before = db.prepare('SELECT COUNT(*) AS n FROM widget_settings').get().n;
  for (const body of [{ note:note('bad id!'), baseRev:0 }, { note:note('m1', { date:'2026-02-30' }), baseRev:0 }, { note:note('m1'), baseRev:-1 }, { note:null, baseRev:0 }]) {
    assert.equal((await call(env, 'POST', '/api/meeting-notes/save', body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal((await call(env, 'GET', '/api/meeting-notes/all', null, 'w_unknown_instance_0000000000000')).status, 404);
  assert.equal((await call(env, 'GET', '/api/meeting-notes/save')).status, 404, 'save is POST only');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM widget_settings').get().n, before);
  const long = note('m1', { title:'가'.repeat(500), who:'x\ny', topics:[{ id:'t1', h:'h', say:'s', lines:[{ id:'l1', t:'a\nb', key:true }, { id:'bad id', t:'drop' }, { id:'l1', t:'dup' }] }] });
  const saved = (await call(env, 'POST', '/api/meeting-notes/save', { note:long, baseRev:0 })).body.data.note;
  assert.equal(saved.title.length, LIMITS.title); assert.equal(saved.who, 'x y');
  assert.deepEqual(saved.topics[0].lines, [{ id:'l1', t:'a b', key:true }]);
});

test('instances stay separate even when one key is a prefix of another', async () => {
  const { env } = d1();
  await call(env, 'POST', '/api/meeting-notes/save', { note:note('mine'), baseRev:0 });
  await call(env, 'POST', '/api/meeting-notes/save', { note:note('theirs'), baseRev:0 }, W2);
  assert.deepEqual((await call(env, 'GET', '/api/meeting-notes/all')).body.data.notes.map(n => n.id), ['mine']);
  assert.deepEqual((await call(env, 'GET', '/api/meeting-notes/all', null, W2)).body.data.notes.map(n => n.id), ['theirs']);
  assert.equal((await call(env, 'GET', '/api/meeting-notes/revision')).body.data.revision, 1);
});

test('note limit per instance, D1 daily limit classification, preflight', async () => {
  const { env, db } = d1();
  const insert = db.prepare(`INSERT INTO widget_settings VALUES (?, ?, 'x')`);
  for (let i = 0; i < LIMITS.notes; i += 1) insert.run(`instance:${W}:meetingNotes:v1:note:n${i}`, JSON.stringify({ ...note(`n${i}`), rev:1 }));
  const r = await call(env, 'POST', '/api/meeting-notes/save', { note:note('one-more'), baseRev:0 });
  assert.equal(r.status, 409); assert.equal(r.body.limit, 'notes');
  assert.equal((await call(env, 'GET', '/api/meeting-notes/all')).body.data.notes.length, LIMITS.notes);
  const quota = { DB:{ prepare() { throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit"); } } };
  const q = await call(quota, 'GET', '/api/meeting-notes/revision');
  assert.equal(q.status, 503); assert.match(q.body.error, /D1_ERROR/);
  assert.equal((await handleMeetingNotes(new Request(`https://x.test/api/meeting-notes/save?w=${W}`, { method:'OPTIONS' }), env, NOW)).status, 204);
});
