// sky-lime 위젯 공통: 업무/일상 전환 동기화, 기존 Store API 연결, 공통 마크업.
// 실제 데이터는 window.Store만 사용한다. localStorage에는 업무/일상 선택값만 둔다.
import { withStatus, uncheckStatus, statusOf, supportsReview, storableStatus } from './sky-lime-model.mjs?v=20261015-sky-lime';

export const Store = window.Store;

export const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
})[character]);

export const canHover = () => window.matchMedia?.('(hover: hover)').matches === true;

// ───────── 업무/일상 전환 (기기별 UI 설정) ─────────
// 같은 인스턴스(w)의 4개 위젯이 함께 바뀐다. 서버에는 저장하지 않는다.
const MODE_KEY = `sky-lime-worklog-mode-v1:${Store?.getWidgetInstanceId?.() || 'unconnected'}`;
const MODE_CHANNEL = 'sky-lime-worklog-mode-v1';
let currentMode = readStoredMode();
const modeListeners = new Set();
let modeChannel = null;

function readStoredMode() {
  try { return window.localStorage.getItem(MODE_KEY) === 'life' ? 'life' : 'work'; }
  catch (_) { return 'work'; }
}
function applyMode(mode) {
  const next = mode === 'life' ? 'life' : 'work';
  if (next === currentMode) return;
  currentMode = next;
  modeListeners.forEach(listener => listener(next));
}
export const getMode = () => currentMode;
export function setMode(mode) {
  const next = mode === 'life' ? 'life' : 'work';
  try { window.localStorage.setItem(MODE_KEY, next); } catch (_) { /* 이 탭 안에서만 전환 */ }
  try { modeChannel?.postMessage({ key:MODE_KEY, mode:next }); } catch (_) {}
  applyMode(next);
}
export function onModeChange(listener) {
  modeListeners.add(listener);
  return () => modeListeners.delete(listener);
}
window.addEventListener('storage', event => { if (event.key === MODE_KEY) applyMode(event.newValue); });
try {
  // localStorage를 막은 환경에서도 열린 위젯끼리는 함께 바뀌게 한다.
  modeChannel = new BroadcastChannel(MODE_CHANNEL);
  modeChannel.addEventListener('message', event => { if (event.data?.key === MODE_KEY) applyMode(event.data.mode); });
} catch (_) {}
// 다른 탭에서 바뀐 값을 놓쳤을 때 돌아오면 맞춘다.
window.addEventListener('focus', () => applyMode(readStoredMode()));
document.addEventListener('visibilitychange', () => { if (!document.hidden) applyMode(readStoredMode()); });

export function modeToggleHtml(mode) {
  const button = (value, label) => `<button class="sl-seg-button${mode === value ? ' is-on' : ''}" type="button" data-mode="${value}" aria-pressed="${mode === value}">${label}</button>`;
  return `<div class="sl-seg" role="group" aria-label="업무/일상 전환">${button('work', '업무')}${button('life', '일상')}</div>`;
}
// 같은 모드면 다시 그리지 않는다(누르는 도중에 버튼이 바뀌어 클릭이 사라지지 않게).
export function paintModeToggle(element, mode) {
  if (element.dataset.paintedMode === mode && element.firstElementChild) return;
  element.innerHTML = modeToggleHtml(mode);
  element.dataset.paintedMode = mode;
}
export function bindModeToggle(root) {
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-mode]');
    if (!button || !root.contains(button)) return;
    setMode(button.dataset.mode);
  });
}

// ───────── 읽기 ─────────
// 연결 실패 시 Store가 넘겨주는 마지막 정상 자료(cachedData)를 보여주고 오류도 함께 알린다.
async function readLastKnown(load) {
  try { return { data:await load() }; }
  catch (error) {
    if (error?.cachedData !== undefined) return { data:error.cachedData, error };
    throw error;
  }
}
export const readWorklog = () => readLastKnown(() => Store.loadWorklogState({ fresh:true }));
export const readNotes = () => readLastKnown(() => Store.loadNotesState());
export function watchWorklog(callback) {
  return Store.watch(callback, 120000, { allowWhileEditing:true, initial:false, allowCached:true, paths:['/api/worklog/'] });
}
export function watchNotes(callback) {
  return Store.watch(callback, 120000, { allowWhileEditing:true, initial:false, allowCached:true, paths:['/api/notes/'] });
}

// ───────── 업무 쓰기 ─────────
// 응답이 전체 상태면 그대로 쓰고, 아니면 최신 상태를 다시 읽는다.
async function stateFrom(result) {
  if (result && Array.isArray(result.tasks)) return result;
  if (result?.data && Array.isArray(result.data.tasks)) return result.data;
  return Store.loadWorklogState({ fresh:true });
}
export async function upsertTask(task) {
  return stateFrom(await Store.patchWorklogState({ upserts:[task] }));
}
export async function upsertTasks(tasks) {
  return stateFrom(await Store.patchWorklogState({ upserts:tasks }));
}
export async function deleteTask(id) {
  return stateFrom(await Store.patchWorklogState({ deleteIds:[id] }));
}
// 상태 변경: 서버의 전용 함수가 있으면 사용, 없으면 기존 업무 저장 방식으로 status를 바꾼다.
export async function changeTaskStatus(task, status) {
  if (typeof Store.updateWorklogTaskStatus === 'function') {
    return stateFrom(await Store.updateWorklogTaskStatus(task.id, status));
  }
  return upsertTask(withStatus(task, status));
}
export const toggleTarget = task => statusOf(task) === 'done' ? uncheckStatus(task) : 'done';

