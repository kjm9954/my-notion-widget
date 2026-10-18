// 위젯 2. 분기 목표: 목록(진행 중·보류 먼저, 달성 아래) + 위젯 안 팝업(제목·세부 단계·% 칸·보류·삭제) + 아래 추가 줄.
// 분기·업무/일상은 분기 진행도 위젯을 따른다. 지난 분기는 읽기 전용(팝업 안 열림, 입력 줄 숨김).
import { getMode, onModeChange, escapeHtml, staleText, failureText, makeId } from './sky-lime-common.mjs?v=20261015-sky-lime';
import { getQuarter, onQuarterChange, onDayChange, watchQuarterGoals, createQuarterController, isEnter } from './goal-check-common.mjs?v=20261018-goal-check';
import { goalRows, goalProgress, quarterRelation, sortByOrder, cleanText, GOAL_LIMIT, STEP_LIMIT, TITLE_MAX } from './goal-check-model.mjs?v=20261018-goal-check';

const app = document.getElementById('app');
const listEl = document.getElementById('list');
const noticeEl = document.getElementById('notice');
const addRow = document.getElementById('addRow');
const goalInput = document.getElementById('goalInput');
const layer = document.getElementById('layer');
const popNum = document.getElementById('popNum');
const popTitle = document.getElementById('popTitle');
const popPct = document.getElementById('popPct');
const popSteps = document.getElementById('popSteps');
const stepInput = document.getElementById('stepInput');
const popHold = document.getElementById('popHold');
const controller = createQuarterController(render);
let openId = null; // 팝업에 연 목표
let lastList = '';
let lastSteps = '';

const isPast = () => quarterRelation(getQuarter()) < 0;
const editable = () => !isPast() && !controller.readOnly();
const findGoal = id => (controller.view()?.goals || []).find(goal => goal.id === id);
const numberOf = (goals, id) => sortByOrder(goals).findIndex(goal => goal.id === id) + 1;

function rowHtml(row, disabled) {
  const { goal, number, done, hold, stalled, progress } = row;
  const gray = done || hold || stalled;
  const right = hold ? '보류' : stalled ? '2주째 멈춤' : `${progress}%`;
  const classes = ['gc-goal', done && 'is-done', hold && 'is-hold', stalled && 'is-stalled'].filter(Boolean).join(' ');
  const title = escapeHtml(goal.title);
  return `<button class="${classes}" type="button" data-goal="${escapeHtml(goal.id)}"${disabled ? ' disabled' : ''}>`
    + `<span class="sl-num${gray ? ' is-gray' : ''}" aria-label="${done ? '달성' : `${number}번`}">${done ? '✓' : number}</span>`
    + `<span class="gc-goal-title" title="${title}">${title}</span><span class="gc-goal-right">${right}</span></button>`;
}

function listHtml(state, quarter) {
  if (!state) return `<p class="gc-message">${controller.loaded ? escapeHtml(failureText(controller.error)) : '불러오는 중이에요'}</p>`;
  if (!state.goals.length) return '<p class="gc-message">이번 분기 목표를 적어 보세요</p>';
  const disabled = isPast();
  return goalRows(state.goals, quarter).map(row => rowHtml(row, disabled)).join('');
}

// ───────── 팝업 ─────────
function stepsHtml(goal) {
  const steps = goal.steps.map(step => {
    const text = escapeHtml(step.title);
    return `<div class="gc-step${step.done ? ' is-done' : ''}" data-step="${escapeHtml(step.id)}">`
      + `<span class="sl-check${step.done ? ' is-on' : ''}" aria-hidden="true"><span class="sl-check-box"></span></span>`
      + `<span class="gc-step-text" title="${text}">${text}</span>`
      + `<button class="sl-delete" type="button" data-step-delete="${escapeHtml(step.id)}" aria-label="세부 단계 삭제: ${text}">✕</button></div>`;
  }).join('');
  if (goal.steps.length) return steps;
  // 세부 단계가 없으면 10칸(10%~100%) 막대로 직접 조절. 같은 칸을 다시 누르면 한 칸 내려간다.
  const progress = goalProgress(goal);
  const cells = Array.from({ length:10 }, (_, index) => {
    const value = (index + 1) * 10;
    return `<button class="gc-cell${progress >= value ? ' is-on' : ''}" type="button" data-pct="${value}" title="${value}%" aria-label="${value}%"></button>`;
  }).join('');
  return `<div class="gc-cells">${cells}</div>`;
}

