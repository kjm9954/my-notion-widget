// sky-lime 순수 계산 함수 테스트. 실행: node --test sky-lime/tests/sky-lime-model.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { worklogToday, calendarToday, mondayOf, dayLabel, weekRangeLabel, statusOf, uncheckStatus, withStatus,
  goalNumber, goalIdFor, categoryOf, categoryValue, categoriesFor, dueInfo, board, tasksForDay, weeklyGoals,
  weekDays, dayCountLabel, effectiveDay, notesFor } from '../Worklog/sky-lime-model.mjs';

const today = '2026-10-14';
const task = (id, extra = {}) => ({ id, mode:'work', date:today, title:`업무 ${id}`, status:'wait', done:false, due:null, proj:'', goalId:null, ...extra });

test('업무일은 한국 오전 6시, 완료일은 한국 자정 기준', () => {
  assert.equal(worklogToday(Date.parse('2026-10-14T05:59:00+09:00')), '2026-10-13');
  assert.equal(worklogToday(Date.parse('2026-10-14T06:00:00+09:00')), '2026-10-14');
  assert.equal(calendarToday(Date.parse('2026-10-14T05:59:00+09:00')), '2026-10-14');
  assert.equal(mondayOf('2026-10-18'), '2026-10-12');
  assert.equal(dayLabel('2026-10-14'), '10월 14일 (수)');
  assert.equal(weekRangeLabel('2026-10-12'), '10.12 – 10.16');
});

test('상태 4종과 review를 모르는 서버 값', () => {
  assert.equal(statusOf(task(1, { status:'review' })), 'review');
  assert.equal(statusOf(task(1, { status:'unknown' })), 'wait');
  assert.equal(statusOf(task(1, { status:'doing', done:true })), 'done');
});

test('체크 해제는 prevStatus, 없으면 진행중', () => {
  assert.equal(uncheckStatus({ prevStatus:'review' }), 'review');
  assert.equal(uncheckStatus({ prevStatus:'wait' }), 'wait');
  assert.equal(uncheckStatus({ prevStatus:'done' }), 'doing');
  assert.equal(uncheckStatus({}), 'doing');
});

test('기존 저장 방식으로 완료할 때 이전 상태와 완료일을 남기고 다른 필드는 보존', () => {
  const now = Date.parse('2026-10-14T09:00:00+09:00');
  const done = withStatus(task(1, { status:'review', extra:'keep', goalId:'worklog:goal:2' }), 'done', now);
  assert.deepEqual([done.status, done.done, done.doneAt, done.prevStatus, done.extra, done.goalId], ['done', true, '2026-10-14', 'review', 'keep', 'worklog:goal:2']);
  const back = withStatus(done, uncheckStatus(done), now);
  assert.deepEqual([back.status, back.done, back.doneAt], ['review', false, null]);
});

test('번호는 goalId에서 읽고 예전 체크 방식은 1번', () => {
  assert.equal(goalNumber(task('a', { goalId:'worklog:goal:3' })), 3);
  assert.equal(goalNumber(task('a', { goalId:'a' })), 1);
  assert.equal(goalNumber(task('a', { goalId:'saved-goal' })), 0);
  assert.equal(goalIdFor(2), 'worklog:goal:2');
  assert.equal(goalIdFor(0), null);
});

test('구분은 업무들의 proj 값을 모으고 빈 값·미분류는 기타', () => {
  const tasks = [task(1, { proj:'기획' }), task(2, { proj:'미분류' }), task(3, { proj:'회의' }), task(4, { proj:'기획' }), task(5, { proj:'운동', mode:'life' })];
  assert.deepEqual(categoriesFor(tasks, 'work'), ['기획', '회의']);
  assert.deepEqual(categoriesFor(tasks, 'life'), ['운동']);
  assert.equal(categoryOf(tasks[1]), '기타');
  assert.equal(categoryValue('기타'), '');
});

test('D-n은 실제 오늘 기준, 마감 지남은 D+n 지남', () => {
  assert.deepEqual(dueInfo(task(1, { due:'2026-10-12' }), today), { diff:-2, text:'D+2 지남', tone:'over' });
  assert.deepEqual(dueInfo(task(1, { due:today }), today), { diff:0, text:'D-day', tone:'dday' });
  assert.equal(dueInfo(task(1, { due:'2026-10-19' }), today).text, 'D-5');
  assert.equal(dueInfo(task(1, { due:today, status:'done', done:true }), today), null);
});

test('보드 정렬: 마감 지남 → D-day → 가까운 마감 → 마감 없음', () => {
  const state = { tasks:[task('none'), task('later', { due:'2026-10-20' }), task('over', { due:'2026-10-10' }), task('dday', { due:today }), task('soon', { due:'2026-10-15' }), task('doing', { status:'doing' })] };
  const model = board(tasksForDay(state, 'work', today));
  assert.deepEqual(model.lanes.wait.map(item => item.id), ['over', 'dday', 'soon', 'later', 'none']);
  assert.deepEqual(model.lanes.doing.map(item => item.id), ['doing']);
  assert.equal(model.remaining, 6);
});

test('이번 주 목표: 번호 있는 업무만, 1→2→3, 지난주 완료 제외', () => {
  const state = { tasks:[
    task('three', { goalId:'worklog:goal:3' }), task('one', { goalId:'worklog:goal:1' }), task('plain'),
    task('done-last-week', { goalId:'worklog:goal:1', date:'2026-10-09', status:'done', done:true, doneAt:'2026-10-09' }),
    task('done-saturday', { goalId:'worklog:goal:2', date:'2026-10-16', status:'done', done:true, doneAt:'2026-10-17' }),
    task('life', { goalId:'worklog:goal:1', mode:'life' })
  ] };
  assert.deepEqual(weeklyGoals(state, 'work', today).map(item => item.id), ['one', 'done-saturday', 'three']);
  assert.deepEqual(weeklyGoals(state, 'life', today).map(item => item.id), ['life']);
});

test('이번 주 한 일: 완료는 doneAt 요일, 없으면 date', () => {
  const state = { tasks:[
    task('moved', { date:'2026-10-13', status:'done', done:true, doneAt:'2026-10-14' }),
    task('no-done-at', { date:'2026-10-13', status:'done', done:true, doneAt:null }),
    task('open', { goalId:'worklog:goal:2' }), task('first', { goalId:'worklog:goal:1' })
  ] };
  assert.equal(effectiveDay(state.tasks[0]), '2026-10-14');
  const days = weekDays(state, 'work', '2026-10-12');
  assert.deepEqual(days[1].items.map(item => item.id), ['no-done-at']);
  assert.deepEqual(days[2].items.map(item => item.id), ['first', 'open', 'moved']);
  assert.equal(dayCountLabel(days[2]), '2개 남음');
  assert.equal(dayCountLabel(days[1]), '모두 완료');
  assert.equal(dayCountLabel(days[0]), '');
});

test('메모: mode가 없으면 업무', () => {
  const state = { items:[{ id:'a', text:'기존' }, { id:'b', text:'일상', mode:'life' }, { id:'c', text:'  ' }] };
  assert.deepEqual(notesFor(state, 'work').map(item => item.id), ['a']);
  assert.deepEqual(notesFor(state, 'life').map(item => item.id), ['b']);
});
