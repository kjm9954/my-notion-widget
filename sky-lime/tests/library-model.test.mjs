import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { seoulYear, safeBookUrl, shelfBooks, countBooks, matchRange, marked, bookDate, searchBooks, fitSearchRows, createLibraryReader } from '../Library/library-common.mjs';

test('Library year and created-date fallback use Seoul midnight, not UTC or the worklog 6am boundary', () => {
  assert.equal(seoulYear(new Date('2025-12-31T15:01:00Z')), 2026);
  assert.equal(bookDate({ created: '2025-12-31T15:01:00Z' }), '2026-01-01');
  assert.equal(bookDate({ startDate: '2025-05-01', created: '2026-01-01T00:00:00Z' }), '2025-05-01');
});
test('Shelf sorts reading by creation, then done by end/start/edit, excludes other statuses and applies the cap', () => {
  const books = [
    { id: 'done-old', status: 'done', endDate: '2024-01-01' },
    { id: 'ignored', status: 'dropped', created: '2027-01-01' },
    { id: 'reading-old', status: 'reading', created: '2025-01-01' },
    { id: 'done-new', status: 'done', edited: '2026-05-01' },
    { id: 'done-start', status: 'done', startDate: '2026-03-01' },
    { id: 'reading-new', status: 'reading', created: '2026-01-01' },
  ];
  assert.deepEqual(shelfBooks(books).map(book => book.id), ['reading-new', 'reading-old', 'done-new', 'done-start']);
  assert.equal(shelfBooks(books, 2).length, 2);
  assert.equal(books[0].id, 'done-old');
});
test('Counts use only done + the existing API year, never fallback to dates in the widget', () => {
  const result = countBooks([
    { status: 'done', year: 2026, startDate: '2025-01-01' },
    { status: 'done', year: '2026' },
    { status: 'reading', year: 2026 },
    { status: 'dropped', year: 2026 },
    { status: 'done', year: null, endDate: '2026-01-01' },
    { status: 'done', year: 2019 },
    { status: 'done', year: 2027 },
  ], 2026);
  assert.equal(result.counts.get(2026), 2);
  assert.deepEqual(result.years, [2022, 2023, 2024, 2025, 2026]);
  assert.deepEqual(countBooks([], 2026).years, [2026]);
});
test('Search includes title, author, one and learned; ignores case/spacing and safely highlights the real span', () => {
  const books = [
    { id: 'title', title: '작은 습관', created: '2026-01-01T00:00:00Z' },
    { id: 'learned', title: '다른 책', learned: '열두 글자보다 더 긴 앞부분입니다. 작은   습관부터 시작', startDate: '2026-03-01' },
    { id: 'author', title: '작가의 책', author: 'James Clear', startDate: '2026-02-01' },
  ];
  assert.deepEqual(searchBooks(books, '작은습관').map(hit => hit.book.id), ['learned', 'title']);
  assert.match(marked(books[1].learned, '작은습관', true), /^….*<b>작은   습관<\/b>/);
  assert.equal(searchBooks(books, 'jamesclear')[0].line, 'James Clear');
  assert.deepEqual(matchRange('James Clear', 'JAMESclear'), [0, 11]);
  assert.equal(marked('<img onerror=alert(1)>습관', '습관'), '&lt;img onerror=alert(1)&gt;<b>습관</b>');
  assert.deepEqual(searchBooks(books, '   '), []);
});
test('Only safe Notion links open and the search never renders a partially visible fourth result', () => {
  assert.equal(safeBookUrl('javascript:alert(1)'), '');
  assert.equal(safeBookUrl('https://notion.so.evil.example/book'), '');
  assert.equal(safeBookUrl('https://www.notion.so/book'), 'https://www.notion.so/book');
  assert.equal(fitSearchRows(158), 3);
  assert.equal(fitSearchRows(149), 2);
  assert.equal(fitSearchRows(20), 0);
});
test('Reader retains last valid data on failure and a just-confirmed save survives a late stale read', async () => {
  let callback, options, output, stopped = false;
  const store = {
    watchReadingLibrary(cb, opts) { callback = cb; options = opts; return () => { stopped = true; }; },
    async loadReadingLibrary() { throw new Error('Offline'); },
  };
  const reader = createLibraryReader(value => { output = value; }, store);
  reader.start();
  assert.equal(options.allowWhileEditing, true);
  callback({ books: [{ id: 'one', status: 'reading' }] });
  reader.saved('one', { status: 'done', star: 4, one: '메모' });
  callback({ books: [{ id: 'one', status: 'reading' }] });
  assert.equal(output.books[0].status, 'done');
  await reader.load(true);
  assert.equal(output.books.length, 1);
  assert.equal(output.error.message, 'Offline');
  callback({ books: [{ id: 'one', status: 'done', star: 4, one: '메모' }] });
  callback({ books: [{ id: 'one', status: 'reading' }] });
  assert.equal(output.books[0].status, 'reading');
  reader.dispose(); assert.equal(stopped, true);
});
test('All four pages load isolated Store and shared sky-lime CSS, without direct fetch/data localStorage or sample files', async () => {
  for (const name of ['new-book', 'bookshelf', 'reading-count', 'book-search']) {
    const html = await readFile(new URL(`../Library/${name}.html`, import.meta.url), 'utf8');
    assert.match(html, /store\.js\?v=20260930-size-sync" data-store-isolated data-store-coalesce/);
    assert.match(html, /\.\.\/Worklog\/sky-lime\.css/);
    assert.match(html, /name="referrer" content="no-referrer"/);
    assert.doesNotMatch(html, /sample-books|SAMPLE_BOOKS|localStorage|fetch\(/);
  }
  const js = await readFile(new URL('../Library/library-widgets.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /localStorage|fetch\(|w_[A-Za-z0-9_-]{24,}/);
  assert.match(js, /Store\.createReadingBook\(\{ title, status: 'reading', year: seoulYear\(\) \}\)/);
  assert.match(js, /Store\.updateReadingBook\(id, patch\)/);
});
