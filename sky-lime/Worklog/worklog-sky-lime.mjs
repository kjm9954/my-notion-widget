// ② 업무일지: 진행중 / 검토 대기 / 예정 3열 보드 + 완료 줄 + 업무 추가.
// 저장은 기존 Store API(patchWorklogState, 있으면 updateWorklogTaskStatus)만 쓴다.
import { getMode, onModeChange, modeToggleHtml, bindModeToggle, watchWorklog, createWorklogController, taskOps,
  toggleTarget, escapeHtml, canHover, makeId, staleText, failureText } from './sky-lime-common.mjs?v=20261015-sky-lime';
import { worklogToday, addDays, daysBetween, dayLabel, tasksForDay, board, statusOf, isDone, goalNumber, goalIdFor,
  categoryOf, categoryValue, categoriesFor, dueInfo, STATUS_LABEL, LANE_ORDER, STATUS_CHOICES, OTHER_CATEGORY,
  MAX_CATEGORIES, isDate } from './sky-lime-model.mjs?v=20261015-sky-lime';

const WIDE_MIN = 900;
const DONE_ROWS = 2;
const TIP_DELAY = 300;
const app = document.getElementById('app');
const boardEl = document.getElementById('board');
const dayLabelEl = document.getElementById('dayLabel');
const goTodayEl = app.querySelector('[data-go-today]');
const titleEl = document.getElementById('title');
const noticeEl = document.getElementById('notice');
const remainEl = document.getElementById('remain');
const progressEl = document.getElementById('progress');
const toggleEl = document.getElementById('modeToggle');
const formEl = document.getElementById('addForm');
const inputEl = document.getElementById('addInput');
const laneLayer = document.getElementById('laneLayer');
const detailLayer = document.getElementById('detailLayer');
const tipEl = document.getElementById('tip');
const ghostEl = document.getElementById('ghost');
const liveEl = document.getElementById('live');

let today = worklogToday();
const ui = {
  date:today, followToday:true, wide:true, touch:!canHover(),
  lanePanel:null, detail:null, drag:null, suppressClickUntil:0
};
const controller = createWorklogController(event => {
  if (event.type === 'save-error') announce('저장하지 못했어요. 다시 시도해 주세요.');
  if (event.type === 'blocked') announce('연결이 돌아오면 저장할 수 있어요.');
  render();
});

const announce = text => { liveEl.textContent = ''; liveEl.textContent = text; };
const esc = escapeHtml;
const currentTasks = () => controller.view()?.tasks || [];
const findTask = id => currentTasks().find(task => String(task.id) === String(id)) || null;
const dayModel = () => board(tasksForDay(controller.view(), getMode(), ui.date));

// ───────── 마크업 ─────────
function checkHtml(task) {
  const done = isDone(task);
  return `<button class="sl-check${done ? ' is-on' : ''}" type="button" role="checkbox" aria-checked="${done}" data-toggle="${esc(task.id)}" aria-label="${done ? '완료 취소' : '완료 표시'}: ${esc(task.title)}"><span class="sl-check-box"></span></button>`;
}
function dueHtml(task) {
  const due = dueInfo(task, today);
  return due ? `<span class="sl-due is-${due.tone}">${due.text}</span>` : '';
}
const gripHtml = () => ui.touch ? '<span class="sl-grip" data-grip aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></span>' : '';

