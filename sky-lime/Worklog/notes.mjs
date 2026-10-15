// ④ 메모: 기존 메모 데이터(Store.loadNotesState / patchNotesState) 재사용.
// 항목의 mode(work/life)로 나누며, mode가 없는 기존 메모는 업무로 본다.
import { getMode, onModeChange, modeToggleHtml, bindModeToggle, readNotes, watchNotes, patchNotes,
  makeId, escapeHtml, staleText, failureText, Store } from './sky-lime-common.mjs?v=20261015-sky-lime';
import { notesFor, notesHaveMode, MAX_NOTES, calendarToday } from './sky-lime-model.mjs?v=20261015-sky-lime';

const app = document.getElementById('app');
const listEl = document.getElementById('list');
const fullEl = document.getElementById('full');
const formEl = document.getElementById('addForm');
const inputEl = document.getElementById('addInput');
const toggleEl = document.getElementById('modeToggle');
const noticeEl = document.getElementById('notice');
const liveEl = document.getElementById('live');

let serverState = null;
let error = null;
let loaded = false;
let running = false;
let reloadAfter = false;
let readSeq = 0;
let cleanedDay = '';
let lastHtml = '';
const queue = [];
const view = () => serverState ? queue.reduce((state, op) => op.apply(state), serverState) : null;
const readOnly = () => !serverState || Boolean(error);
const mapItem = (state, id, change) => ({ ...state, items:(state.items || []).map(item => item.id === id ? change(item) : item) });

async function load() {
  if (running || queue.length) { reloadAfter = true; return; }
  const seq = ++readSeq;
  try {
    const result = await readNotes();
    if (seq !== readSeq) return;
    if (running || queue.length) { reloadAfter = true; return; }
    serverState = result.data;
    error = result.error || null;
    // 기존 메모 위젯과 같은 규칙: 하루 한 번, 지난날 완료한 메모를 서버에서 정리한다.
    const day = calendarToday();
    if (!error && cleanedDay !== day && typeof Store.patchNotesState === 'function') {
      cleanedDay = day;
      try {
        const cleaned = await Store.patchNotesState({ cleanupCompleted:true });
        if (running || queue.length) reloadAfter = true;
        else if (cleaned && Array.isArray(cleaned.items)) serverState = cleaned;
      } catch (failure) { console.warn('메모는 불러왔지만 완료 항목을 정리하지 못했습니다.', failure); }
    }
  } catch (failure) {
    if (seq !== readSeq) return;
    console.warn('메모를 불러오지 못했습니다.', failure);
    error = failure;
  }
  loaded = true;
  render();
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const op = queue[0];
    try { serverState = await op.send(); }
    catch (failure) {
      console.warn('메모를 저장하지 못했습니다.', failure);
      liveEl.textContent = '저장하지 못했어요. 다시 시도해 주세요.';
      reloadAfter = true;
    }
    queue.shift();
    render();
  }
  running = false;
  readSeq += 1;
  if (reloadAfter) { reloadAfter = false; await load(); }
}

function submit(op) {
  if (readOnly()) { liveEl.textContent = '연결이 돌아오면 저장할 수 있어요.'; return false; }
  queue.push(op);
  render();
  pump();
  return true;
}

function rowHtml(item) {
  const done = item.done === true;
  const text = escapeHtml(item.text);
  return `<div class="sl-note${done ? ' is-done' : ''}" data-note-id="${escapeHtml(item.id)}">`
    + `<button class="sl-check${done ? ' is-on' : ''}" type="button" role="checkbox" aria-checked="${done}" data-toggle="${escapeHtml(item.id)}" aria-label="${done ? '완료 취소' : '완료 표시'}: ${text}"><span class="sl-check-box"></span></button>`
    + `<span class="sl-note-text" title="${text}">${text}</span>`
    + `<button class="sl-delete" type="button" data-delete="${escapeHtml(item.id)}" aria-label="메모 삭제: ${text}">✕</button></div>`;
}

function render() {
  const mode = getMode();
  toggleEl.innerHTML = modeToggleHtml(mode);
  inputEl.placeholder = '메모 추가...';
  const state = view();
  noticeEl.textContent = state && error ? staleText(error) : '';
  app.dataset.status = !loaded ? 'loading' : !state ? 'error' : error ? 'stale' : 'ready';
  app.dataset.mode = mode;
  let html;
  let full = false;
  let hidden = 0;
  if (!state) html = `<p class="sl-message">${escapeHtml(loaded ? failureText(error) : '불러오는 중이에요')}</p>`;
  else {
    const items = notesFor(state, mode, notesHaveMode(serverState));
    full = items.length >= MAX_NOTES;
    hidden = Math.max(0, items.length - MAX_NOTES);
    html = items.length ? items.slice(0, MAX_NOTES).map(rowHtml).join('') : '<p class="sl-message">메모가 없어요</p>';
  }
  if (html !== lastHtml) { listEl.innerHTML = html; lastHtml = html; }
  // 기존 위젯에서 8개를 넘게 적어 둔 경우, 보이지 않는 개수를 안내문 끝에 붙인다.
  fullEl.textContent = `완료한 메모를 지우면 추가할 수 있어요${hidden ? ` · 외 ${hidden}개` : ''}`;
  fullEl.hidden = !state || !full;
  formEl.hidden = !state || full;
}

function addNote() {
  const text = inputEl.value.trim();
  if (!text) return;
  const mode = getMode();
  const current = notesFor(view(), mode, notesHaveMode(serverState));
  if (current.length >= MAX_NOTES) return;
  const item = { id:makeId(), text, done:false, doneAt:null, mode };
  const accepted = submit({
    apply:state => ({ ...state, items:[...(state.items || []), item] }),
    send:() => patchNotes({ updates:[{ id:item.id, create:true, changes:{ text, mode, done:false } }] })
  });
  if (accepted) inputEl.value = '';
}

formEl.addEventListener('submit', event => { event.preventDefault(); addNote(); });
inputEl.addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter') { event.preventDefault(); addNote(); }
});

app.addEventListener('click', event => {
  const check = event.target.closest('[data-toggle]');
  if (check) {
    const item = (view()?.items || []).find(note => note.id === check.dataset.toggle);
    if (!item) return;
    const done = item.done !== true;
    submit({
      apply:state => mapItem(state, item.id, note => ({ ...note, done, doneAt:done ? calendarToday() : null })),
      send:() => patchNotes({ updates:[{ id:item.id, create:false, changes:{ done } }] })
    });
    return;
  }
  const remove = event.target.closest('[data-delete]');
  if (remove) {
    const id = remove.dataset.delete;
    const row = remove.closest('.sl-note');
    const run = () => submit({
      apply:state => ({ ...state, items:(state.items || []).filter(note => note.id !== id) }),
      send:() => patchNotes({ deleteIds:[id] })
    });
    if (readOnly()) { run(); return; }
    if (window.widgetMotion?.close && row) window.widgetMotion.close(row, run);
    else run();
  }
});

new ResizeObserver(() => app.classList.toggle('is-narrow', app.clientWidth < 280)).observe(app);
bindModeToggle(app);
onModeChange(render);
render();
load();
watchNotes(load);