// 업무 변경 단위. apply는 화면에 바로 보일 결과, send는 서버 저장(직전 서버 상태 기준).
const findTask = (state, id) => (state?.tasks || []).find(task => String(task.id) === String(id));
const mapTask = (state, id, change) => ({ ...state, tasks:(state.tasks || []).map(task => String(task.id) === String(id) ? change(task) : task) });
export const taskOps = {
  add(task) {
    return { apply:state => ({ ...state, tasks:[...(state.tasks || []), task] }), send:() => upsertTask(task) };
  },
  update(id, patch) {
    return {
      apply:state => mapTask(state, id, task => ({ ...task, ...patch })),
      send:async state => { const task = findTask(state, id); return task ? upsertTask({ ...task, ...patch }) : state; }
    };
  },
  // 검토 대기(review)는 서버에 그대로 보내고, 화면은 서버가 돌려준 상태를 따른다.
  // review를 모르는 서버는 예정으로 바꿔 저장하므로 오류 없이 예정 열에 남고,
  // 서버가 review를 받기 시작하면 코드 수정 없이 바로 검토 대기 열로 간다.
  // 저장 전 미리 보여주는 화면은 서버 지원이 확인된 뒤에만 review, 그 전에는 예정.
  status(id, status) {
    const shown = state => storableStatus(status, supportsReview(state, typeof Store.updateWorklogTaskStatus === 'function'));
    return {
      apply:state => mapTask(state, id, task => withStatus(task, shown(state))),
      send:async state => {
        const task = findTask(state, id);
        return task && statusOf(task) !== status ? changeTaskStatus(task, status) : state;
      }
    };
  },
  remove(id) {
    return {
      apply:state => ({ ...state, tasks:(state.tasks || []).filter(task => String(task.id) !== String(id)) }),
      send:() => deleteTask(id)
    };
  },
  // 구분 삭제: 그 구분을 쓰던 업무(현재 모드)를 기타로 옮긴다.
  clearCategory(mode, matches) {
    const affected = task => (task.mode === 'life' ? 'life' : 'work') === mode && matches(task);
    return {
      apply:state => ({ ...state, tasks:(state.tasks || []).map(task => affected(task) ? { ...task, proj:'' } : task) }),
      send:async state => {
        const tasks = (state.tasks || []).filter(affected).map(task => ({ ...task, proj:'' }));
        return tasks.length ? upsertTasks(tasks) : state;
      }
    };
  }
};

// 업무 데이터 컨트롤러: 서버 상태 + 저장 대기 중인 변경(순서대로 하나씩 저장).
// 저장 중에 도착한 읽기는 덮어쓰지 않고, 저장이 끝난 뒤 다시 읽는다.
export function createWorklogController(onChange) {
  let serverState = null;
  let error = null;
  let loaded = false;
  let running = false;
  let reloadAfter = false;
  let readSeq = 0;
  const queue = [];
  const view = () => serverState ? queue.reduce((state, op) => op.apply(state), serverState) : null;
  const readOnly = () => !serverState || Boolean(error);

  async function load() {
    if (running || queue.length) { reloadAfter = true; return; }
    const seq = ++readSeq;
    try {
      const result = await readWorklog();
      if (seq !== readSeq) return;
      if (running || queue.length) { reloadAfter = true; return; }
      serverState = result.data;
      error = result.error || null;
    } catch (failure) {
      if (seq !== readSeq) return;
      console.warn('업무 데이터를 불러오지 못했습니다.', failure);
      error = failure;
    }
    loaded = true;
    onChange({ type:'load' });
  }

  async function pump() {
    if (running) return;
    running = true;
    while (queue.length) {
      const op = queue[0];
      try {
        serverState = await op.send(serverState);
        queue.shift();
      } catch (failure) {
        queue.shift();
        console.warn('업무를 저장하지 못했습니다.', failure);
        onChange({ type:'save-error', error:failure });
        reloadAfter = true;
      }
      onChange({ type:'saved' });
    }
    running = false;
    readSeq += 1;
    if (reloadAfter) { reloadAfter = false; await load(); }
  }

  function submit(op) {
    if (readOnly()) {
      onChange({ type:'blocked' });
      return false;
    }
    queue.push(op);
    onChange({ type:'local' });
    pump();
    return true;
  }

  return {
    load, submit, view,
    get error() { return error; },
    get loaded() { return loaded; },
    get saving() { return running || queue.length > 0; },
    readOnly
  };
}

// ───────── 메모 쓰기 ─────────
// 생성·수정은 기존 patch 형식(updates/changes). patch 함수가 없을 때만 최신 상태를 다시 읽어 병합 저장.
export async function patchNotes(patch) {
  if (typeof Store.patchNotesState === 'function') return Store.patchNotesState(patch);
  const latest = await Store.loadNotesState();
  const items = Array.isArray(latest?.items) ? latest.items.map(item => ({ ...item })) : [];
  for (const update of patch.updates || []) {
    const found = items.find(item => item.id === update.id);
    if (found) Object.assign(found, update.changes);
    else if (update.create) items.push({ id:update.id, done:false, ...update.changes });
  }
  const removed = new Set(patch.deleteIds || []);
  return Store.saveNotesState({ ...latest, items:items.filter(item => !removed.has(item.id)) });
}

export function makeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// 상태 안내 문구: 이전 자료 표시/불러오기 실패. 키 값은 노출하지 않는다.
export function staleText(error) {
  if (!error) return '';
  return error.dailyLimit ? '이전 데이터 표시 중 · 오전 9시 이후 갱신' : '이전 데이터 표시 중 · 연결되면 갱신';
}
export function failureText(error) {
  if (/인스턴스|주소/.test(String(error?.message || ''))) return '위젯 주소를 확인해 주세요';
  return error?.dailyLimit ? '서버 한도 초과 · 오전 9시 이후 다시 확인해요' : '불러오지 못했어요 · 잠시 후 다시 확인해요';
}