function cardHtml(task, showMemo) {
  const number = goalNumber(task);
  const due = dueHtml(task);
  const memo = String(task.memo || '').trim();
  return `<article class="sl-card" data-task="${esc(task.id)}" data-drag tabindex="0" aria-label="${esc(task.title)} 세부 정보">`
    + '<div class="sl-card-grid">'
    + `<div class="sl-card-check">${checkHtml(task)}</div>`
    + `<div class="sl-card-title">${esc(task.title)}</div>`
    + `<div class="sl-card-numcell">${number ? `<span class="sl-num" aria-label="${number}번">${number}</span>` : ''}</div>`
    + `<div class="sl-card-meta"><span>${esc(categoryOf(task))}</span>${due ? `<span class="sl-sep">·</span>${due}` : ''}</div>`
    + (showMemo && memo ? `<span></span><div class="sl-card-memo" data-memo>${esc(memo)}</div>` : '')
    + '</div>'
    + `<button class="sl-delete sl-card-delete" type="button" data-delete="${esc(task.id)}" aria-label="업무 삭제: ${esc(task.title)}">✕</button>`
    + gripHtml()
    + '</article>';
}
function compactHtml(task) {
  return `<article class="sl-compact" data-task="${esc(task.id)}" data-drag tabindex="0" aria-label="${esc(task.title)} 세부 정보">`
    + checkHtml(task)
    + `<span class="sl-compact-title" title="${esc(task.title)}">${esc(task.title)}</span>${dueHtml(task)}</article>`;
}
function laneHtml(status, rows, stage, limit) {
  const shown = rows.slice(0, limit);
  const head = `<div class="sl-lane-head"><span class="sl-lane-label">${STATUS_LABEL[status]}</span><span class="sl-lane-count">${rows.length}</span></div>`;
  if (!rows.length) return `${head}<div class="sl-lane-empty">비어 있음</div>`;
  const body = shown.map(task => stage >= 2 ? compactHtml(task) : cardHtml(task, stage < 1)).join('');
  const more = rows.length > shown.length ? `<button class="sl-more" type="button" data-more="${status}">외 ${rows.length - shown.length}개</button>` : '';
  return head + body + more;
}
function doneRowHtml(task) {
  const number = goalNumber(task);
  const memo = String(task.memo || '').trim();
  const parts = [];
  if (number) parts.push({ html:`<span class="sl-num sl-num-sm is-done" aria-label="${number}번">${number}</span>`, num:true });
  parts.push({ html:`<span class="sl-done-part">${esc(categoryOf(task))}</span>` });
  if (memo) parts.push({ html:`<span class="sl-done-part is-memo">${esc(memo)}</span>` });
  const body = parts.map((part, index) => (index === 0 || !parts[index - 1].num ? '<span class="sl-sep">·</span>' : '') + part.html).join('');
  return `<div class="sl-done-row" data-task="${esc(task.id)}" tabindex="0" aria-label="${esc(task.title)} 세부 정보">${checkHtml(task)}`
    + `<div class="sl-done-body"><span class="sl-done-title">${esc(task.title)}</span>${body}</div>`
    + `<button class="sl-delete" type="button" data-delete="${esc(task.id)}" aria-label="업무 삭제: ${esc(task.title)}">✕</button></div>`;
}
function doneHtml(rows) {
  const shown = rows.slice(0, DONE_ROWS);
  const head = `<div class="sl-done-head"><span class="sl-done-label">완료</span><span class="sl-lane-count">${rows.length}</span></div>`;
  if (!rows.length) return `${head}<div class="sl-done-empty">완료하면 여기에 모여요</div>`;
  const more = rows.length > shown.length ? `<button class="sl-more" type="button" data-more="done">외 ${rows.length - shown.length}개</button>` : '';
  return head + shown.map(doneRowHtml).join('') + more;
}

// ───────── 넘칠 때 단계적 압축 (글자 크기는 그대로) ─────────
// 0 원래 모양 → 1 메모 줄 숨김 → 2 업무명 한 줄 + 마감 오른쪽 → 3 마지막 줄 "외 n개"
const overflows = element => element.scrollHeight > element.clientHeight + .5;
function paintLane(element, status, rows, stage, limit) {
  element.classList.toggle('is-tight', stage >= 2);
  element.dataset.stage = String(stage);
  element.innerHTML = laneHtml(status, rows, stage, limit);
}
function fitLane(element, status, rows) {
  let stage = 0;
  let limit = rows.length;
  paintLane(element, status, rows, stage, limit);
  while (stage < 2 && overflows(element)) paintLane(element, status, rows, ++stage, limit);
  if (!overflows(element)) return;
  stage = 3;
  limit = Math.max(0, rows.length - 1);
  paintLane(element, status, rows, stage, limit);
  while (limit > 0 && overflows(element)) paintLane(element, status, rows, stage, --limit);
}
function fitStacked(container, model) {
  const active = LANE_ORDER.filter(status => model.lanes[status].length);
  if (!active.length) { container.innerHTML = '<p class="sl-board-empty">아직 항목이 없어요</p>'; return; }
  container.innerHTML = active.map(status => `<section class="sl-lane" data-lane="${status}" data-drop="${status}" aria-label="${STATUS_LABEL[status]}"></section>`).join('');
  const limits = Object.fromEntries(active.map(status => [status, model.lanes[status].length]));
  let stage = 0;
  const paint = () => active.forEach(status => paintLane(container.querySelector(`[data-lane="${status}"]`), status, model.lanes[status], stage, limits[status]));
  paint();
  while (stage < 2 && overflows(container)) { stage += 1; paint(); }
  if (!overflows(container)) return;
  stage = 3;
  while (overflows(container)) {
    const largest = active.reduce((best, status) => limits[status] > limits[best] ? status : best, active[0]);
    if (!limits[largest]) break;
    limits[largest] -= 1;
    paint();
  }
}

