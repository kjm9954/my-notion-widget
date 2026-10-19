// 피드백 모음 위젯 3종 공통: 면담 기록 데이터(Store) 읽기·구독, 핵심·검색 → 면담 기록 "열기 요청" 채널.
// 실제 데이터는 window.Store만 사용한다. 브라우저 저장소에는 아무것도 두지 않는다. 업무/일상 구분 없음(업무 전용).
import { Store, escapeHtml, staleText, failureText, makeId, canHover } from './sky-lime-common.mjs?v=20261015-sky-lime';
import { worklogToday } from './feedback-model.mjs?v=20261019-feedback';

export { Store, escapeHtml, staleText, failureText, makeId, canHover };

// ───────── 읽기 · 구독 ─────────
// 연결 실패 시 Store가 넘겨주는 마지막 정상 자료(cachedData)를 보여주고 오류도 함께 알린다.
export async function readMeetingNotes() {
  try { return { data:await Store.loadMeetingNotes() }; }
  catch (error) {
    if (error?.cachedData !== undefined) return { data:error.cachedData, error };
    throw error;
  }
}
export function watchMeetingNotes(callback) {
  return Store.watch(callback, 120000, { allowWhileEditing:true, initial:false, allowCached:true, paths:['/api/meeting-notes/'] });
}
// 핵심 모아보기·피드백 검색용(읽기만). 읽는 순서가 뒤바뀌어도 마지막 요청 결과만 쓴다.
export function createNotesReader(onChange) {
  let notes = null;
  let error = null;
  let loaded = false;
  let seq = 0;
  async function load() {
    const mine = ++seq;
    try {
      const result = await readMeetingNotes();
      if (mine !== seq) return;
      notes = Array.isArray(result.data?.notes) ? result.data.notes : [];
      error = result.error || null;
    } catch (failure) {
      if (mine !== seq) return;
      console.warn('면담 기록을 불러오지 못했습니다.', failure);
      error = failure;
    }
    loaded = true;
    onChange();
  }
  return { load, get notes() { return notes; }, get error() { return error; }, get loaded() { return loaded; } };
}

// 업무일(오전 6시)이 바뀌면 다시 그린다(다음 면담 · 지난 면담 경계).
export function onDayChange(listener) {
  let last = worklogToday();
  return setInterval(() => { const day = worklogToday(); if (day !== last) { last = day; listener(day); } }, 60000);
}

// ───────── 열기 요청 (핵심 모아보기 · 피드백 검색 → 면담 기록) ─────────
// 세 위젯은 서로 다른 iframe이다. 같은 인스턴스 키끼리만 BroadcastChannel로 "열기 요청"을 보내고, 면담 기록이 받으면 응답한다.
const OPEN_CHANNEL = `sky-lime-feedback-open-v1:${Store?.getWidgetInstanceId?.() || 'unconnected'}`;
export const OPEN_TIMEOUT_MS = 1000;
let channel = null;
try { channel = new BroadcastChannel(OPEN_CHANNEL); } catch (_) {}
const waiting = new Map();
channel?.addEventListener('message', event => {
  const message = event.data || {};
  if (message.type === 'ack' && waiting.has(message.req)) { waiting.get(message.req)(true); waiting.delete(message.req); }
});
// 면담 기록이 1초 안에 응답하면 true.
export function requestOpen(noteId, lineId = null) {
  if (!channel) return Promise.resolve(false);
  const req = makeId();
  return new Promise(resolve => {
    waiting.set(req, resolve);
    setTimeout(() => { if (waiting.has(req)) { waiting.delete(req); resolve(false); } }, OPEN_TIMEOUT_MS);
    try { channel.postMessage({ type:'open', req, noteId, lineId }); }
    catch (_) { waiting.delete(req); resolve(false); }
  });
}
// 면담 기록 위젯이 등록한다. handler가 true를 돌려주면(그 면담이 있으면) 응답한다.
export function onOpenRequest(handler) {
  channel?.addEventListener('message', event => {
    const message = event.data || {};
    if (message.type !== 'open' || !message.req) return;
    if (handler(String(message.noteId || ''), message.lineId ? String(message.lineId) : null)) {
      try { channel.postMessage({ type:'ack', req:message.req }); } catch (_) {}
    }
  });
}

// 엔터 입력: 한글 조합 중에는 무시
export const isComposing = event => event.isComposing || event.keyCode === 229;
export const isEnter = event => event.key === 'Enter' && !isComposing(event);
export const mobileQuery = () => window.matchMedia?.('(max-width: 499.98px)').matches === true;
