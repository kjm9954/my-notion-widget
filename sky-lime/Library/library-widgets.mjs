import { seoulYear, escapeHtml, isComposing, safeBookUrl, countBooks, searchBooks, marked, shortDate, fitSearchRows, failureText, createLibraryReader } from './library-common.mjs?v=20261109-search';
import { dailyShelf, seoulDay } from './library-phrases.mjs?v=20261109';

const Store = window.Store;
const byId = id => document.getElementById(id);
const app = byId('app');
const narrow = matchMedia('(max-width:480px)');
function message(container, text, className = 'lb-message') {
  const p = document.createElement('p'); p.className = className; p.textContent = text;
  container.replaceChildren(p);
}
function watch(onChange) {
  const reader = createLibraryReader(state => {
    app.dataset.status = state.error ? 'error' : state.loaded ? 'ready' : 'loading';
    onChange(state);
  });
  reader.start();
  window.addEventListener('pagehide', event => { if (!event.persisted) reader.dispose(); });
  return reader;
}

function newBook() {
  const input = byId('title'), button = byId('add'), notice = byId('notice'), link = byId('savedLink');
  let saving = false;
  const placeholder = () => { input.placeholder = narrow.matches ? '책 제목' : '읽기 시작한 책 제목'; };
  narrow.addEventListener('change', placeholder); placeholder();
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !saving) { input.value = ''; notice.textContent = ''; }
    if (event.key === 'Enter' && isComposing(event)) event.preventDefault();
  });
  app.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;
    if (!link.hidden) { link.hidden = true; input.hidden = false; button.textContent = '추가'; notice.textContent = ''; input.focus(); return; }
    const title = input.value.trim();
    if (!title) return;
    saving = true; button.disabled = true; input.disabled = true; button.textContent = '저장 중'; notice.textContent = '';
    // Reserve a tab during the click/Enter gesture; navigating it after async save
    // avoids popup blockers. If the embed forbids popups, show a real link instead.
    let tab = null;
    try { tab = window.open('about:blank', '_blank'); if (tab) tab.opener = null; } catch { /* fallback link below */ }
    try {
      const book = await Store.createReadingBook({ title, status: 'reading' });
      input.value = '';
      const url = safeBookUrl(book?.url);
      let opened = false;
      if (url && tab && !tab.closed) {
        try { tab.location.replace(url); opened = true; } catch { /* fallback link below */ }
      }
      if (!opened) {
        try { tab?.close(); } catch { /* already closed */ }
        if (url) {
          link.href = url; link.hidden = false; input.hidden = true;
          notice.textContent = '새 탭이 막혔어요 · 저장된 책 링크를 눌러 주세요';
        } else notice.textContent = '저장했어요 · 노션 독서 DB에서 책을 열어 주세요';
      } else notice.textContent = '저장했어요';
    } catch (error) {
      try { tab?.close(); } catch { /* already closed */ }
      notice.textContent = failureText(error, true);
    } finally {
      saving = false; button.disabled = false; input.disabled = false;
      button.textContent = link.hidden ? '추가' : '새 기록';
      if (link.hidden) input.focus();
    }
  });
}