// ───────── 렌더 ─────────
function renderHeader(model) {
  const mode = getMode();
  toggleEl.innerHTML = modeToggleHtml(mode);
  dayLabelEl.textContent = dayLabel(ui.date);
  goTodayEl.hidden = ui.date === today;
  const offset = daysBetween(today, ui.date);
  titleEl.textContent = ({ 0:'오늘의 ', [-1]:'어제의 ', 1:'내일의 ' }[offset] ?? '') + (mode === 'life' ? '일상' : '업무');
  inputEl.placeholder = mode === 'life' ? '일상 추가...' : '업무 추가...';
  inputEl.setAttribute('aria-label', mode === 'life' ? '일상 추가' : '업무 추가');
  remainEl.textContent = `${model ? model.remaining : 0}개 남음`;
  progressEl.style.width = model && model.total ? `${(model.done / model.total) * 100}%` : '0%';
  const error = controller.error;
  noticeEl.textContent = controller.view() && error ? staleText(error) : '';
}

function renderBoard(model) {
  hideTip();
  if (!model) {
    const message = controller.loaded ? failureText(controller.error) : '불러오는 중이에요';
    boardEl.innerHTML = `<p class="sl-message">${esc(message)}</p>`;
    return;
  }
  boardEl.innerHTML = '<div class="sl-lanes"></div><section class="sl-done" data-drop="done" aria-label="완료"></section>';
  const lanesEl = boardEl.firstElementChild;
  boardEl.lastElementChild.innerHTML = doneHtml(model.lanes.done);
  if (ui.wide) {
    lanesEl.innerHTML = LANE_ORDER.map(status => `<section class="sl-lane" data-lane="${status}" data-drop="${status}" aria-label="${STATUS_LABEL[status]}"></section>`).join('');
    LANE_ORDER.forEach(status => fitLane(lanesEl.querySelector(`[data-lane="${status}"]`), status, model.lanes[status]));
  } else fitStacked(lanesEl, model);
}

function render() {
  const state = controller.view();
  const model = state ? dayModel() : null;
  app.dataset.status = !controller.loaded ? 'loading' : !state ? 'error' : controller.error ? 'stale' : 'ready';
  app.dataset.mode = getMode();
  app.classList.toggle('is-narrow', !ui.wide);
  app.classList.toggle('is-touch', ui.touch);
  renderHeader(model);
  if (!ui.drag) renderBoard(model);
  if (ui.lanePanel) renderLanePanel();
  if (ui.detail) renderDetail(false);
}

// ───────── 그 열 전체 목록 창 ─────────
function renderLanePanel() {
  const state = controller.view();
  if (!state) { closeLanePanel(); return; }
  const status = ui.lanePanel;
  const rows = dayModel().lanes[status] || [];
  const label = STATUS_LABEL[status];
  laneLayer.innerHTML = '<div class="sl-overlay" data-close-lane></div>'
    + `<section class="sl-panel sl-lane-panel" role="dialog" aria-modal="true" aria-label="${label} 전체 목록">`
    + `<div class="sl-panel-head"><div class="sl-panel-heading"><span class="sl-panel-title">${label}</span><span class="sl-panel-count">${rows.length}</span></div><button class="sl-close" type="button" data-close-lane>닫기</button></div>`
    + rows.map(task => `<div class="sl-panel-row${isDone(task) ? ' is-done' : ''}" data-panel-task="${esc(task.id)}">${checkHtml(task)}<span class="sl-panel-row-title">${esc(task.title)}</span>${dueHtml(task)}</div>`).join('')
    + '</section>';
}
function openLanePanel(status) { ui.lanePanel = status; renderLanePanel(); }
function closeLanePanel() { ui.lanePanel = null; laneLayer.innerHTML = ''; }

