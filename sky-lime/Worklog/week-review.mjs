// ③ 이번 주 한 일: 업무일지 데이터를 업무는 월~금 5칸, 일상은 월~일 7칸으로 모은다. 직접 입력 없음(완료 원 체크만).
import { getMode, onModeChange, paintModeToggle, bindModeToggle, watchWorklog, createWorklogController,
  taskOps, toggleTarget, escapeHtml, staleText, failureText } from './sky-lime-common.mjs?v=20261015-sky-lime';
import { weekDays, dayCountLabel, worklogToday, mondayOf, addDays, weekRangeLabel, goalNumber, isDone,
  orderedTasks, modeOf, effectiveDay, weekdayLabel, isDate, weeklyGoals } from './sky-lime-model.mjs?v=20261015-sky-lime';

const MAX_PER_DAY = 6;
const ROW = 28;
const MORE = 24;
const app = document.getElementById('app');
const daysEl = document.getElementById('days');
const rangeEl = document.getElementById('range');
const toggleEl = document.getElementById('modeToggle');
const noticeEl = document.getElementById('notice');
const liveEl = document.getElementById('live');
const compactEl = document.getElementById('compact');
const weekRowsEl = document.getElementById('weekRows');
const weekSumEl = document.getElementById('weekSum');
const controller = createWorklogController(event => {
  if (event.type === 'save-error') liveEl.textContent = '저장하지 못했어요. 다시 시도해 주세요.';
  if (event.type === 'blocked') liveEl.textContent = '연결이 돌아오면 바꿀 수 있어요.';
  render();
});
let today = worklogToday();
let monday = mondayOf(today);
let followThisWeek = true;
let lastSignature = '';

// ───────── 좁은 폭(모바일) 레이아웃: 숫자·점 요약 ─────────
// AGENTS.md 반응형 기준: 위젯 폭 640px 미만이면 요일 줄(완료 점 + 숫자, 업무 5줄·일상 7줄) + 이번 주 요약 한 줄. 그 이상은 요일 열.
// 일상은 7열이라 칸이 좁아지므로 700px 미만부터 요일 줄을 쓴다.
// 업무명·번호 원은 그리지 않는다(읽기 전용). 완료·남은 개수는 넓은 레이아웃과 같은 요일 계산(그날 업무, 이월 제외)을 쓴다.
const COMPACT_BELOW = 640;
const LIFE_COMPACT_BELOW = 700;
const DOT = 12;
const DOT_GAP = 5;
let compact = false;
let compactSignature = '';
const isCompactWidth = mode => document.documentElement.clientWidth < (mode === 'life' ? LIFE_COMPACT_BELOW : COMPACT_BELOW);

// ───────── 이월 업무 (화면 계산만 한다. 업무의 date·status는 바꾸거나 저장하지 않는다) ─────────
// 보이는 기간 = 처음 만든 날 ~ 끝난 날(완료: doneAt, 없으면 date / 미완료: 오늘). 일 모드는 주말 제외.
// 처음 만든 날은 업무 id에 든 생성 시각(UUID v7, "밀리초-…" 형식)으로만 안다. 모르면 지금처럼 한 요일에만 보인다.
const MIN_CREATED_MS = Date.UTC(2020, 0, 1);
function createdDay(task) {
  const id = String(task?.id ?? '');
  const v7 = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.exec(id);
  const stamp = /^(\d{13})-/.exec(id);
  const ms = v7 ? parseInt(v7[1] + v7[2], 16) : stamp ? Number(stamp[1]) : NaN;
  return Number.isFinite(ms) && ms >= MIN_CREATED_MS ? worklogToday(ms) : null;
}
// date(지난 요일)에 이월 업무로 보이는지. ownDay는 그 업무가 원래 보이는 요일(완료한 날, 없으면 date).
function carriedOn(task, date, ownDay) {
  if (date >= today || date === ownDay) return false;
  if (modeOf(task) === 'work' && ['토', '일'].includes(weekdayLabel(date))) return false;
  const created = createdDay(task);
  if (!created) return false;
  const end = isDone(task) ? (isDate(task.doneAt) ? task.doneAt : task.date) : today;
  const start = [created, task.rolledFrom, task.date].filter(isDate).sort()[0];
  return task.date <= end && start <= date && date <= end;
}
// 요일마다 그날 업무(기존 규칙, 완료 먼저) 뒤에 이월 업무를 붙인다. "n개 남음"은 그날 업무로만 센다.
const qOf = task => Number.isInteger(task.q) && task.q >= 1 && task.q <= 4 ? task.q : 5;
function withCarry(day, tasks) {
  const carry = tasks.filter(task => carriedOn(task, day.date, effectiveDay(task)))
    .sort((a, b) => (goalNumber(a) || 9) - (goalNumber(b) || 9) || qOf(a) - qOf(b) || a.order - b.order);
  return { ...day, rows:[...day.items, ...carry], carry:new Set(carry.map(task => String(task.id))) };
}

