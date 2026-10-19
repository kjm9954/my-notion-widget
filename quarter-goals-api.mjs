// Additive endpoint for the goal-check widgets (분기 목표 · 습관 점검).
// Independent of worklog, weekly goals and notes. No migrations, no KV.
// One existing widget_settings row per instance + mode + quarter:
//   instance:<w>:quarterGoals:v1:<work|life>:<YYYY-Qn>
// The row exists once anything was saved for that quarter. That is how a quarter
// counts as "initialized": habit names carry over only into a quarter without a row.
export const QUARTER_GOALS_PREFIX = '/api/quarter-goals/';
const STATE_PATH = '/api/quarter-goals/state';
const PATCH_PATH = '/api/quarter-goals/patch';
export const LIMITS = Object.freeze({ goals:5, habits:5, steps:6, ops:20, goalTitle:120, stepTitle:100, habitName:60, body:16384 });
export const MARKS = Object.freeze(['good', 'half', 'bad']);
// First days of a quarter in which the previous quarter's last month may still be marked.
export const CARRY_LOOKBACK = 4;
export const LAST_MONTH_GRACE_DAYS = 7;
const instancePattern = /^w_[A-Za-z0-9_-]{24,176}$/;
const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
const quarterPattern = /^(\d{4})-Q([1-4])$/;
const DAY_ROLLOVER_MS = 6 * 60 * 60 * 1000;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

export function withQuarterGoals(existingWorker) {
  return {...existingWorker, async fetch(request, env, context) {
    const response = await handleQuarterGoals(request, env);
    return response || existingWorker.fetch(request, env, context);
  }};
}

class RequestError extends Error {
  constructor(status, error, extra = {}) { super(error); this.status = status; this.extra = extra; }
}

// ───────── Dates: workday starts 06:00 Seoul (same rule as the worklog) ─────────
export function workdayKey(now = Date.now()) {
  const shifted = new Date(Number(now) - DAY_ROLLOVER_MS + SEOUL_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}
export function quarterOfDay(day) {
  const [year, month] = day.split('-').map(Number);
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}
const quarterIndex = quarter => { const [, y, q] = quarterPattern.exec(quarter); return Number(y) * 4 + Number(q) - 1; };
export function shiftQuarter(quarter, by) {
  const index = quarterIndex(quarter) + by;
  return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
}
export function isQuarter(value) {
  const match = quarterPattern.exec(String(value || ''));
  return Boolean(match) && Number(match[1]) >= 2000 && Number(match[1]) <= 2999;
}
// What may be written to a quarter today. month = index of today's month inside the quarter.
export function quarterAccess(quarter, now = Date.now()) {
  const today = workdayKey(now);
  const current = quarterOfDay(today);
  const diff = quarterIndex(quarter) - quarterIndex(current);
  const thisMonth = (Number(today.slice(5, 7)) - 1) % 3, dayOfMonth = Number(today.slice(8));
  if (diff === 0) return { editable:true, markable:index => index <= thisMonth };
  if (diff > 0) return { editable:true, markable:() => false };
  const grace = diff === -1 && thisMonth === 0 && dayOfMonth <= LAST_MONTH_GRACE_DAYS;
  return { editable:false, markable:index => grace && index === 2 };
}

// ───────── Row normalization (defensive: stored JSON is never trusted blindly) ─────────
const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const iso = value => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null);
function normalizeGoal(raw, index) {
  if (!idPattern.test(String(raw?.id || ''))) return null;
  const title = text(raw.title, LIMITS.goalTitle);
  if (!title) return null;
  const ids = new Set();
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).map(step => {
    const id = String(step?.id || ''), title = text(step?.title, LIMITS.stepTitle);
    if (!idPattern.test(id) || ids.has(id) || !title) return null;
    ids.add(id);
    return { id, title, done:step.done === true };
  }).filter(Boolean).slice(0, LIMITS.steps);
  const pct = Math.max(0, Math.min(100, Math.round(Number(raw.pct) || 0)));
  const status = ['doing', 'done', 'hold'].includes(raw.status) ? raw.status : 'doing';
  return { id:raw.id, order:Number.isInteger(raw.order) ? raw.order : index + 1, title, steps, pct, status,
    lastActivityAt:iso(raw.lastActivityAt), createdAt:iso(raw.createdAt), doneAt:status === 'done' ? iso(raw.doneAt) : null };
}
function normalizeHabit(raw, index) {
  if (!idPattern.test(String(raw?.id || ''))) return null;
  const name = text(raw.name, LIMITS.habitName);
  if (!name) return null;
  const months = [0, 1, 2].map(i => (MARKS.includes(raw.months?.[i]) ? raw.months[i] : null));
  return { id:raw.id, order:Number.isInteger(raw.order) ? raw.order : index + 1, name, months };
}
function uniqueById(list) {
  const seen = new Set();
  return list.filter(item => item && !seen.has(item.id) && seen.add(item.id));
}
export function normalizeRow(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const goals = uniqueById((Array.isArray(source.goals) ? source.goals : []).map(normalizeGoal))
    .sort((a, b) => a.order - b.order).slice(0, LIMITS.goals);
  const habits = uniqueById((Array.isArray(source.habits) ? source.habits : []).map(normalizeHabit))
    .sort((a, b) => a.order - b.order).slice(0, LIMITS.habits);
  return { v:1, createdAt:iso(source.createdAt), updatedAt:iso(source.updatedAt), goals, habits };
}
function publicState(mode, quarter, row, initialized) {
  return { mode, quarter, initialized, updatedAt:row.updatedAt || null, goals:row.goals, habits:row.habits };
}
const carriedHabits = row => row.habits.map((habit, index) => ({ id:habit.id, order:index + 1, name:habit.name, months:[null, null, null] }));

