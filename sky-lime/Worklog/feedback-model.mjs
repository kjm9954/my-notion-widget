// 피드백 모음 위젯 3종(핵심 모아보기 · 피드백 검색 · 면담 기록)의 순수 계산 함수. 저장·네트워크·DOM 접근 없음.
// 면담 기록 1개: { id, date, title, who, topics:[{ id, h, say, lines:[{ id, t, key }] }], todos:[{ id, t, done }], rev }
// 날짜 비교(다음 면담 / 지난 면담)는 기존 업무일 규칙(한국 오전 6시 경계)을 쓴다.
import { worklogToday } from './sky-lime-model.mjs?v=20261015-sky-lime';

export const TEXT_MAX = Object.freeze({ title:120, who:40, h:80, say:300, line:500, todo:200 });
export const SEARCH_LIMIT = 3;
export const SNIPPET_BEFORE = 12;
export const SNIPPET_LENGTH = 80;
export { worklogToday };

export const md = date => `${String(date || '').slice(5, 7)}/${String(date || '').slice(8, 10)}`;
export const sortNotes = notes => [...(notes || [])].sort((a, b) => b.date.localeCompare(a.date) || String(a.id).localeCompare(String(b.id)));
export const filled = value => String(value ?? '').trim().length > 0;

// ───────── 면담 기록 목록 ─────────
export function noteStats(note) {
  const stars = (note.topics || []).reduce((sum, topic) => sum + (topic.lines || []).filter(line => line.key).length, 0);
  const todos = (note.todos || []).filter(todo => filled(todo.t));
  return { stars, todosLeft:todos.filter(todo => !todo.done).length, todosAll:todos.length };
}
// 맨 위 "다음 면담"(오늘 이후 중 가장 가까운 1개) + 지난 면담(오늘 포함) 최신순. 넣을 수 있는 줄 수(fit)까지만.
export function listRows(notes, today, fit = Infinity) {
  const sorted = sortNotes(notes);
  const next = sorted.filter(note => note.date > today).sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)))[0];
  const past = sorted.filter(note => note.date <= today);
  return [...(next ? [next] : []), ...past].slice(0, Math.max(0, fit)).map(note => ({ note, next:note === next, ...noteStats(note) }));
}

// ───────── 핵심 모아보기 ─────────
// 날짜가 오늘 이전·오늘인 면담의 ★ 줄, 최신 면담 순(같은 면담 안에서는 주제·줄 순서).
export function starItems(notes, today) {
  const items = [];
  for (const note of sortNotes(notes).filter(item => item.date <= today)) {
    for (const topic of note.topics || []) {
      for (const line of topic.lines || []) if (line.key && filled(line.t)) items.push({ note, topic, line });
    }
  }
  return items;
}

// ───────── 준 사람 자동완성 ─────────
// 다른 기록에 쓴 이름을 많이 쓴 순으로 최대 5개, 입력 글자를 포함하는 것만(입력과 똑같은 이름은 제외).
export function whoSuggestions(notes, currentId, query) {
  const counts = new Map();
  for (const note of notes || []) {
    const name = String(note.who || '').trim();
    if (name && note.id !== currentId) counts.set(name, (counts.get(name) || 0) + 1);
  }
  const typed = String(query || '').trim();
  return [...counts].filter(([name]) => !typed || (name.includes(typed) && name !== typed))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([name]) => name);
}

