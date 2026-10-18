// 목표 체크 위젯 3종(분기 진행도·분기 목표·습관 점검)의 순수 계산 함수. 저장·네트워크·DOM 접근 없음.
// 날짜는 기존 업무일 규칙(한국 오전 6시 경계)을 그대로 쓴다.
import { worklogToday, daysBetween, addDays, isDate } from './sky-lime-model.mjs?v=20261015-sky-lime';

export const GOAL_LIMIT = 5;
export const HABIT_LIMIT = 5;
export const STEP_LIMIT = 6;
export const TITLE_MAX = { goal:120, step:100, habit:60 };
export const QUARTER_BACK = 4; // 지난 분기는 1년 전까지
export const QUARTER_AHEAD = 1; // 다음 분기는 1개까지
export const STALL_DAYS = 14;
export const CHECK_DAYS = 7; // 월말 마지막 7일 · 다음 달 첫 7일

export const MARKS = Object.freeze(['good', 'half', 'bad']);
export const MARK_SYMBOL = Object.freeze({ good:'◎', half:'△', bad:'✕' });
export const MARK_LABEL = Object.freeze({ good:'잘 지킴', half:'반반', bad:'못 지킴' });
const MARK_SCORE = Object.freeze({ good:100, half:50, bad:0 });

// ───────── 분기 ─────────
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
export const isQuarter = value => QUARTER_RE.test(String(value || ''));
const quarterIndex = quarter => { const [, y, q] = QUARTER_RE.exec(quarter); return Number(y) * 4 + Number(q) - 1; };
const fromIndex = index => `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
export const quarterOf = date => `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
export const currentQuarter = (now = Date.now()) => quarterOf(worklogToday(now));
export const shiftQuarter = (quarter, by) => fromIndex(quarterIndex(quarter) + by);
export const quarterDistance = (from, to) => quarterIndex(to) - quarterIndex(from);
export const quarterLabel = quarter => quarter.replace('-', ' ');
export function quarterMonths(quarter) {
  const first = (Number(quarter.slice(-1)) - 1) * 3 + 1;
  return [first, first + 1, first + 2];
}
const two = value => String(value).padStart(2, '0');
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
export function quarterRange(quarter) {
  const year = Number(quarter.slice(0, 4));
  const [first, , last] = quarterMonths(quarter);
  const start = `${year}-${two(first)}-01`;
  const end = `${year}-${two(last)}-${two(daysInMonth(year, last))}`;
  return { start, end, days:daysBetween(start, end) + 1 };
}
// -1 지난 분기 · 0 이번 분기 · 1 다음 분기
export const quarterRelation = (quarter, now = Date.now()) => Math.sign(quarterDistance(currentQuarter(now), quarter));
// 이동 범위: 이번 분기 기준 1년 전 ~ 다음 분기
export function quarterInRange(quarter, now = Date.now()) {
  if (!isQuarter(quarter)) return false;
  const distance = quarterDistance(currentQuarter(now), quarter);
  return distance >= -QUARTER_BACK && distance <= QUARTER_AHEAD;
}
export const canShiftQuarter = (quarter, by, now = Date.now()) => quarterInRange(shiftQuarter(quarter, by), now);

