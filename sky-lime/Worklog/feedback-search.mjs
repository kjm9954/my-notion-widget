// 위젯 2. 피드백 검색: 입력하면 바로(Enter도) 찾는다. 들은 말 → 내가 할 말 → 주제명 → 할 일 → 면담 제목·준 사람 순으로
// 면담당 첫 번째로 찾은 것 1개, 면담 날짜 최신순 최대 3개. 검색은 Store로 읽은 데이터를 화면에서 계산한다(서버 검색 API 없음).
// 결과를 누르면 아래 면담 기록 위젯에서 연다. 1초 안에 응답이 없으면 회색 한 줄 "아래 면담 기록에서 열 수 없어요".
import { createNotesReader, watchMeetingNotes, requestOpen, escapeHtml, staleText, failureText } from './feedback-common.mjs?v=20261019-feedback';
import { searchNotes, segments, snippet, resultTitle, resultLine, md, foldQuery, SEARCH_LIMIT } from './feedback-model.mjs?v=20261019-feedback';

const app = document.getElementById('app');
const form = document.getElementById('form');
const queryEl = document.getElementById('query');
const clearEl = document.getElementById('clear');
const resultsEl = document.getElementById('results');
const moreEl = document.getElementById('more');
const noticeEl = document.getElementById('notice');
const reader = createNotesReader(render);
let shown = [];
let noLink = false;
let lastHtml = '';

const bolded = parts => parts.map(part => (part.bold ? `<b>${escapeHtml(part.t)}</b>` : escapeHtml(part.t))).join('');
const message = (text, extra = '') => `<p class="fb-message${extra}">${escapeHtml(text)}</p>`;

function render() {
  const query = queryEl.value;
  const active = Boolean(foldQuery(query));
  const notes = reader.notes;
  const hits = active && notes ? searchNotes(notes, query) : [];
  shown = noLink ? [] : hits.slice(0, SEARCH_LIMIT);
  let html;
  if (!active) html = message(reader.loaded && !notes ? failureText(reader.error) : '면담 내용이나 준 사람으로 찾아보세요');
  else if (noLink) html = message('아래 면담 기록에서 열 수 없어요', ' is-nolink');
  else if (!notes) html = message(reader.loaded ? failureText(reader.error) : '불러오는 중이에요');
  else if (!hits.length) html = message('찾는 내용이 없어요');
  else {
    html = shown.map((result, index) => {
      const line = resultLine(result);
      const cut = snippet(line.text, query);
      return `<button class="fb-result" type="button" data-index="${index}">`
        + `<span class="fb-line1"><span class="fb-date">${md(result.note.date)}</span><span class="fb-name">${bolded(segments(resultTitle(result.note), query))}</span></span>`
        + `<span class="fb-line2">${result.hit?.key ? '<span class="fb-star">★ </span>' : ''}${escapeHtml(line.prefix)}${bolded(segments(cut.text, query))}</span></button>`;
    }).join('');
  }
  if (html !== lastHtml) { resultsEl.innerHTML = html; lastHtml = html; }
  moreEl.hidden = noLink || hits.length <= SEARCH_LIMIT;
  clearEl.hidden = !query;
  noticeEl.textContent = notes && reader.error ? staleText(reader.error) : '';
  app.dataset.status = !reader.loaded ? 'loading' : !notes ? 'error' : reader.error ? 'stale' : 'ready';
  app.dataset.count = String(shown.length);
}

queryEl.addEventListener('input', () => { noLink = false; render(); });
form.addEventListener('submit', event => { event.preventDefault(); noLink = false; render(); });
clearEl.addEventListener('click', () => { queryEl.value = ''; noLink = false; render(); queryEl.focus(); });
resultsEl.addEventListener('click', async event => {
  const result = shown[Number(event.target.closest('[data-index]')?.dataset.index)];
  if (!result) return;
  const opened = await requestOpen(result.note.id, result.hit?.lineId || null);
  if (!opened) { noLink = true; render(); }
});
render();
reader.load();
watchMeetingNotes(() => reader.load());
