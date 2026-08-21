// store.js — 모든 위젯이 공유하는 저장소 계층
// 위젯은 이 파일의 함수만 부른다. 직접 fetch/localStorage 하지 않는다.

const API = "https://notion-widget.wldnjsdkk.workers.dev";
const INSTANCE_RE = /^w_[A-Za-z0-9_-]{24,176}$/;

function readWidgetInstanceId() {
  try {
    const search = new URLSearchParams(window.location.search || "");
    const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
    return search.get("w") || hash.get("w") || "";
  } catch (_) {
    return "";
  }
}

const RAW_INSTANCE_ID = readWidgetInstanceId();
const WIDGET_INSTANCE_ID = INSTANCE_RE.test(RAW_INSTANCE_ID) ? RAW_INSTANCE_ID : "";
const STORE_CHANNEL = `notion-widget-store-v1:${WIDGET_INSTANCE_ID || "legacy"}`;
const STORE_CACHE = "notion-widget-store-cache-v1";
const CACHE_WAIT_MS = 180;
const READING_SYNC_INTERVAL_MS = 5000;
const storeListeners = new Set();
const memoryCache = new Map();
const inFlightGets = new Map();
let storeChannel = null;
let errorIndicatorTimer = 0;

function showStoreError(error) {
  if (typeof document === "undefined" || !document.body) return;
  let indicator = document.querySelector("[data-store-error-indicator]");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.dataset.storeErrorIndicator = "";
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-live", "polite");
    Object.assign(indicator.style, {
      position: "fixed",
      left: "50%",
      bottom: "8px",
      zIndex: "2147483647",
      maxWidth: "calc(100% - 24px)",
      transform: "translateX(-50%)",
      padding: "5px 9px",
      border: "1px solid #d9e6ec",
      borderRadius: "999px",
      background: "rgba(255,255,255,.96)",
      color: "#607984",
      boxShadow: "0 4px 14px rgba(29,56,68,.10)",
      font: "700 10px/1.35 system-ui, sans-serif",
      whiteSpace: "nowrap",
      pointerEvents: "none",
    });
    document.body.appendChild(indicator);
  }
  const detail = String(error?.message || error || "");
  indicator.textContent = /인스턴스/.test(detail) ? detail : "서버 연결 실패 · 다시 시도 중";
  clearTimeout(errorIndicatorTimer);
  errorIndicatorTimer = setTimeout(() => indicator?.remove(), 5000);
}

function clearStoreError() {
  if (typeof document === "undefined" || typeof document.querySelector !== "function") return;
  clearTimeout(errorIndicatorTimer);
  errorIndicatorTimer = 0;
  document.querySelector("[data-store-error-indicator]")?.remove();
}

function notifyStoreListeners() {
  storeListeners.forEach(listener => listener());
}

try {
  storeChannel = new BroadcastChannel(STORE_CHANNEL);
  storeChannel.addEventListener("message", notifyStoreListeners);
} catch (_) {}

function announceChange(path) {
  notifyStoreListeners();
  try { storeChannel?.postMessage({ type: "changed", path, at: Date.now() }); } catch (_) {}
}

function watch(callback, interval = 3000, options = {}) {
  const allowWhileEditing = options?.allowWhileEditing === true;
  let running = false;
  let queued = false;
  const run = () => {
    if (document.hidden) return;
    const active = document.activeElement;
    if (!allowWhileEditing && active && (active.matches("input, textarea, select") || active.isContentEditable)) return;
    if (running) { queued = true; return; }
    running = true;
    Promise.resolve(callback()).catch(() => {}).finally(() => {
      running = false;
      if (queued) { queued = false; run(); }
    });
  };
  storeListeners.add(run);
  const timer = setInterval(run, Math.max(1000, Number(interval) || 3000));
  const initialTimer = options?.initial === false ? null : setTimeout(run, 0);
  const onVisible = () => { if (!document.hidden) run(); };
  const onPageHide = event => { if (!event.persisted) stop(); };
  window.addEventListener("focus", run);
  window.addEventListener("online", run);
  window.addEventListener("pageshow", run);
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisible);
  const stop = () => {
    clearInterval(timer);
    clearTimeout(initialTimer);
    storeListeners.delete(run);
    window.removeEventListener("focus", run);
    window.removeEventListener("online", run);
    window.removeEventListener("pageshow", run);
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisible);
  };
  return stop;
}

