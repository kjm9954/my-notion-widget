// 위젯 3. 면담 기록: 목록(다음 면담 + 지난 면담, 들어가는 만큼만) + 맨 아래 제목 입력 줄 + 위젯 안 상세 팝업(주제 하나씩 · 할 일 화면).
// 저장은 면담 1개 단위 자동 저장(글자는 입력이 1초 멈추면, ★·체크·삭제는 바로, 닫을 때 정리 후). 서버 버전과 비교해 덮어쓰지 않는다.
// 다른 곳에서 먼저 바뀌었으면(버전 충돌) 최신 내용을 받고, ★·할 일 체크·줄/할 일 삭제는 그 위에 다시 적용해 저장한다.
// 글자 수정은 다시 적용하지 않고 팝업 아래에 다시 입력 안내를 잠깐 보여준다.
import { Store, createNotesReader, watchMeetingNotes, onDayChange, onOpenRequest, escapeHtml, staleText, failureText, makeId,
  isEnter, isComposing } from './feedback-common.mjs?v=20261019-feedback';
import { listRows, md, worklogToday, filled, noteStats, whoSuggestions, topicIndexOf, cleanupNote, newNote, sameContent,
  applySimpleOps, SIMPLE_OPS, TEXT_MAX } from './feedback-model.mjs?v=20261019-feedback';

const ROW = 48;
const ROW_GAP = 6;
const LINE = 28;
const TODO = 34;
const HIGHLIGHT_MS = 1500;
const TEXT_DELAY = 1000;
const ACTION_DELAY = 200;
const CONFLICT_TEXT = '최신 내용으로 바뀌었어요 · 고친 글자는 다시 입력해 주세요';

const app = document.getElementById('app');
const listEl = document.getElementById('list');
const noticeEl = document.getElementById('notice');
const titleInput = document.getElementById('titleInput');
const addButton = document.getElementById('addButton');
const layer = document.getElementById('layer');
const pop = document.getElementById('pop');
const reader = createNotesReader(onServer);

// 면담마다 편집기 하나: base = 서버가 확인한 마지막 버전, draft = 화면 내용, ops = 아직 저장 안 된 동작.
const editors = new Map();
const removed = new Set();
const ui = { openId:null, view:'topic', ti:0, hl:null, hlTimer:0, cap:99, tcap:99, sug:false, armed:false, armTimer:0, notice:'', noticeTimer:0 };
let swapping = false;
let lastList = '';
let lastLocked = null;
let shownIds = [];

const locked = () => !reader.notes || Boolean(reader.error);
const serverNote = id => (reader.notes || []).find(note => note.id === id) || null;
const current = () => (ui.openId ? editors.get(ui.openId) || null : null);
function viewNotes() {
  const byId = new Map((reader.notes || []).map(note => [note.id, note]));
  for (const editor of editors.values()) if (!editor.deleted) byId.set(editor.id, editor.draft);
  return [...byId.values()].filter(note => !removed.has(note.id));
}

