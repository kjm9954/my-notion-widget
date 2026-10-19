// Additive endpoint for the feedback widgets (핵심 모아보기 · 피드백 검색 · 면담 기록).
// Independent of worklog, weekly goals, notes and quarter goals. No migrations, no KV.
// Existing widget_settings rows only:
//   instance:<w>:meetingNotes:v1:rev         {"rev":n}  bumped on every change (cheap change check)
//   instance:<w>:meetingNotes:v1:note:<id>   one meeting per row (JSON), with its own "rev"
// Reads: /revision touches 2 rows; /all is one indexed key-range scan (rows = number of meetings).
export const MEETING_NOTES_PREFIX = '/api/meeting-notes/';
const PATHS = Object.freeze({ revision:'/api/meeting-notes/revision', all:'/api/meeting-notes/all', save:'/api/meeting-notes/save', remove:'/api/meeting-notes/delete' });
export const LIMITS = Object.freeze({ notes:2000, topics:30, lines:100, todos:50, title:120, who:40, h:80, say:300, line:500, todo:200, body:131072 });
const instancePattern = /^w_[A-Za-z0-9_-]{24,176}$/;
const idPattern = /^[A-Za-z0-9_-]{1,64}$/;

export function withMeetingNotes(existingWorker) {
  return {...existingWorker, async fetch(request, env, context) {
    const response = await handleMeetingNotes(request, env);
    return response || existingWorker.fetch(request, env, context);
  }};
}

class RequestError extends Error {
  constructor(status, error, extra = {}) { super(error); this.status = status; this.extra = extra; }
}

// ───────── Normalization (stored JSON and request bodies are never trusted) ─────────
const text = (value, max) => String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\t\n]+/g, ' ').slice(0, max);
const iso = value => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null);
export function isDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return date.getUTCFullYear() === +match[1] && date.getUTCMonth() + 1 === +match[2] && date.getUTCDate() === +match[3];
}
function list(value, max, map) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map(map).filter(item => item && !seen.has(item.id) && seen.add(item.id)).slice(0, max);
}
const validId = value => (idPattern.test(String(value ?? '')) ? String(value) : null);
export function normalizeNote(raw) {
  const id = validId(raw?.id);
  if (!id) throw new RequestError(400, 'invalid id');
  if (!isDateKey(raw?.date)) throw new RequestError(400, 'invalid date');
  const topics = list(raw.topics, LIMITS.topics, topic => {
    const topicId = validId(topic?.id);
    if (!topicId) return null;
    const lines = list(topic.lines, LIMITS.lines, line => {
      const lineId = validId(line?.id);
      return lineId ? { id:lineId, t:text(line.t, LIMITS.line), key:line.key === true } : null;
    });
    return { id:topicId, h:text(topic.h, LIMITS.h), say:text(topic.say, LIMITS.say), lines };
  });
  const todos = list(raw.todos, LIMITS.todos, todo => {
    const todoId = validId(todo?.id);
    return todoId ? { id:todoId, t:text(todo.t, LIMITS.todo), done:todo.done === true } : null;
  });
  return { id, date:raw.date, title:text(raw.title, LIMITS.title), who:text(raw.who, LIMITS.who), topics, todos };
}
function readStored(value) {
  const note = JSON.parse(value); // corrupt rows stay errors, never silently empty
  return { ...normalizeNote(note), rev:Number.isInteger(note.rev) ? note.rev : 1, createdAt:iso(note.createdAt), updatedAt:iso(note.updatedAt) };
}