// 공통 요청 헬퍼
function apiUrl(path, includeInstance = true) {
  if (RAW_INSTANCE_ID && !WIDGET_INSTANCE_ID) throw new Error("올바르지 않은 위젯 인스턴스 주소입니다.");
  const url = new URL(API + path);
  if (includeInstance && WIDGET_INSTANCE_ID) url.searchParams.set("w", WIDGET_INSTANCE_ID);
  return url.toString();
}

function parseCached(serialized) {
  try {
    const data = JSON.parse(serialized);
    return data && data.ok ? data : null;
  } catch (_) {
    return null;
  }
}

function cloneData(data) {
  if (typeof structuredClone === "function") return structuredClone(data);
  return JSON.parse(JSON.stringify(data));
}

async function readCached(url) {
  const inMemory = memoryCache.get(url);
  if (inMemory) {
    const data = parseCached(inMemory);
    if (data) return { data, serialized: inMemory };
    memoryCache.delete(url);
  }

  if (!("caches" in window)) return null;
  try {
    const cache = await caches.open(STORE_CACHE);
    const response = await cache.match(url);
    if (!response) return null;
    const serialized = await response.text();
    const data = parseCached(serialized);
    if (!data) {
      await cache.delete(url);
      return null;
    }
    memoryCache.set(url, serialized);
    return { data, serialized };
  } catch (_) {
    return null;
  }
}

function writeCached(url, data, serialized = JSON.stringify(data)) {
  memoryCache.set(url, serialized);
  if (!("caches" in window)) return;
  void caches.open(STORE_CACHE).then(cache => cache.put(url, new Response(serialized, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  }))).catch(() => {});
}

function comparablePayload(path, serialized) {
  if (!path.startsWith("/api/reading/library")) return serialized;
  try {
    const response = JSON.parse(serialized);
    return JSON.stringify([
      Array.isArray(response?.data?.books) ? response.data.books : [],
      Array.isArray(response?.data?.quotes) ? response.data.quotes : [],
    ]);
  } catch (_) {
    return serialized;
  }
}

async function deleteCachedUrl(url) {
  memoryCache.delete(url);
  inFlightGets.delete(url);
  if (!("caches" in window)) return;
  try { await (await caches.open(STORE_CACHE)).delete(url); } catch (_) {}
}

function invalidateApiGet(path) {
  return deleteCachedUrl(apiUrl(path));
}

function requestFresh(path, url, cachedPromise) {
  if (inFlightGets.has(url)) return inFlightGets.get(url);

  const request = fetch(url, { cache: "no-store" }).then(async res => {
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "요청 실패");
    const serialized = JSON.stringify(data);
    const cached = await cachedPromise;
    const changed = Boolean(cached && comparablePayload(path, cached.serialized) !== comparablePayload(path, serialized));
    writeCached(url, data, serialized);
    clearStoreError();
    if (changed) announceChange(path);
    return data;
  }).catch(error => {
    showStoreError(error);
    throw error;
  }).finally(() => {
    inFlightGets.delete(url);
  });

  inFlightGets.set(url, request);
  return request;
}

