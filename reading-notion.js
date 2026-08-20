import { NOTION_API_VERSION } from "./schedule-core.js";

const LIBRARY_CACHE_KEY = "reading:notion:library:v2";
const NESTED_QUOTES_CACHE_KEY = "reading:notion:nested-quotes:v2";
const LIBRARY_CACHE_MS = 15_000;
const NESTED_QUOTES_REFRESH_MS = 60_000;
const NESTED_BOOK_BATCH_SIZE = 2;
const LIFE_CYCLE_STATUSES = new Set(["구입 전", "읽는 중", "재독", "중도포기", "완독", "정리 완료"]);
const KEEP_STATUSES = new Set(["소장", "구독서비스", "인생책"]);
const STATUS_TO_NOTION = Object.freeze({
  reading: "읽는 중",
  wishlist: "구입 전",
  done: "완독",
  dropped: "중도포기",
  owned: "소장",
});

let libraryInFlight = null;

export function notionReadingConfig(env) {
  const config = {
    token: String(env.NOTION_TOKEN || env.NOTION_CLIENT_SECRET || "").trim(),
    booksDataSourceId: String(env.NOTION_READING_BOOKS_DATA_SOURCE_ID || "").trim(),
    quotesDataSourceId: String(env.NOTION_READING_QUOTES_DATA_SOURCE_ID || "").trim(),
    yearsDataSourceId: String(env.NOTION_READING_YEARS_DATA_SOURCE_ID || "").trim(),
  };
  const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`독서 노션 연결 설정이 필요합니다: ${missing.join(", ")}`);
  return config;
}

function headers(config) {
  return {
    Authorization: `Bearer ${config.token}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_API_VERSION,
  };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function notionRequest(config, path, init = {}) {
  const request = { ...init, headers: { ...headers(config), ...(init.headers || {}) } };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response;
    try {
      response = await fetch(`https://api.notion.com/v1${path}`, request);
    } catch (_) {
      if (attempt < 2) { await wait(300 * (attempt + 1)); continue; }
      throw new Error("Notion 네트워크 응답을 확인하지 못했습니다.");
    }
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return payload;
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < 2) {
      const retryAfter = Math.max(0, Number(response.headers.get("Retry-After")) || 0) * 1000;
      await wait(Math.min(5000, retryAfter || 400 * (attempt + 1)));
      continue;
    }
    const error = new Error(`Notion API ${response.status}: ${textValue(payload?.message, 300) || "요청 실패"}`);
    error.status = response.status;
    error.code = textValue(payload?.code, 80);
    throw error;
  }
  throw new Error("Notion API 요청을 완료하지 못했습니다.");
}

