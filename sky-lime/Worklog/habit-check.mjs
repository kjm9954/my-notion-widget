// 위젯 3. 습관 점검: 습관마다 분기 3개월 기호(◎ 잘 지킴 · △ 반반 · ✕ 못 지킴).
// 점검 기간(월말 마지막 7일 = 이번 달 칸, 다음 달 첫 7일 = 지난달 칸)에만 세 기호가 펼쳐진다.
// 지난달이 비어 있으면 "·"을 눌러 언제든 채운다. 아직 안 온 달·지난 분기의 빈 칸은 누를 수 없다.
// 분기·업무/일상은 분기 진행도 위젯을 따른다.
import { getMode, onModeChange, escapeHtml, staleText, failureText, makeId, canHover } from './sky-lime-common.mjs?v=20261015-sky-lime';
import { getQuarter, onQuarterChange, onDayChange, watchQuarterGoals, createQuarterController, isEnter } from './goal-check-common.mjs?v=20261018-goal-check';
import { habitCells, cellTip, quarterRelation, sortByOrder, cleanText, MARKS, MARK_SYMBOL, HABIT_LIMIT, TITLE_MAX } from './goal-check-model.mjs?v=20261018-goal-check';

const app = document.getElementById('app');
const noticeEl = document.getElementById('notice');
const limitEl = document.getElementById('limit');
const emptyEl = document.getElementById('empty');
const board = document.getElementById('board');
const cardsEl = document.getElementById('cards');
const slot = document.getElementById('slot');
const habitInput = document.getElementById('habitInput');
const controller = createQuarterController(render);
const ui = { editing:null, reopen:null, adding:false };
let lastCards = '';
let swapping = false;

const isPast = () => quarterRelation(getQuarter()) < 0;
const findHabit = id => (controller.view()?.habits || []).find(habit => habit.id === id);
const isReopen = (id, index) => ui.reopen?.id === id && ui.reopen.index === index;

function markButton(symbol, { classes = '', tip, data = '', disabled = false }) {
  const label = escapeHtml(tip);
  return `<button class="gc-mark${classes}" type="button"${data}${disabled ? ' disabled' : ''} aria-label="${label}"${canHover() ? ` title="${label}"` : ''}>${symbol}</button>`;
}
function monthHtml(habit, cell, locked) {
  const id = escapeHtml(habit.id);
  const reopened = isReopen(habit.id, cell.index);
  const open = !locked && ((cell.state === 'window' && (!cell.value || reopened)) || (cell.state === 'fillable' && reopened));
  if (open) {
    return MARKS.map(mark => markButton(MARK_SYMBOL[mark], {
      classes:cell.value === mark ? '' : ' is-faint', tip:cellTip(cell, mark), data:` data-choose="${mark}" data-habit="${id}" data-month="${cell.index}"`
    })).join('');
  }
  if (cell.value) {
    const tappable = !locked && cell.state === 'window';
    return markButton(MARK_SYMBOL[cell.value], {
      classes:cell.value === 'bad' ? ' is-bad' : '', tip:cellTip(cell), disabled:!tappable,
      data:tappable ? ` data-reopen="${id}" data-month="${cell.index}"` : ''
    });
  }
  const tappable = !locked && cell.state === 'fillable';
  return markButton('·', { classes:' is-dot', tip:cellTip(cell), disabled:!tappable, data:tappable ? ` data-reopen="${id}" data-month="${cell.index}"` : '' });
}
function cardHtml(habit, quarter, locked, past) {
  const id = escapeHtml(habit.id);
  const name = escapeHtml(habit.name);
  const head = ui.editing === habit.id
    ? `<div class="gc-habit-head gc-edit"><input class="gc-edit-input" type="text" data-rename="${id}" value="${name}" maxlength="${TITLE_MAX.habit}" aria-label="습관 이름" autocomplete="off">`
      + `<button class="gc-text-button" type="button" data-remove="${id}">삭제</button></div>`
    : `<div class="gc-habit-head"><button class="gc-name" type="button" data-name="${id}"${past || locked ? ' disabled' : ''}>${name}</button></div>`;
  const months = habitCells(habit, quarter).map(cell => `<div class="gc-month">${monthHtml(habit, cell, locked)}</div>`).join('');
  return `<div class="gc-habit" data-habit-card="${id}">${head}<div class="gc-marks">${months}</div></div>`;
}

// 입력 중인 이름 칸은 다시 그려도 글자·커서를 그대로 둔다.
function swapCards(html) {
  const active = document.activeElement;
  const keep = active?.matches?.('[data-rename]') ? { id:active.dataset.rename, value:active.value, start:active.selectionStart, end:active.selectionEnd } : null;
  swapping = true;
  cardsEl.innerHTML = html;
  swapping = false;
  if (!keep) return;
  const input = [...cardsEl.querySelectorAll('[data-rename]')].find(node => node.dataset.rename === keep.id);
  if (!input) return;
  input.value = keep.value;
  input.focus();
  input.setSelectionRange(keep.start, keep.end);
}