async function apiGet(path) {
  const url = apiUrl(path);
  const cachedPromise = readCached(url);
  const freshPromise = requestFresh(path, url, cachedPromise);
  const cached = await cachedPromise;

  if (!cached) return cloneData(await freshPromise);

  const result = await Promise.race([
    freshPromise.then(data => ({ type: "fresh", data }), error => ({ type: "error", error })),
    new Promise(resolve => setTimeout(() => resolve({ type: "cached" }), CACHE_WAIT_MS)),
  ]);

  if (result.type === "fresh") return cloneData(result.data);
  return cloneData(cached.data);
}
async function apiGetFresh(path) {
  const url = apiUrl(path);
  const cachedPromise = readCached(url);
  return cloneData(await requestFresh(path, url, cachedPromise));
}
async function apiPost(path, body, includeInstance = true) {
  const url = apiUrl(path, includeInstance);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "요청 실패");
    if (path.endsWith("/state") && data.data !== undefined) writeCached(url, data);
    if (path.startsWith("/api/reading/") && path !== "/api/reading/library") {
      await Promise.all([
        invalidateApiGet("/api/reading/library"),
        invalidateApiGet("/api/reading/library?fresh=1"),
      ]);
    }
    clearStoreError();
    announceChange(path);
    return data;
  } catch (error) {
    showStoreError(error);
    throw error;
  }
}

async function createWidgetInstance() {
  return (await apiPost("/api/instance/create", {}, false)).data;
}

function getWidgetInstanceId() {
  return WIDGET_INSTANCE_ID || null;
}

// ───────── 하루 경계 (자정 기준) ─────────
function todayStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function isToday(iso) {
  if (!iso) return false;
  return todayStr(new Date(iso)) === todayStr();
}

