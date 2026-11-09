import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyShelf, seoulDay } from '../Library/library-phrases.mjs';
const books = Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, status: 'done', title: `책 ${i}`, one: `문구 ${i}` }));
const quotes = books.flatMap(b => [{ id: `${b.id}-q1`, bookId: b.id, text: `필사 ${b.id}` }, { id: `${b.id}-q2`, bookId: b.id, text: `다른 필사 ${b.id}` }]);
test('Seoul midnight, deterministic cross-device prefix, distinct books and actual previous-day exclusion', () => {
  assert.equal(seoulDay(new Date('2026-11-09T15:00:00Z')), '2026-11-10');
  let previous = [];
  for (let day = 1; day <= 15; day++) {
    const date = `2026-11-${String(day).padStart(2, '0')}`;
    const pc = dailyShelf(books, quotes, 4, date), mobile = dailyShelf(books, quotes, 2, date);
    assert.deepEqual(mobile, pc.slice(0, 2));
    assert.equal(new Set(pc.map(b => b.id)).size, 4);
    assert.ok(pc.every(b => !previous.includes(b.id)));
    assert.deepEqual(dailyShelf([...books].reverse(), [...quotes].reverse(), 4, date), pc);
    previous = pc.map(b => b.id);
  }
});
test('one latest reading book then completed phrases only; quotations and no-candidate states', () => {
  const all = [...books, { id: 'old', status: 'reading', created: '2026-01-01' }, { id: 'new', status: 'reading', created: '2020-01-01', startDate: '2026-11-01' }, { id: 'drop', status: 'dropped', one: '금지' }];
  const result = dailyShelf(all, quotes, 4, '2026-11-09');
  assert.equal(result[0].id, 'new'); assert.equal(result.length, 4); assert.ok(result.slice(1).every(b => b.status === 'done'));
  const quoteOnly = books.map(b => ({ ...b, one: '' }));
  assert.ok(dailyShelf(quoteOnly, quotes, 4, '2026-11-09').every(b => b.one.includes('필사')));
  assert.equal(dailyShelf([{ id: 'r', status: 'reading' }, { id: 'empty', status: 'done' }]).length, 1);
  assert.deepEqual(dailyShelf([], []), []);
  assert.equal(dailyShelf([
    { id: 'a', status: 'reading', startDate: '2026-11-01', created: '2026-10-01' },
    { id: 'b', status: 'reading', startDate: '2026-11-01', created: '2026-10-02' },
  ])[0].id, 'b');
});
test('small candidate pools refill without repeating a book within the day; duplicate one/quotes collapse', () => {
  const few = books.slice(0, 2);
  const duplicates = few.map(b => ({ id: `duplicate-${b.id}`, bookId: b.id, text: b.one }));
  assert.equal(dailyShelf(few, duplicates, 4, '2026-11-09').length, 2);
  assert.equal(dailyShelf(few, duplicates, 4, '2026-11-10').length, 2);
  assert.ok(dailyShelf(few, duplicates, 4, '2026-11-10').every(b => b.phraseId.startsWith('book:')));
});
