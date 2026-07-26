// store.js — 모든 위젯이 공유하는 저장소 계층
// 위젯은 이 파일의 함수만 부른다. 직접 fetch/localStorage 하지 않는다.

const API = "https://notion-widget.wldnjsdkk.workers.dev";

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
async function addThought(content, category) {
  return apiPost("/api/thoughts/add", { content, category });
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
async function deleteGoal(id) {
  return apiPost("/api/goals/delete", { id });
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
  const hp = Math.round((count / 7) * 100);
  return Math.max(hp, 20); // 하한 20
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
  addThought, loadThoughts, updateThought, deleteThought,
  addGoal, loadGoals, toggleGoalDone, deleteGoal,
  getHP, getTodayAchievements, getMaterials, getMoodOfDate,
};
