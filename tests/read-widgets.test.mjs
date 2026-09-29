import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorklogState, normalizeWeeklyGoalsState } from '../worker.js';
import { calendarToday, worklogToday, normalizeWeek, normalizeGoals, normalizeSnapshot, summarizeGoals,
  deadlines, weekDays, monthCells, goalForTask, createSource, shiftMonth, qOf, byPriority, api } from '../cream-olive-garden/Worklog/read-widgets-model.mjs';

const today = '2026-09-29', monday = '2026-09-28';
const goal = { id:1, text:'이번 주 목표 '.repeat(12), m:'work', done:false };
const task = (id, extra = {}) => ({ id:String(id), mode:'work', date:today, title:`업무 ${id}`, due:today, done:false, goalId:'1', ...extra });
const snapshot = tasks => normalizeSnapshot({ tasks }, { week:'2026-9-28', items:[goal, { ...goal, id:2, text:'연결 업무 없음' }] });

test('공개 Worker의 구형 응답도 읽되 없는 목표 연결과 색을 만들지 않는다', () => {
  const worklog = normalizeWorklogState({ tasks:[task(1), task(2, { done:true })] });
  const goals = normalizeWeeklyGoalsState({ week:'2026-9-28', items:[{ ...goal, color:'#6b7b49' }] });
  const state = normalizeSnapshot(worklog, goals);
  assert.equal(state.tasks[0].goalId, undefined);
  assert.equal(state.weeklyGoals[0].color, null);
  assert.deepEqual(summarizeGoals(state, monday).map(g => [g.done, g.total]), [[0,0]]);
  assert.equal(goalForTask(state, state.tasks[0]), null);
  assert.equal(deadlines(state, today).length, 1);
  assert.equal(weekDays(state, monday)[1].done, 1);
  assert.equal(monthCells(state, '2026-09').find(c => c.date === today).tasks.length, 1);
});

test('실제 목표 필드와 월요일 날짜 키, ISO 주차를 읽으며 3개로 자르지 않는다', () => {
  const normalized = normalizeGoals({ week:'2026-9-28', items:[goal, { ...goal, id:9, m:'life' }] });
  assert.deepEqual(normalized, [{ id:'1', name:goal.text, color:null, weekKey:monday }]);
  assert.equal(normalizeWeek('2026-W40'), monday);
  assert.equal(normalizeWeek('2026-W53'), '2026-12-28');
  assert.equal(normalizeWeek('2025-W53'), '');
  assert.equal(normalizeWeek('2026-02-30'), '');
  const rich = Array.from({ length:7 }, (_, i) => ({ id:`g${i}`, name:goal.text, color:'#8298a0', weekKey:'2026-W40' }));
  assert.equal(summarizeGoals(normalizeSnapshot({ tasks:[] }, rich), monday).length, 7);
  assert.equal(normalizeGoals(rich)[0].color, '#8298a0');
});

test('한국 자정 마감 기준과 오전 6시 업무일을 구분하고 연말 주차를 맞춘다', () => {
  const before = Date.parse('2026-09-28T05:59:59+09:00');
  assert.equal(calendarToday(before), '2026-09-28');
  assert.equal(worklogToday(before), '2026-09-27');
  assert.equal(worklogToday(before + 1000), '2026-09-28');
  assert.equal(normalizeWeek('2020-W53'), '2020-12-28');
  assert.equal(normalizeWeek('2021-1-1'), '2020-12-28');
});

test('목표는 date/goalId/work만 집계하며 긴 문장 및 0/0을 보존한다', () => {
  const state = snapshot([task(1), task(2, { done:true, doneAt:'2026-10-10' }),
    task(3, { mode:'life' }), task(4, { date:'2026-09-27' }), task(5, { goalId:null })]);
  const rows = summarizeGoals(state, monday);
  assert.equal(rows[0].name, goal.text); assert.ok(rows[0].name.length > 60);
  assert.deepEqual([rows[0].done, rows[0].total], [1, 2]);
  assert.deepEqual([rows[1].done, rows[1].total], [0, 0]);
  state.tasks[0].done = true;
  assert.equal(summarizeGoals(state, monday)[0].done, 2);
});

test('오늘~+3일 포함 최대 5건, 완료 뒤 6번째 진입, +4일/지난날/일상 제외', () => {
  const state = snapshot([...Array.from({ length:7 }, (_, i) => task(i)), task(7, { due:'2026-10-03' }),
    task(8, { due:'2026-09-28' }), task(9, { mode:'life' }), task(10, { due:null })]);
  assert.deepEqual(deadlines(state, today).map(t => t.id), ['0','1','2','3','4']);
  state.tasks[0].done = true;
  assert.deepEqual(deadlines(state, today).map(t => t.id), ['1','2','3','4','5']);
  const range = snapshot([task(1), task(2, { due:'2026-09-30' }), task(3, { due:'2026-10-01' }), task(4, { due:'2026-10-02' })]);
  assert.deepEqual(deadlines(range, today).map(t => t.days), [0,1,2,3]);
});

