// Persist only through the existing task.goalId field. A numbered selection is
// local to each task: two tasks with number 1 remain two separate goal rows.
const GOAL_PREFIX = 'worklog:goal:';
// Display-only colors from the existing cream/olive palette. Never persist these
// defaults: goalId remains the source of the task's numbered selection.
const GOAL_NUMBER_APPEARANCE = Object.freeze({
  1:Object.freeze({ color:'#697A43', ink:'#FFFFFF' }),
  2:Object.freeze({ color:'#F4DDA0', ink:'#665C2F' }),
  3:Object.freeze({ color:'#9A6B52', ink:'#FFFFFF' })
});
export function goalNumberAppearance(number) {
  return Object.hasOwn(GOAL_NUMBER_APPEARANCE, number) ? GOAL_NUMBER_APPEARANCE[number] : null;
}
export function taskGoalNumber(task) {
  const match = /^worklog:goal:([123])$/.exec(String(task.goalId ?? ''));
  if (match) return Number(match[1]);
  // Backward compatibility for tasks selected by the previous checkbox UI.
  return task.id != null && String(task.id) !== '' && String(task.goalId ?? '') === String(task.id) ? 1 : 0;
}
export function nextTaskGoalId(task) {
  const number = taskGoalNumber(task);
  return number === 3 ? null : `${GOAL_PREFIX}${number + 1}`;
}

// A deliberate Q edit (or new/moved task) restores priority order for that day.
// Drag-only, completion, title and goal edits must leave manual order untouched.
// Inputs are normalized worklog states; only next.manualOrder is changed.
export function refreshPriorityOrder(previous, next) {
  const before = new Map(previous.tasks.map(task => [task.id, task]));
  const affected = new Set();
  for (const task of next.tasks) {
    const old = before.get(task.id);
    if (!old || old.q !== task.q || old.mode !== task.mode || old.date !== task.date) {
      affected.add(`${task.mode}:${task.date}`);
    }
  }
  const source = new Map(next.tasks.map((task, index) => [task.id, index]));
  for (const key of affected) {
    const manual = next.manualOrder?.[key];
    if (!Array.isArray(manual) || !manual.length) continue;
    const positions = new Map(manual.map((id, index) => [id, index]));
    next.manualOrder[key] = next.tasks.filter(task => `${task.mode}:${task.date}` === key)
      .sort((a, b) => (a.q ?? 5) - (b.q ?? 5)
        || (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER)
        || source.get(a.id) - source.get(b.id))
      .map(task => task.id);
  }
}
