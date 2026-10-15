// 노션 회의록 검색 전용 Worker (notion-search).
// 기존 notion-widget Worker·D1과 완전히 분리돼 있다. 노션에는 읽기 요청만 보낸다.
//
//   GET  /search?q=검색어&w=인스턴스키   색인에서 제목+본문 검색 (최대 20건, 날짜 최신순)
//   POST /reindex?w=인스턴스키          색인 갱신을 지금 한 번 실행
//   Cron(30분마다)                      색인 갱신
//
// 설정: NOTION_TOKEN·ALLOWED_W(secret), NOTION_DATABASE_ID·NOTION_DATA_SOURCE_ID(vars), SEARCH_INDEX(KV)
// 선택: MAX_NOTION_REQUESTS(한 번 갱신할 때 노션 요청 상한, 기본 45), NOTION_MIN_INTERVAL_MS(요청 간격, 기본 350)

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const ALLOWED_ORIGIN = "https://kjm9954.github.io";
const INDEX_KEY = "index:v1";
const MAX_RESULTS = 20;
const MAX_QUERY_LENGTH = 100;
const MAX_BODY_LENGTH = 20000;
const MAX_BLOCK_DEPTH = 4;
const DEFAULT_MAX_REQUESTS = 45;  // 무료 플랜 요청당 하위 요청 50개 안쪽
const DEFAULT_MIN_INTERVAL_MS = 350; // 노션 속도 제한(초당 약 3회)
const LINE_BEFORE = 24;
const LINE_LENGTH = 90;
const SUMMARY_HEADING = "한줄요약";
// 본문으로 읽는 블록: 제목·문단·목록·체크리스트·인용(+ 토글·콜아웃). 그 밖의 블록도 하위 블록은 읽는다.
const TEXT_BLOCKS = new Set([
  "paragraph", "bulleted_list_item", "numbered_list_item", "to_do", "quote", "toggle", "callout",
]);
// 하위 블록을 읽지 않는 블록: 다른 페이지·데이터베이스.
const SKIP_CHILDREN = new Set(["child_page", "child_database", "link_to_page"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === "/search" && request.method === "GET") {
        if (!allowed(url, env)) return json({ ok: false, error: "forbidden" }, 403, cors);
        const index = await loadIndex(env, 60);
        return json({ ok: true, ...searchPages(index.pages, url.searchParams.get("q")) }, 200, cors);
      }
      if (url.pathname === "/reindex" && request.method === "POST") {
        if (!allowed(url, env)) return json({ ok: false, error: "forbidden" }, 403, cors);
        return json({ ok: true, ...(await runIndex(env)) }, 200, cors);
      }
      return json({ ok: false, error: "not found" }, 404, cors);
    } catch (error) {
      // 토큰·키 값은 응답에 넣지 않는다.
      console.error("notion-search", error?.status || "", error?.message || error);
      return json({ ok: false, error: error?.publicMessage || "server error" }, 502, cors);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runIndex(env).catch(error => {
      console.error("notion-search cron", error?.status || "", error?.message || error);
    }));
  },
};

// ───────── 요청 공통 ─────────
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

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// w가 ALLOWED_W와 같을 때만 허용. ALLOWED_W가 비어 있으면 아무도 허용하지 않는다.
function allowed(url, env) {
  const expected = String(env.ALLOWED_W || "");
  const given = String(url.searchParams.get("w") || "");
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) diff |= expected.charCodeAt(index) ^ given.charCodeAt(index);
  return diff === 0;
}

// ───────── 색인 저장 ─────────
// 검색은 KV 가장자리 캐시(cacheTtl)를 써서 빠르게 읽는다. 갱신 후 최대 1분 뒤 검색에 반영된다.
// 같은 내용이면 이전에 해석한 색인을 다시 쓴다(검색마다 큰 JSON을 다시 해석하지 않게).
let parsed = { text: null, index: null };
async function loadIndex(env, cacheTtl = 0) {
  const text = await env.SEARCH_INDEX.get(INDEX_KEY, cacheTtl ? { type: "text", cacheTtl } : { type: "text" });
  if (text && text === parsed.text) return parsed.index;
  let stored = null;
  try { stored = text ? JSON.parse(text) : null; } catch (_) { stored = null; }
  const index = stored && Array.isArray(stored.pages) ? stored : { v: 1, updatedAt: null, pages: [] };
  parsed = { text, index };
  return index;
}

