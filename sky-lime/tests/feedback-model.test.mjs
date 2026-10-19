// 피드백 모음 위젯 순수 계산 함수 테스트. 실행: node --test sky-lime/tests/feedback-model.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { md, listRows, starItems, whoSuggestions, matchRanges, segments, snippet, searchNotes, resultTitle, resultLine,
  topicIndexOf, cleanupNote, newNote, applySimpleOps, noteStats, worklogToday } from '../Worklog/feedback-model.mjs';

let seq = 0;
const id = () => `x${++seq}`;
const line = (t, key = false) => ({ id:id(), t, key });
const topic = (h, lines, say = '') => ({ id:id(), h, say, lines:lines.map(item => Array.isArray(item) ? line(item[0], true) : line(item)) });
const note = (noteId, date, title, who, topics, todos = []) => ({ id:noteId, date, title, who, topics, todos, rev:1 });
const TODAY = '2026-10-19';
const notes = () => [
  note('n1', '2026-10-23', '팀장 면담 · 4분기 목표', '팀장', [topic('4분기 목표', [['미래 ★는 안 보임']], '신규 기획 맡고 싶다고 말하기')]),
  note('r1', '2026-10-12', '사수 면담 (3차)', '사수', [
    topic('회의 진행', ['주간 회의를 따로 잡아서 진행 상황을 짧게 공유하자', ['회의 전에 결론부터 한 줄로 정리해 가기']]),
    topic('요청하는 법', [['요청할 때도 내 의도와 상대가 해줬으면 하는 액션을 같이 말하기']])],
    [{ id:'d1', t:'주간 회의 시간 잡기', done:true }, { id:'d2', t:'요약 템플릿 만들기', done:false }]),
  note('r2', '2026-09-24', '팀장 면담', '팀장', [topic('문서', [['받는 사람 입장에서 한 번 읽어 보기']])], [{ id:'d3', t:'관련 책 읽기', done:false }]),
  note('r3', '2026-09-03', '사수 면담 (2차)', '사수', [topic('말하는 법', [['두괄식으로 대화하는 연습']])]),
  note('r4', '2026-05-20', '동료 면담', '동료 지민', [topic('리뷰', ['QA 요청할 때 재현 순서'])])
];

test('업무일 06:00 경계, 날짜 표기', () => {
  assert.equal(worklogToday(Date.parse('2026-10-19T05:59:00+09:00')), '2026-10-18');
  assert.equal(md('2026-10-12'), '10/12');
});

test('면담 기록 목록: 다음 면담 1개 + 지난 면담 최신순, 들어가는 만큼만, ★·남은 할 일 수', () => {
  const rows = listRows([...notes(), note('n2', '2026-11-30', '먼 미래', '', [topic('', [''])])], TODAY, 4);
  assert.deepEqual(rows.map(row => [row.note.id, row.next]), [['n1', true], ['r1', false], ['r2', false], ['r3', false]]);
  assert.deepEqual([rows[1].stars, rows[1].todosLeft, rows[1].todosAll], [2, 1, 2]);
  assert.deepEqual(listRows(notes(), '2026-10-23').map(row => row.note.id).slice(0, 2), ['r1', 'n1'].reverse(), '오늘 면담은 지난 면담(오늘 포함)');
  assert.deepEqual(listRows(notes().slice(1), TODAY).map(row => row.next), [false, false, false, false]);
});

test('핵심 모아보기: 오늘 이전·오늘 면담의 ★만, 최신 면담 순, 미래 면담 ★ 제외', () => {
  const items = starItems(notes(), TODAY);
  assert.deepEqual(items.map(item => item.note.id), ['r1', 'r1', 'r2', 'r3']);
  assert.ok(!items.some(item => item.line.t === '미래 ★는 안 보임'));
  assert.deepEqual(starItems(notes(), '2026-10-23')[0].note.id, 'n1');
});

test('준 사람 자동완성: 많이 쓴 순 5개, 입력 글자 포함, 같은 이름·자기 기록 제외', () => {
  const list = notes();
  assert.deepEqual(whoSuggestions(list, 'r4', ''), ['사수', '팀장']);
  assert.deepEqual(whoSuggestions(list, 'r1', '사'), ['사수']);
  assert.deepEqual(whoSuggestions(list, 'r1', '사수'), []);
  assert.deepEqual(whoSuggestions(list, 'x', '지'), ['동료 지민']);
});

test('검색: 대소문자·공백 무시, 원래 글자 위치로 굵게', () => {
  assert.deepEqual(matchRanges('QA 요청할 때', 'qa'), [[0, 2]]);
  assert.deepEqual(matchRanges('두괄식으로 대화', '두 괄식'), [[0, 3]]);
  assert.deepEqual(matchRanges('회의 진행', '회의진행'), [[0, 5]]);
  assert.deepEqual(segments('결론부터 결론', '결론'), [{ t:'결론', bold:true }, { t:'부터 ', bold:false }, { t:'결론', bold:true }]);
  const long = '가'.repeat(30) + '결론' + '나'.repeat(100);
  const cut = snippet(long, '결론');
  assert.equal(cut.text.startsWith('…' + '가'.repeat(12) + '결론'), true);
  assert.equal(cut.text.length, 1 + 80);
  assert.equal(snippet('짧은 결론', '결론').text, '짧은 결론', '앞이 안 잘리면 … 없음');
});