test('마감은 날짜 뒤 Q순, 주간은 완료 뒤 Q순으로 정렬하며 원본을 수정하지 않는다', () => {
  const state=snapshot([task('q3',{q:3}),task('q1',{q:1}),task('done4',{q:4,done:true}),
    task('none',{q:null}),task('done1',{q:1,done:true}),task('tie',{q:1}),
    task('q4',{q:4}),task('q2',{q:2}),task('next',{q:1,due:'2026-09-30'})]);
  const before=structuredClone(state);
  assert.equal(api.qOf,qOf); assert.equal(qOf({q:1}),1); assert.equal(qOf({q:'1'}),5);
  assert.equal(qOf({q:null}),5); assert.equal(qOf({q:NaN}),5);
  assert.equal(byPriority({q:1,originalIndex:0},{q:1,originalIndex:1}),-1);
  assert.deepEqual(deadlines(state,today).map(t=>t.id),['q1','tie','q2','q3','q4']);
  assert.deepEqual(weekDays(state,monday)[1].tasks.map(t=>t.id),['done1','done4','q1','tie','next','q2','q3','q4','none']);
  assert.deepEqual(state,before); assert.ok(state.tasks.every(t=>!Object.hasOwn(t,'originalIndex')));
  state.tasks.find(t=>t.id==='q1').done=true;
  assert.deepEqual(deadlines(state,today).map(t=>t.id),['tie','q2','q3','q4','none']);
});

test('WORK LOG에서 선택한 업무는 별도 목표 등록 없이 자동 표시되고 선택 해제·수정·완료를 반영한다', () => {
  const tasks = Array.from({length:7},(_,i)=>task(`selected-${i}`,{goalId:`selected-${i}`,title:i===0?goal.text:`목표 ${i}`}));
  tasks.push(task('not-selected',{goalId:null}),task('life-selected',{goalId:'life-selected',mode:'life'}));
  const read=()=>normalizeSnapshot({tasks},{week:'',items:[]});
  let state=read(), rows=summarizeGoals(state,monday);
  assert.equal(rows.length,7); assert.equal(rows[0].name,goal.text);
  assert.deepEqual(rows.map(g=>[g.done,g.total]),Array.from({length:7},()=>[0,1]));
  assert.equal(goalForTask(state,tasks[0]).id,'selected-0');
  tasks[0].done=true; tasks[0].title='수정된 업무 제목';
  rows=summarizeGoals(read(),monday);
  assert.equal(rows[0].name,'수정된 업무 제목'); assert.equal(rows[0].done,1);
  tasks[0].goalId=null;
  assert.equal(summarizeGoals(read(),monday).length,6);
  tasks[1].date='2026-10-05';
  assert.equal(summarizeGoals(read(),monday).length,5);
  assert.equal(summarizeGoals(read(),'2026-10-05').length,1);
});

test('번호를 지정한 업무를 1·2·3 순으로 모두 표시하며 같은 번호라도 개별 완료 수를 유지한다', () => {
  const tasks=[task('third',{goalId:'worklog:goal:3'}),task('first',{goalId:'worklog:goal:1'}),
    task('second',{goalId:'worklog:goal:2',done:true}),task('another-first',{goalId:'worklog:goal:1'}),
    task('old-check',{goalId:'old-check'}),task('later',{goalId:'worklog:goal:1',date:'2026-10-05'}),
    task('life',{goalId:'worklog:goal:1',mode:'life'})];
  const read=()=>normalizeSnapshot({tasks},{week:'',items:[]});
  const rows=summarizeGoals(read(),monday);
  assert.deepEqual(rows.map(g=>[g.id,g.number,g.done,g.total]),[
    ['first',1,0,1],['another-first',1,0,1],['old-check',1,0,1],['second',2,1,1],['third',3,0,1]
  ]);
  assert.equal(goalForTask(read(),tasks[0]).name,'업무 third');
  tasks[1].title=goal.text; tasks[1].done=true;
  const updated=summarizeGoals(read(),monday);
  assert.equal(updated[0].name,goal.text); assert.equal(updated[0].done,1); assert.equal(updated[1].done,0);
  tasks[1].goalId=null;
  assert.deepEqual(summarizeGoals(read(),monday).map(g=>g.id),['another-first','old-check','second','third']);
  assert.equal(summarizeGoals(read(),'2026-10-05').length,1);
});

test('번호 목표와 기존 독립 목표 연결·색·집계가 함께 유지된다', () => {
  const saved=[{id:'saved',name:'기존 목표',color:'#6b7b49',weekKey:monday}];
  const tasks=[task('a',{goalId:'saved',done:true}),task('b',{goalId:'worklog:goal:1'})];
  const state=normalizeSnapshot({tasks},saved), rows=summarizeGoals(state,monday);
  assert.equal(goalForTask(state,tasks[0]).color,'#6b7b49');
  assert.deepEqual(rows.map(g=>[g.id,g.done,g.total]),[['saved',1,1],['b',0,1]]);
});