// ───────── 세부 정보 창 ─────────
const chip = (on, attrs, label) => `<button class="sl-chip${on ? ' is-on' : ''}" type="button" aria-pressed="${on}" ${attrs}>${label}</button>`;
function numberChips(task) {
  const current = goalNumber(task);
  return [1, 2, 3, 0].map(number => chip(current === number, `data-pick-number="${number}"`, number ? String(number) : '없음')).join('');
}
function categoryChips(task) {
  const detail = ui.detail;
  const cats = categoriesFor(currentTasks(), getMode());
  const current = categoryOf(task);
  const chips = [OTHER_CATEGORY, ...cats].map(label => {
    const editable = detail.catEditing && label !== OTHER_CATEGORY;
    return chip(!editable && current === label, `data-pick-cat="${esc(label)}"${editable ? ` aria-label="${esc(label)} 구분 삭제"` : ''}`,
      `${esc(label)}${editable ? '<span class="sl-chip-x" aria-hidden="true">✕</span>' : ''}`);
  }).join('');
  const adding = detail.catAdding ? `<input class="sl-cat-input" data-cat-input maxlength="8" placeholder="새 구분" aria-label="새 구분 이름" autocomplete="off" value="${esc(detail.catDraft || '')}">` : '';
  const canAdd = !detail.catAdding && !detail.catEditing && cats.length < MAX_CATEGORIES;
  const add = canAdd ? '<button class="sl-chip-add" type="button" data-cat-add>+ 추가</button>' : '';
  const count = `<span class="sl-cat-count">${cats.length >= MAX_CATEGORIES ? '최대 6개' : `${cats.length}/${MAX_CATEGORIES}`}</span>`;
  return chips + adding + add + count;
}
function categoryHead() {
  const cats = categoriesFor(currentTasks(), getMode());
  const edit = cats.length ? `<button class="sl-small-button" type="button" data-cat-edit>${ui.detail.catEditing ? '완료' : '편집'}</button>` : '';
  return `<span class="sl-field-label">구분</span>${edit}`;
}
function dueChips(task) {
  const quick = [['오늘', 0], ['내일', 1], ['모레', 2]];
  const chips = quick.map(([label, offset]) => chip(task.due === addDays(today, offset), `data-pick-due="${addDays(today, offset)}"`, label)).join('')
    + chip(!isDate(task.due), 'data-pick-due=""', '없음');
  const custom = isDate(task.due) && !quick.some(([, offset]) => task.due === addDays(today, offset));
  const title = custom ? `${Number(task.due.slice(5, 7))}월 ${Number(task.due.slice(8))}일` : '달력에서 선택';
  return chips + `<button class="sl-cal-button${custom ? ' is-on' : ''}" type="button" data-open-cal title="${title}" aria-label="${title}"><span class="sl-cal-icon" aria-hidden="true"></span></button>`;
}
function statusChips(task) {
  const current = statusOf(task);
  return STATUS_CHOICES.map(status => chip(current === status, `data-pick-status="${status}"`, STATUS_LABEL[status])).join('');
}
function detailMainHtml(task) {
  return '<div class="sl-panel-head"><span class="sl-panel-kicker">세부 정보</span><button class="sl-close" type="button" data-close-detail>닫기</button></div>'
    + '<div class="sl-detail-main">'
    + `<input class="sl-detail-title" data-field="title" maxlength="240" placeholder="업무명" aria-label="업무명" autocomplete="off" value="${esc(task.title)}">`
    + `<div class="sl-field"><span class="sl-field-label">번호</span><div class="sl-chips" data-chips="number">${numberChips(task)}</div></div>`
    + `<div class="sl-field"><div class="sl-field-head" data-chips-head="category">${categoryHead()}</div><div class="sl-chips" data-chips="category">${categoryChips(task)}</div></div>`
    + `<div class="sl-field"><span class="sl-field-label">마감일</span><div class="sl-chips" data-chips="due">${dueChips(task)}</div></div>`
    + `<div class="sl-field"><span class="sl-field-label">상태</span><div class="sl-chips" data-chips="status">${statusChips(task)}</div></div>`
    + `<div class="sl-field"><span class="sl-field-label">메모</span><input class="sl-detail-memo" data-field="memo" maxlength="4000" placeholder="한 줄 메모" aria-label="메모" autocomplete="off" value="${esc(task.memo || '')}"></div>`
    + '<div class="sl-detail-foot"><button class="sl-text-button" type="button" data-detail-delete>삭제</button></div>'
    + '</div>';
}
function calendarHtml(task) {
  const month = ui.detail.calMonth;
  const [year, monthNumber] = month.split('-').map(Number);
  const first = `${month}-01`;
  const lead = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cells = Array.from({ length:lead }, () => '<span class="sl-cal-day is-blank" aria-hidden="true"></span>');
  for (let day = 1; day <= length; day += 1) {
    const date = addDays(first, day - 1);
    const classes = ['sl-cal-day'];
    if (date < today) classes.push('is-past');
    if ((lead + day - 1) % 7 === 0) classes.push('is-sunday');
    if (date === today) classes.push('is-today');
    if (task.due === date) classes.push('is-on');
    cells.push(`<button class="${classes.join(' ')}" type="button" data-pick-date="${date}" aria-label="${dayLabel(date)}" aria-pressed="${task.due === date}">${day}</button>`);
  }
  const thisMonth = today.slice(0, 7);
  return '<div class="sl-cal">'
    + '<div class="sl-panel-head"><button class="sl-back" type="button" data-cal-back>‹ 마감일</button><button class="sl-close" type="button" data-close-detail>닫기</button></div>'
    + '<div class="sl-cal-nav">'
    + (month !== thisMonth ? '<button class="sl-cal-today" type="button" data-cal-this>오늘</button>' : '')
    + `<button class="sl-cal-arrow" type="button" data-cal-shift="-1" aria-label="이전 달">‹</button><span class="sl-cal-month">${year}년 ${monthNumber}월</span><button class="sl-cal-arrow" type="button" data-cal-shift="1" aria-label="다음 달">›</button>`
    + '</div>'
    + `<div class="sl-cal-grid">${['일', '월', '화', '수', '목', '금', '토'].map(label => `<span class="sl-cal-week">${label}</span>`).join('')}${cells.join('')}</div>`
    + '</div>';
}
function renderDetail(full) {
  const task = findTask(ui.detail?.id);
  if (!task) { closeDetail(); return; }
  let panel = detailLayer.querySelector('.sl-detail');
  if (full || !panel) {
    const height = ui.detail.view === 'calendar' && panel ? panel.offsetHeight : 0;
    detailLayer.innerHTML = '<div class="sl-overlay is-detail" data-close-detail></div>'
      + `<section class="sl-panel sl-detail" role="dialog" aria-modal="true" aria-label="세부 정보">${ui.detail.view === 'calendar' ? calendarHtml(task) : detailMainHtml(task)}</section>`;
    panel = detailLayer.querySelector('.sl-detail');
    panel.style.height = height ? `${height}px` : '';
    return;
  }
  if (ui.detail.view === 'calendar') {
    const height = panel.style.height;
    panel.innerHTML = calendarHtml(task);
    panel.style.height = height;
    return;
  }
  // 입력 중인 칸은 건드리지 않고 선택 칸만 다시 그린다.
  const swap = (selector, html) => { const element = panel.querySelector(selector); if (element && element.innerHTML !== html) element.innerHTML = html; };
  swap('[data-chips="number"]', numberChips(task));
  // 새 구분을 입력하는 동안에는 입력칸을 다시 그리지 않는다.
  if (!(ui.detail.catAdding && panel.querySelector('[data-cat-input]'))) swap('[data-chips="category"]', categoryChips(task));
  swap('[data-chips-head="category"]', categoryHead());
  swap('[data-chips="due"]', dueChips(task));
  swap('[data-chips="status"]', statusChips(task));
  for (const input of panel.querySelectorAll('[data-field]')) {
    if (document.activeElement !== input) input.value = task[input.dataset.field] || '';
  }
}
function openDetail(id) {
  closeLanePanel();
  hideTip();
  ui.detail = { id:String(id), view:'main', calMonth:null, catAdding:false, catEditing:false, catDraft:'' };
  renderDetail(true);
}
function closeDetail() {
  if (!ui.detail) return;
  commitDetailInputs();
  ui.detail = null;
  detailLayer.innerHTML = '';
}
function setField(id, patch) {
  const task = findTask(id);
  if (!task) return;
  const changed = Object.entries(patch).some(([key, value]) => (task[key] ?? null) !== (value ?? null));
  if (changed) controller.submit(taskOps.update(id, patch));
}
function commitDetailInputs() {
  const panel = detailLayer.querySelector('.sl-detail');
  const task = findTask(ui.detail?.id);
  if (!panel || !task) return;
  for (const input of panel.querySelectorAll('[data-field]')) commitInput(input, task);
}
function commitInput(input, task = findTask(ui.detail?.id)) {
  if (!task) return;
  const field = input.dataset.field;
  const value = input.value.replace(/\s*\n\s*/g, ' ').trim();
  if (field === 'title' && !value) { input.value = task.title || ''; return; }
  setField(task.id, { [field]:value });
}
function commitCategory(input) {
  const detail = ui.detail;
  if (!detail || !detail.catAdding) return;
  const value = input.value.trim();
  detail.catAdding = false;
  detail.catDraft = '';
  const cats = categoriesFor(currentTasks(), getMode());
  if (value && value !== OTHER_CATEGORY && (cats.includes(value) || cats.length < MAX_CATEGORIES)) setField(detail.id, { proj:categoryValue(value) });
  renderDetail(false);
}