test('검색: 들은 말 → 내가 할 말 → 주제명 → 할 일 → 제목·준 사람 순서, 최신순, 면담당 1개', () => {
  const list = notes();
  list[2].topics[0].say = '회의 일정 먼저 공유';
  let hits = searchNotes(list, '회의');
  assert.deepEqual(hits.map(hit => hit.note.id), ['r1', 'r2']);
  assert.equal(hits[0].hit.text, '주간 회의를 따로 잡아서 진행 상황을 짧게 공유하자');
  assert.deepEqual([hits[1].hit.prefix, hits[1].hit.text], ['내가 할 말 · ', '회의 일정 먼저 공유']);
  hits = searchNotes(list, '요청하는');
  assert.equal(hits[0].hit.text, '요청하는 법', '주제명');
  hits = searchNotes(list, '템플릿');
  assert.deepEqual(resultLine(hits[0]), { prefix:'할 일 · ', text:'요약 템플릿 만들기' });
  assert.equal(hits[0].hit.lineId, null);
  hits = searchNotes(list, '지민');
  assert.equal(hits[0].hit, null, '준 사람만 일치');
  assert.equal(resultTitle(hits[0].note), '동료 면담 · 동료 지민');
  assert.deepEqual(resultLine(hits[0]), { prefix:'', text:'QA 요청할 때 재현 순서' });
  hits = searchNotes(list, '결론');
  assert.equal(hits[0].hit.key, true, '★ 줄');
  assert.equal(searchNotes(list, '   ').length, 0);
  assert.equal(resultTitle({ title:'', who:'' }), '(제목 없음)');
  assert.equal(searchNotes(list, '면담').length, 5, '3개 초과 판단용으로 모두 돌려줌');
});

test('팝업: 줄이 있는 주제 찾기, 닫을 때 정리, 새 기록', () => {
  const list = notes();
  assert.equal(topicIndexOf(list[1], list[1].topics[1].lines[0].id), 1);
  assert.equal(topicIndexOf(list[1], 'none'), 0);
  const messy = note('m', TODAY, '', '', [topic('', ['', '  ']), topic('주제만', ['']), topic('', ['내용', '']), topic('', [''], '할 말만')],
    [{ id:'t', t:' ', done:false }, { id:'u', t:'남김', done:false }]);
  const clean = cleanupNote(messy, id);
  assert.deepEqual(clean.topics.map(item => [item.h, item.say, item.lines.map(l => l.t)]), [['주제만', '', []], ['', '', ['내용']], ['', '할 말만', []]]);
  assert.deepEqual(clean.todos.map(item => item.t), ['남김']);
  const blank = note('e', TODAY, '', '', [topic('', [''])]);
  const empty = cleanupNote(blank, id);
  assert.equal(empty.topics.length, 1, '주제가 0개가 되면 빈 주제 1개 유지');
  assert.deepEqual(empty, blank, '빈 기록은 닫을 때마다 바뀌지 않는다(다시 저장 안 함)');
  const fresh = newNote('new', '면담 제목', TODAY, id);
  assert.deepEqual([fresh.date, fresh.title, fresh.topics.length, fresh.topics[0].lines.length, fresh.rev], [TODAY, '면담 제목', 1, 1, 0]);
  assert.deepEqual(noteStats(fresh), { stars:0, todosLeft:0, todosAll:0 });
});

test('버전 충돌: ★·할 일 체크·줄 삭제·할 일 삭제는 최신 내용 위에 다시 적용', () => {
  const latest = notes()[1];
  latest.title = '다른 기기에서 바꾼 제목';
  const lineId = latest.topics[0].lines[0].id;
  const starId = latest.topics[0].lines[1].id;
  const next = applySimpleOps(latest, [
    { type:'star', lineId, value:true }, { type:'star', lineId:starId, value:false },
    { type:'check', todoId:'d2', value:true }, { type:'dropTodo', todoId:'d1' }, { type:'dropLine', lineId:latest.topics[1].lines[0].id, spareId:'spare' }
  ]);
  assert.equal(next.title, '다른 기기에서 바꾼 제목', '최신 내용 유지');
  assert.deepEqual(next.topics[0].lines.map(l => l.key), [true, false]);
  assert.deepEqual(next.todos.map(t => [t.id, t.done]), [['d2', true]]);
  assert.deepEqual(next.topics[1].lines, [{ id:'spare', t:'', key:false }], '줄을 다 지우면 빈 줄 1개');
  assert.equal(latest.todos.length, 2, '원본은 그대로');
});
