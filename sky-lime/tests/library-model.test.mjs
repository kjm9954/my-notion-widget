import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { seoulYear, safeBookUrl, shelfBooks, countBooks, matchRange, marked, bookDate, searchBooks, fitSearchRows, createLibraryReader } from '../Library/library-common.mjs';

test('Library year and created-date fallback use Seoul midnight, not UTC or the worklog 6am boundary', () => {
  assert.equal(seoulYear(new Date('2025-12-31T15:01:00Z')), 2026);
  assert.equal(bookDate({ created: '2025-12-31T15:01:00Z' }), '2026-01-01');
  assert.equal(bookDate({ startDate: '2025-05-01', created: '2026-01-01T00:00:00Z' }), '2025-05-01');
});
test('Shelf sorts reading by start/creation, then done by end/start/edit, excludes other statuses and applies the cap', () => {
  const books = [
    { id: 'done-old', status: 'done', endDate: '2024-01-01' },
    { id: 'ignored', status: 'dropped', created: '2027-01-01' },
    { id: 'reading-old', status: 'reading', created: '2025-01-01' },
    { id: 'done-new', status: 'done', edited: '2026-05-01' },
    { id: 'done-start', status: 'done', startDate: '2026-03-01' },
    { id: 'reading-new', status: 'reading', startDate: '2026-01-01', created: '2024-01-01' },
  ];
  assert.deepEqual(shelfBooks(books).map(book => book.id), ['reading-new', 'reading-old', 'done-new', 'done-start']);
  assert.equal(shelfBooks(books, 2).length, 2);
  assert.equal(books[0].id, 'done-old');
});
test('Counts use done and end/start dates, ignoring legacy relation year and undated books', () => {
  const result = countBooks([
    { status: 'done', year: 2026, startDate: '2025-01-01' },
    { status: 'done', year: '2025', startDate: '2025-01-01', endDate: '2026-02-01' },
    { status: 'reading', year: 2026 },
    { status: 'dropped', year: 2026 },
    { status: 'done', year: null, endDate: '2026-01-01' },
    { status: 'done', year: 2026 },
    { status: 'done', year: 2019, startDate: '2019-01-01' },
    { status: 'done', year: 2027 },
  ], 2026);
  assert.equal(result.counts.get(2026), 2);
  assert.deepEqual(result.years, [2022, 2023, 2024, 2025, 2026]);
  assert.deepEqual(countBooks([], 2026).years, [2026]);
});
test('Search merges title, one, quote text/note/thought and body, prioritizes sources and deduplicates books', () => {
  const books = [
    { id: 'title', title: '작은 습관', created: '2026-01-01T00:00:00Z' },
    { id: 'one', title: '다른 책', one: '열두 글자보다 더 긴 앞부분입니다. 작은   습관부터 시작', startDate: '2026-03-01' },
    { id: 'quote', title: '필사 책', startDate: '2026-04-01' },
    { id: 'body', title: '본문 책', startDate: '2026-05-01' },
    { id: 'author', title: '작가의 책', author: 'James Clear', startDate: '2026-02-01' },
  ];
  const quotes = [{ bookId: 'quote', text: '작은 습관', note: '반응', thought: '생각' }, { bookId: 'title', text: '작은 습관' }];
  const body = [{ id: 'body', line: '작은 습관 본문' }, { id: 'quote', line: '작은 습관 중복' }];
  assert.deepEqual(searchBooks(books, '작은습관', quotes, body).map(hit => hit.book.id), ['title', 'one', 'quote', 'body']);
  assert.equal(searchBooks(books, '반응', quotes)[0].book.id, 'quote');
  assert.equal(searchBooks(books, '생각', quotes)[0].book.id, 'quote');
  assert.match(marked(books[1].one, '작은습관', true), /^….*<b>작은   습관<\/b>/);
  assert.equal(searchBooks(books, 'jamesclear').length, 0);
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
  callback({ books: [{ id: 'one', status: 'reading' }], quotes: [{ bookId: 'one', text: '필사' }] });
  assert.equal(output.quotes[0].text, '필사');
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
  assert.doesNotMatch(js, /localStorage|w_[A-Za-z0-9_-]{24,}/);
  assert.equal((js.match(/fetch\(/g) || []).length, 1);
  assert.match(js, /https:\/\/notion-search\.wldnjsdkk\.workers\.dev\/search/);
  assert.match(js, /Store\.createReadingBook\(\{ title, status: 'reading' \}\)/);
  assert.match(js, /Store\.updateReadingBook\(id, patch\)/);
});
