// 목표 체크 위젯 순수 계산 함수 테스트. 실행: node --test sky-lime/tests/goal-check-model.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { currentQuarter, shiftQuarter, quarterRange, quarterLabel, quarterInRange, canShiftQuarter, goalProgress, habitScore,
  quarterProgress, elapsedRate, quarterDday, lagWidth, isStalled, goalRows, checkWindow, habitCells, cellTip, applyOps,
  GOAL_LIMIT, HABIT_LIMIT, STEP_LIMIT } from '../Worklog/goal-check-model.mjs';

const at = text => Date.parse(`${text}+09:00`);
const NOV28 = at('2026-11-28T10:00:00');
const steps = (...done) => done.map((value, index) => ({ id:`s${index}`, title:`단계 ${index}`, done:value }));
const goal = (id, extra = {}) => ({ id, order:Number(id.slice(1)), title:`목표 ${id}`, steps:[], pct:0, status:'doing',
  lastActivityAt:'2026-11-27T01:00:00.000Z', createdAt:'2026-10-02T01:00:00.000Z', doneAt:null, ...extra });
const habit = (id, months) => ({ id, order:1, name:`습관 ${id}`, months });

test('분기: 06:00 경계, 라벨, 기간, 이동 범위(1년 전 ~ 다음 분기)', () => {
  assert.equal(currentQuarter(at('2026-10-01T05:59:00')), '2026-Q3');
  assert.equal(currentQuarter(at('2026-10-01T06:00:00')), '2026-Q4');
  assert.equal(quarterLabel('2026-Q4'), '2026 Q4');
  assert.deepEqual(quarterRange('2026-Q4'), { start:'2026-10-01', end:'2026-12-31', days:92 });
  assert.equal(quarterRange('2027-Q1').days, 90);
  assert.equal(quarterRange('2028-Q1').days, 91);
  assert.equal(shiftQuarter('2026-Q1', -1), '2025-Q4');
  assert.equal(shiftQuarter('2026-Q4', 1), '2027-Q1');
  assert.equal(quarterInRange('2025-Q4', NOV28), true);
  assert.equal(quarterInRange('2025-Q3', NOV28), false);
  assert.equal(quarterInRange('2027-Q1', NOV28), true);
  assert.equal(quarterInRange('2027-Q2', NOV28), false);
  assert.equal(canShiftQuarter('2025-Q4', -1, NOV28), false);
  assert.equal(canShiftQuarter('2027-Q1', 1, NOV28), false);
  assert.equal(canShiftQuarter('2026-Q4', 1, NOV28), true);
});

test('진행도: 세부 단계 / 단계 없음 / 달성 / 보류 / 습관 점수가 섞인 평균', () => {
  const goals = [
    goal('g1', { steps:steps(true, true, false, false, false) }), // 40
    goal('g2', { pct:20 }), // 20
    goal('g3', { steps:steps(true, true), status:'done' }), // 100
    goal('g4', { pct:50, status:'hold' }), // 제외
    goal('g5', { steps:steps(true, false, false) }) // 33
  ];
  const habits = [habit('h1', ['good', null, null]), habit('h2', ['half', 'bad', null]), habit('h3', [null, null, null])];
  assert.deepEqual(goals.map(goalProgress), [40, 20, 100, 50, 33]);
  assert.deepEqual(habits.map(habitScore), [100, 25, null]);
  // (40 + 20 + 100 + 33 + 100 + 25) / 6 = 53
  assert.equal(quarterProgress({ goals, habits }), 53);
  assert.equal(quarterProgress({ goals:[], habits:[] }), 0);
  assert.equal(quarterProgress({ goals:[goal('g1', { status:'hold', pct:90 })], habits:[habit('h1', [null, null, null])] }), 0);
  assert.equal(goalProgress(goal('g1', { status:'done', pct:30 })), 100);
});