function render() {
  const quarter = getQuarter();
  const state = controller.view();
  const past = isPast();
  const locked = controller.readOnly();
  const habits = sortByOrder(state?.habits);
  if (ui.editing && !habits.some(habit => habit.id === ui.editing)) ui.editing = null;
  let html;
  if (!state) html = `<p class="gc-message">${controller.loaded ? escapeHtml(failureText(controller.error)) : '불러오는 중이에요'}</p>`;
  else html = habits.map(habit => cardHtml(habit, quarter, locked, past)).join('');
  if (html !== lastCards) { swapCards(html); lastCards = html; }
  const canAdd = Boolean(state) && !past && habits.length < HABIT_LIMIT;
  if (!canAdd) ui.adding = false;
  slot.hidden = !canAdd;
  slot.classList.toggle('is-adding', ui.adding);
  limitEl.hidden = !(state && !past && habits.length >= HABIT_LIMIT);
  emptyEl.hidden = !(state && !habits.length && !ui.adding);
  const error = controller.error;
  noticeEl.textContent = state && error ? staleText(error) : '';
  app.dataset.status = !controller.loaded ? 'loading' : !state ? 'error' : error ? 'stale' : 'ready';
  app.dataset.mode = getMode();
  app.dataset.quarter = quarter;
}

// ───────── 이름 수정 · 삭제 ─────────
function startEdit(id) {
  if (isPast() || controller.readOnly() || !findHabit(id)) return;
  ui.editing = id;
  ui.adding = false;
  render();
  const input = [...cardsEl.querySelectorAll('[data-rename]')].find(node => node.dataset.rename === id);
  if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
}
function finishEdit(input) {
  const habit = findHabit(input.dataset.rename);
  ui.editing = null;
  const name = cleanText(input.value, TITLE_MAX.habit);
  if (habit && name && name !== habit.name) controller.submit([{ type:'renameHabit', id:habit.id, name }]);
  else render();
}

board.addEventListener('click', event => {
  const choose = event.target.closest('[data-choose]');
  if (choose) {
    const habit = findHabit(choose.dataset.habit);
    const month = Number(choose.dataset.month);
    ui.reopen = null;
    if (habit && habit.months[month] !== choose.dataset.choose) controller.submit([{ type:'markHabit', id:habit.id, month, value:choose.dataset.choose }]);
    else render();
    return;
  }
  const reopen = event.target.closest('[data-reopen]');
  if (reopen) { ui.reopen = { id:reopen.dataset.reopen, index:Number(reopen.dataset.month) }; render(); return; }
  const name = event.target.closest('[data-name]');
  if (name && !name.disabled) { startEdit(name.dataset.name); return; }
  const remove = event.target.closest('[data-remove]');
  if (remove) { ui.editing = null; controller.submit([{ type:'removeHabit', id:remove.dataset.remove }]); return; }
  if (event.target.closest('#plus')) {
    ui.adding = true;
    ui.editing = null;
    render();
    habitInput.focus();
  }
});
// 삭제를 누르는 순간 이름 칸이 먼저 닫히지 않게 한다.
board.addEventListener('pointerdown', event => { if (event.target.closest('[data-remove]')) event.preventDefault(); });
board.addEventListener('keydown', event => {
  const input = event.target.closest('[data-rename]');
  if (input && (isEnter(event) || event.key === 'Escape')) { event.preventDefault(); input.blur(); }
});
board.addEventListener('focusout', event => {
  const input = event.target.closest?.('[data-rename]');
  if (input && !swapping) finishEdit(input);
});

// ───────── + 습관 ─────────
habitInput.addEventListener('keydown', event => {
  if (isEnter(event)) {
    event.preventDefault();
    const name = cleanText(habitInput.value, TITLE_MAX.habit);
    if (!name || (controller.view()?.habits.length || 0) >= HABIT_LIMIT) return;
    ui.adding = false;
    if (controller.submit([{ type:'addHabit', id:makeId(), name }])) habitInput.value = '';
    else render();
  } else if (event.key === 'Escape') {
    ui.adding = false;
    habitInput.value = '';
    render();
  }
});
habitInput.addEventListener('blur', () => {
  if (!habitInput.value.trim() && ui.adding) { ui.adding = false; render(); }
});

const reload = () => {
  ui.editing = null;
  ui.reopen = null;
  ui.adding = false;
  habitInput.value = '';
  controller.load();
};
onModeChange(reload);
onQuarterChange(reload);
onDayChange(render);
render();
controller.load();
watchQuarterGoals(() => controller.load());
