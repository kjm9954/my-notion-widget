// sky-lime 위젯 4종의 순수 계산 함수. 저장·네트워크·DOM 접근 없음.
// 날짜 규칙은 기존 schedule-core.js를 그대로 쓴다.
//  - 업무일(오늘·D-n·주 계산): 한국 오전 6시 경계
//  - 완료한 날(doneAt): 기존 업무일지와 같은 한국 자정 기준 날짜
import { seoulDateKey, addDateKeyDays, isDateKey, weekdayOfDateKey } from '../../schedule-core.js';

export const DAY_ROLLOVER_MS = 6 * 60 * 60 * 1000;
export const worklogToday = (now = Date.now()) => seoulDateKey(Number(now) - DAY_ROLLOVER_MS);
export const calendarToday = (now = Date.now()) => seoulDateKey(Number(now));
export const addDays = addDateKeyDays;
export const isDate = isDateKey;
export const mondayOf = date => addDateKeyDays(date, 1 - weekdayOfDateKey(date));

const WEEKDAY = ['월', '화', '수', '목', '금', '토', '일'];
export const weekdayLabel = date => WEEKDAY[weekdayOfDateKey(date) - 1] || '';
export function dayLabel(date) {
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일 (${weekdayLabel(date)})`;
}
export function weekRangeLabel(monday) {
  const short = date => `${Number(date.slice(5, 7))}.${date.slice(8)}`;
  return `${short(monday)} – ${short(addDateKeyDays(monday, 4))}`;
}
export const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

// ───────── 상태 ─────────
// wait=예정, doing=진행중, review=검토 대기, done=완료. review를 모르는 서버가
// 다른 값으로 돌려줘도 화면은 그 값을 그대로 따른다.
export const STATUS_LABEL = Object.freeze({ doing:'진행중', review:'검토 대기', wait:'예정', done:'완료' });
export const LANE_ORDER = Object.freeze(['doing', 'review', 'wait']);
export const STATUS_CHOICES = Object.freeze(['doing', 'review', 'wait', 'done']);
const OPEN_STATUSES = new Set(['doing', 'review', 'wait']);

export const isDone = task => task?.done === true || task?.status === 'done';
export function statusOf(task) {
  if (isDone(task)) return 'done';
  return OPEN_STATUSES.has(task?.status) ? task.status : 'wait';
}
export const modeOf = item => item?.mode === 'life' ? 'life' : 'work';

// 검토 대기(review)는 서버가 지원할 때만 저장한다. 지원 신호: 상태 전용 Store 함수가 있거나,
// 서버 응답에 review 상태·prevStatus review·statusChangedAt 필드가 보일 때. 그 전에는 예정(wait)으로 저장·표시한다.
export function supportsReview(state, hasStatusApi = false) {
  if (hasStatusApi) return true;
  return (state?.tasks || []).some(task => task
    && (task.status === 'review' || task.prevStatus === 'review' || Object.hasOwn(task, 'statusChangedAt')));
}
export const storableStatus = (status, reviewSupported) => status === 'review' && !reviewSupported ? 'wait' : status;

// 체크 해제: 서버가 준 prevStatus로 되돌리고, 없거나 알 수 없으면 진행중.
export function uncheckStatus(task) {
  return OPEN_STATUSES.has(task?.prevStatus) ? task.prevStatus : 'doing';
}

// 기존 업무 저장 방식(전체 업무 upsert)으로 상태를 바꿀 때의 결과. 알 수 없는 필드는 보존한다.
export function withStatus(task, status, now = Date.now()) {
  const before = statusOf(task);
  const next = { ...task };
  if (status === 'done') {
    next.status = 'done';
    next.done = true;
    next.doneAt = before === 'done' ? (isDateKey(task.doneAt) ? task.doneAt : task.date) : calendarToday(now);
    if (before !== 'done') next.prevStatus = before;
  } else {
    next.status = OPEN_STATUSES.has(status) ? status : 'wait';
    next.done = false;
    next.doneAt = null;
  }
  return next;
}

// ───────── 번호(이번 주 목표) ─────────
// 기존 goalId 규칙: worklog:goal:1~3. 예전 체크 방식(goalId === id)은 1번.
const GOAL_RE = /^worklog:goal:([123])$/;
export function goalNumber(task) {
  const match = GOAL_RE.exec(String(task?.goalId ?? ''));
  if (match) return Number(match[1]);
  return task?.id != null && String(task.id) !== '' && String(task.goalId ?? '') === String(task.id) ? 1 : 0;
}
export const goalIdFor = number => [1, 2, 3].includes(number) ? `worklog:goal:${number}` : null;

// ───────── 구분 ─────────
export const OTHER_CATEGORY = '기타';
export const MAX_CATEGORIES = 6;
const isOtherCategory = value => !value || value === '미분류' || value === OTHER_CATEGORY;
export const categoryOf = task => {
  const value = String(task?.proj ?? '').trim();
  return isOtherCategory(value) ? OTHER_CATEGORY : value;
};
export const categoryValue = label => isOtherCategory(String(label ?? '').trim()) ? '' : String(label).trim();
// 선택지는 해당 모드 업무들의 proj 값을 처음 나온 순서로 모은다(기타 제외).
export function categoriesFor(tasks, mode) {
  const list = [];
  for (const task of tasks || []) {
    if (modeOf(task) !== mode) continue;
    const label = categoryOf(task);
    if (label !== OTHER_CATEGORY && !list.includes(label)) list.push(label);
  }
  return list;
}

// ───────── 마감 ─────────
// D-n은 보고 있는 날짜와 관계없이 실제 오늘(오전 6시 경계) 기준.
export function dueInfo(task, today) {
  if (!isDateKey(task?.due) || isDone(task)) return null;
  const diff = daysBetween(today, task.due);
  if (diff < 0) return { diff, text:`D+${-diff} 지남`, tone:'over' };
  if (diff === 0) return { diff, text:'D-day', tone:'dday' };
  return { diff, text:`D-${diff}`, tone:'normal' };
}
// 마감 지남 → D-day → 가까운 마감 → 마감 없음. 같은 값은 기존 순서 유지.
export function byDue(a, b) {
  const da = isDateKey(a.due) ? a.due : '9999-99-99';
  const db = isDateKey(b.due) ? b.due : '9999-99-99';
  return da < db ? -1 : da > db ? 1 : (a.order ?? 0) - (b.order ?? 0);
}

// ───────── 업무 목록 ─────────
// 서버 순서를 기본으로, 날짜별 수동 순서(manualOrder)는 기존 위젯과 같은 방식으로 반영한다.
export function orderedTasks(state) {
  const tasks = Array.isArray(state?.tasks) ? state.tasks.filter(task => task && task.id != null && isDateKey(task.date)) : [];
  const ordered = [...tasks];
  for (const ids of Object.values(state?.manualOrder || {})) {
    if (!Array.isArray(ids)) continue;
    const positions = new Map(ids.map((id, index) => [String(id), index]));
    const slots = ordered.flatMap((task, index) => positions.has(String(task.id)) ? [index] : []);
    const values = slots.map(index => ordered[index]).sort((a, b) => positions.get(String(a.id)) - positions.get(String(b.id)));
    slots.forEach((slot, index) => { ordered[slot] = values[index]; });
  }
  return ordered.map((task, order) => ({ ...task, order }));
}

export function tasksForDay(state, mode, date) {
  return orderedTasks(state).filter(task => modeOf(task) === mode && task.date === date);
}

export function board(tasks) {
  const lanes = Object.fromEntries([...LANE_ORDER, 'done'].map(status => [status, []]));
  for (const task of tasks) lanes[statusOf(task)].push(task);
  for (const status of LANE_ORDER) lanes[status].sort(byDue);
  lanes.done.sort((a, b) => a.order - b.order);
  const done = lanes.done.length;
  return { lanes, total:tasks.length, done, remaining:tasks.length - done };
}

// ───────── 이번 주 ─────────
// 완료한 업무는 doneAt 날짜, 없으면 기존 week-review 규칙대로 task.date.
export function effectiveDay(task) {
  return isDone(task) && isDateKey(task.doneAt) ? task.doneAt : task.date;
}

// 이번 주 목표: 오늘이 속한 주(월~금 표시, 주말에 끝낸 것도 같은 주로 본다)의 번호 있는 업무.
export function weeklyGoals(state, mode, today) {
  const monday = mondayOf(today);
  const sunday = addDateKeyDays(monday, 6);
  return orderedTasks(state)
    .filter(task => modeOf(task) === mode && goalNumber(task))
    .filter(task => { const day = effectiveDay(task); return day >= monday && day <= sunday; })
    .map(task => ({ ...task, number:goalNumber(task) }))
    .sort((a, b) => a.number - b.number || a.order - b.order);
}

// 이번 주 한 일: 월~금 5칸. 정렬은 번호(1→2→3→없음) → 완료 먼저 → 우선순위 → 기존 순서.
const qOf = task => Number.isInteger(task.q) && task.q >= 1 && task.q <= 4 ? task.q : 5;
export function weekDays(state, mode, monday) {
  const tasks = orderedTasks(state).filter(task => modeOf(task) === mode);
  return Array.from({ length:5 }, (_, index) => {
    const date = addDateKeyDays(monday, index);
    const items = tasks.filter(task => effectiveDay(task) === date)
      .sort((a, b) => (goalNumber(a) || 9) - (goalNumber(b) || 9)
        || Number(isDone(b)) - Number(isDone(a)) || qOf(a) - qOf(b) || a.order - b.order);
    const remaining = items.filter(task => !isDone(task)).length;
    return { date, label:weekdayLabel(date), items, total:items.length, remaining };
  });
}
export function dayCountLabel(day) {
  if (!day.total) return '';
  return day.remaining ? `${day.remaining}개 남음` : '모두 완료';
}

// ───────── 메모 ─────────
export const MAX_NOTES = 8;
// 서버가 메모 mode를 저장해 돌려줄 때만 업무/일상으로 나눈다. 그 전에는 두 모드가 같은 목록을 본다.
export const notesHaveMode = state => (Array.isArray(state?.items) ? state.items : []).some(item => item && Object.hasOwn(item, 'mode'));
export function notesFor(state, mode, byMode = true) {
  const items = Array.isArray(state?.items) ? state.items : [];
  return items.filter(item => item && item.id != null && String(item.text || '').trim() && (!byMode || modeOf(item) === mode));
}
