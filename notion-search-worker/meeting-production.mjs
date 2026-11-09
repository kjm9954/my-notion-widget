var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// desktop-api.mjs
var API = "https://api.notion.com/v1";
var UUID = /^[0-9a-f]{32}$/i;
var MAX_REQUESTS = 40;
var MAX_DEPTH = 12;
var DATE_PROPERTY = "\uB0A0\uC9DC";
var TITLE_PROPERTY = "\uC774\uB984";
var ApiError = class extends Error {
  static {
    __name(this, "ApiError");
  }
  constructor(status, code, upstreamStatus = null) {
    super(code);
    this.status = status;
    this.code = code;
    this.upstreamStatus = upstreamStatus;
  }
};
var fail = /* @__PURE__ */ __name((status, code) => {
  throw new ApiError(status, code);
}, "fail");
var compactId = /* @__PURE__ */ __name((value) => String(value || "").replaceAll("-", "").toLowerCase(), "compactId");
var sameId = /* @__PURE__ */ __name((left, right) => compactId(left) === compactId(right), "sameId");
function keyMatches(given, expected) {
  if (!expected || given.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}
__name(keyMatches, "keyMatches");
function parsePageLink(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(400, "invalid_page_url");
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || !(host === "app.notion.com" || host === "notion.so" || host.endsWith(".notion.so") || host === "notion.site" || host.endsWith(".notion.site"))) fail(400, "invalid_page_url");
  const last = url.pathname.replace(/\/$/, "").split("/").at(-1);
  const match = last.match(/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (!match) fail(400, "invalid_page_url");
  const id = compactId(match[1]);
  url.search = "";
  url.hash = "";
  return { id, pageUrl: url.href };
}
__name(parsePageLink, "parsePageLink");
function embedKey(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "kjm9954.github.io" || url.port || url.username || url.password || !url.pathname.startsWith("/my-notion-widget/")) return null;
  const keys = url.searchParams.getAll("w");
  if (keys.length !== 1 || !/^w_[a-zA-Z0-9_-]{1,200}$/.test(keys[0])) return null;
  return keys[0];
}
__name(embedKey, "embedKey");
function notionReader(env, version, transport) {
  if (!env.NOTION_TOKEN) fail(503, "notion_not_configured");
  let requests = 0;
  let lastRequest = 0;
  return async (path, body) => {
    if (++requests > MAX_REQUESTS) fail(503, "notion_request_limit");
    const delay = Math.max(0, 350 - (Date.now() - lastRequest));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    lastRequest = Date.now();
    let response;
    try {
      response = await transport(`${API}${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, "Notion-Version": version, "Content-Type": "application/json" },
        ...body ? { body: JSON.stringify(body) } : {},
        // Workerd supports manual mode; any 3xx is rejected below without forwarding credentials.
        redirect: "manual",
        signal: AbortSignal.timeout(15e3)
      });
    } catch {
      fail(502, "notion_unavailable");
    }
    if (!response.ok) {
      throw new ApiError(
        response.status === 429 ? 429 : 502,
        response.status === 429 ? "notion_rate_limited" : "notion_unavailable",
        response.status
      );
    }
    try {
      return await response.json();
    } catch {
      fail(502, "invalid_notion_response");
    }
  };
}
__name(notionReader, "notionReader");
async function listAll(read, path, body) {
  const results = [];
  const cursors = /* @__PURE__ */ new Set();
  let cursor;
  do {
    const suffix = new URLSearchParams({ page_size: "100", ...cursor ? { start_cursor: cursor } : {} });
    const response = body ? await read(path, { ...body, page_size: 100, ...cursor ? { start_cursor: cursor } : {} }) : await read(`${path}?${suffix}`);
    if (!Array.isArray(response.results)) fail(502, "invalid_notion_response");
    results.push(...response.results);
    if (!response.has_more) break;
    if (!response.next_cursor || cursors.has(response.next_cursor)) fail(502, "invalid_notion_pagination");
    cursor = response.next_cursor;
    cursors.add(cursor);
  } while (true);
  return results;
}
__name(listAll, "listAll");
async function resolvePage(url, env, read) {
  const { id, pageUrl } = parsePageLink(url.searchParams.get("page"));
  if (!env.ALLOWED_W) fail(503, "access_not_configured");
  const keys = /* @__PURE__ */ new Set();
  const databases = /* @__PURE__ */ new Set();
  const queue = [{ id, depth: 0 }];
  const visited = /* @__PURE__ */ new Set();
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    if (node.depth > MAX_DEPTH) fail(503, "page_too_complex");
    let blocks;
    try {
      blocks = await listAll(read, `/blocks/${encodeURIComponent(node.id)}/children`);
    } catch (error) {
      if ([401, 403, 404].includes(error.upstreamStatus)) fail(404, "page_not_found");
      throw error;
    }
    for (const block of blocks) {
      if (block.archived || block.in_trash) continue;
      if (block.type === "embed") {
        const key = embedKey(block.embed?.url);
        if (key !== null) keys.add(key);
      }
      if (block.type === "child_database") databases.add(block.id);
      else if (block.has_children && !["child_page", "link_to_page"].includes(block.type)) {
        const childId = block.type === "synced_block" ? block.synced_block?.synced_from?.block_id || block.id : block.id;
        queue.push({ id: childId, depth: node.depth + 1 });
      }
    }
  }
  if (!keys.size) fail(404, "widget_not_found");
  if ([...keys].some((key) => !keyMatches(key, String(env.ALLOWED_W)))) fail(403, "forbidden");
  const sources = /* @__PURE__ */ new Set();
  for (const databaseId of databases) {
    const database = await read(`/databases/${encodeURIComponent(databaseId)}`);
    if (!database.is_inline) continue;
    if (!Array.isArray(database.data_sources)) fail(502, "invalid_notion_response");
    for (const source of database.data_sources) {
      const schema = await read(`/data_sources/${encodeURIComponent(source.id)}`);
      if (schema.properties?.[DATE_PROPERTY]?.type === "date" && schema.properties?.[TITLE_PROPERTY]?.type === "title") sources.add(source.id);
    }
  }
  let meetingDb = null;
  if (sources.size) {
    meetingDb = [...sources].find((source) => sameId(source, env.NOTION_DATA_SOURCE_ID));
    if (!meetingDb) fail(409, "meeting_source_mismatch");
  }
  return { w: [...keys][0], meetingDb, pageUrl };
}
__name(resolvePage, "resolvePage");
function instant(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) return null;
  const [, y, m, d, h, min, sec = "0", , zone] = match;
  const days = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  if (+m < 1 || +m > 12 || +d < 1 || +d > days || +h > 23 || +min > 59 || +sec > 59 || zone !== "Z" && (+zone.slice(1, 3) > 23 || +zone.slice(4) > 59)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}
__name(instant, "instant");
function notionInstant(value, timeZone) {
  const direct = instant(value);
  if (direct !== null) return direct;
  if (!timeZone || typeof value !== "string" || instant(`${value}Z`) === null) return null;
  const wall = instant(`${value}Z`);
  let format;
  try {
    format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  } catch {
    return null;
  }
  const wallAt = /* @__PURE__ */ __name((epoch) => {
    const parts = Object.fromEntries(format.formatToParts(epoch).map((part) => [part.type, part.value]));
    return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`) + (epoch % 1e3 + 1e3) % 1e3;
  }, "wallAt");
  const candidates = [-864e5, 0, 864e5].map((delta) => {
    const sample = wall + delta;
    return wall - (wallAt(sample) - sample);
  }).filter((candidate) => wallAt(candidate) === wall);
  return candidates.length ? Math.min(...candidates) : null;
}
__name(notionInstant, "notionInstant");
async function meetings(url, env, read) {
  const source = compactId(env.NOTION_DATA_SOURCE_ID);
  if (!UUID.test(source)) fail(503, "meeting_source_not_configured");
  const from = instant(url.searchParams.get("from"));
  const to = instant(url.searchParams.get("to"));
  if (from === null || to === null || from > to) fail(400, "invalid_date_range");
  const rows = await listAll(read, `/data_sources/${source}/query`, {
    filter: { and: [
      { property: DATE_PROPERTY, date: { on_or_after: new Date(from).toISOString() } },
      { property: DATE_PROPERTY, date: { on_or_before: new Date(to).toISOString() } }
    ] },
    sorts: [{ property: DATE_PROPERTY, direction: "ascending" }]
  });
  const result = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (row.object !== "page" || row.archived || row.in_trash) continue;
    const date = row.properties?.[DATE_PROPERTY]?.date;
    if (!date || !date.start?.includes("T")) continue;
    const start = notionInstant(date.start, date.time_zone);
    if (start === null) fail(502, "invalid_meeting_time");
    if (start < from || start > to) continue;
    const end = date.end == null ? null : notionInstant(date.end, date.time_zone);
    if (date.end != null && end === null) fail(502, "invalid_meeting_time");
    result.set(row.id, {
      id: row.id,
      title: (row.properties?.[TITLE_PROPERTY]?.title || []).map((part) => part.plain_text ?? part.text?.content ?? "").join(""),
      start: new Date(start).toISOString(),
      end: end === null ? null : new Date(end).toISOString(),
      url: row.url
    });
  }
  return [...result.values()].sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
}
__name(meetings, "meetings");
async function handleDesktopRequest(request, env, { cors = {}, notionVersion = "2026-03-11", transport = fetch } = {}) {
  const json2 = /* @__PURE__ */ __name((body, status) => new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  }), "json");
  try {
    const url = new URL(request.url);
    if (request.method !== "GET" || !["/resolve", "/meetings"].includes(url.pathname)) fail(404, "not_found");
    if (url.pathname === "/meetings" && !keyMatches(url.searchParams.get("w") || "", String(env.ALLOWED_W || ""))) fail(403, "forbidden");
    const read = notionReader(env, notionVersion, transport);
    const body = url.pathname === "/resolve" ? await resolvePage(url, env, read) : await meetings(url, env, read);
    return json2(body, 200);
  } catch (error) {
    return json2({ error: error instanceof ApiError ? error.code : "server_error" }, error instanceof ApiError ? error.status : 502);
  }
}
__name(handleDesktopRequest, "handleDesktopRequest");