// ───────── Ops ─────────
// status: done when every step is checked, or pct reaches 100 with no steps. hold is manual.
function settle(goal, now) {
  if (goal.status !== 'hold') {
    const done = goal.steps.length ? goal.steps.every(step => step.done) : goal.pct >= 100;
    goal.status = done ? 'done' : 'doing';
  }
  if (goal.status === 'done') goal.doneAt = goal.doneAt || now;
  else goal.doneAt = null;
}
const nextOrder = list => list.reduce((max, item) => Math.max(max, item.order), 0) + 1;
function requireId(value) {
  const id = String(value ?? '');
  if (!idPattern.test(id)) throw new RequestError(400, 'invalid id');
  return id;
}
function requireText(value, max) {
  const clean = text(value, max);
  if (!clean) throw new RequestError(400, 'text is required');
  return clean;
}

// Returns true when the row changed. Missing targets are a no-op (another device may have removed them).
export function applyOp(row, op, access, now) {
  const type = String(op?.type || '');
  if (type === 'markHabit') {
    const habit = row.habits.find(item => item.id === requireId(op.id));
    const month = Number(op.month);
    if (![0, 1, 2].includes(month)) throw new RequestError(400, 'invalid month');
    const value = op.value === null ? null : MARKS.includes(op.value) ? op.value : undefined;
    if (value === undefined) throw new RequestError(400, 'invalid mark');
    if (!access.markable(month)) throw new RequestError(409, 'month not open');
    if (!habit || habit.months[month] === value) return false;
    habit.months[month] = value;
    return true;
  }
  if (!access.editable) throw new RequestError(409, 'read-only quarter');
  const goal = () => row.goals.find(item => item.id === requireId(op.goalId ?? op.id));
  switch (type) {
    case 'addGoal': {
      const id = requireId(op.id), title = requireText(op.title, LIMITS.goalTitle);
      if (row.goals.some(item => item.id === id)) return false;
      if (row.goals.length >= LIMITS.goals) throw new RequestError(409, 'limit', { limit:'goals' });
      row.goals.push({ id, order:nextOrder(row.goals), title, steps:[], pct:0, status:'doing', lastActivityAt:now, createdAt:now, doneAt:null });
      return true;
    }
    case 'updateGoal': {
      const target = goal();
      if (!target) return false;
      const before = JSON.stringify(target);
      if (op.title !== undefined) target.title = requireText(op.title, LIMITS.goalTitle);
      if (op.pct !== undefined) {
        const pct = Number(op.pct);
        if (!Number.isFinite(pct)) throw new RequestError(400, 'invalid pct');
        target.pct = Math.max(0, Math.min(100, Math.round(pct)));
      }
      if (op.hold !== undefined) target.status = op.hold === true ? 'hold' : target.status === 'hold' ? 'doing' : target.status;
      settle(target, now);
      if (JSON.stringify(target) === before) return false;
      target.lastActivityAt = now;
      return true;
    }
    case 'removeGoal': {
      const id = requireId(op.id), before = row.goals.length;
      row.goals = row.goals.filter(item => item.id !== id);
      return row.goals.length !== before;
    }
    case 'addStep': {
      const target = goal(), id = requireId(op.stepId), title = requireText(op.title, LIMITS.stepTitle);
      if (!target || target.steps.some(step => step.id === id)) return false;
      if (target.steps.length >= LIMITS.steps) throw new RequestError(409, 'limit', { limit:'steps' });
      target.steps.push({ id, title, done:false });
      settle(target, now);
      target.lastActivityAt = now;
      return true;
    }
    case 'setStep': {
      const target = goal(), step = target?.steps.find(item => item.id === requireId(op.stepId));
      if (!step || step.done === (op.done === true)) return false;
      step.done = op.done === true;
      settle(target, now);
      target.lastActivityAt = now;
      return true;
    }
    case 'removeStep': {
      const target = goal(), id = requireId(op.stepId);
      if (!target || !target.steps.some(step => step.id === id)) return false;
      target.steps = target.steps.filter(step => step.id !== id);
      settle(target, now);
      target.lastActivityAt = now;
      return true;
    }
    case 'addHabit': {
      const id = requireId(op.id), name = requireText(op.name, LIMITS.habitName);
      if (row.habits.some(item => item.id === id)) return false;
      if (row.habits.length >= LIMITS.habits) throw new RequestError(409, 'limit', { limit:'habits' });
      row.habits.push({ id, order:nextOrder(row.habits), name, months:[null, null, null] });
      return true;
    }
    case 'renameHabit': {
      const habit = row.habits.find(item => item.id === requireId(op.id)), name = requireText(op.name, LIMITS.habitName);
      if (!habit || habit.name === name) return false;
      habit.name = name;
      return true;
    }
    case 'removeHabit': {
      const id = requireId(op.id), before = row.habits.length;
      row.habits = row.habits.filter(item => item.id !== id);
      return row.habits.length !== before;
    }
    default:
      throw new RequestError(400, 'unknown op');
  }
}

