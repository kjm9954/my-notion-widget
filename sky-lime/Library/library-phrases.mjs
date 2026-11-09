// Deterministic daily shelf. Nothing is persisted: every device derives the same
// four-slot schedule from the same Store snapshot and Seoul date. Mobile is a prefix.
export const seoulDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function hash(text, seed = 2166136261) {
  let value = seed;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
function candidates(books, quotes) {
  const done = new Map(books.filter(b => b.status === 'done').map(b => [b.id, b]));
  const result = [], seen = new Set();
  function add(bookId, text, id) {
    const book = done.get(bookId), line = String(text || '').trim();
    const unique = `${bookId}\0${line}`;
    if (!book || !line || seen.has(unique)) return;
    seen.add(unique); result.push({ id, book, line });
  }
  for (const book of done.values()) add(book.id, book.one, `book:${book.id}:one`);
  for (const quote of [...quotes].sort((a, b) => compare(String(a.id || a.text), String(b.id || b.text)))) {
    add(quote.bookId, quote.text, `quote:${quote.bookId}:${quote.id || hash(String(quote.text))}`);
  }
  return result.sort((a, b) => compare(a.id, b.id));
}
let cached = null;
function selection(pool, date, slots) {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  if (!Number.isFinite(day)) return [];
  const signature = JSON.stringify([slots, pool.map(p => [p.id, p.book.id])]);
  if (!cached || cached.signature !== signature || day < cached.day) cached = { signature, day: -1, chosen: [] };
  // Reconstruct the actual preceding selection, not yesterday's unfiltered hash
  // ranking (which can repeat books). A fixed Unix epoch makes this independent
  // of first visit, browser storage and viewport. Cache the schedule in memory.
  for (let d = cached.day + 1; d <= day; d++) {
    const previous = new Set(cached.chosen.map(p => p.book.id));
    const prefix = hash(`${new Date(d * 86400000).toISOString().slice(0, 10)}:`);
    const ordered = pool.map(p => ({ p, score: hash(p.id, prefix) }))
      .sort((a, b) => a.score - b.score || compare(a.p.id, b.p.id));
    const chosen = [], used = new Set();
    const take = allowPrevious => {
      for (const { p } of ordered) {
        if (chosen.length === slots) break;
        if (used.has(p.book.id) || (!allowPrevious && previous.has(p.book.id))) continue;
        used.add(p.book.id); chosen.push(p);
      }
    };
    take(false); if (chosen.length < slots) take(true);
    cached.day = d; cached.chosen = chosen;
  }
  const current = new Map(pool.map(p => [p.id, p]));
  return cached.chosen.map(p => current.get(p.id)).filter(Boolean);
}
export function dailyShelf(books, quotes = [], limit = 4, date = seoulDay()) {
  const reading = books.filter(b => b.status === 'reading').sort((a, b) =>
    compare(String(b.startDate || b.created || ''), String(a.startDate || a.created || ''))
    || compare(String(b.created || ''), String(a.created || '')) || compare(a.id, b.id))[0];
  const pool = candidates(books, quotes), slots = reading ? 3 : 4;
  const phrases = pool.length ? selection(pool, date, slots).map(p => ({ ...p.book, one: p.line, phraseId: p.id })) : [];
  return [...(reading ? [reading] : []), ...phrases].slice(0, limit);
}
