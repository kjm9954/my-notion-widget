// Private, instance-scoped diary API for the two diary-v1 widgets.
// Structured records live in D1; original image bytes are split across rows so
// no image or entry approaches D1's 2 MB row limit.
export const DIARY_V1_PREFIX = "/api/diary-v1/";
export const DIARY_V1_LIMITS = Object.freeze({
  text: 2000,
  photos: 4,
  photoBytes: 5_000_000,
  bodyChars: 28_000_000,
  chunkChars: 700_000,
  rangeDays: 62,
});

const INSTANCE_RE = /^w_[A-Za-z0-9_-]{24,176}$/;
const IMAGE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MOODS = new Set(["calm", "good", "tired"]);
const JSON_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
});

class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function withDiaryV1(existingWorker) {
  return {
    ...existingWorker,
    async fetch(request, env, context) {
      const response = await handleDiaryV1(request, env);
      return response || existingWorker.fetch(request, env, context);
    },
  };
}

export async function handleDiaryV1(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(DIARY_V1_PREFIX)) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });

  try {
    const instanceId = url.searchParams.get("w") || "";
    if (!INSTANCE_RE.test(instanceId)) throw new ApiError(400, "invalid widget instance");
    const registered = await env.DB.prepare("SELECT key FROM widget_settings WHERE key = ?")
      .bind(`instance-meta:${instanceId}`).first();
    if (!registered) throw new ApiError(404, "unknown widget instance");

    if (url.pathname === `${DIARY_V1_PREFIX}entry` && request.method === "GET") {
      return json({ ok: true, data: await loadEntry(env, request.url, instanceId, validDate(url.searchParams.get("date"))) });
    }
    if (url.pathname === `${DIARY_V1_PREFIX}range` && request.method === "GET") {
      const start = validDate(url.searchParams.get("start"));
      const end = validDate(url.searchParams.get("end"));
      if (start > end || daysBetween(start, end) > DIARY_V1_LIMITS.rangeDays) throw new ApiError(400, "invalid date range");
      return json({ ok: true, data: await loadRange(env, request.url, instanceId, start, end) });
    }
    if (url.pathname === `${DIARY_V1_PREFIX}export` && request.method === "GET") {
      return json({ ok: true, data: await loadExport(env, request.url, instanceId) });
    }
    if (url.pathname === `${DIARY_V1_PREFIX}photo` && request.method === "GET") {
      return loadPhoto(env, instanceId, validDate(url.searchParams.get("date")), validImageId(url.searchParams.get("id")));
    }
    if (url.pathname === `${DIARY_V1_PREFIX}save` && request.method === "POST") {
      const body = await readJson(request);
      return json({ ok: true, data: await saveEntry(env, request.url, instanceId, body) });
    }
    if (url.pathname === `${DIARY_V1_PREFIX}delete` && request.method === "POST") {
      const body = await readJson(request);
      await deleteEntry(env, instanceId, body);
      return json({ ok: true, data: null });
    }
    throw new ApiError(404, "not found");
  } catch (error) {
    if (error instanceof ApiError) return json({ ok: false, error: error.message, ...error.extra }, error.status);
    const message = String(error?.message || error);
    const daily = /exceeded D1's free tier daily row (?:read|write) limit/i.test(message);
    return json({
      ok: false,
      error: daily ? "D1_ERROR: Your account has exceeded D1's free tier daily row read limit" : "diary service unavailable",
    }, 503);
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

async function readJson(request) {
  const declared = Number(request.headers.get("Content-Length")) || 0;
  if (declared > DIARY_V1_LIMITS.bodyChars) throw new ApiError(413, "upload is too large");
  const raw = await request.text();
  if (raw.length > DIARY_V1_LIMITS.bodyChars) throw new ApiError(413, "upload is too large");
  try { return JSON.parse(raw); }
  catch { throw new ApiError(400, "invalid json"); }
}

function validDate(value) {
  const text = String(value || "");
  const match = DATE_RE.exec(text);
  if (!match) throw new ApiError(400, "invalid date");
  const stamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(stamp);
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
    throw new ApiError(400, "invalid date");
  }
  return text;
}

