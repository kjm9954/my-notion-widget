// ① 이번 주 목표: 이번 주 번호(1·2·3)가 있는 업무만 자동 표시. 읽기 전용.
import { getMode, onModeChange, modeToggleHtml, bindModeToggle, watchWorklog, createWorklogController,
  escapeHtml, staleText, failureText } from './sky-lime-common.mjs?v=20261015-sky-lime';
import { weeklyGoals, worklogToday, isDone } from './sky-lime-model.mjs?v=20261015-sky-lime';

const CELLS = 5;
const app = document.getElementById('app');
const goalsEl = document.getElementById('goals');
const toggleEl = document.getElementById('modeToggle');
const noticeEl = document.getElementById('notice');
const controller = createWorklogController(render);
let lastHtml = '';
let lastDay = worklogToday();

function goalsHtml(state, mode) {
  const goals = weeklyGoals(state, mode, worklogToday());
  if (!goals.length) return '<p class="sl-message">업무일지에서 번호를 지정하면 여기에 표시돼요</p>';
  // 한 줄 5칸 고정. 6개 이상이면 5번째 칸을 "외 n개"로 쓴다.
  const over = goals.length > CELLS;
  const shown = over ? goals.slice(0, CELLS - 1) : goals;
  const cells = shown.map(goal => {
    const done = isDone(goal);
    const title = escapeHtml(goal.title || '');
    return `<div class="sl-goal${done ? ' is-done' : ''}" data-goal-id="${escapeHtml(goal.id)}"><span class="sl-num${done ? ' is-done' : ''}" aria-label="${goal.number}번">${goal.number}</span><span class="sl-goal-text" title="${title}">${title}</span></div>`;
  });
  if (over) cells.push(`<div class="sl-goal sl-goal-more">외 ${goals.length - shown.length}개</div>`);
  return cells.join('');
}

function render() {
  const mode = getMode();
  toggleEl.innerHTML = modeToggleHtml(mode);
  const state = controller.view();
  const error = controller.error;
  let html;
  if (!controller.loaded) html = '<p class="sl-message">불러오는 중이에요</p>';
  else if (!state) html = `<p class="sl-message">${escapeHtml(failureText(error))}</p>`;
  else html = goalsHtml(state, mode);
  if (html !== lastHtml) { goalsEl.innerHTML = html; lastHtml = html; }
  noticeEl.textContent = state && error ? staleText(error) : '';
  app.dataset.status = !controller.loaded ? 'loading' : !state ? 'error' : error ? 'stale' : 'ready';
  app.dataset.mode = mode;
}

bindModeToggle(app);
onModeChange(render);
render();
controller.load();
watchWorklog(() => controller.load());
// 오전 6시가 지나 업무일이 바뀌면 이번 주 기준도 다시 계산한다.
setInterval(() => { const day = worklogToday(); if (day !== lastDay) { lastDay = day; render(); } }, 60000);
