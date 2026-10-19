// 위젯 1. 핵심 모아보기: 오늘 이전·오늘 면담의 ★ 줄만 최신 면담 순으로. 높이에 들어가는 만큼만(스크롤·더 보기 없음).
// 누르면 아래 면담 기록 위젯에서 그 면담·주제·줄을 연다(면담 기록이 없으면 아무 표시 없음). 읽기 전용.
import { createNotesReader, watchMeetingNotes, onDayChange, requestOpen, escapeHtml, staleText, failureText, mobileQuery } from './feedback-common.mjs?v=20261019-feedback';
import { starItems, md, worklogToday, filled } from './feedback-model.mjs?v=20261019-feedback';

const ROW = 80;
const GAP = 8;
const app = document.getElementById('app');
const gridEl = document.getElementById('grid');
const messageEl = document.getElementById('message');
const noticeEl = document.getElementById('notice');
const reader = createNotesReader(render);
let shown = [];
let lastHtml = '';

function capacity() {
  const rows = Math.max(1, Math.floor((gridEl.clientHeight + GAP) / (ROW + GAP)));
  return rows * (mobileQuery() ? 1 : 3);
}

function render() {
  const notes = reader.notes;
  const items = notes ? starItems(notes, worklogToday()) : [];
  shown = items.slice(0, capacity());
  const html = shown.map((item, index) => {
    const meta = `${md(item.note.date)}${filled(item.note.who) ? ` · ${item.note.who}` : ''}`;
    return `<button class="fb-key" type="button" data-index="${index}"><span class="fb-key-text">${escapeHtml(item.line.t)}</span>`
      + `<span class="fb-key-meta">${escapeHtml(meta)}</span></button>`;
  }).join('');
  if (html !== lastHtml) { gridEl.innerHTML = html; lastHtml = html; }
  const message = !reader.loaded ? '불러오는 중이에요' : !notes ? failureText(reader.error) : !items.length ? '면담 기록에서 ☆를 누르면 여기에 모여요' : '';
  messageEl.textContent = message;
  messageEl.hidden = !message;
  noticeEl.textContent = notes && reader.error ? staleText(reader.error) : '';
  app.dataset.status = !reader.loaded ? 'loading' : !notes ? 'error' : reader.error ? 'stale' : 'ready';
  app.dataset.count = String(shown.length);
}

// 면담 기록이 응답하지 않으면 아무 표시 없이 넘어간다.
gridEl.addEventListener('click', event => {
  const item = shown[Number(event.target.closest('[data-index]')?.dataset.index)];
  if (item) requestOpen(item.note.id, item.line.id);
});
new ResizeObserver(() => render()).observe(gridEl);
onDayChange(render);
render();
reader.load();
watchMeetingNotes(() => reader.load());
