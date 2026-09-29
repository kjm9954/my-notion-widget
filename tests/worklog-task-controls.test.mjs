import test from 'node:test';
import assert from 'node:assert/strict';
import { taskGoalNumber, nextTaskGoalId, goalNumberAppearance, refreshPriorityOrder } from '../cream-olive-garden/Worklog/worklog-task-controls.mjs';

test('목표 번호의 표시 색은 기존 팔레트의 올리브·노랑·갈색이며 공유 값은 변경할 수 없다', () => {
  assert.deepEqual([1,2,3].map(goalNumberAppearance),[
    {color:'#697A43',ink:'#FFFFFF'}, {color:'#F4DDA0',ink:'#665C2F'}, {color:'#9A6B52',ink:'#FFFFFF'}
  ]);
  for(const number of [0,4,null,undefined,'__proto__']) assert.equal(goalNumberAppearance(number),null);
  assert.ok(Object.isFrozen(goalNumberAppearance(1)));
});

test('목표 번호는 미선택 → 1 → 2 → 3 → 미선택으로 순환한다', () => {
  const task = {id:'task-a', goalId:null};
  for (const expected of [1,2,3,0,1]) {
    task.goalId = nextTaskGoalId(task);
    assert.equal(taskGoalNumber(task), expected);
  }
  assert.equal(taskGoalNumber({id:'old',goalId:'old'}),1);
  assert.equal(nextTaskGoalId({id:'old',goalId:'old'}),'worklog:goal:2');
  assert.equal(taskGoalNumber({id:'a',goalId:'existing-saved-goal'}),0);
  assert.equal(taskGoalNumber({id:'a',goalId:'worklog:goal:4'}),0);
  assert.equal(taskGoalNumber({id:'',goalId:null}),0);
});

const key = 'work:2026-09-29';
function fixture() {
  return {tasks:[
    {id:'a',mode:'work',date:'2026-09-29',q:4},
    {id:'b',mode:'work',date:'2026-09-29',q:2},
    {id:'c',mode:'work',date:'2026-09-29',q:1},
    {id:'d',mode:'work',date:'2026-09-29',q:2},
    {id:'e',mode:'work',date:'2026-09-29',q:null},
    {id:'other',mode:'work',date:'2026-09-28',q:3},
    {id:'life',mode:'life',date:'2026-09-29',q:2}
  ], manualOrder:{[key]:['d','a','b','c','e'],'work:2026-09-28':['other'],'life:2026-09-29':['life']}};
}
test('Q 변경 시 해당 날짜만 재정렬하고 동순위 수동 순서와 이전 상태를 보존한다', () => {
  const previous=fixture(), backup=structuredClone(previous), next=structuredClone(previous);
  next.tasks[0].q=1; refreshPriorityOrder(previous,next);
  assert.deepEqual(next.manualOrder[key],['a','c','d','b','e']);
  assert.deepEqual(next.manualOrder['work:2026-09-28'],['other']);
  assert.deepEqual(next.manualOrder['life:2026-09-29'],['life']);
  assert.deepEqual(previous,backup);
  const unset=structuredClone(next); unset.tasks[0].q=null; refreshPriorityOrder(next,unset);
  assert.deepEqual(unset.manualOrder[key],['c','d','b','a','e']);
});
test('드래그·완료·목표 번호·제목 편집은 저장된 수동 순서를 초기화하지 않는다', () => {
  const previous=fixture(), next=structuredClone(previous);
  next.manualOrder[key]=['e','b','a','c','d'];
  Object.assign(next.tasks[0],{done:true,title:'수정',goalId:'worklog:goal:2'});
  refreshPriorityOrder(previous,next);
  assert.deepEqual(next.manualOrder[key],['e','b','a','c','d']);
});
test('업무 추가·다른 날에서 이동은 기존 수동 목록의 Q 순서에 반영한다', () => {
  const previous=fixture(), next=structuredClone(previous);
  next.tasks.push({id:'new',mode:'work',date:'2026-09-29',q:1});
  next.tasks.find(t=>t.id==='other').date='2026-09-29';
  refreshPriorityOrder(previous,next);
  assert.deepEqual(next.manualOrder[key],['c','new','d','b','other','a','e']);
});
test('수동 목록이 없으면 불필요한 정렬 메타데이터를 만들지 않는다', () => {
  const previous=fixture(); previous.manualOrder={};
  const next=structuredClone(previous); next.tasks[0].q=1;
  refreshPriorityOrder(previous,next); assert.deepEqual(next.manualOrder,{});
});
