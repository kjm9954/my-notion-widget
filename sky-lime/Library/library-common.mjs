// Library reads and writes only through the existing Store. No data is saved in localStorage.
export const seoulYear = (now = new Date()) => Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(now));
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const isComposing = event => event.isComposing || event.keyCode === 229;
export function safeBookUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)notion\.(so|site)$/.test(url.hostname) ? url.href : '';
  } catch { return ''; }
}
export function shelfBooks(books, limit = 4) {
  const recent = field => (a, b) => String(field(b) || '').localeCompare(String(field(a) || '')) || String(a.id).localeCompare(String(b.id));
  return [
    ...books.filter(book => book.status === 'reading').sort(recent(book => book.startDate || book.created)),
    ...books.filter(book => book.status === 'done').sort(recent(book => book.endDate || book.startDate || book.edited)),
  ].slice(0, limit);
}
export function countBooks(books, currentYear = seoulYear()) {
  const counts = new Map();
  for (const book of books) {
    const year = Number(String(book.endDate || book.startDate || '').slice(0, 4));
    if (book.status === 'done' && Number.isInteger(year) && year >= 1000 && year <= currentYear) counts.set(year, (counts.get(year) || 0) + 1);
  }
  const first = counts.size ? Math.min(...counts.keys()) : currentYear;
  const years = [];
  for (let year = Math.max(first, currentYear - 4); year <= currentYear; year++) years.push(year);
  return { counts, years, max: Math.max(1, ...years.map(year => counts.get(year) || 0)) };
}
function searchable(value) {
  const original = String(value ?? '');
  let text = '';
  const positions = [];
  for (let i = 0; i < original.length; i++) {
    if (/\s/.test(original[i])) continue;
    const lower = original[i].toLowerCase();
    text += lower;
    for (let j = 0; j < lower.length; j++) positions.push(i);
  }
  return { original, text, positions };
}
export function matchRange(value, query) {
  const source = searchable(value), key = searchable(query).text;
  if (!key) return null;
  const index = source.text.indexOf(key);
  return index < 0 ? null : [source.positions[index], source.positions[index + key.length - 1] + 1];
}
export function marked(value, query, excerpt = false) {
  const text = String(value ?? '');
  const range = matchRange(text, query);
  if (!range) return escapeHtml(excerpt ? text.slice(0, 100) : text);
  const [from, to] = range;
  const start = excerpt ? Math.max(0, from - 12) : 0;
  return (start ? '…' : '') + escapeHtml(text.slice(start, from)) + '<b>' + escapeHtml(text.slice(from, to)) + '</b>' + escapeHtml(text.slice(to, excerpt ? to + 80 : undefined));
}
export function bookDate(book) {
  const raw = book.startDate || book.created || '';
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export const shortDate = book => bookDate(book).slice(2).replaceAll('-', '.');
export function searchBooks(books, query, quotes = [], bodyHits = []) {
  if (!searchable(query).text) return [];
  const key = id => String(id || '').replaceAll('-', '').toLowerCase();
  const quoteMatches = new Map(), bodyMatches = new Map();
  for (const quote of quotes) {
    const line = ['text', 'note', 'thought'].map(field => quote[field]).find(value => matchRange(value, query));
    if (line && !quoteMatches.has(key(quote.bookId))) quoteMatches.set(key(quote.bookId), line);
  }
  for (const hit of bodyHits) if (hit.id && matchRange(hit.line, query)) bodyMatches.set(key(hit.id), hit.line);
  const hits = [];
  for (const book of books) {
    const id = key(book.id), quote = quoteMatches.get(id), body = bodyMatches.get(id);
    if (matchRange(book.title, query)) hits.push({ book, line: book.one || quote || body || '', rank: 0 });
    else if (matchRange(book.one, query)) hits.push({ book, line: book.one, rank: 1 });
    else if (quote) hits.push({ book, line: quote, rank: 2 });
    else if (body) hits.push({ book, line: body, rank: 3 });
  }
  return hits.sort((a, b) => a.rank - b.rank || bookDate(b.book).localeCompare(bookDate(a.book)) || String(b.book.edited || '').localeCompare(String(a.book.edited || '')));
}
export const fitSearchRows = height => Math.max(0, Math.min(3, Math.floor((height + 6) / 52)));
export function failureText(error, saving = false) {
  if (error?.status === 400 || error?.status === 401 || error?.status === 403 || error?.status === 404 || /인스턴스|주소/.test(String(error?.message || ''))) return '위젯 주소를 확인해 주세요';
  if (error?.dailyLimit) return '서버 한도 초과 · 오전 9시 이후 다시 확인해요';
  return saving ? '저장하지 못했어요 · 다시 시도해 주세요' : '불러오지 못했어요 · 잠시 후 다시 확인해요';
}

// Store owns caching, request notifications, the instance key and the shared error indicator.
// The reader keeps the last valid display during a failed reload and never logs errors/keys.
export function createLibraryReader(onChange, store = window.Store) {
  let books = [], quotes = [], loaded = false, error = null, disposed = false, stop = null;
  const confirmed = new Map();
  const emit = () => { if (!disposed) onChange({ books, quotes, loaded, error }); };
  function accept(state) {
    if (disposed) return;
    if (!Array.isArray(state?.books)) throw new Error('Invalid reading library response');
    quotes = Array.isArray(state.quotes) ? state.quotes : [];
    books = state.books.map(book => {
      const patch = confirmed.get(book.id);
      if (!patch) return book;
      if (Object.entries(patch).every(([key, value]) => book[key] === value)) confirmed.delete(book.id);
      return { ...book, ...patch };
    });
    loaded = true;
    error = null;
    emit();
  }
  const fail = failure => { error = failure; loaded = true; emit(); };
  async function load(fresh = false) {
    try { accept(await store.loadReadingLibrary({ fresh })); }
    catch (failure) { fail(failure); }
  }
  function start() {
    try { stop = store.watchReadingLibrary(accept, { allowWhileEditing: true, onError: fail }); }
    catch (failure) { fail(failure); }
  }
  function saved(id, patch) {
    confirmed.set(id, patch);
    books = books.map(book => book.id === id ? { ...book, ...patch } : book);
    error = null;
    emit();
  }
  return { start, load, saved, dispose() { disposed = true; stop?.(); } };
}