// ───────── 저장 ─────────
function editorFor(note) {
  let editor = editors.get(note.id);
  if (!editor) {
    editor = { id:note.id, base:structuredClone(note), draft:structuredClone(note), ops:[], seq:0, timer:0, inflight:null, again:false, retry:0, deleted:false };
    editors.set(note.id, editor);
  }
  return editor;
}
const payload = note => ({ id:note.id, date:note.date, title:note.title, who:note.who, topics:note.topics, todos:note.todos });
function schedule(editor, delay) {
  clearTimeout(editor.timer);
  editor.timer = setTimeout(() => flush(editor), delay);
}
function conflictNote(error) {
  try { return JSON.parse(error.responseText || '{}').note ?? null; } catch (_) { return null; }
}
async function flush(editor) {
  clearTimeout(editor.timer);
  editor.timer = 0;
  if (editor.deleted) return;
  if (editor.inflight) { editor.again = true; return; }
  if (!editor.ops.length) { finish(editor); return; }
  const upto = editor.seq;
  const baseRev = editor.base.rev || 0;
  editor.inflight = Store.saveMeetingNote(payload(editor.draft), baseRev);
  try {
    const data = await editor.inflight;
    editor.base = data.note;
    editor.draft.rev = data.note.rev;
    editor.ops = editor.ops.filter(op => op.seq > upto);
    editor.retry = 0;
  } catch (error) {
    if (error?.status === 409) resolveConflict(editor, conflictNote(error));
    else {
      console.warn('면담 기록을 저장하지 못했습니다.', error);
      editor.retry += 1;
      // 연결이 잠깐 끊긴 경우만 다시 시도한다(서버 한도 대기 중이면 다음 입력·닫기 때).
      if (editor.retry <= 2 && !error?.serverBackoff) editor.again = true;
    }
  } finally {
    editor.inflight = null;
    if (editor.again) { editor.again = false; schedule(editor, editor.retry ? 3000 : 50); }
    else if (editor.ops.length && !editor.timer && !editor.retry) schedule(editor, 300);
    else finish(editor);
    renderList();
  }
}
// 닫힌 면담은 남은 저장이 끝나면 편집기를 정리한다.
function finish(editor) {
  if (ui.openId !== editor.id && !editor.inflight && !editor.ops.length && !editor.timer) editors.delete(editor.id);
}
function resolveConflict(editor, latest) {
  const simple = editor.ops.filter(op => SIMPLE_OPS.includes(op.type));
  const hadText = editor.ops.some(op => !SIMPLE_OPS.includes(op.type));
  if (!latest) {
    // 다른 곳에서 지운 면담: 따라서 지운다(다음 확인 전에도 목록에서 바로 뺀다).
    editor.deleted = true;
    editors.delete(editor.id);
    removed.add(editor.id);
    if (ui.openId === editor.id) hidePop();
    reader.load();
    return;
  }
  editor.base = latest;
  editor.draft = applySimpleOps(latest, simple);
  editor.ops = sameContent(editor.draft, latest) ? [] : simple.map(op => ({ ...op, seq:++editor.seq }));
  if (editor.ops.length) editor.again = true;
  if (ui.openId === editor.id) {
    ui.ti = Math.min(ui.ti, editor.draft.topics.length - 1);
    if (hadText) showNotice(CONFLICT_TEXT);
    renderPop();
  }
  reader.load();
}
function change(op, mutate, { delay = TEXT_DELAY, rerender = false } = {}) {
  const editor = current();
  if (!editor || editor.deleted || locked()) return;
  mutate(editor.draft);
  editor.ops.push({ type:'text', ...op, seq:++editor.seq });
  schedule(editor, delay);
  if (rerender) renderPop();
  renderList();
}
function showNotice(text) {
  ui.notice = text;
  clearTimeout(ui.noticeTimer);
  ui.noticeTimer = setTimeout(() => { ui.notice = ''; const el = pop.querySelector('.fb-conflict'); if (el) el.textContent = ''; }, 6000);
}

// ───────── 서버 변경 반영 ─────────
function onServer() {
  for (const editor of [...editors.values()]) {
    if (editor.inflight || editor.ops.length || editor.timer || editor.deleted) continue;
    const server = serverNote(editor.id);
    if (!server) {
      if ((editor.base.rev || 0) > 0 && reader.notes && !reader.error) { editors.delete(editor.id); if (ui.openId === editor.id) hidePop(); }
      continue;
    }
    if ((server.rev || 0) > (editor.base.rev || 0)) {
      editor.base = structuredClone(server);
      editor.draft = structuredClone(server);
      if (ui.openId === editor.id) { ui.ti = Math.min(ui.ti, editor.draft.topics.length - 1); renderPop(); }
    }
    finish(editor);
  }
  render();
}