function validImageId(value) {
  const text = String(value || "");
  if (!IMAGE_ID_RE.test(text)) throw new ApiError(400, "invalid photo id");
  return text;
}

function daysBetween(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

function normalizeText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").slice(0, DIARY_V1_LIMITS.text);
}

function normalizeMood(value) {
  if (value === null || value === undefined || value === "") return null;
  if (!MOODS.has(value)) throw new ApiError(400, "invalid mood");
  return value;
}

function normalizeRevision(value, allowNull = true) {
  if (allowNull && (value === null || value === undefined)) return null;
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new ApiError(400, "invalid revision");
  return revision;
}

function dataUrlInfo(dataUrl) {
  const match = /^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(String(dataUrl || ""));
  if (!match) throw new ApiError(400, "invalid photo");
  const base64 = match[2];
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
  if (!bytes || bytes > DIARY_V1_LIMITS.photoBytes) {
    throw new ApiError(413, "photo is too large", { limit: DIARY_V1_LIMITS.photoBytes });
  }
  return { type: match[1].toLowerCase(), base64, bytes };
}

function chunksOf(value) {
  const chunks = [];
  for (let index = 0; index < value.length; index += DIARY_V1_LIMITS.chunkChars) {
    chunks.push(value.slice(index, index + DIARY_V1_LIMITS.chunkChars));
  }
  return chunks;
}

async function photoRows(env, instanceId, date) {
  const { results } = await env.DB.prepare(
    `SELECT image_id, position, type, size, MAX(updated_at) AS updated_at
       FROM diary_v1_images
      WHERE instance_id = ? AND date_key = ?
      GROUP BY image_id, position, type, size
      ORDER BY position ASC, image_id ASC`
  ).bind(instanceId, date).all();
  return results || [];
}

function photoUrl(requestUrl, instanceId, date, row) {
  const url = new URL(`${DIARY_V1_PREFIX}photo`, requestUrl);
  url.searchParams.set("w", instanceId);
  url.searchParams.set("date", date);
  url.searchParams.set("id", row.image_id);
  url.searchParams.set("v", String(row.updated_at || ""));
  return url.toString();
}

