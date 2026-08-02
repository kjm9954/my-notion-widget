// store.js — 모든 위젯이 공유하는 저장소 계층
// 위젯은 이 파일의 함수만 부른다. 직접 fetch/localStorage 하지 않는다.

const API = "https://notion-widget.wldnjsdkk.workers.dev";
const STORE_CHANNEL = "notion-widget-store-v1";
const storeListeners = new Set();
let storeChannel = null;

try {
  storeChannel = new BroadcastChannel(STORE_CHANNEL);
  storeChannel.addEventListener("message", () => {
    storeListeners.forEach(listener => listener());
  });
} catch (_) {}

function announceChange(path) {
  try { storeChannel?.postMessage({ type: "changed", path, at: Date.now() }); } catch (_) {}
}

function watch(callback, interval = 3000) {
  let running = false;
  let queued = false;
  const run = () => {
    if (document.hidden) return;
    const active = document.activeElement;
    if (active && (active.matches("input, textarea, select") || active.isContentEditable)) return;
    if (running) { queued = true; return; }
    running = true;
    Promise.resolve(callback()).catch(() => {}).finally(() => {
      running = false;
      if (queued) { queued = false; run(); }
    });
  };
  storeListeners.add(run);
  const timer = setInterval(run, Math.max(1000, Number(interval) || 3000));
  const stop = () => {
    clearInterval(timer);
    storeListeners.delete(run);
  };
  window.addEventListener("pagehide", stop, { once: true });
  return stop;
}

// 공통 요청 헬퍼
async function apiGet(path) {
  const res = await fetch(API + path);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "요청 실패");
  return data;
}
async function apiPost(path, body) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "요청 실패");
  announceChange(path);
  return data;
}

// ───────── 하루 경계 (자정 기준) ─────────
function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
async function loadWorklogState() {
  return (await apiGet("/api/worklog/state")).data;
}
async function saveWorklogState(state) {
  return (await apiPost("/api/worklog/state", state)).data;
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

// ───────── 계산 (저장 안 함, 호출 시 계산) ─────────
async function getHP() {
  const dates = await getWrittenDates();
  const set = new Set(dates);
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    if (set.has(todayStr(d))) count++;
  }
  return Math.min(100, 20 + Math.round((count / 7) * 80));
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
  saveDiary, loadDiary, loadDiaryRange, getWrittenDates, deleteDiary,
  loadMoodWords, saveMoodWords,
  loadThoughtState, saveThoughtState, addThought, loadThoughts, updateThought, deleteThought,
  loadGoalState, saveGoalState, addGoal, loadGoals, updateGoal, toggleGoalDone, deleteGoal,
  loadIndexState, saveIndexScope, addIndexItem, updateIndexItem, deleteIndexItem,
  loadWorklogState, saveWorklogState, saveWorklogColumnSplit,
  loadImportantCalendarState, saveImportantCalendarState,
  loadWeeklyGoalsState, saveWeeklyGoalsState,
  loadNotesState, saveNotesState,
  getHP, getTodayAchievements, getAchievements, getMaterials, getMoodOfDate,
  watch,
};
