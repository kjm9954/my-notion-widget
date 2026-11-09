import test from 'node:test';
import assert from 'node:assert/strict';
import { monthStats, shiftMonth, photoPayload, rebaseDraft, EntryEditor } from '../game-log-diary/diary-v2-common.js';

const row = (date, mood = null) => ({ date, mood, text: '', photos: [], revision: 1 });
test('current month excludes future/neighbor dates and includes mood/photo-only days', () => {
  const s = monthStats([row('2026-10-31', 'good'), row('2026-11-07', 'calm'), row('2026-11-08', 'good'), row('2026-11-09'), row('2026-11-10', 'good')], '2026-11', '2026-11-09');
  assert.equal(s.count, 3); assert.equal(s.until, 9); assert.equal(s.streak, 3);
  assert.deepEqual(s.moods, { calm: 1, good: 1, tired: 0 }); assert.equal(s.marked[9], false);
});
test('current streak starts yesterday when today has no entry, within displayed month', () => {
  assert.equal(monthStats([row('2026-11-07'), row('2026-11-08')], '2026-11', '2026-11-09').streak, 2);
  assert.equal(monthStats([row('2026-11-06'), row('2026-11-07')], '2026-11', '2026-11-09').streak, 0);
  assert.equal(monthStats([row('2026-10-31'), row('2026-11-01')], '2026-11', '2026-11-01').streak, 1);
});
test('past months use full length and longest streak, including leap February', () => {
  const s = monthStats([row('2024-02-27'), row('2024-02-28'), row('2024-02-29')], '2024-02', '2026-11-09');
  assert.equal(s.until, 29); assert.equal(s.days, 29); assert.equal(s.streak, 3); assert.equal(s.current, false);
});
test('empty/duplicate records and year boundaries are stable', () => {
  assert.equal(monthStats([], '2026-11', '2026-11-09').count, 0);
  assert.equal(monthStats([row('2026-11-01', 'good'), row('2026-11-01', 'good')], '2026-11', '2026-11-09').moods.good, 1);
  assert.equal(shiftMonth('2026-01', -1), '2025-12'); assert.equal(shiftMonth('2026-12', 1), '2027-01');
});
test('existing photos send ids only; new originals retain their data URLs', () => {
  assert.deepEqual(photoPayload([{ id: 'old', url: 'private', dataUrl: 'should-not-send' }, { id: 'new', isNew: true, dataUrl: 'original-bytes' }]), [{ id: 'old' }, { id: 'new', dataUrl: 'original-bytes' }]);
});
test('conflict rebasing cannot resurrect a photo removed on another device', () => {
  const draft = { text: 'mine', photos: [{ id: 'old' }, { id: 'keep' }, { id: 'new', isNew: true, dataUrl: 'bytes' }] };
  const rebased = rebaseDraft(draft, { revision: 4, photos: [{ id: 'keep' }] });
  assert.equal(rebased.revision, 4); assert.deepEqual(rebased.photos.map(p => p.id), ['keep', 'new']);
  assert.equal(draft.photos.length, 3);
});