async function queryDataSource(config, dataSourceId, filter = null) {
  const results = [];
  let cursor = null;
  do {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;
    const payload = await notionRequest(config, `/data_sources/${encodeURIComponent(dataSourceId)}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    results.push(...(Array.isArray(payload?.results) ? payload.results : []));
    cursor = payload?.has_more ? payload?.next_cursor : null;
  } while (cursor);
  return results;
}

function richText(content) {
  const value = textValue(content, 4000, false);
  if (!value) return [];
  const chunks = [];
  for (let index = 0; index < value.length; index += 1900) {
    chunks.push({ type: "text", text: { content: value.slice(index, index + 1900) } });
  }
  return chunks;
}

function titleProperty(value) {
  return { type: "title", title: richText(value).slice(0, 1) };
}

function richTextProperty(value) {
  return { type: "rich_text", rich_text: richText(value) };
}

function propertyPlainText(property) {
  const values = property?.type === "title" ? property?.title : property?.rich_text;
  return Array.isArray(values) ? values.map(value => value?.plain_text || value?.text?.content || "").join("") : "";
}

function propertyNames(property) {
  if (property?.type === "multi_select") return (property.multi_select || []).map(value => value?.name).filter(Boolean);
  if (property?.type === "select") return property.select?.name ? [property.select.name] : [];
  return [];
}

function relationIds(property) {
  return property?.type === "relation" ? (property.relation || []).map(value => value?.id).filter(Boolean) : [];
}

function propertyFileUrl(property, fallback = null) {
  const file = property?.type === "files" ? property.files?.[0] : null;
  return file?.file?.url || file?.external?.url || fallback?.file?.url || fallback?.external?.url || "";
}

function textValue(value, maximum = 2000, trim = true) {
  const text = String(value ?? "");
  return (trim ? text.trim() : text).slice(0, maximum);
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  });
  return formatter.format(date);
}

function normalizedStatus(statuses) {
  if (statuses.includes("읽는 중") || statuses.includes("재독")) return "reading";
  if (statuses.includes("완독") || statuses.includes("정리 완료")) return "done";
  if (statuses.includes("중도포기")) return "dropped";
  if (statuses.includes("구입 전")) return "wishlist";
  if (statuses.includes("소장") || statuses.includes("구독서비스")) return "owned";
  return "owned";
}

function starNumber(label) {
  const stars = (String(label || "").match(/★/g) || []).length;
  const half = String(label || "").includes("☆") ? 0.5 : 0;
  return Math.min(5, stars + half);
}

function pageYear(page, yearsById) {
  const properties = page?.properties || {};
  const relation = relationIds(properties["연도"]);
  const related = relation.map(id => yearsById.get(id)).find(Boolean);
  const date = properties["날짜"]?.date;
  return Number(related) || Number(String(date?.end || date?.start || "").slice(0, 4)) || null;
}

export function normalizeReadingBookPage(page, yearsById = new Map()) {
  const properties = page?.properties || {};
  const statuses = propertyNames(properties["상태"]);
  const fields = propertyNames(properties["분야"]);
  const date = properties["날짜"]?.date || null;
  const starLabel = propertyNames(properties["별점"])[0] || "";
  return {
    id: String(page?.id || ""),
    url: String(page?.url || ""),
    title: propertyPlainText(properties["제목"]) || "제목 없음",
    author: propertyPlainText(properties["저자"]),
    publisher: propertyPlainText(properties["출판사"]),
    cover: propertyFileUrl(properties.cover, page?.cover),
    field: fields[0] || "미분류",
    fields,
    status: normalizedStatus(statuses),
    statuses,
    isLifeBook: statuses.includes("인생책"),
    star: starNumber(starLabel),
    starLabel,
    one: propertyPlainText(properties["이 책의 한 줄"]),
    learned: propertyPlainText(properties["나의 생각 한줄"]),
    applying: propertyPlainText(properties["적용할 것"]),
    dropReason: propertyPlainText(properties["중도포기 이유"]),
    readingProcess: propertyPlainText(properties["읽는 과정"]),
    readingType: propertyNames(properties["독서유형"])[0] || "",
    pageRead: numberValue(properties["page read"]?.number),
    totalPage: numberValue(properties["total page"]?.number),
    startDate: date?.start || "",
    endDate: date?.end || "",
    year: pageYear(page, yearsById),
    created: page?.created_time || "",
    edited: page?.last_edited_time || "",
  };
}

export function normalizeStructuredQuotePage(page) {
  const properties = page?.properties || {};
  const bookId = relationIds(properties["책"])[0] || "";
  const text = propertyPlainText(properties["문장"]) || propertyPlainText(properties["이름"]);
  const date = properties["기록일"]?.date?.start || page?.created_time || "";
  if (!bookId || !text) return null;
  return {
    id: String(page?.id || ""),
    bookId,
    text,
    page: propertyPlainText(properties["페이지"]),
    note: propertyPlainText(properties["반응"]),
    thought: propertyPlainText(properties["생각"]),
    created: validDate(date) || new Date().toISOString(),
    clientId: propertyPlainText(properties["클라이언트 ID"]),
    sourceBlockId: propertyPlainText(properties["원본 블록 ID"]),
    legacy: false,
  };
}

function isMissingDataSource(error) {
  return Number(error?.status) === 404;
}

async function loadYears(config, bookPages = []) {
  let pages = [];
  try {
    pages = await queryDataSource(config, config.yearsDataSourceId);
  } catch (error) {
    if (!isMissingDataSource(error)) throw error;
  }

  const relatedIds = new Set();
  bookPages.forEach(page => {
    relationIds(page?.properties?.["연도"]).forEach(id => relatedIds.add(id));
  });
  const knownIds = new Set(pages.map(page => page?.id).filter(Boolean));
  const relatedPages = await Promise.all([...relatedIds]
    .filter(id => !knownIds.has(id))
    .map(async id => {
      try {
        return await notionRequest(config, `/pages/${encodeURIComponent(id)}`);
      } catch (error) {
        if (isMissingDataSource(error)) return null;
        throw error;
      }
    }));
  pages.push(...relatedPages.filter(Boolean));

  const byId = new Map();
  const byYear = new Map();
  pages.forEach(page => {
    const label = propertyPlainText(page?.properties?.["이름"]);
    if (!label) return;
    byId.set(page.id, label);
    byYear.set(label, page.id);
  });
  return { byId, byYear };
}

async function listBlockChildren(config, blockId) {
  const results = [];
  let cursor = null;
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);
    const payload = await notionRequest(config, `/blocks/${encodeURIComponent(blockId)}/children?${query}`);
    results.push(...(Array.isArray(payload?.results) ? payload.results : []));
    cursor = payload?.has_more ? payload?.next_cursor : null;
  } while (cursor);
  return results;
}

function blockText(block) {
  const rich = block?.[block?.type]?.rich_text;
  return Array.isArray(rich) ? rich.map(value => value?.plain_text || "").join("").trim() : "";
}

function nestedQuotePageLabel(value) {
  const title = textValue(value, 300);
  const match = title.match(/^\[\s*p\.?\s*([^\]]+)\]\s*/i);
  return {
    page: match?.[1]?.trim() || "",
    title: match ? title.slice(match[0].length).trim() : title,
  };
}

function nestedQuoteText(blocks) {
  const callouts = (Array.isArray(blocks) ? blocks : []).filter(block => block?.type === "callout");
  const preferred = callouts.find(block => /^summary(?:\s|$)/i.test(blockText(block))) || callouts[0];
  return blockText(preferred).replace(/^summary\s*/i, "").trim();
}

export function normalizeNestedQuotePage(page, bookId, blocks = []) {
  const properties = page?.properties || {};
  const label = nestedQuotePageLabel(propertyPlainText(properties["이름"]));
  const text = nestedQuoteText(blocks);
  if (!bookId || !text) return null;
  return {
    id: `nested:${String(page?.id || "")}`,
    bookId: String(bookId),
    text,
    page: label.page,
    note: label.title,
    thought: "",
    created: validDate(page?.created_time) || new Date().toISOString(),
    sourceBlockId: "",
    legacy: false,
    readOnly: true,
    source: "nested-database",
  };
}

export function normalizeBookOneLine(book) {
  const text = textValue(book?.one, 4000, false).trim();
  if (!book?.id || !text) return null;
  return {
    id: `book-line:${String(book.id)}`,
    bookId: String(book.id),
    text,
    page: "",
    note: "이 책의 한 줄",
    thought: "",
    created: validDate(book.edited || book.created) || new Date().toISOString(),
    sourceBlockId: "",
    legacy: false,
    readOnly: true,
    source: "book-one-line",
  };
}

async function mapInBatches(items, mapper, batchSize = 3) {
  const results = [];
  for (let index = 0; index < items.length; index += batchSize) {
    results.push(...await Promise.all(items.slice(index, index + batchSize).map(mapper)));
    if (index + batchSize < items.length) await wait(350);
  }
  return results;
}

async function kvGet(env, key) {
  try { return env.KV ? await env.KV.get(key, "json") : null; } catch (_) { return null; }
}

async function kvPut(env, key, value) {
  try { if (env.KV) await env.KV.put(key, JSON.stringify(value), { expirationTtl: 3600 }); } catch (_) {}
}

async function kvDelete(env, key) {
  try { if (env.KV) await env.KV.delete(key); } catch (_) {}
}

async function loadNestedQuotes(env, config, books, fresh) {
  const signature = books.map(book => book.id).join(":");
  const cached = await kvGet(env, NESTED_QUOTES_CACHE_KEY);
  const state = cached?.signature === signature && cached?.quotesByBook && cached?.dataSourceIdsByBook
    ? cached
    : { signature, nextIndex:0, completedAt:0, quotesByBook:{}, dataSourceIdsByBook:{} };
  const complete = books.every(book => Object.hasOwn(state.quotesByBook, book.id));
  if (!fresh && complete && state.completedAt && Date.now() - state.completedAt < NESTED_QUOTES_REFRESH_MS) {
    return books.flatMap(book => state.quotesByBook[book.id] || []);
  }

  const start = Math.max(0, Math.min(books.length - 1, Number(state.nextIndex) || 0));
  const batch = books.slice(start, start + NESTED_BOOK_BATCH_SIZE);
  const unresolved = batch.filter(book => !Array.isArray(state.dataSourceIdsByBook[book.id]) || !state.dataSourceIdsByBook[book.id].length);
  const bookBlocks = await mapInBatches(unresolved, async book => ({
    book,
    blocks: await listBlockChildren(config, book.id),
  }));
  const nestedDatabases = bookBlocks.flatMap(({ book, blocks }) => blocks
    .filter(block => block?.type === "child_database" && /필사/.test(String(block?.child_database?.title || "")))
    .map(block => ({ book, databaseId: block.id })));
  const discovered = await mapInBatches(nestedDatabases, async entry => {
    const database = await notionRequest(config, `/databases/${encodeURIComponent(entry.databaseId)}`);
    return {
      bookId:entry.book.id,
      ids:(Array.isArray(database?.data_sources) ? database.data_sources : []).map(source => source?.id).filter(Boolean),
    };
  });
  unresolved.forEach(book => { state.dataSourceIdsByBook[book.id] = []; });
  discovered.forEach(entry => { state.dataSourceIdsByBook[entry.bookId] = entry.ids; });

  const dataSources = batch.flatMap(book => (state.dataSourceIdsByBook[book.id] || [])
    .map(dataSourceId => ({ book, dataSourceId })));
  const notePages = (await mapInBatches(dataSources, async entry => {
    const pages = await queryDataSource(config, entry.dataSourceId);
    return pages.map(page => ({ book: entry.book, page }));
  })).flat();
  const scanned = (await mapInBatches(notePages, async entry => ({
    bookId:entry.book.id,
    quote:normalizeNestedQuotePage(entry.page, entry.book.id, await listBlockChildren(config, entry.page.id)),
  }))).filter(entry => entry.quote);
  batch.forEach(book => { state.quotesByBook[book.id] = []; });
  scanned.forEach(entry => { state.quotesByBook[entry.bookId].push(entry.quote); });

  const nextIndex = start + batch.length;
  state.nextIndex = nextIndex >= books.length ? 0 : nextIndex;
  if (state.nextIndex === 0) state.completedAt = Date.now();
  await kvPut(env, NESTED_QUOTES_CACHE_KEY, state);
  return books.flatMap(book => state.quotesByBook[book.id] || []);
}

export function mergeReadingQuotes(structured, nested) {
  const migrated = new Set(structured.map(quote => quote.sourceBlockId).filter(Boolean));
  const seen = new Set();
  return [...structured, ...nested.filter(quote => !migrated.has(quote.sourceBlockId))]
    .filter(quote => {
      const key = `${quote.bookId}\u0000${String(quote.text || "").trim().replace(/\s+/g, " ")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

function sortBooks(books) {
  return books.sort((a, b) => {
    const aDate = a.endDate || a.startDate || a.created || "";
    const bDate = b.endDate || b.startDate || b.created || "";
    return String(bDate).localeCompare(String(aDate));
  });
}

async function fetchReadingLibrary(env, fresh) {
  const config = notionReadingConfig(env);
  const [bookPages, quotePages] = await Promise.all([
    queryDataSource(config, config.booksDataSourceId),
    queryDataSource(config, config.quotesDataSourceId),
  ]);
  const { byId: yearsById } = await loadYears(config, bookPages);
  const books = sortBooks(bookPages.map(page => normalizeReadingBookPage(page, yearsById)).filter(book => book.id));
  const structured = quotePages.map(normalizeStructuredQuotePage).filter(Boolean);
  const nested = await loadNestedQuotes(env, config, books, fresh);
  const bookLines = books.map(normalizeBookOneLine).filter(Boolean);
  const data = { books, quotes: mergeReadingQuotes(structured, [...nested, ...bookLines]), fetchedAt: new Date().toISOString() };
  await kvPut(env, LIBRARY_CACHE_KEY, { fetchedAt: Date.now(), data });
  return data;
}

export async function loadReadingLibrary(env, options = {}) {
  const fresh = options?.fresh === true;
  const cached = await kvGet(env, LIBRARY_CACHE_KEY);
  if (!fresh && cached?.fetchedAt && Date.now() - cached.fetchedAt < LIBRARY_CACHE_MS && cached?.data) return cached.data;
  if (!fresh && libraryInFlight) return libraryInFlight;
  const pending = fetchReadingLibrary(env, fresh).finally(() => {
    if (libraryInFlight === pending) libraryInFlight = null;
  });
  if (!fresh) libraryInFlight = pending;
  return pending;
}

export async function invalidateReadingLibrary(env, options = {}) {
  libraryInFlight = null;
  await kvDelete(env, LIBRARY_CACHE_KEY);
  if (options?.nested === true) await kvDelete(env, NESTED_QUOTES_CACHE_KEY);
}

async function findOrCreateYear(config, year) {
  const label = String(Math.floor(Number(year) || 0));
  if (!/^\d{4}$/.test(label)) return null;
  try {
    const found = await queryDataSource(config, config.yearsDataSourceId, {
      property: "이름",
      title: { equals: label },
    });
    if (found[0]?.id) return found[0].id;
    const page = await notionRequest(config, "/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: config.yearsDataSourceId },
        properties: { "이름": titleProperty(label) },
      }),
    });
    return page?.id || null;
  } catch (error) {
    if (!isMissingDataSource(error)) throw error;
    const bookPages = await queryDataSource(config, config.booksDataSourceId);
    const years = await loadYears(config, bookPages);
    return years.byYear.get(label) || null;
  }
}

function statusProperty(statuses) {
  return { type: "multi_select", multi_select: statuses.map(name => ({ name })) };
}

function relationProperty(ids) {
  return { type: "relation", relation: ids.filter(Boolean).map(id => ({ id })) };
}

function selectProperty(name) {
  return { type: "select", select: name ? { name } : null };
}

function numberProperty(value) {
  const number = numberValue(value);
  return { type: "number", number };
}

function starLabel(value) {
  const number = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
  return number ? "★".repeat(number) : "";
}

export async function createReadingBook(env, input) {
  const config = notionReadingConfig(env);
  const title = textValue(input?.title, 200);
  if (!title) throw new Error("책 제목이 필요합니다.");
  const status = STATUS_TO_NOTION[input?.status] || STATUS_TO_NOTION.wishlist;
  const yearId = await findOrCreateYear(config, input?.year);
  const properties = {
    "제목": titleProperty(title),
    "저자": richTextProperty(input?.author),
    "출판사": richTextProperty(input?.publisher),
    "상태": statusProperty([status]),
  };
  if (yearId) properties["연도"] = relationProperty([yearId]);
  const cover = textValue(input?.cover, 2000);
  if (/^https:\/\//i.test(cover)) {
    properties.cover = { type: "files", files: [{ name: "cover", type: "external", external: { url: cover } }] };
  }
  const page = await notionRequest(config, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: config.booksDataSourceId },
      properties,
      template: { type: "default", timezone: "Asia/Seoul" },
    }),
  });
  await invalidateReadingLibrary(env);
  const years = new Map(yearId ? [[yearId, String(input?.year || "")]] : []);
  return normalizeReadingBookPage(page, years);
}

