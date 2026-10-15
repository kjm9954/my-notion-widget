// ③ 이번 주 한 일: 업무일지 데이터를 월~금 5칸으로 모은다. 직접 입력 없음(완료 원 체크만).
import { getMode, onModeChange, modeToggleHtml, bindModeToggle, watchWorklog, createWorklogController,
  taskOps, toggleTarget, escapeHtml, staleText, failureText } from './sky-lime-common.mjs?v=20261015-sky-lime';
import { weekDays, dayCountLabel, worklogToday, mondayOf, addDays, weekRangeLabel, goalNumber, isDone } from './sky-lime-model.mjs?v=20261015-sky-lime';

const MAX_PER_DAY = 6;
const ROW = 28;
const MORE = 24;
const app = document.getElementById('app');
const daysEl = document.getElementById('days');
const rangeEl = document.getElementById('range');
const toggleEl = document.getElementById('modeToggle');
const noticeEl = document.getElementById('notice');
const liveEl = document.getElementById('live');
const controller = createWorklogController(event => {
  if (event.type === 'save-error') liveEl.textContent = '저장하지 못했어요. 다시 시도해 주세요.';
  if (event.type === 'blocked') liveEl.textContent = '연결이 돌아오면 바꿀 수 있어요.';
  render();
});
let today = worklogToday();
let monday = mondayOf(today);
let followThisWeek = true;
let lastSignature = '';

function itemHtml(task) {
  const done = isDone(task);
  const number = goalNumber(task);
  const title = escapeHtml(task.title || '');
  return `<div class="sl-day-item${done ? ' is-done' : ''}" data-task-id="${escapeHtml(task.id)}">`
    + `<button class="sl-dot-button${done ? ' is-on' : ''}" type="button" role="checkbox" aria-checked="${done}" data-toggle="${escapeHtml(task.id)}" aria-label="${done ? '완료 취소' : '완료 표시'}: ${title}"><span class="sl-dot"></span></button>`
    + (number ? `<span class="sl-num${done ? ' is-done' : ''}" aria-label="${number}번">${number}</span>` : '')
    + `<span class="sl-day-text" title="${title}">${title}</span></div>`;
}

function dayInner(day, limit, emptyLabel) {
  const head = `<div class="sl-day-head"><span class="sl-day-name">${day.label}${day.date === today ? '<span class="sl-today-badge">오늘</span>' : ''}</span><span class="sl-day-count">${dayCountLabel(day)}</span></div>`;
  if (!day.total) return `${head}<div class="sl-day-empty">${emptyLabel}</div>`;
  const shown = day.items.slice(0, limit);
  const more = day.total - shown.length;
  return head + shown.map(itemHtml).join('') + (more > 0 ? `<div class="sl-day-more">외 ${more}개</div>` : '');
}

// 하루 최대 6줄. 높이가 모자라면 들어가는 만큼만 보이고 나머지는 "외 n개".
function fitDay(column, day, emptyLabel) {
  let limit = Math.min(MAX_PER_DAY, day.total);
  if (day.total > MAX_PER_DAY) limit = MAX_PER_DAY;
  column.innerHTML = dayInner(day, limit, emptyLabel);
  const room = column.clientHeight - 20 - 26;
  if (column.scrollHeight <= column.clientHeight + .5 || room <= 0) return;
  limit = Math.max(0, Math.min(limit, Math.floor((room - MORE) / ROW)));
  column.innerHTML = dayInner(day, limit, emptyLabel);
  while (limit > 0 && column.scrollHeight > column.clientHeight + .5) {
    limit -= 1;
    column.innerHTML = dayInner(day, limit, emptyLabel);
  }
}

function render() {
  const mode = getMode();
  toggleEl.innerHTML = modeToggleHtml(mode);
  rangeEl.textContent = weekRangeLabel(monday);
  rangeEl.setAttribute('aria-label', `${monday}부터 ${addDays(monday, 4)}까지`);
  const state = controller.view();
  const error = controller.error;
  noticeEl.textContent = state && error ? staleText(error) : '';
  app.dataset.status = !controller.loaded ? 'loading' : !state ? 'error' : error ? 'stale' : 'ready';
  app.dataset.mode = mode;
  if (!state) {
    const message = controller.loaded ? failureText(error) : '불러오는 중이에요';
    daysEl.innerHTML = `<p class="sl-message">${escapeHtml(message)}</p>`;
    lastSignature = '';
    return;
  }
  const days = weekDays(state, mode, monday);
  const signature = JSON.stringify([mode, today, monday, daysEl.clientHeight, days.map(day => day.items.map(task => [task.id, task.title, isDone(task), goalNumber(task)]))]);
  if (signature === lastSignature) return;
  lastSignature = signature;
  daysEl.innerHTML = days.map(day => `<section class="sl-day${day.date === today ? ' is-today' : ''}" data-date="${day.date}" aria-label="${day.label}요일"></section>`).join('');
  const emptyLabel = mode === 'life' ? '일상 없음' : '업무 없음';
  days.forEach((day, index) => fitDay(daysEl.children[index], day, emptyLabel));
}

app.addEventListener('click', event => {
  const arrow = event.target.closest('[data-week]');
  if (arrow) {
    monday = addDays(monday, Number(arrow.dataset.week) * 7);
    followThisWeek = monday === mondayOf(today);
    render();
    return;
  }
  const dot = event.target.closest('[data-toggle]');
  if (dot) {
    const task = (controller.view()?.tasks || []).find(item => String(item.id) === dot.dataset.toggle);
    if (task) controller.submit(taskOps.status(task.id, toggleTarget(task)));
  }
});

bindModeToggle(app);
onModeChange(render);
new ResizeObserver(() => { lastSignature = ''; render(); }).observe(daysEl);
render();
controller.load();
watchWorklog(() => controller.load());
setInterval(() => {
  const next = worklogToday();
  if (next === today) return;
  today = next;
  if (followThisWeek) monday = mondayOf(today);
  lastSignature = '';
  render();
}, 60000);