// ───────── 목록 ─────────
function renderList() {
  const notes = viewNotes();
  const fit = Math.max(0, Math.floor((listEl.clientHeight + ROW_GAP) / (ROW + ROW_GAP)));
  const rows = listRows(notes, worklogToday(), fit);
  shownIds = rows.map(row => row.note.id);
  let html;
  if (!reader.loaded) html = '<p class="fb-message">불러오는 중이에요</p>';
  else if (!reader.notes) html = `<p class="fb-message">${escapeHtml(failureText(reader.error))}</p>`;
  else if (!notes.length) html = '<p class="fb-message">면담이 끝나면 들은 내용을 적어 두세요</p>';
  else {
    html = rows.map(row => `<button class="fb-row${row.next ? ' is-next' : ''}" type="button" data-id="${escapeHtml(row.note.id)}">`
      + `<span class="fb-row-date">${md(row.note.date)}</span>${row.next ? '<span class="fb-next">다음</span>' : ''}`
      + `<span class="fb-row-title">${escapeHtml(filled(row.note.title) ? row.note.title : '(제목 없음)')}</span>`
      + `${row.stars ? `<span class="fb-row-stars">★ ${row.stars}</span>` : ''}${row.todosLeft ? `<span class="fb-row-todo">할 일 ${row.todosLeft}</span>` : ''}</button>`).join('');
  }
  if (html !== lastList) { listEl.innerHTML = html; lastList = html; }
}
function render() {
  renderList();
  const blocked = locked();
  titleInput.disabled = blocked;
  addButton.disabled = blocked;
  noticeEl.textContent = reader.notes && reader.error ? staleText(reader.error) : '';
  app.dataset.status = !reader.loaded ? 'loading' : !reader.notes ? 'error' : reader.error ? 'stale' : 'ready';
  app.dataset.count = String(shownIds.length);
  // 팝업은 읽기 전용 여부가 바뀔 때만 다시 그린다(입력 중 한글 조합이 끊기지 않게). 서버 내용 반영은 onServer에서.
  if (ui.openId && blocked !== lastLocked) renderPop();
  lastLocked = blocked;
}