// ───────── 진행도 ─────────
// 달성 = 100 / 세부 단계가 있으면 체크 비율 / 없으면 pct
export function goalProgress(goal) {
  if (goal?.status === 'done') return 100;
  const steps = Array.isArray(goal?.steps) ? goal.steps : [];
  if (steps.length) return Math.round(steps.filter(step => step.done).length / steps.length * 100);
  return Math.max(0, Math.min(100, Math.round(Number(goal?.pct) || 0)));
}
// ◎ 100 · △ 50 · ✕ 0, 점검한 달만 평균. 점검한 달이 없으면 null(계산 제외)
export function habitScore(habit) {
  const marks = (habit?.months || []).filter(mark => MARKS.includes(mark));
  if (!marks.length) return null;
  return Math.round(marks.reduce((sum, mark) => sum + MARK_SCORE[mark], 0) / marks.length);
}
// (보류 제외 목표 진행도 + 점수 있는 습관 점수)의 평균, 반올림 정수. 항목 0개면 0
export function quarterProgress(state) {
  const items = [
    ...(state?.goals || []).filter(goal => goal.status !== 'hold').map(goalProgress),
    ...(state?.habits || []).map(habitScore).filter(score => score !== null)
  ];
  return items.length ? Math.round(items.reduce((sum, value) => sum + value, 0) / items.length) : 0;
}
// 오늘까지 지난 날 / 분기 총 일수. 지난 분기 100, 다음 분기 0
export function elapsedRate(quarter, now = Date.now()) {
  const relation = quarterRelation(quarter, now);
  if (relation < 0) return 100;
  if (relation > 0) return 0;
  const { start, days } = quarterRange(quarter);
  return Math.round((daysBetween(start, worklogToday(now)) + 1) / days * 100);
}
// 이번 분기 = 마지막 날까지 남은 날 / 지난 분기 = 종료 / 다음 분기 = n월 시작
export function quarterDday(quarter, now = Date.now()) {
  const relation = quarterRelation(quarter, now);
  if (relation < 0) return '종료';
  if (relation > 0) return `${quarterMonths(quarter)[0]}월 시작`;
  return `D-${daysBetween(worklogToday(now), quarterRange(quarter).end)}`;
}
// 경과율 띠: 이번 분기이고 진행도 < 경과율일 때만 경과율 길이
export function lagWidth(quarter, progress, now = Date.now()) {
  if (quarterRelation(quarter, now) !== 0) return 0;
  const elapsed = elapsedRate(quarter, now);
  return progress < elapsed ? elapsed : 0;
}

// ───────── 분기 목표 목록 ─────────
const workdayOf = iso => {
  const time = Date.parse(iso || '');
  return Number.isFinite(time) ? worklogToday(time) : null;
};
// 멈춤: 이번 분기 + 진행 중 + 마지막 활동(업무일 기준)이 14일 이상 지남
export function isStalled(goal, quarter, now = Date.now()) {
  if (quarterRelation(quarter, now) !== 0 || goal?.status !== 'doing') return false;
  const last = workdayOf(goal.lastActivityAt) || workdayOf(goal.createdAt);
  return Boolean(last) && daysBetween(last, worklogToday(now)) >= STALL_DAYS;
}
export const sortByOrder = list => [...(list || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
// 진행 중·보류 먼저, 달성은 아래로. 번호는 추가한 순서(1부터).
export function goalRows(goals, quarter, now = Date.now()) {
  const rows = sortByOrder(goals).map((goal, index) => ({
    goal, number:index + 1, progress:goalProgress(goal),
    done:goal.status === 'done', hold:goal.status === 'hold', stalled:isStalled(goal, quarter, now)
  }));
  return [...rows.filter(row => !row.done), ...rows.filter(row => row.done)];
}

// ───────── 습관 점검 칸 ─────────
// 점검 기간에 열린 달: 그 달 마지막 7일이면 이번 달, 첫 7일이면 지난달. 둘 다 아니면 없음.
export function checkWindow(now = Date.now()) {
  const today = worklogToday(now);
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7)), day = Number(today.slice(8));
  let target = null;
  if (day > daysInMonth(year, month) - CHECK_DAYS) target = today;
  else if (day <= CHECK_DAYS) target = addDays(`${today.slice(0, 8)}01`, -1);
  if (!target) return null;
  return { quarter:quarterOf(target), index:(Number(target.slice(5, 7)) - 1) % 3, month:Number(target.slice(5, 7)) };
}
// 칸 상태
//  window   점검 기간 칸(비어 있으면 세 기호, 고른 뒤엔 눌러서 수정)
//  fillable 이번 분기의 지난달인데 비어 있음 → "·" 눌러서 언제든 채우기
//  fixed    고른 기호(수정 불가)
//  empty    지난 분기의 빈 칸 · future 아직 안 온 달 → 연한 "·", 누를 수 없음
export function habitCells(habit, quarter, now = Date.now()) {
  const relation = quarterRelation(quarter, now);
  const window = checkWindow(now);
  const windowIndex = window && window.quarter === quarter ? window.index : -1;
  const thisMonth = relation === 0 ? (Number(worklogToday(now).slice(5, 7)) - 1) % 3 : -1;
  const months = quarterMonths(quarter);
  return [0, 1, 2].map(index => {
    const value = MARKS.includes(habit?.months?.[index]) ? habit.months[index] : null;
    let state;
    if (index === windowIndex) state = 'window';
    else if (value) state = 'fixed';
    else if (relation === 0 && index < thisMonth) state = 'fillable';
    else if (relation < 0) state = 'empty';
    else state = 'future';
    return { index, month:months[index], value, state };
  });
}
// 마우스 툴팁 문구(시안): "11월 잘 지킴", "10월 · 눌러서 채우기"
export function cellTip(cell, mark = cell.value) {
  const month = `${cell.month}월`;
  if (mark) return `${month} ${MARK_LABEL[mark]}${cell.state === 'window' && cell.value && mark === cell.value ? ' · 누르면 수정' : ''}`;
  return `${month} · ${cell.state === 'fillable' ? '눌러서 채우기' : '아직'}`;
}