function harness(overrides = {}) {
  const records = new Map(), drafts = new Map(), writes = [], notices = [];
  const D = {
    seoulDateKey: () => '2026-11-09', loadDraft: d => drafts.get(d), saveDraft: (d, v) => { drafts.set(d, structuredClone(v)); return { saved: true, photosSaved: true }; },
    clearDraft: d => drafts.delete(d), announce: n => notices.push(n), loadEntry: async d => records.get(d) || null,
    saveEntry: async v => { writes.push(v); const saved = { ...v, revision: (v.expectedRevision || 0) + 1 }; records.set(v.date, saved); return saved; }, ...overrides,
  };
  const conflicts = [], editor = new EntryEditor(D, () => {}, c => conflicts.push(c));
  return { editor, records, drafts, writes, notices, conflicts };
}
test('empty save is disabled; normal save clears draft and announces exactly once', async () => {
  const h = harness(); await h.editor.load('2026-11-09'); assert.equal(h.editor.canSave(), false);
  h.editor.edit({ mood: 'calm' }); assert.ok(h.drafts.has('2026-11-09'));
  await h.editor.save(); assert.equal(h.writes.length, 1); assert.equal(h.writes[0].expectedRevision, null);
  assert.equal(h.drafts.size, 0); assert.equal(h.notices.length, 1);
});
test('failed loading of a different date never saves previous date content', async () => {
  const h = harness({ loadEntry: async d => { if (d.endsWith('08')) throw new Error('offline'); return { text: 'previous', revision: 2 }; } });
  await h.editor.load('2026-11-09'); await h.editor.load('2026-11-08');
  assert.equal(h.editor.value.text, ''); assert.equal(h.editor.known, false); assert.equal(await h.editor.save(), null);
});
test('late date load cannot replace a more recently requested date', async () => {
  let finish; const h = harness({ loadEntry: d => d.endsWith('08') ? new Promise(r => { finish = r; }) : Promise.resolve({ text: 'newer', revision: 3 }) });
  const old = h.editor.load('2026-11-08'); await h.editor.load('2026-11-09'); finish({ text: 'stale', revision: 1 }); await old;
  assert.equal(h.editor.date, '2026-11-09'); assert.equal(h.editor.value.text, 'newer');
});
test('save failures preserve text/mood/new photos and support retry', async () => {
  let fail = true; const h = harness({ saveEntry: async v => { if (fail) throw new Error('offline'); return { ...v, revision: 1 }; } });
  await h.editor.load('2026-11-09'); h.editor.edit({ text: 'mine', mood: 'good', photos: [{ id: 'p', isNew: true, dataUrl: 'original' }] });
  await h.editor.save(); assert.equal(h.editor.value.photos[0].dataUrl, 'original'); assert.equal(h.editor.dirty, true);
  fail = false; assert.ok(await h.editor.save()); assert.equal(h.editor.dirty, false);
});
test('409 including remote deletion requires explicit rebase before any second write', async () => {
  let n = 0; const h = harness({ saveEntry: async v => { n++; if (n === 1) throw Object.assign(new Error('conflict'), { status: 409, data: { current: null } }); return { ...v, revision: 1 }; } });
  await h.editor.load('2026-11-09'); h.editor.edit({ text: 'mine' }); await h.editor.save();
  assert.equal(h.conflicts.length, 1); assert.equal(h.editor.value.text, 'mine'); await h.editor.save(); assert.equal(n, 1);
  h.editor.resolve(true); assert.equal(n, 1); assert.equal(h.editor.value.revision, null); await h.editor.save(); assert.equal(n, 2);
});
test('draft storage exhaustion blocks date navigation, preserving photo bytes in memory', async () => {
  const h = harness({ saveDraft: () => ({ saved: true, photosSaved: false }) }); await h.editor.load('2026-11-09');
  h.editor.edit({ photos: [{ id: 'p', isNew: true, dataUrl: 'bytes' }] }); assert.equal(await h.editor.load('2026-11-08'), false);
  assert.equal(h.editor.date, '2026-11-09'); assert.equal(h.editor.value.photos[0].dataUrl, 'bytes');
});
test('duplicate saves lock input and produce one request', async () => {
  let finish, calls = 0; const h = harness({ saveEntry: v => { calls++; return new Promise(r => { finish = () => r({ ...v, revision: 1 }); }); } });
  await h.editor.load('2026-11-09'); h.editor.edit({ text: 'first' }); const saving = h.editor.save();
  h.editor.edit({ text: 'second' }); await h.editor.save(); assert.equal(calls, 1); assert.equal(h.editor.value.text, 'first'); finish(); await saving;
});
test('photo import locks navigation, retains successes, reports failed files, limits four', async () => {
  const h = harness({ photoFromFile: async f => { if (f.bad) throw new Error('이미지 파일만 추가할 수 있어요.'); return { id: f.id, isNew: true, dataUrl: 'bytes' }; } });
  await h.editor.load('2026-11-09'); await h.editor.addFiles([{ id: '1' }, { bad: true }, { id: '2' }, { id: '3' }, { id: '5' }]);
  assert.equal(h.editor.value.photos.length, 3); assert.match(h.editor.status, /최대 4장/); assert.match(h.editor.status, /이미지/);
});