// ───────── 상세 팝업 ─────────
const attr = value => escapeHtml(value ?? '');
function topicHtml(note, ro) {
  const ti = Math.min(ui.ti, note.topics.length - 1);
  const topic = note.topics[ti];
  const many = note.topics.length > 1;
  const todos = note.todos.filter(todo => filled(todo.t));
  const left = todos.filter(todo => !todo.done).length;
  const lines = topic.lines.slice(0, ui.cap);
  const hidden = topic.lines.length - lines.length;
  const full = topic.lines.length >= ui.cap;
  const dis = ro ? ' disabled' : '';
  const roAttr = ro ? ' readonly' : '';
  const lineHtml = lines.map(line => `<div class="fb-line${line.key ? ' is-key' : ''}${ui.hl === line.id ? ' is-hl' : ''}" data-line="${attr(line.id)}">`
    + `<button class="fb-mark" type="button" data-act="star" aria-label="핵심 표시" aria-pressed="${line.key}"${dis}>${line.key ? '★' : '·'}</button>`
    + `<input class="fb-line-input" type="text" data-f="line:${attr(line.id)}" value="${attr(line.t)}" placeholder="들은 말" maxlength="${TEXT_MAX.line}" aria-label="들은 말" autocomplete="off"${roAttr}>`
    + `<button class="fb-x" type="button" data-act="line-x" aria-label="줄 삭제"${dis}>✕</button></div>`).join('');
  const more = full
    ? `<button class="fb-more-line is-full" type="button" data-act="add-topic"${dis}>${hidden > 0 ? `외 ${hidden}줄 · ` : ''}+ 주제로 나눠 적어요</button>`
    : `<button class="fb-more-line" type="button" data-act="add-line"${dis}>+ 들은 말</button>`;
  return `<div class="fb-pop-head">`
    + `<input class="fb-pop-title" type="text" data-f="title" value="${attr(note.title)}" placeholder="면담 제목" maxlength="${TEXT_MAX.title}" aria-label="면담 제목" autocomplete="off"${roAttr}>`
    + `<button class="fb-todo-button${todos.length && left ? ' is-left' : ''}" type="button" data-act="todo">${todos.length ? `할 일 ${left}/${todos.length}` : '+ 할 일'}</button>`
    + `<button class="fb-close" type="button" data-act="close" aria-label="닫기">✕</button></div>`
    + `<div class="fb-meta"><input class="fb-date-input" type="date" data-f="date" value="${attr(note.date)}" aria-label="면담 날짜"${roAttr}><span>·</span>`
    + `<div class="fb-who-wrap"><input class="fb-who" type="text" data-f="who" value="${attr(note.who)}" placeholder="준 사람" maxlength="${TEXT_MAX.who}" aria-label="준 사람" autocomplete="off"${roAttr}>`
    + `<div class="fb-sug" id="sug" hidden></div></div></div>`
    + `<div class="fb-topic${many && !ro ? ' can-delete' : ''}">`
    + `<input class="fb-topic-name" type="text" data-f="h:${attr(topic.id)}" value="${attr(topic.h)}" placeholder="주제" maxlength="${TEXT_MAX.h}" aria-label="주제" autocomplete="off"${roAttr}>`
    + (many ? `<button class="fb-topic-del" type="button" data-act="topic-del"${dis}>삭제</button>`
      + `<div class="fb-pager"><button type="button" data-act="prev" aria-label="이전 주제"${ti > 0 ? '' : ' disabled'}>‹</button><span>${ti + 1} / ${note.topics.length}</span>`
      + `<button type="button" data-act="next" aria-label="다음 주제"${ti < note.topics.length - 1 ? '' : ' disabled'}>›</button></div>` : '')
    + `</div><div class="fb-say"><span class="fb-say-label">내가 할 말</span>`
    + `<input class="fb-say-input" type="text" data-f="say:${attr(topic.id)}" value="${attr(topic.say)}" placeholder="면담 전에 꺼낼 말 (선택)" maxlength="${TEXT_MAX.say}" aria-label="내가 할 말" autocomplete="off"${roAttr}></div>`
    + `<div class="fb-lines">${lineHtml}${more}</div>`
    + `<div class="fb-foot"><button class="fb-plus" type="button" data-act="add-topic"${dis}>+ 주제</button><span class="fb-conflict">${escapeHtml(ui.notice)}</span>`
    + `<button class="fb-delete-note${ui.armed ? ' is-armed' : ''}" type="button" data-act="del-note"${dis}>${ui.armed ? '정말 삭제?' : '기록 삭제'}</button></div>`;
}
function todoHtml(note, ro) {
  const todos = note.todos.slice(0, ui.tcap);
  const dis = ro ? ' disabled' : '';
  const roAttr = ro ? ' readonly' : '';
  const rows = todos.map(todo => `<div class="fb-todo${todo.done ? ' is-done' : ''}" data-todo="${attr(todo.id)}">`
    + `<button class="sl-check${todo.done ? ' is-on' : ''}" type="button" data-act="check" aria-label="완료" aria-pressed="${todo.done}"${dis}><span class="sl-check-box"></span></button>`
    + `<input class="fb-todo-input" type="text" data-f="todo:${attr(todo.id)}" value="${attr(todo.t)}" placeholder="할 일" maxlength="${TEXT_MAX.todo}" aria-label="할 일" autocomplete="off"${roAttr}>`
    + `<button class="fb-x" type="button" data-act="todo-x" aria-label="할 일 삭제"${dis}>✕</button></div>`).join('');
  return `<div class="fb-pop-head"><button class="fb-back" type="button" data-act="back"><span class="fb-back-arrow">←</span>할 일</button>`
    + `<button class="fb-close" type="button" data-act="close" aria-label="닫기">✕</button></div>`
    + `<span class="fb-sub">${escapeHtml(filled(note.title) ? note.title : '(제목 없음)')}</span>`
    + `<div class="fb-todos">${rows}${note.todos.length < ui.tcap ? `<button class="fb-plus" type="button" data-act="add-todo"${dis}>+ 할 일</button>` : ''}</div>`;
}
// 다시 그려도 입력 중인 칸의 포커스·커서는 그대로 둔다.
function renderPop() {
  const editor = current();
  if (!editor) return;
  const active = document.activeElement;
  const key = pop.contains(active) ? active.dataset.f : null;
  const range = key && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  swapping = true;
  pop.innerHTML = ui.view === 'todo' ? todoHtml(editor.draft, locked()) : topicHtml(editor.draft, locked());
  swapping = false;
  if (key) focusField(key, range);
  if (ui.sug) renderSug();
  measure();
}
function focusField(key, range = null) {
  const input = [...pop.querySelectorAll('[data-f]')].find(node => node.dataset.f === key);
  if (!input) return;
  input.focus();
  if (input.type === 'text') {
    const end = input.value.length;
    try { input.setSelectionRange(range ? range[0] : end, range ? range[1] : end); } catch (_) {}
  }
}
// 들어가는 줄 수: 들은 말 영역 높이 ÷ 28px(마지막 한 줄은 "+ 들은 말" 자리), 할 일 영역 ÷ 34px(+ 할 일 32px).
function measure() {
  if (layer.hidden) return;
  if (ui.view === 'topic') {
    const area = pop.querySelector('.fb-lines');
    const cap = area ? Math.max(1, Math.floor(area.clientHeight / LINE) - 1) : ui.cap;
    if (cap !== ui.cap) { ui.cap = cap; renderPop(); }
  } else {
    const area = pop.querySelector('.fb-todos');
    const cap = area ? Math.max(1, Math.floor((area.clientHeight - 32) / TODO)) : ui.tcap;
    if (cap !== ui.tcap) { ui.tcap = cap; renderPop(); }
  }
}
function renderSug() {
  const box = pop.querySelector('#sug');
  const editor = current();
  if (!box || !editor) return;
  const names = ui.sug && !locked() ? whoSuggestions(viewNotes(), editor.id, editor.draft.who) : [];
  box.innerHTML = names.map((name, index) => `<button class="fb-sug-item${index === 0 && filled(editor.draft.who) ? ' is-first' : ''}" type="button" data-sug="${attr(name)}">${escapeHtml(name)}</button>`).join('');
  box.hidden = !names.length;
}

