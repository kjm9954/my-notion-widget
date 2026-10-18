// 목표 체크 위젯 3종 공통: 분기 선택 공유, 분기 목표·습관 데이터(Store) 연결, 저장 순서 관리.
// 실제 데이터는 window.Store만 사용한다. localStorage에는 고른 분기(UI 설정)만 둔다.
// 업무/일상 전환은 기존 sky-lime-common의 setMode를 그대로 쓴다(같은 키의 sky-lime 위젯과 함께 바뀜).
import { Store, getMode } from './sky-lime-common.mjs?v=20261015-sky-lime';
import { currentQuarter, quarterInRange, applyOps, worklogToday } from './goal-check-model.mjs?v=20261018-goal-check';

// ───────── 분기 선택 (기기별 UI 설정) ─────────
// 세 위젯이 서로 다른 iframe이어도 함께 바뀐다(localStorage + BroadcastChannel).
// 고른 날(업무일)이 지나면 이번 분기로 돌아간다. 범위 밖 값은 이번 분기.
const QUARTER_KEY = `sky-lime-goal-quarter-v1:${Store?.getWidgetInstanceId?.() || 'unconnected'}`;
const QUARTER_CHANNEL = 'sky-lime-goal-quarter-v1';
const quarterListeners = new Set();
let quarterChannel = null;
let currentPick = readStoredQuarter();

function parsePick(raw) {
  try {
    const saved = JSON.parse(raw || 'null');
    if (saved?.day === worklogToday() && quarterInRange(saved.quarter)) return saved.quarter;
  } catch (_) {}
  return currentQuarter();
}
function readStoredQuarter() {
  try { return parsePick(window.localStorage.getItem(QUARTER_KEY)); }
  catch (_) { return currentQuarter(); }
}
function applyQuarter(quarter) {
  const next = quarterInRange(quarter) ? quarter : currentQuarter();
  if (next === currentPick) return;
  currentPick = next;
  quarterListeners.forEach(listener => listener(next));
}
export const getQuarter = () => currentPick;
export function setQuarter(quarter) {
  if (!quarterInRange(quarter)) return;
  const saved = JSON.stringify({ quarter, day:worklogToday() });
  try { window.localStorage.setItem(QUARTER_KEY, saved); } catch (_) { /* 열린 위젯끼리만 전환 */ }
  try { quarterChannel?.postMessage({ key:QUARTER_KEY, saved }); } catch (_) {}
  applyQuarter(quarter);
}
export function onQuarterChange(listener) {
  quarterListeners.add(listener);
  return () => quarterListeners.delete(listener);
}
window.addEventListener('storage', event => { if (event.key === QUARTER_KEY) applyQuarter(parsePick(event.newValue)); });
try {
  quarterChannel = new BroadcastChannel(QUARTER_CHANNEL);
  quarterChannel.addEventListener('message', event => { if (event.data?.key === QUARTER_KEY) applyQuarter(parsePick(event.data.saved)); });
} catch (_) {}
const resyncQuarter = () => applyQuarter(readStoredQuarter());
window.addEventListener('focus', resyncQuarter);
document.addEventListener('visibilitychange', () => { if (!document.hidden) resyncQuarter(); });

// 업무일이 바뀌면(오전 6시) 다시 그린다. 고른 분기도 이때 이번 분기로 돌아간다.
const dayListeners = new Set();
let lastDay = worklogToday();
setInterval(() => {
  const day = worklogToday();
  if (day === lastDay) return;
  lastDay = day;
  resyncQuarter();
  dayListeners.forEach(listener => listener(day));
}, 60000);
export function onDayChange(listener) {
  dayListeners.add(listener);
  return () => dayListeners.delete(listener);
}