function bookshelf() {
  const grid = byId('grid'), layer = byId('layer'), one = byId('one'), stars = byId('stars'), finish = byId('finish'), close = byId('close'), errorLabel = byId('saveError');
  let state = { books: [], quotes: [], loaded: false, error: null }, target = null, star = 0, saving = false, openerId = '';
  let day = seoulDay();
  function fitTitles() {
    grid.querySelectorAll('.lb-card-title').forEach(title => {
      const card = title.parentElement, style = getComputedStyle(card), done = card.querySelector('.lb-done');
      const room = card.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
        - card.querySelector('.lb-tag').offsetHeight - done.offsetHeight - parseFloat(getComputedStyle(done).marginBottom) - 2 * parseFloat(style.gap);
      title.style.setProperty('--lb-title-lines', String(Math.max(1, Math.min(2, Math.floor(room / 24)))));
    });
  }
  function render() {
    const list = dailyShelf(state.books, state.quotes, narrow.matches ? 2 : 4, day);
    if (!list.length) { message(grid, state.error ? failureText(state.error) : state.loaded ? '기록한 책이 없어요' : '불러오는 중이에요'); return; }
    grid.innerHTML = list.map(book => {
      const reading = book.status === 'reading';
      const body = reading
        ? `<span class="lb-tag">읽는 중</span><span class="lb-card-title">${escapeHtml(book.title)}</span><button class="lb-done" type="button" data-finish="${escapeHtml(book.id)}" aria-label="${escapeHtml(book.title)} 완독"><span class="lb-done-hit"><span class="sl-check-box" aria-hidden="true"></span></span>완독</button>`
        : book.one ? `<span class="lb-card-one">${escapeHtml(book.one)}</span><span class="lb-card-name">${escapeHtml(book.title)}</span>` : `<span class="lb-card-one is-title">${escapeHtml(book.title)}</span>`;
      return `<article class="lb-card" tabindex="0" role="link" data-book="${escapeHtml(book.id)}" aria-label="${escapeHtml(book.title)} 노션 페이지 열기">${body}</article>`;
    }).join('');
    fitTitles();
    if (state.error) byId('live').textContent = failureText(state.error);
  }
  const reader = watch(next => { state = next; render(); });
  function renderStars() {
    stars.innerHTML = [1, 2, 3, 4, 5].map(value => `<button class="lb-star${value <= star ? ' is-on' : ''}" type="button" role="radio" aria-checked="${value === star}" aria-label="별 ${value}개" data-star="${value}"${saving ? ' disabled' : ''}>★</button>`).join('');
  }
  function openLayer(book) {
    target = book; openerId = book.id; star = Math.max(0, Math.min(5, Math.round(Number(book.star) || 0))); one.value = book.one || '';
    errorLabel.hidden = true; byId('layerTitle').textContent = book.title;
    renderStars(); layer.hidden = false; grid.inert = true; byId('shelfHead').inert = true; one.focus();
  }
  function closeLayer() {
    if (saving) return;
    layer.hidden = true; grid.inert = false; byId('shelfHead').inert = false; target = null;
    grid.querySelector(`[data-finish="${CSS.escape(openerId)}"]`)?.focus();
  }
  function openBook(book) {
    const url = safeBookUrl(book?.url);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }
  grid.addEventListener('click', event => {
    const card = event.target.closest('[data-book]'); if (!card) return;
    const book = state.books.find(item => item.id === card.dataset.book); if (!book) return;
    if (event.target.closest('[data-finish]')) { event.stopPropagation(); openLayer(book); } else openBook(book);
  });
  grid.addEventListener('keydown', event => {
    if (event.target.matches('[data-book]') && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openBook(state.books.find(book => book.id === event.target.dataset.book)); }
  });
  stars.addEventListener('click', event => {
    const selected = event.target.closest('[data-star]'); if (!selected || saving) return;
    star = Number(selected.dataset.star); renderStars(); stars.querySelector(`[data-star="${star}"]`).focus();
  });
  stars.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || saving) return;
    event.preventDefault(); star = Math.max(1, Math.min(5, star + (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1)));
    renderStars(); stars.querySelector(`[data-star="${star}"]`).focus();
  });
  close.addEventListener('click', closeLayer);
  document.addEventListener('keydown', event => {
    if (layer.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closeLayer(); }
    if (event.key === 'Tab') {
      const controls = [...layer.querySelectorAll('button:not(:disabled),textarea:not(:disabled)')];
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  one.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !isComposing(event)) { event.preventDefault(); save(); }
  });
  async function save() {
    if (!target || saving) return;
    const id = target.id, patch = { status: 'done', star, one: one.value.trim() };
    saving = true; finish.disabled = true; close.disabled = true; one.disabled = true; finish.textContent = '저장 중'; errorLabel.hidden = true; renderStars();
    let succeeded = false;
    try {
      await Store.updateReadingBook(id, patch);
      reader.saved(id, patch); succeeded = true;
      byId('live').textContent = '완독으로 저장했어요';
    } catch (error) { errorLabel.textContent = failureText(error, true); errorLabel.hidden = false; }
    finally { saving = false; finish.disabled = false; close.disabled = false; one.disabled = false; finish.textContent = '완독'; renderStars(); }
    if (succeeded) { closeLayer(); await reader.load(true); }
  }
  finish.addEventListener('click', save);
  narrow.addEventListener('change', render);
  new ResizeObserver(fitTitles).observe(grid);
  const checkDay = () => { const next = seoulDay(); if (next !== day) { day = next; render(); } };
  let midnightTimer;
  function scheduleMidnight() {
    clearTimeout(midnightTimer);
    const nextMidnight = Date.parse(`${seoulDay()}T00:00:00+09:00`) + 86400000;
    midnightTimer = setTimeout(() => { checkDay(); scheduleMidnight(); }, Math.max(1, nextMidnight - Date.now() + 20));
  }
  window.addEventListener('focus', () => { checkDay(); scheduleMidnight(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkDay(); scheduleMidnight(); } });
  window.addEventListener('pagehide', event => { if (!event.persisted) clearTimeout(midnightTimer); });
  scheduleMidnight();
}