function renderPop(state) {
  const goal = openId && state ? state.goals.find(item => item.id === openId) : null;
  if (!goal || isPast()) {
    if (!layer.hidden) closePop(false);
    return;
  }
  const done = goal.status === 'done', hold = goal.status === 'hold';
  popNum.textContent = done ? '✓' : String(numberOf(state.goals, goal.id));
  popNum.classList.toggle('is-gray', done || hold);
  // 입력 중인 제목은 덮어쓰지 않는다.
  if (document.activeElement !== popTitle) popTitle.value = goal.title;
  popPct.textContent = `${goalProgress(goal)}%`;
  const steps = stepsHtml(goal);
  if (steps !== lastSteps) { popSteps.innerHTML = steps; lastSteps = steps; }
  stepInput.hidden = goal.steps.length >= STEP_LIMIT;
  popHold.textContent = hold ? '보류 풀기' : '보류';
  layer.hidden = false;
}

function openPop(id) {
  if (!editable() || !findGoal(id)) return;
  openId = id;
  lastSteps = '';
  stepInput.value = '';
  render();
}
function commitTitle() {
  const goal = findGoal(openId);
  if (!goal) return;
  const title = cleanText(popTitle.value, TITLE_MAX.goal);
  if (!title) { popTitle.value = goal.title; return; }
  if (title !== goal.title) controller.submit([{ type:'updateGoal', id:goal.id, title }]);
}
function closePop(commit = true) {
  if (commit && openId) commitTitle();
  openId = null;
  layer.hidden = true;
  if (layer.contains(document.activeElement)) document.activeElement.blur();
}

// ───────── 그리기 ─────────
function render() {
  const quarter = getQuarter();
  const state = controller.view();
  const html = listHtml(state, quarter);
  if (html !== lastList) { listEl.innerHTML = html; lastList = html; }
  const count = state?.goals.length || 0;
  const canAdd = Boolean(state) && !isPast();
  addRow.classList.toggle('is-open', canAdd && count < GOAL_LIMIT);
  addRow.classList.toggle('is-full', canAdd && count >= GOAL_LIMIT);
  renderPop(state);
  const error = controller.error;
  noticeEl.textContent = state && error ? staleText(error) : '';
  app.dataset.status = !controller.loaded ? 'loading' : !state ? 'error' : error ? 'stale' : 'ready';
  app.dataset.mode = getMode();
  app.dataset.quarter = quarter;
}

// ───────── 입력 ─────────
function addGoal() {
  const title = cleanText(goalInput.value, TITLE_MAX.goal);
  if (!title) return;
  if ((controller.view()?.goals.length || 0) >= GOAL_LIMIT) return;
  if (controller.submit([{ type:'addGoal', id:makeId(), title }])) goalInput.value = '';
}
document.getElementById('goalAdd').addEventListener('click', addGoal);
goalInput.addEventListener('keydown', event => { if (isEnter(event)) { event.preventDefault(); addGoal(); } });

listEl.addEventListener('click', event => {
  const row = event.target.closest('[data-goal]');
  if (row && !row.disabled) openPop(row.dataset.goal);
});

layer.addEventListener('click', event => {
  // 바깥(어두운 곳) 클릭이나 ✕로 닫기
  if (event.target === layer || event.target.closest('[data-close]')) { closePop(); return; }
  const goal = findGoal(openId);
  if (!goal) return;
  const remove = event.target.closest('[data-step-delete]');
  if (remove) { controller.submit([{ type:'removeStep', goalId:goal.id, stepId:remove.dataset.stepDelete }]); return; }
  const step = event.target.closest('[data-step]');
  if (step) {
    const current = goal.steps.find(item => item.id === step.dataset.step);
    if (current) controller.submit([{ type:'setStep', goalId:goal.id, stepId:current.id, done:!current.done }]);
    return;
  }
  const cell = event.target.closest('[data-pct]');
  if (cell) {
    const value = Number(cell.dataset.pct);
    controller.submit([{ type:'updateGoal', id:goal.id, pct:goal.pct === value ? value - 10 : value }]);
    return;
  }
  if (event.target.closest('#popHold')) { controller.submit([{ type:'updateGoal', id:goal.id, hold:goal.status !== 'hold' }]); return; }
  if (event.target.closest('#popDelete')) { closePop(false); controller.submit([{ type:'removeGoal', id:goal.id }]); }
});
popTitle.addEventListener('keydown', event => { if (isEnter(event)) { event.preventDefault(); popTitle.blur(); } });
popTitle.addEventListener('blur', commitTitle);
stepInput.addEventListener('keydown', event => {
  if (!isEnter(event)) return;
  event.preventDefault();
  const goal = findGoal(openId);
  const title = cleanText(stepInput.value, TITLE_MAX.step);
  if (!goal || !title || goal.steps.length >= STEP_LIMIT) return;
  if (controller.submit([{ type:'addStep', goalId:goal.id, stepId:makeId(), title }])) stepInput.value = '';
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !layer.hidden) closePop(); });

const reload = () => { closePop(); controller.load(); };
onModeChange(reload);
onQuarterChange(reload);
onDayChange(render);
render();
controller.load();
watchQuarterGoals(() => controller.load());