// ───────── 말풍선 (마우스 기기, 말줄임된 메모만) ─────────
let tipTimer = 0;
function hideTip() {
  clearTimeout(tipTimer);
  tipEl.hidden = true;
  tipEl.classList.remove('is-on');
}
function showTipFor(element) {
  if (ui.touch || ui.drag || element.scrollWidth <= element.clientWidth + 1) return;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => {
    if (!element.isConnected) return;
    const root = app.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const scale = root.width / (app.offsetWidth || root.width) || 1;
    const width = app.offsetWidth;
    const height = app.offsetHeight;
    const x = (rect.left - root.left) / scale;
    const top = (rect.top - root.top) / scale;
    const bottom = (rect.bottom - root.top) / scale;
    tipEl.textContent = element.textContent;
    tipEl.hidden = false;
    const tipHeight = tipEl.offsetHeight;
    // 아래 공간이 모자라면 위로 띄우고, 좌우는 위젯 안에 들어오게 맞춘다.
    const above = bottom + 6 + tipHeight > height - 8 || bottom > height - 130;
    tipEl.style.left = `${Math.max(8, Math.min(x - 4, width - tipEl.offsetWidth - 8))}px`;
    tipEl.style.top = `${above ? Math.max(8, top - 6 - tipHeight) : bottom + 6}px`;
    requestAnimationFrame(() => tipEl.classList.add('is-on'));
  }, TIP_DELAY);
}
app.addEventListener('mouseover', event => {
  const memo = event.target.closest('[data-memo]');
  if (memo && !memo.contains(event.relatedTarget)) showTipFor(memo);
});
app.addEventListener('mouseout', event => {
  const memo = event.target.closest('[data-memo]');
  if (memo && !memo.contains(event.relatedTarget)) hideTip();
});