// ───────── Storage ─────────
const keysFor = instance => {
  const base = `instance:${instance}:meetingNotes:v1:`;
  return { meta:`instance-meta:${instance}`, rev:`${base}rev`, notePrefix:`${base}note:`, noteEnd:`${base}note;`, note:id => `${base}note:${id}` };
};
async function readKeys(env, keys) {
  const { results } = await env.DB.prepare(`SELECT key, value FROM widget_settings WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all();
  return new Map((results || []).map(row => [row.key, row.value]));
}
const revisionOf = raw => { try { return Number(JSON.parse(raw)?.rev) || 0; } catch { return 0; } };
function revBump(env, k, now) {
  return env.DB.prepare(`INSERT INTO widget_settings (key, value, updatedAt) VALUES (?, '{"rev":1}', ?)
    ON CONFLICT(key) DO UPDATE SET value = json_set(widget_settings.value, '$.rev', COALESCE(json_extract(widget_settings.value, '$.rev'), 0) + 1),
    updatedAt = excluded.updatedAt RETURNING value`).bind(k.rev, now);
}
const changed = result => Number(result?.meta?.changes ?? result?.changes) > 0;

async function readBody(request) {
  const raw = await request.text();
  if (raw.length > LIMITS.body) throw new RequestError(413, 'payload too large');
  try { return JSON.parse(raw); } catch { throw new RequestError(400, 'invalid json'); }
}

export async function handleMeetingNotes(request, env, now = Date.now()) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(MEETING_NOTES_PREFIX)) return null;
  const headers = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type', 'Access-Control-Max-Age':'86400',
    'Content-Type':'application/json', 'Cache-Control':'no-store' };
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status:204, headers });
  const route = Object.entries(PATHS).find(([, path]) => path === url.pathname)?.[0];
  const method = route === 'save' || route === 'remove' ? 'POST' : 'GET';
  if (!route || request.method !== method) return json({ ok:false, error:'not found' }, 404);
  try {
    const instance = url.searchParams.get('w') || '';
    if (!instancePattern.test(instance)) throw new RequestError(400, 'invalid widget instance');
    const k = keysFor(instance);
    const stamp = new Date(now).toISOString();

    if (route === 'revision') {
      const rows = await readKeys(env, [k.meta, k.rev]);
      if (!rows.has(k.meta)) throw new RequestError(404, 'unknown widget instance');
      return json({ ok:true, data:{ revision:revisionOf(rows.get(k.rev)) } });
    }
    if (route === 'all') {
      // One transaction: the revision and the notes are read together.
      const [head, body] = await env.DB.batch([
        env.DB.prepare(`SELECT key, value FROM widget_settings WHERE key IN (?, ?)`).bind(k.meta, k.rev),
        env.DB.prepare(`SELECT value FROM widget_settings WHERE key >= ? AND key < ?`).bind(k.notePrefix, k.noteEnd)
      ]);
      const rows = new Map((head.results || []).map(row => [row.key, row.value]));
      if (!rows.has(k.meta)) throw new RequestError(404, 'unknown widget instance');
      const notes = (body.results || []).map(row => readStored(row.value)).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
      return json({ ok:true, data:{ revision:revisionOf(rows.get(k.rev)), notes } });
    }

    const payload = await readBody(request);
    const baseRev = Number(payload?.baseRev);
    if (!Number.isInteger(baseRev) || baseRev < 0) throw new RequestError(400, 'invalid baseRev');
    const id = route === 'save' ? normalizeNote(payload?.note).id : validId(payload?.id);
    if (!id) throw new RequestError(400, 'invalid id');
    const rows = await readKeys(env, [k.meta, k.note(id)]);
    if (!rows.has(k.meta)) throw new RequestError(404, 'unknown widget instance');
    const current = rows.has(k.note(id)) ? readStored(rows.get(k.note(id))) : null;
    const conflict = () => new RequestError(409, 'conflict', { note:current });
    if ((current?.rev || 0) !== baseRev) throw conflict();

    if (route === 'remove') {
      if (!current) return json({ ok:true, data:{ id, removed:false } });
      const [removed, rev] = await env.DB.batch([
        env.DB.prepare(`DELETE FROM widget_settings WHERE key = ? AND json_extract(value, '$.rev') = ?`).bind(k.note(id), baseRev),
        revBump(env, k, stamp)
      ]);
      if (!changed(removed)) throw conflict();
      return json({ ok:true, data:{ id, removed:true, revision:revisionOf(rev.results?.[0]?.value) } });
    }

    if (!current) {
      const { results } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM widget_settings WHERE key >= ? AND key < ?`).bind(k.notePrefix, k.noteEnd).all();
      if (Number(results?.[0]?.n) >= LIMITS.notes) throw new RequestError(409, 'limit', { limit:'notes' });
    }
    const next = { ...normalizeNote(payload.note), rev:baseRev + 1, createdAt:current?.createdAt || stamp, updatedAt:stamp };
    const write = current
      ? env.DB.prepare(`UPDATE widget_settings SET value = ?, updatedAt = ? WHERE key = ? AND json_extract(value, '$.rev') = ?`).bind(JSON.stringify(next), stamp, k.note(id), baseRev)
      : env.DB.prepare(`INSERT INTO widget_settings (key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`).bind(k.note(id), JSON.stringify(next), stamp);
    const [saved, rev] = await env.DB.batch([write, revBump(env, k, stamp)]);
    if (!changed(saved)) throw conflict(); // another device saved first; the extra revision bump is harmless
    return json({ ok:true, data:{ revision:revisionOf(rev.results?.[0]?.value), note:next } });
  } catch (error) {
    if (error instanceof RequestError) return json({ ok:false, error:error.message, ...error.extra }, error.status);
    // Preserve quota classification without returning SQL, bindings or records.
    const daily = /exceeded D1's free tier daily row (?:read|write) limit/i.test(String(error?.message));
    return json({ ok:false, error:daily ? "D1_ERROR: Your account has exceeded D1's free tier daily row read limit" : 'meeting notes service unavailable' }, 503);
  }
}