// worker.js
var NOTION_API = "https://api.notion.com/v1";
var NOTION_VERSION = "2026-03-11";
var ALLOWED_ORIGIN = "https://kjm9954.github.io";
var INDEX_KEY = "index:v1";
var MAX_RESULTS = 20;
var MAX_QUERY_LENGTH = 100;
var MAX_BODY_LENGTH = 2e4;
var MAX_BLOCK_DEPTH = 4;
var DEFAULT_MAX_REQUESTS = 45;
var DEFAULT_MIN_INTERVAL_MS = 350;
var LINE_BEFORE = 24;
var LINE_LENGTH = 90;
var SUMMARY_HEADING = "\uD55C\uC904\uC694\uC57D";
var CONTINUATION_TTL_MS = 24 * 60 * 60 * 1e3;
var MAX_CONTINUATION_BYTES = 4 * 1024 * 1024;
var runtimes = /* @__PURE__ */ new WeakMap();
function runtime(env) {
  let state = runtimes.get(env.SEARCH_INDEX);
  if (!state) {
    state = { job: null, running: null, blockedUntil: 0, published: null };
    runtimes.set(env.SEARCH_INDEX, state);
  }
  return state;
}
__name(runtime, "runtime");
var TEXT_BLOCKS = /* @__PURE__ */ new Set([
  "paragraph",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "quote",
  "toggle",
  "callout"
]);
var SKIP_CHILDREN = /* @__PURE__ */ new Set(["child_page", "child_database", "link_to_page"]);
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (request.method === "GET" && ["/resolve", "/meetings"].includes(url.pathname)) {
        return handleDesktopRequest(request, env, { cors, notionVersion: NOTION_VERSION });
      }
      if (url.pathname === "/search" && request.method === "GET") {
        if (!allowed(url, env)) return json({ ok: false, error: "forbidden" }, 403, cors);
        const index = await loadIndex(env, 60);
        return json({ ok: true, ...searchPages(index.pages, url.searchParams.get("q")) }, 200, cors);
      }
      if (url.pathname === "/reindex" && request.method === "POST") {
        if (!allowed(url, env)) return json({ ok: false, error: "forbidden" }, 403, cors);
        const result = await runIndex(env, await requestContinuation(request));
        return json({ ok: true, ...result }, 200, cors);
      }
      return json({ ok: false, error: "not found" }, 404, cors);
    } catch (error) {
      console.error("notion-search", error?.status || "", error?.publicMessage || "server error");
      return json({ ok: false, error: error?.publicMessage || "server error", ...error?.details }, error?.responseStatus || 502, cors);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runIndex(env).catch((error) => {
      console.error("notion-search cron", error?.status || "", error?.publicMessage || "server error");
    }));
  }
};
function corsHeaders(request) {
  const headers = { "Vary": "Origin" };
  if (request.headers.get("Origin") === ALLOWED_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}
__name(corsHeaders, "corsHeaders");
function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
__name(json, "json");
function allowed(url, env) {
  const expected = String(env.ALLOWED_W || "");
  const given = String(url.searchParams.get("w") || "");
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) diff |= expected.charCodeAt(index) ^ given.charCodeAt(index);
  return diff === 0;
}
__name(allowed, "allowed");
var parsed = /* @__PURE__ */ new WeakMap();
async function loadIndex(env, cacheTtl = 0) {
  const local = runtime(env).published;
  if (local && Date.now() < local.until) return local.index;
  const text = await env.SEARCH_INDEX.get(INDEX_KEY, cacheTtl ? { type: "text", cacheTtl } : { type: "text" });
  const cached = parsed.get(env.SEARCH_INDEX);
  if (text && text === cached?.text) return cached.index;
  let index = { v: 1, updatedAt: null, pages: [] };
  if (text) {
    try {
      index = JSON.parse(text);
      if (!index || !Array.isArray(index.pages)) throw new Error();
    } catch (_) {
      throw indexError("invalid stored index", 502);
    }
  }
  parsed.set(env.SEARCH_INDEX, { text, index });
  return index;
}
__name(loadIndex, "loadIndex");
function indexError(message, responseStatus = 502, details = {}) {
  return Object.assign(new Error(message), { publicMessage: message, responseStatus, details });
}
__name(indexError, "indexError");
async function requestContinuation(request) {
  if (Number(request.headers.get("Content-Length")) > MAX_CONTINUATION_BYTES * 2) throw indexError("continuation too large", 413);
  const text = await request.text();
  if (!text.trim()) return null;
  if (text.length > MAX_CONTINUATION_BYTES * 2) throw indexError("continuation too large", 413);
  try {
    const body = JSON.parse(text);
    if (typeof body?.continuation !== "string") throw new Error();
    return body.continuation;
  } catch (_) {
    throw indexError("invalid continuation", 400);
  }
}
__name(requestContinuation, "requestContinuation");
async function continuationKey(env) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`notion-search/continuation/v1:${env.NOTION_TOKEN}`));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
__name(continuationKey, "continuationKey");
function base64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
__name(base64, "base64");
async function sealJob(env, job) {
  const plain = new TextEncoder().encode(JSON.stringify(job));
  if (plain.byteLength > MAX_CONTINUATION_BYTES) throw indexError("continuation too large", 413, { saved: false, preserved: true });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await continuationKey(env), plain);
  return `${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}
__name(sealJob, "sealJob");
async function openJob(env, token) {
  try {
    if (token.length > MAX_CONTINUATION_BYTES * 2) throw new Error();
    const parts = token.split(".");
    if (parts.length !== 2) throw new Error();
    const decode = /* @__PURE__ */ __name((text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0)), "decode");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(parts[0]) }, await continuationKey(env), decode(parts[1]));
    const job = JSON.parse(new TextDecoder().decode(plain));
    if (job.v !== 1 || job.source !== String(env.NOTION_DATA_SOURCE_ID || "").trim() || job.expiresAt <= Date.now()) throw new Error();
    return job;
  } catch (_) {
    throw indexError("invalid or expired continuation", 400);
  }
}
__name(openJob, "openJob");
var BudgetError = class extends Error {
  static {
    __name(this, "BudgetError");
  }
};
function notionClient(env) {
  const token = String(env.NOTION_TOKEN || "").trim();
  if (!token) throw Object.assign(new Error("NOTION_TOKEN is missing"), { publicMessage: "notion token missing" });
  const budget = positiveNumber(env.MAX_NOTION_REQUESTS, DEFAULT_MAX_REQUESTS);
  const interval = Math.max(0, Number(env.NOTION_MIN_INTERVAL_MS ?? DEFAULT_MIN_INTERVAL_MS) || 0);
  let used = 0;
  let last = 0;
  async function request(path, init = {}) {
    for (let attempt = 0; ; attempt += 1) {
      if (used >= budget) throw new BudgetError("request budget used");
      const waitFor = last + interval - Date.now();
      if (waitFor > 0) await sleep(waitFor);
      last = Date.now();
      used += 1;
      const response = await fetch(`${NOTION_API}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" }
      });
      if (response.ok) return response.json();
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < 3) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        await sleep(Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(retryAfter, 10) * 1e3 : 500 * (attempt + 1));
        continue;
      }
      const error = new Error(`Notion API ${response.status}`);
      error.status = response.status;
      error.publicMessage = response.status === 401 || response.status === 403 || response.status === 404 ? "notion connection" : "notion error";
      throw error;
    }
  }
  __name(request, "request");
  return { request, get used() {
    return used;
  } };
}
__name(notionClient, "notionClient");
var sleep = /* @__PURE__ */ __name((ms) => new Promise((resolve) => setTimeout(resolve, ms)), "sleep");
var positiveNumber = /* @__PURE__ */ __name((value, fallback) => Number(value) > 0 ? Math.floor(Number(value)) : fallback, "positiveNumber");
async function listPages(notion, job) {
  while (!job.listedAll) {
    const body = { page_size: 100 };
    if (job.cursor) body.start_cursor = job.cursor;
    const payload = await notion.request(`/data_sources/${encodeURIComponent(job.source)}/query`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    if (!Array.isArray(payload?.results) || payload.has_more && !payload.next_cursor) throw indexError("invalid notion response");
    job.listed.push(...payload.results.filter((page) => (!page?.object || page.object === "page") && !isRemoved(page)).map(pageMeta));
    job.cursor = payload.has_more ? payload.next_cursor : null;
    job.listedAll = !job.cursor;
  }
}
__name(listPages, "listPages");
var blockFrame = /* @__PURE__ */ __name((id, depth = 0) => ({ id, depth, cursor: null, items: null, offset: 0, next: null }), "blockFrame");
async function readBlocks(notion, work) {
  while (work.stack.length) {
    const frame = work.stack[work.stack.length - 1];
    if (!frame.items) {
      const query = new URLSearchParams({ page_size: "100" });
      if (frame.cursor) query.set("start_cursor", frame.cursor);
      const payload = await notion.request(`/blocks/${encodeURIComponent(frame.id)}/children?${query}`);
      if (!Array.isArray(payload?.results) || payload.has_more && !payload.next_cursor) throw indexError("invalid notion response");
      frame.items = payload.results.map((block2) => ({ id: block2.id, type: block2.type, text: richText(block2?.[block2.type]?.rich_text), children: block2.has_children }));
      frame.offset = 0;
      frame.next = payload.has_more ? payload.next_cursor : null;
    }
    if (frame.offset >= frame.items.length) {
      if (frame.next) {
        frame.cursor = frame.next;
        frame.items = null;
      } else work.stack.pop();
      continue;
    }
    const block = frame.items[frame.offset++];
    work.blocks.push({ type: block.type, text: block.text });
    if (block.children && frame.depth < MAX_BLOCK_DEPTH && !SKIP_CHILDREN.has(block.type)) {
      work.stack.push(blockFrame(block.id, frame.depth + 1));
    }
  }
}
__name(readBlocks, "readBlocks");
var richText = /* @__PURE__ */ __name((values) => Array.isArray(values) ? values.map((value) => value?.plain_text ?? value?.text?.content ?? "").join("") : "", "richText");
var isHeading = /* @__PURE__ */ __name((type) => /^heading_\d$/.test(String(type)), "isHeading");
var clean = /* @__PURE__ */ __name((text) => String(text || "").normalize("NFC").replace(/\s+/g, " ").trim(), "clean");
function pageText(blocks) {
  const lines = [];
  let lead = "";
  let summary = "";
  let waiting = false;
  let found = false;
  for (const block of blocks) {
    const text = clean(block.text);
    const heading = isHeading(block.type);
    if (waiting && (heading || TEXT_BLOCKS.has(block.type))) {
      waiting = false;
      found = true;
      summary = heading ? "" : text;
    }
    if (heading && !found && !waiting && text.replace(/[\s\p{Extended_Pictographic}:：]/gu, "") === SUMMARY_HEADING) waiting = true;
    if ((heading || TEXT_BLOCKS.has(block.type)) && text) lines.push(text);
    if (!lead && !heading && TEXT_BLOCKS.has(block.type) && text) lead = text.slice(0, LINE_LENGTH + 1);
  }
  return { body: lines.join("\n").slice(0, MAX_BODY_LENGTH), summary, lead };
}
__name(pageText, "pageText");
function pageMeta(page) {
  const properties = page?.properties || {};
  const values = Object.values(properties);
  const titleProperty = properties["\uC774\uB984"]?.type === "title" ? properties["\uC774\uB984"] : values.find((value) => value?.type === "title");
  const dateStart = properties["\uB0A0\uC9DC"]?.date?.start;
  const tags = properties["\uD0DC\uADF8"]?.multi_select;
  return {
    id: String(page.id),
    url: String(page.url || `https://www.notion.so/${String(page.id).replaceAll("-", "")}`),
    title: clean(richText(titleProperty?.title)) || "\uC81C\uBAA9 \uC5C6\uC74C",
    date: /^\d{4}-\d{2}-\d{2}/.test(String(dateStart || "")) ? String(dateStart).slice(0, 10) : seoulDate(page.created_time),
    tags: Array.isArray(tags) ? tags.map((tag) => String(tag?.name || "")).filter(Boolean) : [],
    lastEdited: String(page.last_edited_time || "")
  };
}
__name(pageMeta, "pageMeta");
function seoulDate(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  return new Date(time + 9 * 60 * 60 * 1e3).toISOString().slice(0, 10);
}
__name(seoulDate, "seoulDate");
var isRemoved = /* @__PURE__ */ __name((page) => page?.in_trash === true || page?.archived === true || page?.is_archived === true, "isRemoved");
function runIndex(env, continuation = null) {
  const state = runtime(env);
  if (state.running) return state.running;
  state.running = buildIndex(env, continuation).finally(() => {
    state.running = null;
  });
  return state.running;
}
__name(runIndex, "runIndex");
async function buildIndex(env, continuation) {
  const state = runtime(env);
  const notBefore = Date.parse(env.INDEX_NOT_BEFORE || "");
  if (Number.isFinite(notBefore) && Date.now() < notBefore) {
    return { saved: false, skipped: "not_before", retryAt: new Date(notBefore).toISOString(), pending: null, requests: 0 };
  }
  if (Date.now() < state.blockedUntil) {
    throw indexError("kv daily write limit", 429, { saved: false, preserved: true, retryAt: new Date(state.blockedUntil).toISOString() });
  }
  const notion = notionClient(env);
  const dataSourceId = String(env.NOTION_DATA_SOURCE_ID || "").trim();
  if (!dataSourceId) throw Object.assign(new Error("NOTION_DATA_SOURCE_ID is missing"), { publicMessage: "data source missing" });
  const previous = await loadIndex(env);
  const before = new Map(previous.pages.map((page) => [page.id, page]));
  let job = continuation ? await openJob(env, continuation) : state.job;
  if (job && (job.expiresAt <= Date.now() || job.source !== dataSourceId || job.baseUpdatedAt !== (previous.updatedAt || null))) {
    state.job = null;
    if (continuation) throw indexError("stale continuation; restart indexing", 409, { saved: false, preserved: true });
    job = null;
  }
  job ||= {
    v: 1,
    source: dataSourceId,
    baseUpdatedAt: previous.updatedAt || null,
    expiresAt: Date.now() + CONTINUATION_TTL_MS,
    listed: [],
    listedAll: false,
    cursor: null,
    pages: null,
    work: null
  };
  state.job = job;
  let indexed = 0;
  try {
    await listPages(notion, job);
    job.pages ||= job.listed.map((meta) => {
      const old = before.get(meta.id);
      return { ...meta, summary: old?.summary || "", lead: old?.lead || "", body: old?.body || "", edited: old?.edited ?? null };
    }).sort((a, b) => b.date.localeCompare(a.date) || b.lastEdited.localeCompare(a.lastEdited));
    const denied = /* @__PURE__ */ new Set();
    for (; ; ) {
      const page = job.work ? job.pages.find((page2) => page2.id === job.work.id) : job.pages.find((page2) => page2.edited !== page2.lastEdited && !denied.has(page2.id));
      if (!page) break;
      job.work ||= { id: page.id, blocks: [], stack: [blockFrame(page.id)] };
      try {
        await readBlocks(notion, job.work);
      } catch (error) {
        if (error?.status !== 403 && error?.status !== 404) throw error;
        denied.add(page.id);
        job.work = null;
        continue;
      }
      Object.assign(page, pageText(job.work.blocks), { edited: page.lastEdited });
      job.work = null;
      indexed++;
    }
  } catch (error) {
    if (!(error instanceof BudgetError)) {
      state.job = null;
      throw error;
    }
  }
  const pages = job.pages || [];
  const left = job.listedAll ? pages.filter((page) => page.edited !== page.lastEdited).length : Math.max(1, job.listed.length);
  if (left) {
    return {
      total: job.listed.length,
      indexed,
      pending: left,
      listing: !job.listedAll,
      removed: 0,
      requests: notion.used,
      saved: false,
      continuation: await sealJob(env, job)
    };
  }
  const kept = new Set(pages.map((page) => page.id));
  const removed = previous.pages.filter((page) => !kept.has(page.id)).length;
  const same = /* @__PURE__ */ __name((page, old) => old && ["url", "title", "date", "summary", "lead", "body", "edited", "lastEdited"].every((key) => page[key] === old[key]) && page.tags.join("\0") === (old.tags || []).join("\0"), "same");
  const changed = removed > 0 || pages.length !== previous.pages.length || pages.some((page) => !same(page, before.get(page.id)));
  if (changed) {
    const index = { v: 1, updatedAt: (/* @__PURE__ */ new Date()).toISOString(), complete: true, pages };
    try {
      await env.SEARCH_INDEX.put(INDEX_KEY, JSON.stringify(index));
    } catch (error) {
      state.job = null;
      if (/KV put\(\) limit exceeded for the day|daily.*(?:write|put).*limit|(?:write|put).*daily.*limit/i.test(String(error?.message || error))) {
        const now = /* @__PURE__ */ new Date();
        state.blockedUntil = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
        throw indexError("kv daily write limit", 429, {
          saved: false,
          preserved: true,
          pending: 0,
          total: pages.length,
          retryAt: new Date(state.blockedUntil).toISOString()
        });
      }
      throw indexError("index storage unavailable", 503, { saved: false, preserved: true });
    }
    state.published = { index, until: Date.now() + 6e4 };
  }
  state.job = null;
  return { total: pages.length, indexed, pending: 0, removed, requests: notion.used, saved: changed };
}
__name(buildIndex, "buildIndex");
function normalized(text) {
  let value = "";
  const map = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (/\s/.test(character)) continue;
    for (const lower of character.toLowerCase()) {
      value += lower;
      map.push(index);
    }
  }
  return { value, map };
}
__name(normalized, "normalized");
var normalizeQuery = /* @__PURE__ */ __name((query) => String(query || "").normalize("NFC").toLowerCase().replace(/\s+/g, "").slice(0, MAX_QUERY_LENGTH), "normalizeQuery");
function findMatches(text, query) {
  if (!query) return [];
  const { value, map } = normalized(text);
  const found = [];
  let from = 0;
  for (; ; ) {
    const at = value.indexOf(query, from);
    if (at < 0) break;
    found.push([map[at], map[at + query.length - 1] + 1]);
    from = at + query.length;
  }
  return found;
}
__name(findMatches, "findMatches");
function secondLine(page, query) {
  if (page.summary) return { line: page.summary, matches: findMatches(page.summary, query) };
  const body = String(page.body || "");
  const first = findMatches(body, query)[0];
  if (!first) {
    const lead = String(page.lead || "");
    return { line: lead.length > LINE_LENGTH ? `${lead.slice(0, LINE_LENGTH)}\u2026` : lead, matches: [] };
  }
  const at = first[0];
  const sentenceStart = Math.max(
    body.lastIndexOf("\n", at - 1) + 1,
    ...[". ", "? ", "! "].map((mark) => {
      const found = body.lastIndexOf(mark, at - 1);
      return found < 0 ? 0 : found + 2;
    })
  );
  const start = Math.max(sentenceStart, at - LINE_BEFORE, 0);
  const end = Math.min(body.length, start + LINE_LENGTH);
  const prefix = start > 0 ? "\u2026" : "";
  const line = prefix + body.slice(start, end).replace(/\s/g, " ") + (end < body.length ? "\u2026" : "");
  const matches = findMatches(body.slice(start, end), query).map(([from, to]) => [from + prefix.length, to + prefix.length]);
  return { line, matches };
}
__name(secondLine, "secondLine");
function searchPages(pages, rawQuery) {
  const query = normalizeQuery(rawQuery);
  if (!query) return { results: [], total: 0 };
  const hits = [];
  for (const page of pages) {
    const titleMatches = findMatches(page.title, query);
    if (!titleMatches.length && !String(page.body || "").toLowerCase().replace(/\s+/g, "").includes(query)) continue;
    hits.push({ page, titleMatches });
  }
  hits.sort((a, b) => b.page.date.localeCompare(a.page.date) || String(b.page.lastEdited).localeCompare(String(a.page.lastEdited)));
  return {
    total: hits.length,
    results: hits.slice(0, MAX_RESULTS).map(({ page, titleMatches }) => {
      const { line, matches } = secondLine(page, query);
      return { date: page.date, title: page.title, url: page.url, tags: page.tags, line, titleMatches, lineMatches: matches };
    })
  };
}
__name(searchPages, "searchPages");
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map


// Export existing index runner for the shared scheduled request budget; implementation unchanged.
export { runIndex as runMeetingIndex };