// ───────── 끌어서 상태 바꾸기 ─────────
function placeGhost(event) {
  const root = app.getBoundingClientRect();
  const scale = root.width / (app.offsetWidth || root.width) || 1;
  ghostEl.style.left = `${(event.clientX - root.left) / scale + 14}px`;
  ghostEl.style.top = `${(event.clientY - root.top) / scale + 10}px`;
}
function startDrag(item, event) {
  const task = findTask(item.dataset.task);
  if (!task || controller.readOnly()) return;
  hideTip();
  ui.drag = { id:String(task.id), over:null };
  item.classList.add('is-dragging');
  app.classList.add('is-drag');
  ghostEl.textContent = task.title;
  ghostEl.hidden = false;
  placeGhost(event);
  const move = moveEvent => {
    placeGhost(moveEvent);
    const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('[data-drop]');
    const over = target && app.contains(target) ? target.dataset.drop : null;
    if (over === ui.drag.over) return;
    app.querySelectorAll('.is-over').forEach(element => element.classList.remove('is-over'));
    target?.classList.add('is-over');
    ui.drag.over = over;
  };
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    const { id, over } = ui.drag;
    ui.drag = null;
    ghostEl.hidden = true;
    app.classList.remove('is-drag');
    ui.suppressClickUntil = Date.now() + 80;
    const latest = findTask(id);
    if (latest && over && statusOf(latest) !== over) controller.submit(taskOps.status(id, over));
    else render();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}