test('경과율·D-n·경과율 띠', () => {
  // 11/28은 4분기 59번째 날 → 59/92 = 64%, 남은 날 33
  assert.equal(elapsedRate('2026-Q4', NOV28), 64);
  assert.equal(quarterDday('2026-Q4', NOV28), 'D-33');
  assert.equal(quarterDday('2026-Q4', at('2026-12-31T10:00:00')), 'D-0');
  assert.equal(quarterDday('2026-Q4', at('2027-01-01T05:00:00')), 'D-0', '06:00 전에는 아직 12/31');
  assert.equal(quarterDday('2026-Q3', NOV28), '종료');
  assert.equal(quarterDday('2027-Q1', NOV28), '1월 시작');
  assert.equal(lagWidth('2026-Q4', 57, NOV28), 64);
  assert.equal(lagWidth('2026-Q4', 64, NOV28), 0);
  assert.equal(lagWidth('2026-Q3', 10, NOV28), 0);
  assert.equal(lagWidth('2027-Q1', 0, NOV28), 0);
  assert.equal(elapsedRate('2026-Q3', NOV28), 100);
  assert.equal(elapsedRate('2027-Q1', NOV28), 0);
});

test('멈춤: 이번 분기 + 진행 중 + 마지막 활동이 업무일 기준 14일 이상', () => {
  const now = at('2026-11-28T10:00:00');
  const last = iso => goal('g1', { lastActivityAt:new Date(at(iso)).toISOString() });
  assert.equal(isStalled(last('2026-11-14T10:00:00'), '2026-Q4', now), true, '14일');
  assert.equal(isStalled(last('2026-11-15T10:00:00'), '2026-Q4', now), false, '13일');
  assert.equal(isStalled(last('2026-11-15T05:30:00'), '2026-Q4', now), true, '06:00 전 활동은 전날(11/14)');
  assert.equal(isStalled({ ...last('2026-11-01T10:00:00'), status:'hold' }, '2026-Q4', now), false);
  assert.equal(isStalled({ ...last('2026-11-01T10:00:00'), status:'done' }, '2026-Q4', now), false);
  assert.equal(isStalled(last('2026-07-01T10:00:00'), '2026-Q3', now), false, '지난 분기는 멈춤 없음');
  assert.equal(isStalled(goal('g1', { lastActivityAt:null, createdAt:new Date(at('2026-11-01T10:00:00')).toISOString() }), '2026-Q4', now), true);
});

test('목록 순서: 진행 중·보류 먼저, 달성은 아래, 번호는 추가한 순서', () => {
  const rows = goalRows([goal('g3'), goal('g1', { status:'done' }), goal('g2', { status:'hold' }), goal('g4')], '2026-Q4', NOV28);
  assert.deepEqual(rows.map(row => [row.goal.id, row.number]), [['g2', 2], ['g3', 3], ['g4', 4], ['g1', 1]]);
});

test('점검 기간: 월말 7일(31·30·28·29일) · 다음 달 첫 7일 · 06:00 경계 · 분기 넘김', () => {
  const win = text => { const w = checkWindow(at(text)); return w && `${w.quarter}#${w.index}`; };
  assert.equal(win('2026-10-25T10:00:00'), '2026-Q4#0', '31일 달: 25일부터');
  assert.equal(win('2026-10-24T10:00:00'), null);
  assert.equal(win('2026-11-24T10:00:00'), '2026-Q4#1', '30일 달: 24일부터');
  assert.equal(win('2026-11-23T10:00:00'), null);
  assert.equal(win('2027-02-22T10:00:00'), '2027-Q1#1', '2월(28일): 22일부터');
  assert.equal(win('2027-02-21T10:00:00'), null);
  assert.equal(win('2028-02-23T10:00:00'), '2028-Q1#1', '윤년 2월(29일): 23일부터');
  assert.equal(win('2028-02-22T10:00:00'), null);
  assert.equal(win('2026-11-01T10:00:00'), '2026-Q4#0', '다음 달 첫 7일 = 지난달 칸');
  assert.equal(win('2026-11-07T10:00:00'), '2026-Q4#0');
  assert.equal(win('2026-11-08T10:00:00'), null);
  assert.equal(win('2026-11-08T05:59:00'), '2026-Q4#0', '06:00 전에는 아직 7일');
  assert.equal(win('2026-11-24T05:59:00'), null, '06:00 전에는 아직 23일');
  assert.equal(win('2027-01-03T10:00:00'), '2026-Q4#2', '새 분기 첫 7일은 지난 분기 마지막 달');
  assert.equal(win('2027-03-01T10:00:00'), '2027-Q1#1');
});