// ───────── 노션 요청 (속도 제한 + 429 재시도 + 요청 수 상한) ─────────
class BudgetError extends Error {}

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
        headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
      });
      if (response.ok) return response.json();
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < 3) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        await sleep(Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(retryAfter, 10) * 1000 : 500 * (attempt + 1));
        continue;
      }
      const error = new Error(`Notion API ${response.status}`);
      error.status = response.status;
      error.publicMessage = response.status === 401 || response.status === 403 || response.status === 404
        ? "notion connection" : "notion error";
      throw error;
    }
  }
  return { request, get used() { return used; } };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const positiveNumber = (value, fallback) => Number(value) > 0 ? Math.floor(Number(value)) : fallback;

async function listPages(notion, dataSourceId) {
  const pages = [];
  let cursor = null;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const payload = await notion.request(`/data_sources/${encodeURIComponent(dataSourceId)}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    pages.push(...(Array.isArray(payload?.results) ? payload.results : []));
    cursor = payload?.has_more ? payload.next_cursor : null;
  } while (cursor);
  return pages;
}

// 블록을 문서 순서대로 펼친다(하위 블록 포함). 요청 수 상한에 걸리면 그때까지 읽은 블록은 out에 남는다.
async function readBlocks(notion, blockId, out, depth = 0) {
  let cursor = null;
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);
    const payload = await notion.request(`/blocks/${encodeURIComponent(blockId)}/children?${query}`);
    for (const block of Array.isArray(payload?.results) ? payload.results : []) {
      out.push({ type: block.type, text: richText(block?.[block.type]?.rich_text) });
      if (block.has_children && depth < MAX_BLOCK_DEPTH && !SKIP_CHILDREN.has(block.type)) {
        await readBlocks(notion, block.id, out, depth + 1);
      }
    }
    cursor = payload?.has_more ? payload.next_cursor : null;
  } while (cursor);
  return out;
}

const richText = values => Array.isArray(values) ? values.map(value => value?.plain_text ?? value?.text?.content ?? "").join("") : "";
const isHeading = type => /^heading_\d$/.test(String(type));
const clean = text => String(text || "").normalize("NFC").replace(/\s+/g, " ").trim();

// 본문 텍스트와 한 줄 요약.
// 한 줄 요약 = "한 줄 요약" 제목 바로 아래 첫 번째 텍스트 블록의 내용. 그 블록이 비어 있거나, 텍스트 블록보다
// 다음 제목이 먼저 나오면 빈 값. (구분선·이미지처럼 글이 없는 블록은 건너뛴다)
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
  // lead: 본문 첫 문장(제목 블록 제외). 제목에만 검색어가 있을 때 둘째 줄로 쓴다.
  return { body: lines.join("\n").slice(0, MAX_BODY_LENGTH), summary, lead };
}

// 페이지 속성: 제목(이름), 날짜(날짜 속성, 없으면 만든 날·한국 시간), 태그, 노션 URL.
function pageMeta(page) {
  const properties = page?.properties || {};
  const values = Object.values(properties);
  const titleProperty = properties["이름"]?.type === "title" ? properties["이름"] : values.find(value => value?.type === "title");
  const dateStart = properties["날짜"]?.date?.start;
  const tags = properties["태그"]?.multi_select;
  return {
    id: String(page.id),
    url: String(page.url || `https://www.notion.so/${String(page.id).replaceAll("-", "")}`),
    title: clean(richText(titleProperty?.title)) || "제목 없음",
    date: /^\d{4}-\d{2}-\d{2}/.test(String(dateStart || "")) ? String(dateStart).slice(0, 10) : seoulDate(page.created_time),
    tags: Array.isArray(tags) ? tags.map(tag => String(tag?.name || "")).filter(Boolean) : [],
    lastEdited: String(page.last_edited_time || ""),
  };
}