// ───────── 보이는 요일: 업무 월~금 5칸, 일상 월~일 7칸 ─────────
// 일상의 토·일은 모델의 weekDays(시작일부터 5칸)를 토요일부터 한 번 더 불러 앞 2칸만 붙인다(같은 정렬·개수 규칙).
const lastDayOf = mode => addDays(monday, mode === 'life' ? 6 : 4);
function visibleDays(state, mode) {
  const days = weekDays(state, mode, monday);
  return mode === 'life' ? [...days, ...weekDays(state, mode, addDays(monday, 5)).slice(0, 2)] : days;
}
const isWeekend = day => ['토', '일'].includes(day.label);
function rangeLabel(mode) {
  if (mode !== 'life') return weekRangeLabel(monday);
  const short = date => `${Number(date.slice(5, 7))}.${date.slice(8)}`;
  return `${short(monday)} – ${short(lastDayOf(mode))}`;
}

// 이월 업무는 그 요일에 아직 끝나지 않았던 업무라 흐린 글자 + 빈 원. 원은 누를 수 없다(지난 요일에서 상태를 바꾸지 않게).
function itemHtml(task, carry) {
  const done = !carry && isDone(task);
  const number = goalNumber(task);
  const title = escapeHtml(task.title || '');
  const dot = carry
    ? '<span class="sl-dot-button" aria-hidden="true"><span class="sl-dot"></span></span>'
    : `<button class="sl-dot-button${done ? ' is-on' : ''}" type="button" role="checkbox" aria-checked="${done}" data-toggle="${escapeHtml(task.id)}" aria-label="${done ? '완료 취소' : '완료 표시'}: ${title}"><span class="sl-dot"></span></button>`;
  return `<div class="sl-day-item${done ? ' is-done' : ''}${carry ? ' is-carry' : ''}" data-task-id="${escapeHtml(task.id)}">`
    + dot
    + (number ? `<span class="sl-num${done ? ' is-done' : ''}" aria-label="${number}번">${number}</span>` : '')
    + `<span class="sl-day-text" title="${title}">${title}</span></div>`;
}

function dayInner(day, limit, emptyLabel) {
  const head = `<div class="sl-day-head"><span class="sl-day-name">${day.label}${day.date === today ? '<span class="sl-today-badge">오늘</span>' : ''}</span><span class="sl-day-count">${dayCountLabel(day)}</span></div>`;
  if (!day.rows.length) return `${head}<div class="sl-day-empty">${emptyLabel}</div>`;
  const shown = day.rows.slice(0, limit);
  const more = day.rows.length - shown.length;
  return head + shown.map(task => itemHtml(task, day.carry.has(String(task.id)))).join('') + (more > 0 ? `<div class="sl-day-more">외 ${more}개</div>` : '');
}