app.addEventListener('pointerdown', event => {
  const item = event.target.closest('[data-drag]');
  if (!item || controller.readOnly()) return;
  if (event.target.closest('[data-grip]')) { event.preventDefault(); startDrag(item, event); return; }
  if (event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('button, input')) return;
  const startX = event.clientX;
  const startY = event.clientY;
  const move = moveEvent => {
    if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) <= 5) return;
    stop();
    startDrag(item, moveEvent);
  };
  const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
});

// ───────── 클릭 ─────────
function moveDay(date) {
  ui.date = date;
  ui.followToday = date === today;
  closeLanePanel();
  closeDetail();
  render();
}
function toggleTask(id) {
  const task = findTask(id);
  if (task) controller.submit(taskOps.status(task.id, toggleTarget(task)));
}
function deleteTask(id, row) {
  const run = () => controller.submit(taskOps.remove(id));
  if (!controller.readOnly() && window.widgetMotion?.close && row) window.widgetMotion.close(row, run);
  else run();
}

app.addEventListener('click', event => {
  if (Date.now() < ui.suppressClickUntil) return;
  const target = event.target;
  const day = target.closest('[data-day]');
  if (day) { moveDay(addDays(ui.date, Number(day.dataset.day))); return; }
  if (target.closest('[data-go-today]')) { moveDay(today); return; }
  const toggle = target.closest('[data-toggle]');
  if (toggle) { toggleTask(toggle.dataset.toggle); return; }
  const remove = target.closest('[data-delete]');
  if (remove) { deleteTask(remove.dataset.delete, remove.closest('[data-task]')); return; }
  const more = target.closest('[data-more]');
  if (more) { openLanePanel(more.dataset.more); return; }
  if (target.closest('[data-close-lane]')) { closeLanePanel(); return; }
  const panelRow = target.closest('[data-panel-task]');
  if (panelRow) { openDetail(panelRow.dataset.panelTask); return; }
  if (target.closest('[data-close-detail]')) { closeDetail(); return; }
  if (ui.detail) { handleDetailClick(target); return; }
  const card = target.closest('[data-task]');
  if (card && boardEl.contains(card)) openDetail(card.dataset.task);
});

function handleDetailClick(target) {
  const detail = ui.detail;
  const id = detail.id;
  const pickNumber = target.closest('[data-pick-number]');
  if (pickNumber) { setField(id, { goalId:goalIdFor(Number(pickNumber.dataset.pickNumber)) }); return; }
  const pickCat = target.closest('[data-pick-cat]');
  if (pickCat) {
    const label = pickCat.dataset.pickCat;
    if (detail.catEditing) {
      if (label === OTHER_CATEGORY) return;
      controller.submit(taskOps.clearCategory(getMode(), task => categoryOf(task) === label));
      if (categoriesFor(currentTasks(), getMode()).length === 0) detail.catEditing = false;
      renderDetail(false);
    } else setField(id, { proj:categoryValue(label) });
    return;
  }
  if (target.closest('[data-cat-add]')) {
    detail.catAdding = true;
    renderDetail(false);
    detailLayer.querySelector('[data-cat-input]')?.focus();
    return;
  }
  if (target.closest('[data-cat-edit]')) {
    detail.catEditing = !detail.catEditing;
    detail.catAdding = false;
    renderDetail(false);
    return;
  }
  const pickDue = target.closest('[data-pick-due]');
  if (pickDue) { setField(id, { due:pickDue.dataset.pickDue || null }); return; }
  if (target.closest('[data-open-cal]')) {
    commitDetailInputs();
    const task = findTask(id);
    detail.view = 'calendar';
    detail.calMonth = (isDate(task?.due) ? task.due : today).slice(0, 7);
    renderDetail(true);
    return;
  }
  if (target.closest('[data-cal-back]')) { detail.view = 'main'; renderDetail(true); return; }
  if (target.closest('[data-cal-this]')) { detail.calMonth = today.slice(0, 7); renderDetail(false); return; }
  const shift = target.closest('[data-cal-shift]');
  if (shift) {
    const [year, month] = detail.calMonth.split('-').map(Number);
    detail.calMonth = new Date(Date.UTC(year, month - 1 + Number(shift.dataset.calShift), 1)).toISOString().slice(0, 7);
    renderDetail(false);
    return;
  }
  const pickDate = target.closest('[data-pick-date]');
  if (pickDate) {
    setField(id, { due:pickDate.dataset.pickDate });
    detail.view = 'main';
    renderDetail(true);
    return;
  }
  const pickStatus = target.closest('[data-pick-status]');
  if (pickStatus) {
    const task = findTask(id);
    if (task && statusOf(task) !== pickStatus.dataset.pickStatus) controller.submit(taskOps.status(id, pickStatus.dataset.pickStatus));
    return;
  }
  if (target.closest('[data-detail-delete]')) {
    ui.detail = null;
    detailLayer.innerHTML = '';
    controller.submit(taskOps.remove(id));
  }
}