function seoulDate(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  return new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const isRemoved = page => page?.in_trash === true || page?.archived === true || page?.is_archived === true;

// ───────── 색인 갱신 ─────────
// 1) 회의록 DB 전체 목록(페이지네이션)  2) last_edited_time이 바뀐 페이지만 본문을 다시 읽음(최근 날짜부터)
// 3) 목록에 없는 페이지(삭제·보관)는 제거. 요청 수 상한에 걸리면 남은 페이지는 다음 실행에서 이어 읽는다.
async function runIndex(env) {
  const notion = notionClient(env);
  const dataSourceId = String(env.NOTION_DATA_SOURCE_ID || "").trim();
  if (!dataSourceId) throw Object.assign(new Error("NOTION_DATA_SOURCE_ID is missing"), { publicMessage: "data source missing" });
  const previous = await loadIndex(env);
  const before = new Map(previous.pages.map(page => [page.id, page]));
  const listed = (await listPages(notion, dataSourceId)).filter(page => (!page?.object || page.object === "page") && !isRemoved(page));

  const pages = listed.map(page => {
    const meta = pageMeta(page);
    const old = before.get(meta.id);
    // 본문은 다시 읽기 전까지 이전 내용을 유지한다(edited = 그 본문을 읽었을 때의 last_edited_time).
    return { id: meta.id, url: meta.url, title: meta.title, date: meta.date, tags: meta.tags,
      summary: old?.summary || "", lead: old?.lead || "", body: old?.body || "", edited: old?.edited || "", lastEdited: meta.lastEdited };
  });
  const pending = pages.filter(page => page.edited !== page.lastEdited)
    .sort((a, b) => b.date.localeCompare(a.date) || b.lastEdited.localeCompare(a.lastEdited));

  let indexed = 0;
  for (const page of pending) {
    const blocks = [];
    try {
      await readBlocks(notion, page.id, blocks);
    } catch (error) {
      // 연동이 그 페이지만 못 읽는 경우(403·404)는 건너뛰고 다음 실행에서 다시 시도한다.
      if (error?.status === 403 || error?.status === 404) continue;
      if (!(error instanceof BudgetError)) throw error;
      // 한 페이지가 상한보다 많은 요청을 쓰면 끝내 못 읽으므로, 이번 실행의 첫 페이지라면 읽은 데까지 저장한다.
      if (indexed === 0 && blocks.length) Object.assign(page, pageText(blocks), { edited: page.lastEdited });
      break;
    }
    Object.assign(page, pageText(blocks), { edited: page.lastEdited });
    indexed += 1;
  }

  const kept = new Set(pages.map(page => page.id));
  const removed = previous.pages.filter(page => !kept.has(page.id)).length;
  const same = (page, old) => old && ["url", "title", "date", "summary", "lead", "body", "edited", "lastEdited"].every(key => page[key] === old[key])
    && page.tags.join("\u0000") === (old.tags || []).join("\u0000");
  const changed = removed > 0 || pages.length !== previous.pages.length || pages.some(page => !same(page, before.get(page.id)));
  const left = pages.filter(page => page.edited !== page.lastEdited).length;
  if (changed) {
    await env.SEARCH_INDEX.put(INDEX_KEY, JSON.stringify({ v: 1, updatedAt: new Date().toISOString(), complete: left === 0, pages }));
  }
  return { total: pages.length, indexed, pending: left, removed, requests: notion.used, saved: changed };
}

// ───────── 검색 ─────────
// 대소문자·공백 차이를 무시한다. 원문 위치로 되돌리기 위해 정규화한 글자마다 원래 위치를 기억한다.
function normalized(text) {
  let value = "";
  const map = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (/\s/.test(character)) continue;
    for (const lower of character.toLowerCase()) { value += lower; map.push(index); }
  }
  return { value, map };
}
const normalizeQuery = query => String(query || "").normalize("NFC").toLowerCase().replace(/\s+/g, "").slice(0, MAX_QUERY_LENGTH);

// 원문에서 찾은 위치 [시작, 끝) 목록.
function findMatches(text, query) {
  if (!query) return [];
  const { value, map } = normalized(text);
  const found = [];
  let from = 0;
  for (;;) {
    const at = value.indexOf(query, from);
    if (at < 0) break;
    found.push([map[at], map[at + query.length - 1] + 1]);
    from = at + query.length;
  }
  return found;
}

// 둘째 줄: 한 줄 요약이 있으면 요약, 없으면 검색어가 들어간 문장(앞뒤를 잘라 …), 제목에만 있으면 본문 첫 문장.
function secondLine(page, query) {
  if (page.summary) return { line: page.summary, matches: findMatches(page.summary, query) };
  const body = String(page.body || "");
  const first = findMatches(body, query)[0];
  if (!first) {
    const lead = String(page.lead || "");
    return { line: lead.length > LINE_LENGTH ? `${lead.slice(0, LINE_LENGTH)}…` : lead, matches: [] };
  }
  const at = first[0];
  // 찾은 곳이 속한 블록·문장의 시작이 가까우면 그곳부터, 멀면 앞쪽 일부만 보여준다.
  const sentenceStart = Math.max(body.lastIndexOf("\n", at - 1) + 1,
    ...[". ", "? ", "! "].map(mark => { const found = body.lastIndexOf(mark, at - 1); return found < 0 ? 0 : found + 2; }));
  const start = Math.max(sentenceStart, at - LINE_BEFORE, 0);
  const end = Math.min(body.length, start + LINE_LENGTH);
  const prefix = start > 0 ? "…" : "";
  // 블록 사이 줄바꿈은 공백으로(글자 수가 같아 위치가 그대로 맞는다).
  const line = prefix + body.slice(start, end).replace(/\s/g, " ") + (end < body.length ? "…" : "");
  const matches = findMatches(body.slice(start, end), query).map(([from, to]) => [from + prefix.length, to + prefix.length]);
  return { line, matches };
}

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
    }),
  };
}