// ───────── Storage ─────────
const rowKey = (instance, mode, quarter) => `instance:${instance}:quarterGoals:v1:${mode}:${quarter}`;
async function readRows(env, keys) {
  const { results } = await env.DB.prepare(`SELECT key, value FROM widget_settings WHERE key IN (${keys.map(() => '?').join(',')})`)
    .bind(...keys).all();
  return new Map((results || []).map(row => [row.key, row.value]));
}
function parseStored(value) {
  if (value == null) return null;
  return normalizeRow(JSON.parse(value)); // corrupt rows stay errors, never silently empty
}
// Nearest earlier quarter (up to a year back) that has a row. Only for this or a later quarter.
async function carrySource(env, instance, mode, quarter, now) {
  if (quarterIndex(quarter) < quarterIndex(quarterOfDay(workdayKey(now)))) return null;
  const quarters = Array.from({ length:CARRY_LOOKBACK }, (_, i) => shiftQuarter(quarter, -(i + 1)));
  const rows = await readRows(env, quarters.map(q => rowKey(instance, mode, q)));
  for (const q of quarters) {
    const stored = parseStored(rows.get(rowKey(instance, mode, q)));
    if (stored) return stored;
  }
  return null;
}
// meta + row in one indexed lookup. Throws 404 for an unregistered instance.
async function loadCurrent(env, instance, mode, quarter) {
  const key = rowKey(instance, mode, quarter), meta = `instance-meta:${instance}`;
  const rows = await readRows(env, [meta, key]);
  if (!rows.has(meta)) throw new RequestError(404, 'unknown widget instance');
  return { key, raw:rows.get(key) ?? null };
}
async function compareAndSwap(env, key, previousRaw, next, now) {
  const value = JSON.stringify(next);
  const statement = previousRaw == null
    ? env.DB.prepare(`INSERT INTO widget_settings (key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`).bind(key, value, now)
    : env.DB.prepare(`UPDATE widget_settings SET value = ?, updatedAt = ? WHERE key = ? AND value = ?`).bind(value, now, key, previousRaw);
  const result = await statement.run();
  return Number(result?.meta?.changes ?? result?.changes) > 0;
}