function publicEntry(row, photos, requestUrl, instanceId) {
  if (!row) return null;
  return {
    date: row.date_key,
    text: row.body || "",
    mood: row.mood || null,
    revision: Number(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    photos: photos.map(photo => ({
      id: photo.image_id,
      type: photo.type,
      size: Number(photo.size),
      position: Number(photo.position),
      url: photoUrl(requestUrl, instanceId, row.date_key, photo),
    })),
  };
}

async function loadEntry(env, requestUrl, instanceId, date) {
  const row = await env.DB.prepare(
    "SELECT * FROM diary_v1_entries WHERE instance_id = ? AND date_key = ?"
  ).bind(instanceId, date).first();
  if (!row) return null;
  return publicEntry(row, await photoRows(env, instanceId, date), requestUrl, instanceId);
}

async function loadRange(env, requestUrl, instanceId, start, end) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM diary_v1_entries
      WHERE instance_id = ? AND date_key >= ? AND date_key <= ?
      ORDER BY date_key ASC`
  ).bind(instanceId, start, end).all();
  const { results: covers } = await env.DB.prepare(
    `SELECT date_key, image_id, position, type, size, updated_at
       FROM diary_v1_images
      WHERE instance_id = ? AND date_key >= ? AND date_key <= ? AND part = 0
      ORDER BY date_key ASC, position ASC`
  ).bind(instanceId, start, end).all();
  const firstByDate = new Map();
  for (const row of covers || []) if (!firstByDate.has(row.date_key)) firstByDate.set(row.date_key, row);
  return (results || []).map(row => {
    const cover = firstByDate.get(row.date_key);
    return {
      date: row.date_key,
      text: row.body || "",
      mood: row.mood || null,
      photoCount: Number(row.photo_count) || 0,
      coverUrl: cover ? photoUrl(requestUrl, instanceId, row.date_key, cover) : null,
      revision: Number(row.revision),
      updatedAt: row.updated_at,
    };
  });
}

async function loadExport(env, requestUrl, instanceId) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM diary_v1_entries WHERE instance_id = ? ORDER BY date_key ASC"
  ).bind(instanceId).all();
  const entries = [];
  for (const row of results || []) {
    entries.push(publicEntry(row, await photoRows(env, instanceId, row.date_key), requestUrl, instanceId));
  }
  return { exportedAt: new Date().toISOString(), entries };
}

function normalizePhotos(value, existingIds) {
  if (!Array.isArray(value) || value.length > DIARY_V1_LIMITS.photos) throw new ApiError(400, "invalid photos");
  const ids = new Set();
  return value.map((raw, position) => {
    const id = validImageId(raw?.id);
    if (ids.has(id)) throw new ApiError(400, "duplicate photo id");
    ids.add(id);
    if (Object.hasOwn(raw || {}, "dataUrl")) return { id, position, upload: dataUrlInfo(raw.dataUrl) };
    if (!existingIds.has(id)) throw new ApiError(400, "unknown photo id");
    return { id, position, upload: null };
  });
}

async function saveEntry(env, requestUrl, instanceId, raw) {
  const date = validDate(raw?.date);
  const text = normalizeText(raw?.text);
  const mood = normalizeMood(raw?.mood);
  const expectedRevision = normalizeRevision(raw?.expectedRevision);
  const current = await env.DB.prepare(
    "SELECT * FROM diary_v1_entries WHERE instance_id = ? AND date_key = ?"
  ).bind(instanceId, date).first();
  const currentRevision = current ? Number(current.revision) : null;
  if (currentRevision !== expectedRevision) {
    throw new ApiError(409, "record changed on another device", {
      current: current ? publicEntry(current, await photoRows(env, instanceId, date), requestUrl, instanceId) : null,
    });
  }

  const existingPhotos = await photoRows(env, instanceId, date);
  const existingIds = new Set(existingPhotos.map(row => row.image_id));
  const photos = normalizePhotos(raw?.photos || [], existingIds);
  if (!text.trim() && !mood && !photos.length) throw new ApiError(400, "empty diary");

  const now = new Date().toISOString();
  const nextRevision = (currentRevision || 0) + 1;
  const writeToken = crypto.randomUUID();
  const statements = [];
  if (current) {
    statements.push(env.DB.prepare(
      `UPDATE diary_v1_entries
          SET mood = ?, body = ?, photo_count = ?, revision = ?, write_token = ?, updated_at = ?
        WHERE instance_id = ? AND date_key = ? AND revision = ?`
    ).bind(mood, text, photos.length, nextRevision, writeToken, now, instanceId, date, currentRevision));
  } else {
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO diary_v1_entries
       (instance_id, date_key, mood, body, photo_count, revision, write_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(instanceId, date, mood, text, photos.length, nextRevision, writeToken, now, now));
  }

  const nextIds = new Set(photos.map(photo => photo.id));
  for (const existing of existingPhotos) {
    if (nextIds.has(existing.image_id)) continue;
    statements.push(env.DB.prepare(
      `DELETE FROM diary_v1_images
        WHERE instance_id = ? AND date_key = ? AND image_id = ?
          AND EXISTS (SELECT 1 FROM diary_v1_entries WHERE instance_id = ? AND date_key = ? AND write_token = ?)`
    ).bind(instanceId, date, existing.image_id, instanceId, date, writeToken));
  }

  for (const photo of photos) {
    if (!photo.upload) {
      statements.push(env.DB.prepare(
        `UPDATE diary_v1_images SET position = ?
          WHERE instance_id = ? AND date_key = ? AND image_id = ?
            AND EXISTS (SELECT 1 FROM diary_v1_entries WHERE instance_id = ? AND date_key = ? AND write_token = ?)`
      ).bind(photo.position, instanceId, date, photo.id, instanceId, date, writeToken));
      continue;
    }
    statements.push(env.DB.prepare(
      `DELETE FROM diary_v1_images
        WHERE instance_id = ? AND date_key = ? AND image_id = ?
          AND EXISTS (SELECT 1 FROM diary_v1_entries WHERE instance_id = ? AND date_key = ? AND write_token = ?)`
    ).bind(instanceId, date, photo.id, instanceId, date, writeToken));
    const chunks = chunksOf(photo.upload.base64);
    chunks.forEach((chunk, part) => {
      statements.push(env.DB.prepare(
        `INSERT INTO diary_v1_images
         (instance_id, date_key, image_id, position, part, parts, type, size, data, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM diary_v1_entries WHERE instance_id = ? AND date_key = ? AND write_token = ?)`
      ).bind(instanceId, date, photo.id, photo.position, part, chunks.length, photo.upload.type,
        photo.upload.bytes, chunk, now, now, instanceId, date, writeToken));
    });
  }

  await env.DB.batch(statements);
  const saved = await env.DB.prepare(
    "SELECT * FROM diary_v1_entries WHERE instance_id = ? AND date_key = ?"
  ).bind(instanceId, date).first();
  if (!saved || saved.write_token !== writeToken) {
    throw new ApiError(409, "record changed on another device", {
      current: saved ? publicEntry(saved, await photoRows(env, instanceId, date), requestUrl, instanceId) : null,
    });
  }
  return publicEntry(saved, await photoRows(env, instanceId, date), requestUrl, instanceId);
}

async function deleteEntry(env, instanceId, raw) {
  const date = validDate(raw?.date);
  const expectedRevision = normalizeRevision(raw?.expectedRevision, false);
  const current = await env.DB.prepare(
    "SELECT revision FROM diary_v1_entries WHERE instance_id = ? AND date_key = ?"
  ).bind(instanceId, date).first();
  if (!current) return;
  if (Number(current.revision) !== expectedRevision) throw new ApiError(409, "record changed on another device");
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM diary_v1_images
        WHERE instance_id = ? AND date_key = ?
          AND EXISTS (SELECT 1 FROM diary_v1_entries WHERE instance_id = ? AND date_key = ? AND revision = ?)`
    ).bind(instanceId, date, instanceId, date, expectedRevision),
    env.DB.prepare(
      "DELETE FROM diary_v1_entries WHERE instance_id = ? AND date_key = ? AND revision = ?"
    ).bind(instanceId, date, expectedRevision),
  ]);
  const remaining = await env.DB.prepare(
    "SELECT revision FROM diary_v1_entries WHERE instance_id = ? AND date_key = ?"
  ).bind(instanceId, date).first();
  if (remaining) throw new ApiError(409, "record changed on another device");
}

async function loadPhoto(env, instanceId, date, imageId) {
  const { results } = await env.DB.prepare(
    `SELECT part, parts, type, size, data, updated_at
       FROM diary_v1_images
      WHERE instance_id = ? AND date_key = ? AND image_id = ?
      ORDER BY part ASC`
  ).bind(instanceId, date, imageId).all();
  const rows = results || [];
  if (!rows.length || rows.length !== Number(rows[0].parts)) throw new ApiError(404, "photo not found");
  const base64 = rows.map(row => row.data).join("");
  let binary;
  try {
    const decoded = atob(base64);
    binary = Uint8Array.from(decoded, character => character.charCodeAt(0));
  } catch {
    throw new ApiError(500, "photo is damaged");
  }
  return new Response(binary, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": rows[0].type,
      "Content-Length": String(binary.byteLength),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
