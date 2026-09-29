import { seoulDateKey, addDateKeyDays, isDateKey, weekdayOfDateKey } from '../../schedule-core.js';
import { taskGoalNumber, goalNumberAppearance } from './worklog-task-controls.mjs?v=20260929-goal-colors';

// Reuse the server's Seoul clock. Due badges use midnight (worklog calendarToday);
// worklog's business day rolls at 06:00; the existing goals editor rolls at midnight.
export const calendarToday = (now = Date.now()) => seoulDateKey(now);
export const worklogToday = (now = Date.now()) => seoulDateKey(Number(now) - 6 * 60 * 60 * 1000);
export const addDays = addDateKeyDays;
export const mondayOf = date => addDays(date, 1 - weekdayOfDateKey(date));
export function isoWeekKey(date) {
  const thursday = addDays(mondayOf(date), 3);
  const year = Number(thursday.slice(0, 4));
  const week = Math.ceil(((Date.parse(thursday) - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
export function normalizeWeek(value) {
  const key = String(value || '');
  const date = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(key);
  if (date) {
    const padded = `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`;
    return isDateKey(padded) ? mondayOf(padded) : '';
  }
  const iso = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!iso || Number(iso[2]) < 1 || Number(iso[2]) > 53) return '';
  const monday = addDays(mondayOf(`${iso[1]}-01-04`), (Number(iso[2]) - 1) * 7);
  return isoWeekKey(monday) === key ? monday : '';
}
export function normalizeGoals(source) {
  // Both layouts are already recognized by worklog's goalsForTask(). No invented keys.
  const rows = Array.isArray(source) ? source : source?.weeklyGoals ?? source?.items;
  if (!Array.isArray(rows)) throw new TypeError('목표 응답 형식이 올바르지 않습니다.');
  return rows.filter(goal => goal && goal.id != null && (!goal.m || goal.m === 'work') && (!goal.mode || goal.mode === 'work')).map(goal => {
    const week = normalizeWeek(goal.weekKey || source.week);
    if (!week) throw new TypeError('목표의 주차를 확인할 수 없습니다.');
    return { id: String(goal.id), name: String(goal.name ?? goal.text ?? ''), color: goal.color || null, weekKey: week };
  });
}
export function normalizeSnapshot(worklog, goals) {
  if (!Array.isArray(worklog?.tasks)) throw new TypeError('업무 응답 형식이 올바르지 않습니다.');
  const tasks = worklog.tasks.filter(task => task && task.mode === 'work');
  // Preserve the same per-day manual ordering used by the worklog.
  const ordered = [...tasks];
  for (const ids of Object.values(worklog.manualOrder || {})) {
    if (!Array.isArray(ids)) continue;
    const positions = new Map(ids.map((id, i) => [String(id), i]));
    const slots = ordered.flatMap((task, i) => positions.has(String(task.id)) ? [i] : []);
    const values = slots.map(i => ordered[i]).sort((a, b) => positions.get(String(a.id)) - positions.get(String(b.id)));
    slots.forEach((slot, i) => { ordered[slot] = values[i]; });
  }
  const weeklyGoals = normalizeGoals(goals);
  // Numbered task selections are independent rows, even with the same number.
  // Derive name/week/completion from each task; never duplicate user data.
  for (const task of ordered) {
    const number = taskGoalNumber(task);
    if (!number || task.id == null || !String(task.id) || !isDateKey(task.date)) continue;
    const id = String(task.id), weekKey = mondayOf(task.date);
    // Keep pre-existing links to independently saved goals unchanged.
    if (String(task.goalId) === id && weeklyGoals.some(goal => goal.id === id && goal.weekKey === weekKey)) continue;
    weeklyGoals.push({ id, taskId:id, number, name:String(task.title || ''), color:goalNumberAppearance(number).color, weekKey });
  }
  return { tasks: ordered, weeklyGoals };
}
export function goalForTask(state, task) {
  if (task.goalId == null || !isDateKey(task.date)) return null;
  const ownGoal = taskGoalNumber(task) && state.weeklyGoals.find(goal => goal.taskId === String(task.id) && goal.weekKey === mondayOf(task.date));
  if (ownGoal) return ownGoal;
  return state.weeklyGoals.find(goal => goal.id === String(task.goalId) && goal.weekKey === mondayOf(task.date)) || null;
}
export function summarizeGoals(state, monday) {
  const end = addDays(monday, 6);
  return state.weeklyGoals.filter(goal => goal.weekKey === monday).map((goal, index) => {
    const tasks = state.tasks.filter(task => task.mode === 'work' && isDateKey(task.date) && task.date >= monday && task.date <= end && goalForTask(state, task) === goal);
    return { ...goal, number: goal.number ?? index + 1, total: tasks.length, done: tasks.filter(task => task.done === true).length };
  }).sort((a, b) => a.number - b.number);
}
export function deadlines(state, today) {
  return state.tasks.map((task, originalIndex) => ({ ...task, originalIndex }))
    .filter(task => task.mode === 'work' && task.done === false && isDateKey(task.due) && task.due >= today && task.due <= addDays(today, 3))
    .map(task => ({ ...task, days: (Date.parse(task.due) - Date.parse(today)) / 86400000 }))
    .sort((a, b) => a.days - b.days || byPriority(a, b)).slice(0, 5);
}
export const qOf = task => Number.isFinite(task.q) ? task.q : 5;
export const byPriority = (a, b) => qOf(a) - qOf(b) || a.originalIndex - b.originalIndex;
export function weekDays(state, monday) {
  return ['월', '화', '수', '목', '금'].map((label, index) => {
    const date = addDays(monday, index);
    const tasks = state.tasks.map((task, originalIndex) => ({ ...task, originalIndex }))
      .filter(task => task.mode === 'work' && task.date === date)
      .sort((a, b) => Number(b.done === true) - Number(a.done === true) || byPriority(a, b));
    return { label, date, tasks, total: tasks.length, done: tasks.filter(task => task.done === true).length };
  });
}
export function monthCells(state, monthKey) {
  const first = `${monthKey}-01`;
  const [year, month] = monthKey.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const start = mondayOf(first);
  const length = Math.ceil(((Date.parse(last) - Date.parse(start)) / 86400000 + 1) / 7) * 7;
  const tasksByDue = new Map();
  for (const task of state.tasks) {
    if (task.mode !== 'work' || task.done !== false || !isDateKey(task.due)) continue;
    if (!tasksByDue.has(task.due)) tasksByDue.set(task.due, []);
    tasksByDue.get(task.due).push(task);
  }
  return Array.from({ length }, (_, index) => {
    const date = addDays(start, index);
    return { date, day: Number(date.slice(8)), otherMonth: date.slice(0, 7) !== monthKey,
      weekend: index % 7 >= 5, lastRow: index >= length - 7, tasks: tasksByDue.get(date) || [] };
  });
}
export function shiftMonth(monthKey, delta) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
}
export function createSource(store) {
  return {
    async read() {
      const [worklog, goals] = await Promise.all([
        store.loadWorklogState({ fresh: true }),
        store.loadWeeklyGoalsState({ fresh: true, worklogInstance: true })
      ]);
      return normalizeSnapshot(worklog, goals);
    },
    subscribe(callback) {
      return store.watch(callback, 120000, { allowWhileEditing: true, initial: false,
        paths: ['/api/worklog/', '/api/weekly-goals/'] });
    }
  };
}
// Pure display helpers only; no persistence or additional Store API.
export const api = { qOf, byPriority, deadlines, weekDays };