function openNote(id, { lineId = null, highlight = false, focusLine = null } = {}) {
  const note = viewNotes().find(item => item.id === id);
  if (!note) return false;
  if (ui.openId && ui.openId !== id) closePop();
  const editor = editorFor(note);
  Object.assign(ui, { openId:id, view:'topic', ti:topicIndexOf(editor.draft, lineId), hl:highlight ? lineId : null, sug:false, armed:false, notice:'' });
  clearTimeout(ui.hlTimer);
  layer.hidden = false;
  renderPop();
  if (highlight && lineId) {
    ui.hlTimer = setTimeout(() => { ui.hl = null; pop.querySelector('.fb-line.is-hl')?.classList.remove('is-hl'); }, HIGHLIGHT_MS);
  }
  if (focusLine) focusField(`line:${focusLine}`);
  return true;
}
function hidePop() {
  ui.openId = null;
  ui.sug = false;
  ui.armed = false;
  layer.hidden = true;
  pop.innerHTML = '';
  clearTimeout(ui.hlTimer);
}
// 닫을 때 정리(빈 줄·빈 할 일·빈 주제) 후 저장. 저장은 뒤에서 이어서 한다.
function closePop() {
  const editor = current();
  if (!editor) return;
  if (!editor.deleted && !locked()) {
    const cleaned = cleanupNote(editor.draft, makeId);
    if (!sameContent(cleaned, editor.draft)) {
      editor.draft = cleaned;
      editor.ops.push({ type:'text', seq:++editor.seq });
    }
  }
  hidePop();
  if (editor.ops.length || editor.timer) flush(editor);
  else finish(editor);
  renderList();
}
async function deleteNote() {
  const editor = current();
  if (!editor || locked()) return;
  if (!ui.armed) {
    ui.armed = true;
    clearTimeout(ui.armTimer);
    ui.armTimer = setTimeout(() => { ui.armed = false; if (ui.openId === editor.id) renderPop(); }, 2000);
    renderPop();
    return;
  }
  clearTimeout(ui.armTimer);
  editor.deleted = true;
  clearTimeout(editor.timer);
  removed.add(editor.id);
  hidePop();
  renderList();
  try {
    if (editor.inflight) await editor.inflight.catch(() => {});
    if ((editor.base.rev || 0) > 0) await Store.deleteMeetingNote(editor.id, editor.base.rev);
  } catch (error) {
    console.warn('면담 기록을 지우지 못했습니다.', error);
    removed.delete(editor.id);
    reader.load();
  } finally {
    editors.delete(editor.id);
    renderList();
  }
}
function addNote() {
  const title = titleInput.value.trim();
  if (!title || locked()) return;
  const note = newNote(makeId(), title, worklogToday(), makeId);
  const editor = editorFor(note);
  editor.ops.push({ type:'text', seq:++editor.seq });
  titleInput.value = '';
  openNote(note.id, { focusLine:note.topics[0].lines[0].id });
  flush(editor);
}

