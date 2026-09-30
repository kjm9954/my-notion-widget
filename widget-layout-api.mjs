// Additive endpoint: independent of task, goal and note state. No migrations.
export const LAYOUT_PATH = '/api/widget-layout';
export const LAYOUT_WIDGETS = Object.freeze(['worklog', 'notes', 'weekly-goals', 'deadlines', 'week-review', 'month-calendar']);
export function withWidgetLayouts(existingWorker) {
  return {...existingWorker, async fetch(request, env, context) {
    const response = await handleWidgetLayout(request, env);
    return response || existingWorker.fetch(request, env, context);
  }};
}
const instancePattern = /^w_[A-Za-z0-9_-]{24,176}$/;
const numeric = { scale:[.08, 4], contentW:[40, 10000], frameH:[40, 10000], listH:[40, 10000] };
const locks = ['scaleLocked', 'widthLocked', 'heightLocked', 'listLocked'];
async function readSmallBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('missing body');
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2048) { await reader.cancel(); throw new Error('size payload too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function normalizeLayoutSize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid size');
  const result = {};
  for (const name of Object.keys(raw)) {
    if (numeric[name]) {
      const value = raw[name], [min, max] = numeric[name];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('invalid size');
      result[name] = name === 'scale' ? Math.round(value * 10000) / 10000 : Math.round(value);
    } else if (locks.includes(name) && typeof raw[name] === 'boolean') result[name] = raw[name];
    else throw new Error('invalid size field');
  }
  if (!['scale', 'contentW', 'frameH'].every(name => name in result)) throw new Error('missing size');
  return result;
}

export async function handleWidgetLayout(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== LAYOUT_PATH) return null;
  const headers = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type', 'Access-Control-Max-Age':'86400',
    'Content-Type':'application/json', 'Cache-Control':'no-store' };
  const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers});
  if (request.method === 'OPTIONS') return new Response(null, {status:204, headers});
  if (!['GET','POST'].includes(request.method)) return json({ok:false,error:'method not allowed'},405);
  const instance = url.searchParams.get('w') || '';
  if (!instancePattern.test(instance)) return json({ok:false,error:'invalid widget instance'},400);
  let body, size;
  if (request.method === 'POST') {
    try {
      body = await readSmallBody(request);
      if (!LAYOUT_WIDGETS.includes(body?.widget) || Object.keys(body).some(k => !['widget','size'].includes(k))) throw new Error('invalid widget');
      size = normalizeLayoutSize(body.size);
    } catch { return json({ok:false,error:'invalid widget size'},400); }
  }
  try {
    // Indexed lookup only. Do not invoke the worklog GET (which auto-rolls dates).
    const registered = await env.DB.prepare('SELECT key FROM widget_settings WHERE key = ?')
      .bind(`instance-meta:${instance}`).first();
    if (!registered) return json({ok:false,error:'unknown widget instance'},404);
    const settingKey = widget => `instance:${instance}:widgetLayout:v1:${widget}`;
    if (request.method === 'GET') {
      const keys = LAYOUT_WIDGETS.map(settingKey);
      const {results} = await env.DB.prepare(`SELECT key, value FROM widget_settings WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all();
      const layouts = {};
      for (const row of results) {
        const widget = LAYOUT_WIDGETS.find(name => settingKey(name) === row.key);
        if (!widget) throw new Error('unexpected layout record');
        const stored = JSON.parse(row.value);
        layouts[widget] = {size:normalizeLayoutSize(stored.size), updatedAt:stored.updatedAt};
      }
      return json({ok:true,data:{layouts}});
    }
    const updatedAt = new Date().toISOString();
    const entry = {size, updatedAt};
    await env.DB.prepare(`INSERT INTO widget_settings (key, value, updatedAt) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`)
      .bind(settingKey(body.widget), JSON.stringify(entry), updatedAt).run();
    return json({ok:true,data:{widget:body.widget, ...entry}});
  } catch (error) {
    // Preserve quota classification without returning SQL, bindings or records.
    const daily = /exceeded D1's free tier daily row (?:read|write) limit/i.test(String(error?.message));
    return json({ok:false,error:daily ? "D1_ERROR: Your account has exceeded D1's free tier daily row read limit" : 'widget size service unavailable'},503);
  }
}