test('습관 칸 상태: 점검 기간 · 지난달 채우기 · 아직 안 온 달 · 지난 분기', () => {
  const states = (months, quarter, text) => habitCells(habit('h1', months), quarter, at(text)).map(cell => cell.state);
  assert.deepEqual(states([null, null, null], '2026-Q4', '2026-11-15T10:00:00'), ['fillable', 'future', 'future'], '평소 11/15');
  assert.deepEqual(states(['good', null, null], '2026-Q4', '2026-11-15T10:00:00'), ['fixed', 'future', 'future']);
  assert.deepEqual(states(['good', null, null], '2026-Q4', '2026-11-28T10:00:00'), ['fixed', 'window', 'future'], '월말 11/28');
  assert.deepEqual(states([null, null, null], '2026-Q4', '2026-11-03T10:00:00'), ['window', 'future', 'future'], '월초 11/3');
  assert.deepEqual(states([null, 'good', null], '2026-Q4', '2026-12-15T10:00:00'), ['fillable', 'fixed', 'future']);
  assert.deepEqual(states(['good', null, null], '2026-Q3', '2026-11-28T10:00:00'), ['fixed', 'empty', 'empty'], '지난 분기 읽기 전용');
  assert.deepEqual(states([null, null, null], '2026-Q4', '2027-01-03T10:00:00'), ['empty', 'empty', 'window'], '1/3: 12월 칸만 열림');
  assert.deepEqual(states([null, null, null], '2026-Q4', '2027-01-08T10:00:00'), ['empty', 'empty', 'empty']);
  assert.deepEqual(states([null, null, null], '2027-Q1', '2026-11-28T10:00:00'), ['future', 'future', 'future'], '다음 분기');
  const [oct, nov] = habitCells(habit('h1', [null, 'good', null]), '2026-Q4', at('2026-11-28T10:00:00'));
  assert.equal(cellTip(oct), '10월 · 눌러서 채우기');
  assert.equal(cellTip(nov), '11월 잘 지킴 · 누르면 수정');
  assert.equal(cellTip(nov, 'bad'), '11월 못 지킴');
});

test('저장 전 화면 반영: 서버와 같은 상태 규칙 · 상한', () => {
  const now = '2026-11-28T01:00:00.000Z';
  let state = { goals:[], habits:[] };
  for (let i = 1; i <= GOAL_LIMIT + 1; i += 1) state = applyOps(state, [{ type:'addGoal', id:`g${i}`, title:`목표 ${i}` }], now);
  assert.equal(state.goals.length, GOAL_LIMIT);
  state = applyOps(state, [{ type:'addStep', goalId:'g1', stepId:'a', title:'A' }, { type:'setStep', goalId:'g1', stepId:'a', done:true }], now);
  assert.equal(state.goals[0].status, 'done');
  state = applyOps(state, [{ type:'updateGoal', id:'g1', hold:true }], now);
  assert.equal(state.goals[0].status, 'hold');
  state = applyOps(state, [{ type:'updateGoal', id:'g1', hold:false }, { type:'updateGoal', id:'g2', pct:100 }], now);
  assert.deepEqual([state.goals[0].status, state.goals[1].status], ['done', 'done']);
  for (let i = 0; i < STEP_LIMIT + 1; i += 1) state = applyOps(state, [{ type:'addStep', goalId:'g3', stepId:`s${i}`, title:'x' }], now);
  assert.equal(state.goals[2].steps.length, STEP_LIMIT);
  for (let i = 1; i <= HABIT_LIMIT + 1; i += 1) state = applyOps(state, [{ type:'addHabit', id:`h${i}`, name:`습관 ${i}` }], now);
  assert.equal(state.habits.length, HABIT_LIMIT);
  state = applyOps(state, [{ type:'markHabit', id:'h1', month:1, value:'half' }], now);
  assert.deepEqual(state.habits[0].months, [null, 'half', null]);
});