// ───────── 입력 ─────────
app.addEventListener('change', event => {
  if (event.target.matches('[data-field]')) commitInput(event.target);
});
app.addEventListener('focusout', event => {
  if (event.target.matches('[data-cat-input]')) commitCategory(event.target);
});
app.addEventListener('input', event => {
  if (event.target.matches('[data-cat-input]') && ui.detail) ui.detail.catDraft = event.target.value;
});
app.addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229) return;
  const target = event.target;
  if (target.matches('[data-cat-input]')) {
    if (event.key === 'Enter') { event.preventDefault(); commitCategory(target); }
    if (event.key === 'Escape') { event.preventDefault(); ui.detail.catAdding = false; ui.detail.catDraft = ''; renderDetail(false); }
    return;
  }
  if (target.matches('[data-field]') && event.key === 'Enter') { event.preventDefault(); target.blur(); return; }
  if (event.key === 'Escape') {
    if (ui.detail) { closeDetail(); return; }
    if (ui.lanePanel) { closeLanePanel(); return; }
  }
  if ((event.key === 'Enter' || event.key === ' ') && target.matches('[data-task]') && !ui.detail) {
    event.preventDefault();
    openDetail(target.dataset.task);
  }
});

function addTask() {
  const title = inputEl.value.trim();
  if (!title || !controller.view()) return;
  const task = {
    id:makeId(), mode:getMode(), date:ui.date, proj:'', q:null, title, due:null, start:null, end:null,
    progress:null, est:null, status:'wait', done:false, doneAt:null, goalId:null, memo:'', rolledFrom:null, progressTouched:false
  };
  if (controller.submit(taskOps.add(task))) {
    inputEl.value = '';
    announce('추가했어요.');
  }
}
formEl.addEventListener('submit', event => { event.preventDefault(); addTask(); });
inputEl.addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter') { event.preventDefault(); addTask(); }
});

// ───────── 시작 ─────────
bindModeToggle(app);
onModeChange(() => { closeLanePanel(); closeDetail(); render(); });
let lastSize = '';
new ResizeObserver(() => {
  const size = `${app.clientWidth}x${app.clientHeight}`;
  if (size === lastSize) return;
  lastSize = size;
  ui.wide = app.clientWidth >= WIDE_MIN;
  render();
}).observe(app);
window.matchMedia?.('(hover: hover)').addEventListener?.('change', () => { ui.touch = !canHover(); render(); });
ui.wide = app.clientWidth >= WIDE_MIN;
render();
controller.load();
watchWorklog(() => controller.load());
// 오전 6시가 지나면 오늘·D-n을 새로 계산한다. 오늘을 보고 있었다면 다음 날로 따라간다.
setInterval(() => {
  const next = worklogToday();
  if (next === today) return;
  today = next;
  if (ui.followToday) ui.date = today;
  render();
}, 60000);