function nextStatuses(current, status) {
  const kept = current.filter(name => KEEP_STATUSES.has(name));
  const mapped = STATUS_TO_NOTION[status];
  if (mapped === "소장" && !kept.includes("소장")) kept.push("소장");
  else if (mapped) kept.push(mapped);
  return [...new Set(kept.filter(name => !LIFE_CYCLE_STATUSES.has(name) || name === mapped))];
}

export async function updateReadingBook(env, id, patch) {
  const config = notionReadingConfig(env);
  const pageId = textValue(id, 80);
  if (!pageId) throw new Error("책 ID가 필요합니다.");
  const properties = {};
  if (Object.hasOwn(patch || {}, "status")) {
    const current = await notionRequest(config, `/pages/${encodeURIComponent(pageId)}`);
    properties["상태"] = statusProperty(nextStatuses(propertyNames(current?.properties?.["상태"]), patch.status));
  }
  if (Object.hasOwn(patch || {}, "title")) properties["제목"] = titleProperty(textValue(patch.title, 200) || "제목 없음");
  if (Object.hasOwn(patch || {}, "author")) properties["저자"] = richTextProperty(patch.author);
  if (Object.hasOwn(patch || {}, "publisher")) properties["출판사"] = richTextProperty(patch.publisher);
  if (Object.hasOwn(patch || {}, "one")) properties["이 책의 한 줄"] = richTextProperty(patch.one);
  if (Object.hasOwn(patch || {}, "learned")) properties["나의 생각 한줄"] = richTextProperty(patch.learned);
  if (Object.hasOwn(patch || {}, "applying")) properties["적용할 것"] = richTextProperty(patch.applying);
  if (Object.hasOwn(patch || {}, "dropReason")) properties["중도포기 이유"] = richTextProperty(patch.dropReason);
  if (Object.hasOwn(patch || {}, "star")) properties["별점"] = selectProperty(starLabel(patch.star));
  if (Object.hasOwn(patch || {}, "pageRead")) properties["page read"] = numberProperty(patch.pageRead);
  if (!Object.keys(properties).length) return { id: pageId };
  const page = await notionRequest(config, `/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
  await invalidateReadingLibrary(env);
  return { id: page?.id || pageId };
}

async function findQuoteByClientId(config, clientId) {
  if (!clientId) return null;
  const pages = await queryDataSource(config, config.quotesDataSourceId, {
    property: "클라이언트 ID",
    rich_text: { equals: clientId },
  });
  return pages[0] || null;
}

async function createStructuredQuote(config, quote) {
  const clientId = textValue(quote?.clientId || quote?.id || crypto.randomUUID(), 160);
  const existing = await findQuoteByClientId(config, clientId);
  if (existing) return { page: existing, created: false };
  const text = textValue(quote?.text, 4000, false).trim();
  const bookId = textValue(quote?.bookId, 80);
  if (!text || !bookId) throw new Error("책과 문장이 필요합니다.");
  const created = validDate(quote?.created) || new Date().toISOString();
  const page = await notionRequest(config, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: config.quotesDataSourceId },
      properties: {
        "이름": titleProperty(text.slice(0, 120)),
        "문장": richTextProperty(text),
        "책": relationProperty([bookId]),
        "페이지": richTextProperty(quote?.page),
        "반응": richTextProperty(quote?.note),
        "생각": richTextProperty(quote?.thought),
        "기록일": { type: "date", date: { start: created } },
        "클라이언트 ID": richTextProperty(clientId),
        "원본 블록 ID": richTextProperty(quote?.sourceBlockId),
      },
    }),
  });
  return { page, created: true };
}

export async function createReadingQuotes(env, input) {
  const config = notionReadingConfig(env);
  const bookId = textValue(input?.bookId, 80);
  const source = Array.isArray(input?.quotes) ? input.quotes.slice(0, 30) : [];
  if (!bookId || !source.length) throw new Error("저장할 문장이 필요합니다.");
  const saved = [];
  let createdCount = 0;
  for (const value of source) {
    const result = await createStructuredQuote(config, { ...value, bookId });
    const normalized = normalizeStructuredQuotePage(result.page);
    if (normalized) saved.push(normalized);
    if (result.created) createdCount += 1;
  }
  const pageRead = numberValue(input?.pageRead);
  if (pageRead !== null) await updateReadingBook(env, bookId, { pageRead });
  await invalidateReadingLibrary(env);
  return { quotes: saved, createdCount };
}

export async function updateReadingQuote(env, id, patch, original = {}) {
  const config = notionReadingConfig(env);
  const quoteId = textValue(id, 180);
  if (!quoteId) throw new Error("문장 ID가 필요합니다.");
  if (quoteId.startsWith("legacy:")) {
    const sourceBlockId = quoteId.slice("legacy:".length);
    const result = await createStructuredQuote(config, {
      ...original,
      ...patch,
      clientId: quoteId,
      sourceBlockId,
    });
    await invalidateReadingLibrary(env);
    return normalizeStructuredQuotePage(result.page);
  }
  const properties = {};
  if (Object.hasOwn(patch || {}, "thought")) properties["생각"] = richTextProperty(patch.thought);
  if (Object.hasOwn(patch || {}, "note")) properties["반응"] = richTextProperty(patch.note);
  if (Object.hasOwn(patch || {}, "page")) properties["페이지"] = richTextProperty(patch.page);
  if (Object.hasOwn(patch || {}, "text")) {
    properties["문장"] = richTextProperty(patch.text);
    properties["이름"] = titleProperty(textValue(patch.text, 120));
  }
  const page = await notionRequest(config, `/pages/${encodeURIComponent(quoteId)}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
  await invalidateReadingLibrary(env);
  return normalizeStructuredQuotePage(page);
}

export async function deleteReadingQuote(env, id, original = {}) {
  const config = notionReadingConfig(env);
  const quoteId = textValue(id, 180);
  const sourceBlockId = textValue(original?.sourceBlockId, 100);
  if (quoteId.startsWith("legacy:")) {
    const blockId = quoteId.slice("legacy:".length);
    await notionRequest(config, `/blocks/${encodeURIComponent(blockId)}`, {
      method: "PATCH",
      body: JSON.stringify({ in_trash: true }),
    });
    await invalidateReadingLibrary(env);
    return;
  }
  await notionRequest(config, `/pages/${encodeURIComponent(quoteId)}`, {
    method: "PATCH",
    body: JSON.stringify({ in_trash: true }),
  });
  if (sourceBlockId) {
    await notionRequest(config, `/blocks/${encodeURIComponent(sourceBlockId)}`, {
      method: "PATCH",
      body: JSON.stringify({ in_trash: true }),
    });
  }
  await invalidateReadingLibrary(env);
}

export function readingDateKey(value) {
  return localDateKey(value);
}