// ───────── 팝업 입력 ─────────
const topicOf = (note, id) => note.topics.find(topic => topic.id === id);
const lineOf = (note, id) => note.topics.flatMap(topic => topic.lines).find(line => line.id === id);
const currentTopic = note => note.topics[Math.min(ui.ti, note.topics.length - 1)];
function newLineAfter(lineId) {
  const id = makeId();
  change({}, note => {
    const topic = currentTopic(note);
    const at = lineId ? topic.lines.findIndex(line => line.id === lineId) + 1 : topic.lines.length;
    topic.lines.splice(at, 0, { id, t:'', key:false });
  }, { rerender:true });
  focusField(`line:${id}`);
}
function addTopic() {
  const topic = { id:makeId(), h:'', say:'', lines:[{ id:makeId(), t:'', key:false }] };
  change({}, note => { note.topics.push(topic); });
  ui.ti = current().draft.topics.length - 1;
  renderPop();
  focusField(`h:${topic.id}`);
}
function newTodoAfter(todoId) {
  const id = makeId();
  change({}, note => {
    const at = todoId ? note.todos.findIndex(todo => todo.id === todoId) + 1 : note.todos.length;
    note.todos.splice(at, 0, { id, t:'', done:false });
  }, { rerender:true });
  focusField(`todo:${id}`);
}
function dropLine(lineId, focusPrevious = false) {
  const note = current()?.draft;
  if (!note) return;
  const topic = currentTopic(note);
  const at = topic.lines.findIndex(line => line.id === lineId);
  const previous = topic.lines[Math.max(0, at - 1)]?.id;
  const spareId = makeId();
  change({ type:'dropLine', lineId, spareId }, draft => {
    const target = draft.topics.find(item => item.lines.some(line => line.id === lineId));
    if (!target) return;
    target.lines = target.lines.filter(line => line.id !== lineId);
    if (!target.lines.length) target.lines = [{ id:spareId, t:'', key:false }];
  }, { delay:ACTION_DELAY, rerender:true });
  if (focusPrevious && previous && previous !== lineId) focusField(`line:${previous}`);
}