// ───────── 검색 ─────────
// 대소문자·공백 차이를 무시한다: 비교할 때 공백을 빼고 소문자로 맞추고, 찾은 자리는 원래 글자 위치로 돌려준다.
function folded(text) {
  const chars = [];
  const index = [];
  const source = String(text ?? '');
  for (let i = 0; i < source.length; i += 1) {
    if (/\s/.test(source[i])) continue;
    chars.push(source[i].toLowerCase());
    index.push(i);
  }
  return { text:chars.join(''), index };
}
export const foldQuery = query => folded(query).text;
// 모든 일치 구간 [start, end) (원래 글자 기준)
export function matchRanges(text, query) {
  const needle = foldQuery(query);
  if (!needle) return [];
  const hay = folded(text);
  const ranges = [];
  let from = 0;
  for (;;) {
    const at = hay.text.indexOf(needle, from);
    if (at < 0) break;
    ranges.push([hay.index[at], hay.index[at + needle.length - 1] + 1]);
    from = at + needle.length;
  }
  return ranges;
}
export const contains = (text, query) => matchRanges(text, query).length > 0;
// 글자를 굵은 부분/보통 부분으로 나눈다. [{ t, bold }]
export function segments(text, query) {
  const source = String(text ?? '');
  const out = [];
  let at = 0;
  for (const [start, end] of matchRanges(source, query)) {
    if (start > at) out.push({ t:source.slice(at, start), bold:false });
    out.push({ t:source.slice(start, end), bold:true });
    at = end;
  }
  if (at < source.length || !out.length) out.push({ t:source.slice(at), bold:false });
  return out;
}
// 찾은 단어 앞 12자부터 80자. 앞이 잘리면 "…".
export function snippet(text, query) {
  const source = String(text ?? '');
  const first = matchRanges(source, query)[0];
  const start = first ? Math.max(0, first[0] - SNIPPET_BEFORE) : 0;
  return { text:(start > 0 ? '…' : '') + source.slice(start, start + SNIPPET_LENGTH), cut:start > 0 };
}
// 면담당 첫 번째로 찾은 것 1개: 들은 말 → 내가 할 말 → 주제명 → 할 일 → 면담 제목·준 사람. 면담 날짜 최신순.
// hit = { prefix("내가 할 말 · " / "할 일 · " / ""), text(찾은 문장), lineId, key }
export function searchNotes(notes, query) {
  if (!foldQuery(query)) return [];
  const hits = [];
  for (const note of sortNotes(notes)) {
    const topics = note.topics || [];
    let hit = null;
    for (const topic of topics) {
      const line = (topic.lines || []).find(item => contains(item.t, query));
      if (line) { hit = { prefix:'', text:line.t, lineId:line.id, key:line.key === true }; break; }
    }
    if (!hit) {
      const topic = topics.find(item => contains(item.say, query));
      if (topic) hit = { prefix:'내가 할 말 · ', text:topic.say, lineId:topic.lines?.[0]?.id || null, topicId:topic.id, key:false };
    }
    if (!hit) {
      const topic = topics.find(item => contains(item.h, query));
      if (topic) hit = { prefix:'', text:topic.h, lineId:topic.lines?.[0]?.id || null, topicId:topic.id, key:false };
    }
    if (!hit) {
      const todo = (note.todos || []).find(item => contains(item.t, query));
      if (todo) hit = { prefix:'할 일 · ', text:todo.t, lineId:null, key:false };
    }
    if (hit || contains(note.title, query) || contains(note.who, query)) hits.push({ note, hit });
  }
  return hits;
}
export const resultTitle = note => `${filled(note.title) ? note.title : '(제목 없음)'}${filled(note.who) ? ` · ${note.who}` : ''}`;
// 결과 2줄째: { prefix, text } 찾은 문장(찾은 게 제목·준 사람뿐이면 첫 들은 말). 앞 12자 자르기는 text에만 한다.
export function resultLine(result) {
  if (result.hit) return { prefix:result.hit.prefix, text:result.hit.text };
  const line = (result.note.topics || []).flatMap(topic => topic.lines || []).find(item => filled(item.t));
  return { prefix:'', text:line ? line.t : '' };
}

// ───────── 상세 팝업 ─────────
export function topicIndexOf(note, lineId, topicId) {
  const topics = note.topics || [];
  const at = topics.findIndex(topic => (lineId && (topic.lines || []).some(line => line.id === lineId)) || (topicId && topic.id === topicId));
  return Math.max(0, at);
}
// 닫을 때 정리: 빈 들은 말·빈 할 일 삭제, 주제명·내가 할 말·줄이 모두 빈 주제 삭제(0개가 되면 빈 주제 1개).
// 면담 전에 적어 둔 "내가 할 말"만 있는 주제는 지우지 않는다. 빈 주제 1개는 원래 id를 써서 닫을 때마다 다시 저장되지 않게 한다.
export function cleanupNote(note, makeId) {
  const next = structuredClone(note);
  next.topics = (next.topics || []).map(topic => ({ ...topic, lines:(topic.lines || []).filter(line => filled(line.t)) }))
    .filter(topic => filled(topic.h) || filled(topic.say) || topic.lines.length);
  if (!next.topics.length) {
    const first = (note.topics || [])[0];
    next.topics = [{ id:first?.id || makeId(), h:'', say:'', lines:[{ id:first?.lines?.[0]?.id || makeId(), t:'', key:false }] }];
  }
  next.todos = (next.todos || []).filter(todo => filled(todo.t));
  return next;
}
export const emptyTopic = makeId => ({ id:makeId(), h:'', say:'', lines:[{ id:makeId(), t:'', key:false }] });
export function newNote(id, title, date, makeId) {
  return { id, date, title:String(title || '').slice(0, TEXT_MAX.title), who:'', topics:[emptyTopic(makeId)], todos:[], rev:0 };
}
export const sameContent = (a, b) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));
const strip = note => note && { id:note.id, date:note.date, title:note.title, who:note.who, topics:note.topics, todos:note.todos };

// ───────── 버전 충돌 때 다시 적용하는 단순 동작 ─────────
// star(★ 켜기/끄기) · check(할 일 체크) · dropLine(줄 삭제) · dropTodo(할 일 삭제)는 "그 값으로 맞추기"라 최신 내용 위에 다시 적용해도 안전하다.
// 글자·구조 수정(text)은 다시 적용하지 않는다(다시 입력 안내).
export const SIMPLE_OPS = Object.freeze(['star', 'check', 'dropLine', 'dropTodo']);
export function applySimpleOps(note, ops) {
  const next = structuredClone(note);
  for (const op of ops) {
    if (op.type === 'star') {
      for (const topic of next.topics || []) for (const line of topic.lines || []) if (line.id === op.lineId) line.key = op.value === true;
    } else if (op.type === 'check') {
      for (const todo of next.todos || []) if (todo.id === op.todoId) todo.done = op.value === true;
    } else if (op.type === 'dropLine') {
      for (const topic of next.topics || []) {
        if (!(topic.lines || []).some(line => line.id === op.lineId)) continue;
        topic.lines = topic.lines.filter(line => line.id !== op.lineId);
        if (!topic.lines.length) topic.lines = [{ id:op.spareId || `${op.lineId}-spare`, t:'', key:false }];
      }
    } else if (op.type === 'dropTodo') {
      next.todos = (next.todos || []).filter(todo => todo.id !== op.todoId);
    }
  }
  return next;
}