function readingCount() {
  let state = { books: [], loaded: false, error: null }, currentYear = seoulYear(), selected = currentYear;
  const bars = byId('bars'), prev = byId('prev'), next = byId('next');
  function render() {
    const data = countBooks(state.books, currentYear);
    selected = Math.max(data.years[0], Math.min(currentYear, selected));
    byId('year').textContent = `${selected}년`;
    const count = data.counts.get(selected) || 0;
    byId('count').textContent = !state.loaded || (state.error && !state.books.length) ? '—' : String(count);
    byId('count').classList.toggle('is-zero', count === 0);
    prev.disabled = selected <= data.years[0]; next.disabled = selected >= currentYear;
    byId('notice').textContent = state.error ? failureText(state.error) : '';
    if (!state.loaded || (state.error && !state.books.length)) { bars.replaceChildren(); return; }
    const maxHeight = Math.max(4, Math.min(52, byId('countBody').clientHeight - 20));
    bars.innerHTML = data.years.map(year => {
      const value = data.counts.get(year) || 0;
      return `<button class="lb-bar${year === selected ? ' is-on' : ''}" type="button" data-year="${year}" aria-label="${year}년 ${value}권" aria-pressed="${year === selected}"><i style="height:${Math.max(4, Math.round(value / data.max * maxHeight))}px" aria-hidden="true"></i><b>${year}</b></button>`;
    }).join('');
  }
  prev.addEventListener('click', () => { if (!prev.disabled) { selected--; render(); } });
  next.addEventListener('click', () => { if (!next.disabled) { selected++; render(); } });
  bars.addEventListener('click', event => { const bar = event.target.closest('[data-year]'); if (bar) { selected = Number(bar.dataset.year); render(); } });
  watch(nextState => { state = nextState; render(); });
  new ResizeObserver(render).observe(byId('countBody'));
  const timer = setInterval(() => { const year = seoulYear(); if (year !== currentYear) { if (selected === currentYear) selected = year; currentYear = year; render(); } }, 60000);
  window.addEventListener('pagehide', event => { if (!event.persisted) clearInterval(timer); });
  render();
}

function bookSearch() {
  const input = byId('query'), list = byId('list'), more = byId('more'), clear = byId('clear');
  const instanceKey = (new URLSearchParams(location.search).get('w') || '').trim();
  let state = { books: [], quotes: [], loaded: false, error: null }, timer = 0, sequence = 0, controller = null, bodyHits = [], bodyTotal = 0;
  function render() {
    const query = input.value.trim(); clear.hidden = !input.value;
    more.hidden = true;
    if (state.error && !state.books.length) { message(list, failureText(state.error), 'sl-search-message'); return; }
    if (!query) { message(list, '책 제목이나 내용으로 찾아보세요', 'sl-search-message'); return; }
    if (!state.loaded) { message(list, '불러오는 중이에요', 'sl-search-message'); return; }
    const hits = searchBooks(state.books, query, state.quotes, bodyHits);
    if (!hits.length) { message(list, '찾는 내용이 없어요', 'sl-search-message'); return; }
    const count = fitSearchRows(list.clientHeight); more.hidden = hits.length <= count && bodyTotal <= count;
    list.innerHTML = `<div class="sl-search-rows">${hits.slice(0, count).map(({ book, line }) => {
      const url = safeBookUrl(book.url);
      return `<a class="sl-search-row"${url ? ` href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"` : ' aria-disabled="true"'}><span class="sl-search-line1"><span class="sl-search-date">${shortDate(book)}</span><span class="sl-search-name">${marked(book.title, query)}</span></span><span class="sl-search-line2">${marked(line, query, true)}</span></a>`;
    }).join('')}</div>`;
    byId('live').textContent = `${hits.length}건 찾았어요`;
  }
  async function searchBody(query, id) {
    const request = new AbortController(); controller = request;
    try {
      const url = new URL('https://notion-search.wldnjsdkk.workers.dev/search');
      url.search = new URLSearchParams({ source: 'reading', q: query, w: instanceKey });
      const response = await fetch(url, { signal: request.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) return;
      const data = await response.json();
      if (id !== sequence || query !== input.value.trim() || !data.ok || !Array.isArray(data.results)) return;
      bodyHits = data.results; bodyTotal = Number(data.total) || 0; render();
    } catch { /* Body search is optional; preserve instant Store results. */ }
    finally { if (controller === request) controller = null; }
  }
  function run() {
    clearTimeout(timer); controller?.abort(); const id = ++sequence;
    bodyHits = []; bodyTotal = 0; render();
    const query = input.value.trim();
    if (query && /^w_[A-Za-z0-9_-]{24,176}$/.test(instanceKey)) timer = setTimeout(() => void searchBody(query, id), 300);
  }
  input.addEventListener('input', run);
  input.addEventListener('keydown', event => { if (event.key === 'Escape') { input.value = ''; run(); } if (event.key === 'Enter' && isComposing(event)) event.preventDefault(); });
  byId('form').addEventListener('submit', event => { event.preventDefault(); run(); });
  clear.addEventListener('click', () => { input.value = ''; run(); input.focus(); });
  watch(next => { state = next; render(); });
  window.addEventListener('pagehide', () => { clearTimeout(timer); ++sequence; controller?.abort(); });
  new ResizeObserver(render).observe(list);
}

({ 'new-book': newBook, bookshelf, 'reading-count': readingCount, 'book-search': bookSearch })[document.body.dataset.libraryWidget]?.();