pop.addEventListener('input', event => {
  const key = event.target.dataset?.f;
  if (!key || key === 'date') return;
  const value = event.target.value;
  const [kind, id] = key.split(':');
  change({}, note => {
    if (kind === 'title') note.title = value;
    else if (kind === 'who') note.who = value;
    else if (kind === 'h') { const topic = topicOf(note, id); if (topic) topic.h = value; }
    else if (kind === 'say') { const topic = topicOf(note, id); if (topic) topic.say = value; }
    else if (kind === 'line') { const line = lineOf(note, id); if (line) line.t = value; }
    else if (kind === 'todo') { const todo = note.todos.find(item => item.id === id); if (todo) todo.t = value; }
  });
  if (kind === 'who') { ui.sug = true; renderSug(); }
});
pop.addEventListener('change', event => {
  if (event.target.dataset?.f !== 'date') return;
  const value = event.target.value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) change({}, note => { note.date = value; }, { rerender:true });
  else renderPop();
});
pop.addEventListener('keydown', event => {
  const key = event.target.dataset?.f || '';
  const [kind, id] = key.split(':');
  if (event.key === 'Escape') return; // 닫기는 아래 문서 단위 처리
  if (isComposing(event)) return;
  if (kind === 'line') {
    const topic = currentTopic(current().draft);
    if (event.key === 'Enter') { event.preventDefault(); if (topic.lines.length < ui.cap && !locked()) newLineAfter(id); }
    else if (event.key === 'Backspace' && !event.target.value && topic.lines.length > 1 && !locked()) { event.preventDefault(); dropLine(id, true); }
  } else if (kind === 'todo' && isEnter(event)) {
    event.preventDefault();
    if (current().draft.todos.length < ui.tcap && !locked()) newTodoAfter(id);
  } else if (kind === 'who' && isEnter(event)) {
    const first = pop.querySelector('#sug:not([hidden]) [data-sug]');
    if (first) { event.preventDefault(); pickWho(first.dataset.sug); }
  } else if ((kind === 'title' || kind === 'h' || kind === 'say') && isEnter(event)) {
    event.preventDefault();
    event.target.blur();
  }
});
function pickWho(name) {
  change({}, note => { note.who = name; });
  ui.sug = false;
  const input = pop.querySelector('[data-f="who"]');
  if (input) input.value = name;
  renderSug();
}
pop.addEventListener('focusin', event => { if (event.target.dataset?.f === 'who') { ui.sug = true; renderSug(); } });
pop.addEventListener('focusout', event => {
  if (swapping || event.target.dataset?.f !== 'who') return;
  setTimeout(() => { if (document.activeElement?.dataset?.f !== 'who') { ui.sug = false; renderSug(); } }, 120);
});
// 자동완성 항목은 누르는 순간 고른다(입력 칸이 먼저 닫히지 않게).
pop.addEventListener('mousedown', event => {
  const item = event.target.closest('[data-sug]');
  if (item) { event.preventDefault(); pickWho(item.dataset.sug); }
});
pop.addEventListener('click', event => {
  const button = event.target.closest('[data-act]');
  if (!button || button.disabled) return;
  const act = button.dataset.act;
  const editor = current();
  if (!editor) return;
  const lineId = button.closest('[data-line]')?.dataset.line;
  const todoId = button.closest('[data-todo]')?.dataset.todo;
  if (act === 'close') closePop();
  else if (act === 'todo') { ui.view = 'todo'; ui.sug = false; renderPop(); }
  else if (act === 'back') { ui.view = 'topic'; renderPop(); }
  else if (act === 'prev' || act === 'next') { ui.ti = Math.max(0, Math.min(editor.draft.topics.length - 1, ui.ti + (act === 'next' ? 1 : -1))); renderPop(); }
  else if (act === 'topic-del') {
    const at = Math.min(ui.ti, editor.draft.topics.length - 1);
    change({}, note => { if (note.topics.length > 1) note.topics.splice(at, 1); });
    ui.ti = Math.max(0, at - 1);
    renderPop();
  } else if (act === 'star') {
    const line = lineOf(editor.draft, lineId);
    if (line) change({ type:'star', lineId, value:!line.key }, () => { line.key = !line.key; }, { delay:ACTION_DELAY, rerender:true });
  } else if (act === 'line-x') dropLine(lineId);
  else if (act === 'add-line') newLineAfter(null);
  else if (act === 'add-topic') addTopic();
  else if (act === 'del-note') deleteNote();
  else if (act === 'check') {
    const todo = editor.draft.todos.find(item => item.id === todoId);
    if (todo) change({ type:'check', todoId, value:!todo.done }, () => { todo.done = !todo.done; }, { delay:ACTION_DELAY, rerender:true });
  } else if (act === 'todo-x') change({ type:'dropTodo', todoId }, note => { note.todos = note.todos.filter(item => item.id !== todoId); }, { delay:ACTION_DELAY, rerender:true });
  else if (act === 'add-todo') newTodoAfter(null);
});
// 모바일: 줄·할 일을 왼쪽으로 밀면 삭제
let swipe = null;
pop.addEventListener('pointerdown', event => {
  const row = event.target.closest('.fb-line, .fb-todo');
  if (!row || event.pointerType !== 'touch' || locked()) return;
  swipe = { row, x:event.clientX, y:event.clientY, dx:0, id:event.pointerId };
});
pop.addEventListener('pointermove', event => {
  if (!swipe || event.pointerId !== swipe.id) return;
  swipe.dx = Math.min(0, event.clientX - swipe.x);
  if (Math.abs(event.clientY - swipe.y) > 24) { swipe.row.style.transform = ''; swipe = null; return; }
  swipe.row.style.transform = `translateX(${swipe.dx}px)`;
});
const endSwipe = event => {
  if (!swipe || event.pointerId !== swipe.id) return;
  const { row, dx } = swipe;
  swipe = null;
  row.style.transform = '';
  if (dx > -64) return;
  if (row.dataset.line) dropLine(row.dataset.line);
  else if (row.dataset.todo) change({ type:'dropTodo', todoId:row.dataset.todo }, note => { note.todos = note.todos.filter(item => item.id !== row.dataset.todo); }, { delay:ACTION_DELAY, rerender:true });
};
pop.addEventListener('pointerup', endSwipe);
pop.addEventListener('pointercancel', endSwipe);

layer.addEventListener('click', event => { if (event.target === layer) closePop(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !layer.hidden) closePop(); });
listEl.addEventListener('click', event => {
  const row = event.target.closest('[data-id]');
  if (row) openNote(row.dataset.id);
});
titleInput.addEventListener('keydown', event => { if (isEnter(event)) { event.preventDefault(); addNote(); } });
addButton.addEventListener('click', addNote);
// 탭을 닫거나 숨기기 전에 남은 저장을 바로 보낸다.
document.addEventListener('visibilitychange', () => { if (document.hidden) for (const editor of editors.values()) if (editor.timer) flush(editor); });

// 핵심 모아보기·피드백 검색에서 온 열기 요청: 그 면담·주제를 열고 그 줄을 1.5초 강조
onOpenRequest((noteId, lineId) => (reader.notes ? openNote(noteId, { lineId, highlight:true }) : false));
new ResizeObserver(() => { renderList(); measure(); }).observe(app);
onDayChange(render);
render();
reader.load();
watchMeetingNotes(() => reader.load());