// ───────── 일기 ─────────
async function saveDiary(diary) {
  return apiPost("/api/diary/save", diary);
}
async function loadDiary(date) {
  return (await apiGet(`/api/diary/get?date=${encodeURIComponent(date)}`)).data;
}
async function loadDiaryRange(start, end) {
  return (await apiGet(`/api/diary/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)).data;
}
async function getWrittenDates() {
  return (await apiGet("/api/diary/dates")).data;
}
async function deleteDiary(date) {
  return apiPost("/api/diary/delete", { date });
}

// ───────── 감정 단어 ─────────
async function loadMoodWords() {
  return (await apiGet("/api/settings/mood-words")).data;
}
async function saveMoodWords(words) {
  return apiPost("/api/settings/mood-words", { words });
}

// ───────── 성장 스탯 · 독서 기록 ─────────
async function loadStatsSettings() {
  return (await apiGet("/api/stats/settings")).data;
}
async function saveStatsSettings(settings) {
  return (await apiPost("/api/stats/settings", settings)).data;
}
async function loadReadingNotesState() {
  return (await apiGet("/api/reading-notes/state")).data;
}
async function saveReadingNotesState(state) {
  return (await apiPost("/api/reading-notes/state", state)).data;
}
async function addReadingNotes(date, count) {
  return (await apiPost("/api/reading-notes/add", { date, count })).data;
}
async function loadReadingLibrary(options = {}) {
  const path = options?.fresh === true ? "/api/reading/library?fresh=1" : "/api/reading/library";
  return (await apiGet(path)).data;
}
function readingLibrarySignature(state) {
  return JSON.stringify([
    Array.isArray(state?.books) ? state.books : [],
    Array.isArray(state?.quotes) ? state.quotes : [],
  ]);
}
function watchReadingLibrary(callback, options = {}) {
  let renderedSignature = null;
  const onError = typeof options?.onError === "function" ? options.onError : null;
  return watch(async () => {
    try {
      const state = await loadReadingLibrary();
      const nextSignature = readingLibrarySignature(state);
      if (nextSignature === renderedSignature) return;
      await callback(state);
      renderedSignature = nextSignature;
    } catch (error) {
      if (onError) onError(error);
      else throw error;
    }
  }, options?.interval ?? READING_SYNC_INTERVAL_MS, {
    allowWhileEditing: options?.allowWhileEditing === true,
  });
}
async function createReadingBook(book) {
  return (await apiPost("/api/reading/books/create", book)).data;
}
async function updateReadingBook(id, patch) {
  return (await apiPost("/api/reading/books/update", { id, patch })).data;
}
async function createReadingQuotes(bookId, quotes, options = {}) {
  return (await apiPost("/api/reading/quotes/create", {
    bookId,
    quotes,
    date: options?.date,
    pageRead: options?.pageRead,
  })).data;
}
async function updateReadingQuote(id, patch, original = {}) {
  return (await apiPost("/api/reading/quotes/update", { id, patch, original })).data;
}
async function deleteReadingQuote(id, original = {}) {
  return apiPost("/api/reading/quotes/delete", { id, original });
}

// ───────── 생각 ─────────
async function loadThoughtState() {
  return (await apiGet("/api/thoughts/state")).data;
}
async function saveThoughtState(state) {
  return (await apiPost("/api/thoughts/state", state)).data;
}
async function addThought(content, category) {
  const body = content && typeof content === "object" ? content : { content, category };
  return apiPost("/api/thoughts/add", body);
}
async function loadThoughts(filter = {}) {
  const q = new URLSearchParams();
  if (filter.category) q.set("category", filter.category);
  if (filter.keyword) q.set("keyword", filter.keyword);
  const qs = q.toString();
  return (await apiGet(`/api/thoughts/list${qs ? "?" + qs : ""}`)).data;
}
async function updateThought(id, patch) {
  return apiPost("/api/thoughts/update", { id, ...patch });
}
async function deleteThought(id) {
  return apiPost("/api/thoughts/delete", { id });
}

// ───────── 목표 ─────────
async function loadGoalState() {
  return (await apiGet("/api/goals/state")).data;
}
async function saveGoalState(state) {
  return (await apiPost("/api/goals/state", state)).data;
}
async function addGoal(title, scope, parentId) {
  return apiPost("/api/goals/add", { title, scope, parentId });
}
async function loadGoals(scope) {
  const qs = scope ? `?scope=${encodeURIComponent(scope)}` : "";
  return (await apiGet(`/api/goals/list${qs}`)).data;
}
async function toggleGoalDone(id) {
  return apiPost("/api/goals/toggle", { id });
}
async function updateGoal(id, patch) {
  return apiPost("/api/goals/update", { id, ...patch });
}
async function deleteGoal(id, cascade = false) {
  return apiPost("/api/goals/delete", { id, cascade });
}

// ───────── 에너지 나침반 ─────────
async function loadIndexState() {
  return (await apiGet("/api/index/state")).data;
}
async function saveIndexScope(scope) {
  return apiPost("/api/index/scope", { scope });
}
async function addIndexItem(title, scope, parent = null) {
  return apiPost("/api/index/add", { title, scope, parent });
}
async function updateIndexItem(id, patch) {
  return apiPost("/api/index/update", { id, patch });
}
async function deleteIndexItem(id) {
  return apiPost("/api/index/delete", { id });
}

// ───────── 업무일지 ─────────
async function loadWorklogState(options = {}) {
  const response = options?.fresh === true
    ? await apiGetFresh("/api/worklog/state")
    : await apiGet("/api/worklog/state");
  return response.data;
}
async function saveWorklogState(state) {
  return (await apiPost("/api/worklog/state", state)).data;
}
async function patchWorklogState(patch) {
  const data = (await apiPost("/api/worklog/patch", patch)).data;
  writeCached(apiUrl("/api/worklog/state"), { ok: true, data });
  return data;
}
async function saveWorklogView(view) {
  return (await apiPost("/api/worklog/view", { view })).data;
}
async function saveWorklogColumnSplit(mode, value) {
  return (await apiPost("/api/worklog/column-split", { mode, value })).data;
}

// ───────── 중요 업무 ─────────
async function loadImportantCalendarState() {
  return (await apiGet("/api/important-calendar/state")).data;
}
async function saveImportantCalendarState(state) {
  return (await apiPost("/api/important-calendar/state", state)).data;
}

// ───────── 이번 주 목표 ─────────
async function loadWeeklyGoalsState() {
  return (await apiGet("/api/weekly-goals/state")).data;
}
async function saveWeeklyGoalsState(state) {
  return (await apiPost("/api/weekly-goals/state", state)).data;
}

// ───────── 메모장 ─────────
async function loadNotesState() {
  return (await apiGet("/api/notes/state")).data;
}
async function saveNotesState(state) {
  return (await apiPost("/api/notes/state", state)).data;
}

// ───────── 업무 관리 예약 ─────────
async function loadSchedules() {
  return (await apiGet("/api/schedules/list")).data;
}
async function createSchedule(schedule) {
  return (await apiPost("/api/schedules/create", schedule)).data;
}
async function updateSchedule(id, patch) {
  return (await apiPost("/api/schedules/update", { id, ...patch })).data;
}
async function skipScheduleOccurrence(id, skip = true) {
  return (await apiPost("/api/schedules/skip", { id, skip })).data;
}
async function deleteSchedule(id) {
  return apiPost("/api/schedules/delete", { id });
}

// ───────── 계산 (저장 안 함, 호출 시 계산) ─────────
async function getHP() {
  const dates = await getWrittenDates();
  const set = new Set(dates);
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86400000);
    if (set.has(todayStr(d))) count++;
  }
  return Math.max(20, Math.round((count / 7) * 100));
}
async function getTodayAchievements() {
  const today = todayStr();
  const diary = await loadDiary(today);
  const fromDiary = diary?.achievements || [];
  const goals = await loadGoals();
  const fromGoals = goals
    .filter(g => g.done && isToday(g.completedAt))
    .map(g => g.title);
  return [...fromDiary, ...fromGoals];
}
async function getAchievements() {
  const [diaries, goals] = await Promise.all([
    loadDiaryRange("0000-01-01", "9999-12-31"),
    loadGoals(),
  ]);
  const fromDiary = diaries.flatMap(diary => (Array.isArray(diary.achievements) ? diary.achievements : [])
    .map((text, index) => ({ id: `diary:${diary.date}:${index}:${text}`, date: diary.date, text: String(text || "").trim(), source: "diary" }))
    .filter(item => item.text));
  const fromGoals = goals.filter(goal => goal.done && goal.completedAt).map(goal => ({
    id: `goal:${goal.id}`,
    date: todayStr(new Date(goal.completedAt)),
    text: goal.title,
    source: "goal",
  }));
  return [...fromDiary, ...fromGoals].sort((a, b) => b.date.localeCompare(a.date));
}
async function getMaterials() {
  const all = await loadThoughts();
  return all.filter(t => isToday(t.createdAt));
}
async function getMoodOfDate(date) {
  const diary = await loadDiary(date);
  return diary?.mood || null;
}

// 위젯에서 window.Store.saveDiary(...)처럼 씀
window.Store = {
  READING_SYNC_INTERVAL_MS,
  createWidgetInstance, getWidgetInstanceId,
  saveDiary, loadDiary, loadDiaryRange, getWrittenDates, deleteDiary,
  loadMoodWords, saveMoodWords,
  loadStatsSettings, saveStatsSettings,
  loadReadingNotesState, saveReadingNotesState, addReadingNotes,
  loadReadingLibrary, watchReadingLibrary, createReadingBook, updateReadingBook,
  createReadingQuotes, updateReadingQuote, deleteReadingQuote,
  loadThoughtState, saveThoughtState, addThought, loadThoughts, updateThought, deleteThought,
  loadGoalState, saveGoalState, addGoal, loadGoals, updateGoal, toggleGoalDone, deleteGoal,
  loadIndexState, saveIndexScope, addIndexItem, updateIndexItem, deleteIndexItem,
  loadWorklogState, saveWorklogState, patchWorklogState, saveWorklogView, saveWorklogColumnSplit,
  loadImportantCalendarState, saveImportantCalendarState,
  loadWeeklyGoalsState, saveWeeklyGoalsState,
  loadNotesState, saveNotesState,
  loadSchedules, createSchedule, updateSchedule, skipScheduleOccurrence, deleteSchedule,
  getHP, getTodayAchievements, getAchievements, getMaterials, getMoodOfDate,
  watch,
};
