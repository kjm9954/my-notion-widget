// ① 이번 주 목표: 이번 주 번호(1·2·3)가 있는 업무만 자동 표시. 읽기 전용(완료는 업무일지에서).
// 완료한 목표는 화면에서만 숨긴다(데이터는 그대로). 보고 있던 목표가 완료되면 회색으로 1.5초 둔 뒤 사라진다.
import { getMode, onModeChange, paintModeToggle, bindModeToggle, watchWorklog, createWorklogController,
  escapeHtml, staleText, failureText } from './sky-lime-common.mjs?v=20261015-sky-lime';
import { weeklyGoals, worklogToday, mondayOf, isDone } from './sky-lime-model.mjs?v=20261015-sky-lime';

const CELLS = 5;
const HOLD_MS = 1500;
const app = document.getElementById('app');
const goalsEl = document.getElementById('goals');
const toggleEl = document.getElementById('modeToggle');
const noticeEl = document.getElementById('notice');
const controller = createWorklogController(render);
let lastHtml = '';
let lastDay = worklogToday();

// ───────── 완료한 목표 숨기기 ─────────
// openSeen: 이 화면에서 미완료로 그린 목표. 이 목표가 완료로 바뀌면 그때만 회색으로 1.5초 보여준다.
// 처음 열 때·새로고침·업무/일상 전환·주가 바뀔 때 이미 완료된 목표는 아예 그리지 않는다.
// leaving: 사라지는 중인 목표마다 타이머를 따로 둔다. 그 사이 다시 읽기가 와도 타이머는 그대로 두고,
// 완료가 취소되면 타이머를 멈추고 원래 카드로 돌린다.
let scope = '';
let openSeen = new Set();
const leaving = new Map();

function closeMs() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--t-close'));
  return Number.isFinite(value) ? value : 160;
}
function startLeaving(id) {
  const entry = { closing:false, timer:0 };
  entry.timer = setTimeout(() => {
    entry.closing = true;
    render(); // 카드에 is-leaving → var(--t-close) 동안 흐려짐
    entry.timer = setTimeout(() => { leaving.delete(id); render(); }, closeMs());
  }, HOLD_MS);
  leaving.set(id, entry);
}
function stopLeaving(id) {
  const entry = leaving.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  leaving.delete(id);
}

function visibleGoals(state, mode) {
  const today = worklogToday();
  const key = `${mode}:${mondayOf(today)}`;
  if (key !== scope) {
    scope = key;
    openSeen = new Set();
    [...leaving.keys()].forEach(stopLeaving);
  }
  const goals = weeklyGoals(state, mode, today);
  const ids = new Set(goals.map(goal => String(goal.id)));
  [...leaving.keys()].filter(id => !ids.has(id)).forEach(stopLeaving);
  const shown = [];
  for (const goal of goals) {
    const id = String(goal.id);
    if (!isDone(goal)) {
      stopLeaving(id);
      openSeen.add(id);
      shown.push(goal);
    } else if (leaving.has(id)) {
      shown.push(goal);
    } else if (openSeen.has(id)) {
      openSeen.delete(id);
      startLeaving(id);
      shown.push(goal);
    }
  }
  return { goals, shown };
}

function goalsHtml(state, mode) {
  const { goals, shown } = visibleGoals(state, mode);
  if (!goals.length) return { columns:CELLS, html:'<p class="sl-message">업무일지에서 번호를 지정하면 여기에 표시돼요</p>' };
  if (!shown.length) return { columns:CELLS, html:'<p class="sl-message">이번 주 목표 완료</p>' };
  // 남은 카드가 가로 폭을 나눠 채운다(최대 5칸). 6개 이상이면 5번째 칸을 "외 n개"로 쓴다.
  const over = shown.length > CELLS;
  const cards = over ? shown.slice(0, CELLS - 1) : shown;
  const cells = cards.map(goal => {
    const done = isDone(goal);
    const closing = leaving.get(String(goal.id))?.closing;
    const title = escapeHtml(goal.title || '');
    return `<div class="sl-goal${done ? ' is-done' : ''}${closing ? ' is-leaving' : ''}" data-goal-id="${escapeHtml(goal.id)}"><span class="sl-num${done ? ' is-done' : ''}" aria-label="${goal.number}번">${goal.number}</span><span class="sl-goal-text" title="${title}">${title}</span></div>`;
  });
  if (over) cells.push(`<div class="sl-goal sl-goal-more">외 ${shown.length - cards.length}개</div>`);
  return { columns:cells.length, html:cells.join('') };
}

function render() {
  const mode = getMode();
  paintModeToggle(toggleEl, mode);
  const state = controller.view();
  const error = controller.error;
  let view;
  if (!controller.loaded) view = { columns:CELLS, html:'<p class="sl-message">불러오는 중이에요</p>' };
  else if (!state) view = { columns:CELLS, html:`<p class="sl-message">${escapeHtml(failureText(error))}</p>` };
  else view = goalsHtml(state, mode);
  goalsEl.style.setProperty('--goal-columns', String(view.columns));
  // 사라지는 중인 카드는 같은 요소에 클래스만 붙여야 흐려지는 모션이 보인다.
  if (view.html !== lastHtml) {
    const closing = goalsEl.querySelectorAll('.sl-goal[data-goal-id]');
    const sameCards = view.html.replaceAll(' is-leaving', '') === lastHtml.replaceAll(' is-leaving', '');
    if (sameCards && closing.length) {
      closing.forEach(card => card.classList.toggle('is-leaving', Boolean(leaving.get(card.dataset.goalId)?.closing)));
    } else goalsEl.innerHTML = view.html;
    lastHtml = view.html;
  }
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