test('업무 목표 1·2·3은 모든 읽기 화면에서 동일한 색을 얻되 원본 기록과 저장 목표는 바꾸지 않는다', () => {
  const worklog={tasks:[task('a',{goalId:'worklog:goal:1'}),task('b',{goalId:'worklog:goal:2'}),
    task('c',{goalId:'worklog:goal:3'}),task('legacy',{goalId:'legacy'}),task('none',{goalId:null})]};
  const goals={items:[]}, before=structuredClone({worklog,goals});
  const state=normalizeSnapshot(worklog,goals);
  assert.deepEqual(state.tasks.map(task=>goalForTask(state,task)?.color ?? null),['#697A43','#F4DDA0','#9A6B52','#697A43',null]);
  assert.deepEqual({worklog,goals},before);
  assert.ok(state.tasks.every(task=>!Object.hasOwn(task,'color')));
});

test('한 일은 doneAt 대신 date, 하루 8개와 미완료를 모두 유지한다', () => {
  const state = snapshot(Array.from({ length:8 }, (_, i) => task(i, { done:i === 0, doneAt:'2026-10-02' })));
  const days = weekDays(state, monday);
  assert.equal(days.length, 5); assert.equal(days[1].total, 8); assert.equal(days[1].done, 1);
  assert.equal(days[4].total, 0);
});

test('달력은 due당 점 하나, 완료 제외, 4/5/6주 달력 및 연도 이동', () => {
  const state = snapshot(Array.from({ length:6 }, (_, i) => task(i, { date:monday })));
  let cells = monthCells(state, '2026-09');
  assert.equal(cells[0].date, '2026-08-31');
  assert.equal(cells.find(c => c.date === today).tasks.length, 6);
  state.tasks[0].done = true;
  assert.equal(monthCells(state, '2026-09').find(c => c.date === today).tasks.length, 5);
  assert.equal(monthCells(state, '2021-02').length, 28);
  assert.equal(monthCells(state, '2024-02').length, 35);
  assert.equal(monthCells(state, '2026-03').length, 42);
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('목표 색은 task의 주차와 id를 함께 매칭해 이전 주의 동명 id와 섞지 않는다', () => {
  const state = snapshot([task(1)]);
  state.weeklyGoals.unshift({ id:'1', name:'지난 목표', weekKey:'2026-09-21', color:'#ff0000' });
  assert.equal(goalForTask(state, state.tasks[0]).name, goal.text);
  assert.equal(goalForTask(state, task(2, { goalId:null })), null);
});

test('실제 두 Store read와 공통 watch만 사용하고 실패를 빈 상태로 숨기지 않는다', async () => {
  const calls = [];
  const store = {
    MIN_WATCH_INTERVAL_MS:60000,
    loadWorklogState:async options => { calls.push(['tasks', options]); return { tasks:[] }; },
    loadWeeklyGoalsState:async options => { calls.push(['goals', options]); return { week:'', items:[] }; },
    watch:(fn, ms, options) => { calls.push(['watch', ms, options]); return () => {}; }
  };
  const source = createSource(store);
  assert.deepEqual(await source.read(), { tasks:[], weeklyGoals:[] }); source.subscribe(() => {});
  assert.deepEqual(calls, [['tasks', { fresh:true }], ['goals', { fresh:true, worklogInstance:true }], ['watch', 120000, { allowWhileEditing:true, initial:false, allowCached:true, paths:['/api/worklog/', '/api/weekly-goals/'] }]]);
  store.loadWeeklyGoalsState = async () => { throw new Error('offline'); };
  assert.deepEqual((await source.read()).readWarning, {dailyLimit:false,missingGoals:true});
  store.loadWorklogState = async () => { throw new Error('offline'); };
  await assert.rejects(source.read(), /offline/);
  assert.throws(() => normalizeSnapshot({}, { items:[] }));
  assert.throws(() => normalizeSnapshot({ tasks:[] }, {}));
});

test('실패를 성공으로 바꾸지 않고 같은 키의 마지막 업무·목표로 읽기 모델을 복원한다', async () => {
  const store = {
    loadWorklogState:async()=>{throw Object.assign(new Error('quota'),{dailyLimit:true,cachedData:{tasks:[task(1)]}});},
    loadWeeklyGoalsState:async()=>{throw Object.assign(new Error('quota'),{dailyLimit:true,cachedData:{week:'2026-9-28',items:[goal]}});}
  };
  const state=await createSource(store).read();
  assert.equal(state.tasks.length,1); assert.equal(state.weeklyGoals.length,1);
  assert.deepEqual(state.readWarning,{dailyLimit:true,missingGoals:false});
});