// 하루 최대 6줄. 높이가 모자라면 들어가는 만큼만 보이고 나머지는 "외 n개".
function fitDay(column, day, emptyLabel) {
  let limit = Math.min(MAX_PER_DAY, day.rows.length);
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
// 칸이 좁아 머리줄이 넘칠 때만 "오늘" 배지 → 그래도 넘치면 개수 글자 순서로 화면에서 숨긴다.
// 오늘 칸은 하늘색 배경, 완료 여부는 업무마다 채운 원·빈 원으로 보이고, 읽기 도구에는 그대로 읽힌다.
function fitHead(column) {
  const name = column.querySelector('.sl-day-name');
  for (const part of [name.querySelector('.sl-today-badge'), column.querySelector('.sl-day-count')]) {
    if (part?.textContent && name.scrollWidth > name.clientWidth + .5) part.classList.add('sl-sr');
  }
}

// 요일 한 줄: 지난 요일은 완료 점만, 오늘은 완료 점 + 남은 업무 흰 점, 미래 요일은 점 없음.
function compactRow(day) {
  const done = day.items.filter(isDone).length;
  const when = day.date < today ? 'past' : day.date === today ? 'today' : 'future';
  const open = when === 'today' ? day.remaining : 0;
  const dots = when === 'future' ? 0 : done;
  const count = when === 'past' ? (done ? `${done}개 완료` : '–') : when === 'today' && day.total ? `${done} / ${day.total}` : '–';
  const label = when === 'today' ? `${day.label}요일 오늘, ${day.total}개 중 ${done}개 완료` : `${day.label}요일, ${count === '–' ? '완료 없음' : count}`;
  return { day, done, dots, open, count, when, label };
}
// 점이 폭을 넘으면 들어가는 만큼만 그리고 마지막에 "+n".
function paintDots(element, filled, open) {
  const total = filled + open;
  const dotsHtml = count => Array.from({ length:count }, (_, index) => `<span class="sl-wk-dot${index < filled ? '' : ' is-open'}"></span>`).join('');
  element.innerHTML = dotsHtml(total);
  if (element.scrollWidth <= element.clientWidth + .5) return;
  let shown = Math.max(0, Math.floor((element.clientWidth + DOT_GAP) / (DOT + DOT_GAP)) - 1);
  element.innerHTML = dotsHtml(shown) + `<span class="sl-wk-plus">+${total - shown}</span>`;
  while (shown > 0 && element.scrollWidth > element.clientWidth + .5) {
    shown -= 1;
    element.innerHTML = dotsHtml(shown) + `<span class="sl-wk-plus">+${total - shown}</span>`;
  }
}
function renderCompact(state, days, mode) {
  const rows = days.map(compactRow);
  const weekDone = rows.reduce((sum, row) => sum + row.done, 0);
  // 목표 요약: 이번 주 목표 위젯과 같은 계산(weeklyGoals)을 보고 있는 주에 적용한다.
  const goals = weeklyGoals(state, mode, monday);
  const goalsDone = goals.filter(isDone).length;
  const signature = JSON.stringify([mode, today, monday, weekRowsEl.clientWidth, weekRowsEl.clientHeight,
    rows.map(row => [row.done, row.open, row.count, row.day.total]), weekDone, goals.length, goalsDone]);
  if (signature === compactSignature) return;
  compactSignature = signature;
  weekRowsEl.innerHTML = rows.map(row => `<div class="sl-wk-row is-${row.when}${row.day.total ? '' : ' is-empty'}${isWeekend(row.day) ? ' is-weekend' : ''}" data-date="${row.day.date}" aria-label="${row.label}">`
    + `<span class="sl-wk-dow" aria-hidden="true">${row.day.label}</span><span class="sl-wk-dots" aria-hidden="true"></span>`
    + `<span class="sl-wk-count" aria-hidden="true">${row.count}</span></div>`).join('');
  rows.forEach((row, index) => paintDots(weekRowsEl.children[index].querySelector('.sl-wk-dots'), row.dots, row.open));
  const doneLabel = mode === 'life' ? '이번 주 한 일' : '이번 주 완료';
  weekSumEl.innerHTML = `<span>${doneLabel} <b>${weekDone}개</b></span>`
    + (goals.length ? `<span>목표 완료 <b>${goalsDone} / ${goals.length}</b></span>` : '<span>목표 –</span>');
}
function setCompact(next) {
  if (next === compact) return;
  compact = next;
  app.classList.toggle('is-compact', compact);
  compactEl.hidden = !compact;
  lastSignature = '';
  compactSignature = '';
}

function render() {
  const mode = getMode();
  setCompact(isCompactWidth(mode));
  paintModeToggle(toggleEl, mode);
  rangeEl.textContent = rangeLabel(mode);
  rangeEl.setAttribute('aria-label', `${monday}부터 ${lastDayOf(mode)}까지`);
  const state = controller.view();
  const error = controller.error;
  noticeEl.textContent = state && error ? staleText(error) : '';
  app.dataset.status = !controller.loaded ? 'loading' : !state ? 'error' : error ? 'stale' : 'ready';
  app.dataset.mode = mode;
  if (!state) {
    const message = controller.loaded ? failureText(error) : '불러오는 중이에요';
    daysEl.innerHTML = `<p class="sl-message">${escapeHtml(message)}</p>`;
    lastSignature = '';
    if (compact) {
      weekRowsEl.innerHTML = `<p class="sl-message">${escapeHtml(message)}</p>`;
      weekSumEl.innerHTML = '';
      compactSignature = '';
    }
    return;
  }
  const tasks = orderedTasks(state).filter(task => modeOf(task) === mode);
  const days = visibleDays(state, mode).map(day => withCarry(day, tasks));
  if (compact) { renderCompact(state, days, mode); return; }
  const signature = JSON.stringify([mode, today, monday, daysEl.clientHeight,
    days.map(day => day.rows.map(task => [task.id, task.title, isDone(task), goalNumber(task), day.carry.has(String(task.id))]))]);
  if (signature === lastSignature) return;
  lastSignature = signature;
  daysEl.innerHTML = days.map(day => `<section class="sl-day${day.date === today ? ' is-today' : ''}${isWeekend(day) ? ' is-weekend' : ''}" data-date="${day.date}" aria-label="${day.label}요일"></section>`).join('');
  const emptyLabel = mode === 'life' ? '일상 없음' : '업무 없음';
  days.forEach((day, index) => {
    fitDay(daysEl.children[index], day, emptyLabel);
    fitHead(daysEl.children[index]);
  });
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
// 폭이 바뀌면(창 크기 조절·기기 회전) 새로고침 없이 두 레이아웃을 바꾼다(render가 폭·모드로 고른다). 줄 폭이 바뀌면 점 개수를 다시 센다.
new ResizeObserver(() => render()).observe(app);
render();
// 글꼴이 늦게 들어오면 머리줄 폭이 달라지므로 "오늘" 배지·개수 글자 숨김 판단을 다시 한다.
document.fonts?.ready.then(() => { lastSignature = ''; render(); });
controller.load();
watchWorklog(() => controller.load());
setInterval(() => {
  const next = worklogToday();
  if (next === today) return;
  today = next;
  if (followThisWeek) monday = mondayOf(today);
  lastSignature = '';
  compactSignature = '';
  render();
}, 60000);