// ───────── 읽기·변경 구독 ─────────
// 연결 실패 시 Store가 넘겨주는 마지막 정상 자료(cachedData)를 보여주고 오류도 함께 알린다.
async function readQuarter(mode, quarter) {
  try { return { data:await Store.loadQuarterGoals(mode, quarter) }; }
  catch (error) {
    if (error?.cachedData !== undefined) return { data:error.cachedData, error };
    throw error;
  }
}
export function watchQuarterGoals(callback) {
  return Store.watch(callback, 120000, { allowWhileEditing:true, initial:false, allowCached:true, paths:['/api/quarter-goals/'] });
}

// ───────── 데이터 컨트롤러 ─────────
// 지금 보고 있는 업무/일상 + 분기의 서버 상태 + 저장 대기 중인 변경(순서대로 하나씩 저장).
// 저장 중에 도착한 읽기는 덮어쓰지 않고, 저장이 끝난 뒤 다시 읽는다. 실패하면 화면을 서버 값으로 되돌린다.
export function createQuarterController(onChange) {
  let scope = '';
  let serverState = null;
  let error = null;
  let loaded = false;
  let running = false;
  let reloadAfter = false;
  let readSeq = 0;
  const queue = [];
  // 분기·업무/일상을 오갈 때 이미 본 화면은 바로 보여주고 뒤에서 다시 읽는다(이 화면 메모리에만).
  const seen = new Map();
  const scopeOf = () => ({ mode:getMode(), quarter:getQuarter() });
  const keyOf = ({ mode, quarter }) => `${mode}|${quarter}`;
  const pendingHere = () => queue.some(item => item.key === scope);

  function enterScope() {
    const key = keyOf(scopeOf());
    if (key === scope) return false;
    if (scope && serverState) seen.set(scope, serverState);
    scope = key;
    serverState = seen.get(key) || null;
    error = null;
    loaded = Boolean(serverState);
    return true;
  }
  const view = () => serverState
    ? queue.filter(item => item.key === scope).reduce((state, item) => applyOps(state, item.ops, item.at), serverState)
    : null;
  const readOnly = () => !serverState || Boolean(error);

  async function load() {
    if (enterScope()) onChange({ type:'scope' });
    if (running || pendingHere()) { reloadAfter = true; return; }
    const target = scopeOf();
    const key = keyOf(target);
    const seq = ++readSeq;
    try {
      const result = await readQuarter(target.mode, target.quarter);
      if (seq !== readSeq || key !== scope) return;
      if (running || pendingHere()) { reloadAfter = true; return; }
      serverState = result.data;
      error = result.error || null;
    } catch (failure) {
      if (seq !== readSeq || key !== scope) return;
      console.warn('분기 목표를 불러오지 못했습니다.', failure);
      error = failure;
    }
    loaded = true;
    onChange({ type:'load' });
  }

  async function pump() {
    if (running) return;
    running = true;
    while (queue.length) {
      const item = queue[0];
      try {
        const data = await Store.patchQuarterGoals(item.mode, item.quarter, item.ops);
        if (item.key === scope && data && Array.isArray(data.goals)) serverState = data;
        queue.shift();
      } catch (failure) {
        queue.shift();
        console.warn('분기 목표를 저장하지 못했습니다.', failure);
        onChange({ type:'save-error', error:failure });
        reloadAfter = true;
      }
      onChange({ type:'saved' });
    }
    running = false;
    readSeq += 1;
    if (reloadAfter) { reloadAfter = false; await load(); }
  }

  function submit(ops) {
    if (readOnly() || !ops.length) {
      onChange({ type:'blocked' });
      return false;
    }
    const target = scopeOf();
    queue.push({ key:keyOf(target), mode:target.mode, quarter:target.quarter, ops, at:new Date().toISOString() });
    onChange({ type:'local' });
    pump();
    return true;
  }

  return {
    load, submit, view, readOnly,
    get error() { return error; },
    get loaded() { return loaded; },
    get saving() { return running || queue.length > 0; }
  };
}

// 엔터 입력: 한글 조합 중에는 무시
export const isEnter = event => event.key === 'Enter' && !event.isComposing && event.keyCode !== 229;