async function readBody(request) {
  const raw = await request.text();
  if (raw.length > LIMITS.body) throw new RequestError(413, 'payload too large');
  try { return JSON.parse(raw); } catch { throw new RequestError(400, 'invalid json'); }
}
function readScope(source) {
  const mode = source?.mode, quarter = source?.quarter;
  if (!['work', 'life'].includes(mode) || !isQuarter(quarter)) throw new RequestError(400, 'invalid mode or quarter');
  return { mode, quarter };
}

export async function handleQuarterGoals(request, env, now = Date.now()) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(QUARTER_GOALS_PREFIX)) return null;
  const headers = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type', 'Access-Control-Max-Age':'86400',
    'Content-Type':'application/json', 'Cache-Control':'no-store' };
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status:204, headers });
  const route = url.pathname === STATE_PATH && request.method === 'GET' ? 'state'
    : url.pathname === PATCH_PATH && request.method === 'POST' ? 'patch' : null;
  if (!route) return json({ ok:false, error:'not found' }, 404);
  try {
    const instance = url.searchParams.get('w') || '';
    if (!instancePattern.test(instance)) throw new RequestError(400, 'invalid widget instance');
    if (route === 'state') {
      const { mode, quarter } = readScope({ mode:url.searchParams.get('mode'), quarter:url.searchParams.get('quarter') });
      const { raw } = await loadCurrent(env, instance, mode, quarter);
      if (raw != null) return json({ ok:true, data:publicState(mode, quarter, parseStored(raw), true) });
      const source = await carrySource(env, instance, mode, quarter, now);
      return json({ ok:true, data:publicState(mode, quarter, { goals:[], habits:source ? carriedHabits(source) : [] }, false) });
    }
    const body = await readBody(request);
    const { mode, quarter } = readScope(body);
    const ops = body?.ops;
    if (!Array.isArray(ops) || !ops.length || ops.length > LIMITS.ops) throw new RequestError(400, 'invalid ops');
    const access = quarterAccess(quarter, now);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const stamp = new Date(now).toISOString();
      const { key, raw } = await loadCurrent(env, instance, mode, quarter);
      let row;
      if (raw != null) row = parseStored(raw);
      else {
        // First save in this quarter: start from the carried habit names, then apply the ops.
        const source = await carrySource(env, instance, mode, quarter, now);
        row = { v:1, createdAt:stamp, updatedAt:null, goals:[], habits:source ? carriedHabits(source) : [] };
      }
      let changed = false;
      for (const op of ops) changed = applyOp(row, op, access, stamp) || changed;
      if (!changed) return json({ ok:true, data:publicState(mode, quarter, row, raw != null) });
      row.updatedAt = stamp;
      if (await compareAndSwap(env, key, raw, row, stamp)) return json({ ok:true, data:publicState(mode, quarter, row, true) });
    }
    throw new RequestError(409, 'busy, try again');
  } catch (error) {
    if (error instanceof RequestError) return json({ ok:false, error:error.message, ...error.extra }, error.status);
    // Preserve quota classification without returning SQL, bindings or records.
    const daily = /exceeded D1's free tier daily row (?:read|write) limit/i.test(String(error?.message));
    return json({ ok:false, error:daily ? "D1_ERROR: Your account has exceeded D1's free tier daily row read limit" : 'quarter goals service unavailable' }, 503);
  }
}