// ───────── 저장 전 화면 반영 ─────────
// 서버와 같은 규칙으로 바로 보여줄 결과를 만든다. 실제 결과는 서버 응답이 정한다.
function settle(goal, now) {
  if (goal.status !== 'hold') {
    const done = goal.steps.length ? goal.steps.every(step => step.done) : goal.pct >= 100;
    goal.status = done ? 'done' : 'doing';
  }
  goal.doneAt = goal.status === 'done' ? goal.doneAt || now : null;
}
const nextOrder = list => list.reduce((max, item) => Math.max(max, item.order ?? 0), 0) + 1;
export function applyOps(state, ops, now = new Date().toISOString()) {
  const next = structuredClone(state);
  next.goals = next.goals || [];
  next.habits = next.habits || [];
  const goalOf = id => next.goals.find(goal => goal.id === id);
  for (const op of ops) {
    const goal = goalOf(op.goalId ?? op.id);
    const habit = next.habits.find(item => item.id === op.id);
    const touch = () => { settle(goal, now); goal.lastActivityAt = now; };
    switch (op.type) {
      case 'addGoal':
        if (!goal && next.goals.length < GOAL_LIMIT) next.goals.push({ id:op.id, order:nextOrder(next.goals), title:op.title, steps:[], pct:0, status:'doing', lastActivityAt:now, createdAt:now, doneAt:null });
        break;
      case 'updateGoal':
        if (!goal) break;
        if (op.title !== undefined) goal.title = op.title;
        if (op.pct !== undefined) goal.pct = op.pct;
        if (op.hold !== undefined) goal.status = op.hold ? 'hold' : goal.status === 'hold' ? 'doing' : goal.status;
        touch();
        break;
      case 'removeGoal': next.goals = next.goals.filter(item => item.id !== op.id); break;
      case 'addStep':
        if (goal && goal.steps.length < STEP_LIMIT && !goal.steps.some(step => step.id === op.stepId)) { goal.steps.push({ id:op.stepId, title:op.title, done:false }); touch(); }
        break;
      case 'setStep': {
        const step = goal?.steps.find(item => item.id === op.stepId);
        if (step) { step.done = op.done === true; touch(); }
        break;
      }
      case 'removeStep':
        if (goal) { goal.steps = goal.steps.filter(step => step.id !== op.stepId); touch(); }
        break;
      case 'addHabit':
        if (!habit && next.habits.length < HABIT_LIMIT) next.habits.push({ id:op.id, order:nextOrder(next.habits), name:op.name, months:[null, null, null] });
        break;
      case 'renameHabit': if (habit) habit.name = op.name; break;
      case 'removeHabit': next.habits = next.habits.filter(item => item.id !== op.id); break;
      case 'markHabit': if (habit) habit.months[op.month] = op.value; break;
      default: break;
    }
  }
  return next;
}

// 목록 정리용: 공백을 한 칸으로 줄이고 앞뒤 공백 제거(서버와 같은 규칙)
export const cleanText = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export { worklogToday, isDate };
