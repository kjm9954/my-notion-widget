// Traverse only descendants physically owned by a Library book, never page links.
// Serialized frames fit the existing encrypted continuation / request budget.
import { runMeetingIndex, allowed, corsHeaders, json, requestContinuation } from './meeting-production.mjs';

const VERSION = 'reading-tree-v1';
const MAX_NODES = 5000, MAX_DEPTH = 64, MAX_TEXT = 1000000;
const key = value => String(value || '').replaceAll('-', '').toLowerCase();
const sameId = (a, b) => Boolean(a && b) && key(a) === key(b);
const removed = item => item?.archived || item?.in_trash || item?.is_archived;
const rich = items => Array.isArray(items) ? items.map(v => v.plain_text ?? v.text?.content ?? '').join('') : '';
const clean = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
const fail = message => Object.assign(new Error(message), { publicMessage: message });
const title = page => clean(rich(Object.values(page.properties || {}).find(p => p?.type === 'title')?.title));

function frame(kind, id, extra = {}) { return { kind, id, depth: 0, cursor: null, items: null, offset: 0, next: null, ...extra }; }
function enter(work, next) {
  if (next.depth > MAX_DEPTH) throw fail('reading tree depth limit');
  const id = `${next.kind}:${key(next.id)}`;
  if (work.seen.includes(id)) return;
  if (work.seen.length >= MAX_NODES) throw fail('reading tree size limit');
  work.seen.push(id); work.stack.push(next);
}
function appendText(work, node, text) {
  const line = clean(text);
  if (!line) return;
  work.chars += line.length;
  if (work.chars > MAX_TEXT) throw fail('reading book text limit');
  node.lines.push(line);
}
function setItems(current, payload, map) {
  if (!Array.isArray(payload?.results) || (payload.has_more && !payload.next_cursor)) throw fail('invalid notion response');
  current.items = payload.results.filter(item => !removed(item)).map(map); current.offset = 0;
  current.next = payload.has_more ? payload.next_cursor : null;
}
function advance(work, current) {
  if (current.offset < current.items.length) return false;
  if (current.next) { current.cursor = current.next; current.items = null; }
  else work.stack.pop();
  return true;
}
function childrenPath(id, cursor) {
  const query = new URLSearchParams({ page_size: '100' }); if (cursor) query.set('start_cursor', cursor);
  return `/blocks/${encodeURIComponent(id)}/children?${query}`;
}
function sourceQuery(current) {
  return { method: 'POST', body: JSON.stringify({ page_size: 100, ...(current.cursor ? { start_cursor: current.cursor } : {}) }) };
}
function compactPage(page) {
  return { id: page.id, title: title(page), last_edited_time: page.last_edited_time, parent: page.parent, archived: removed(page) };
}
function compactBlock(block) {
  const value = block[block.type] || {};
  return { id: block.id, type: block.type, children: block.has_children,
    text: rich(value.rich_text) || (block.type === 'table_row' ? (value.cells || []).map(rich).join(' ') : '') || value.expression || '',
    title: value.title || '', syncedFrom: value.synced_from || null };
}

async function readPage(notion, work, current) {
  if (!current.meta) current.meta = compactPage(await notion.request(`/pages/${encodeURIComponent(current.id)}`));
  const meta = current.meta;
  const owned = current.root || (current.source ? sameId(meta.parent?.data_source_id, current.source)
    : sameId(meta.parent?.page_id, current.parent) || sameId(meta.parent?.block_id, current.container));
  if (meta.archived || !owned) { work.unavailable++; work.stack.pop(); return; }
  const nodeId = key(current.id);
  if (!current.prepared) {
    const old = work.oldNodes[nodeId], edited = String(meta.last_edited_time || '');
    if (old && edited && old.edited === edited) {
      work.nodes[nodeId] = { ...old, title: meta.title };
      work.chars += old.lines.join('\n').length;
      if (work.chars > MAX_TEXT) throw fail('reading book text limit');
    } else {
      work.nodes[nodeId] = { edited, title: meta.title, lines: [], refs: [] };
      current.prepared = true;
      enter(work, frame('blocks', current.id, { owner: current.id, depth: current.depth + 1 }));
      return;
    }
    current.prepared = true;
  }
  const node = work.nodes[nodeId];
  const ref = node.refs[current.offset++];
  if (!ref) { work.stack.pop(); return; }
  enter(work, frame(ref.kind, ref.id, { parent: current.id, container: ref.container, depth: current.depth + 1 }));
}

async function readBlocks(notion, work, current) {
  if (!current.items) setItems(current, await notion.request(childrenPath(current.id, current.cursor)), compactBlock);
  if (advance(work, current)) return;
  const block = current.items[current.offset++], node = work.nodes[key(current.owner)];
  if (block.type === 'link_to_page' || (block.type === 'synced_block' && block.syncedFrom)) return;
  if (block.type === 'child_page' || block.type === 'child_database') {
    node.refs.push({ kind: block.type === 'child_page' ? 'page' : 'database', id: block.id, container: current.id });
    return;
  }
  appendText(work, node, block.text);
  if (block.children) enter(work, frame('blocks', block.id, { owner: current.owner, depth: current.depth + 1 }));
}

async function readDatabase(notion, work, current) {
  if (!current.items) {
    const db = await notion.request(`/databases/${encodeURIComponent(current.id)}`);
    if (removed(db) || !(sameId(db.parent?.page_id, current.parent) || sameId(db.parent?.block_id, current.container))) {
      work.unavailable++; work.stack.pop(); return;
    }
    if (!Array.isArray(db.data_sources)) throw fail('invalid notion database response');
    current.items = db.data_sources.map(ds => ({ id: ds.id })); work.databases++;
  }
  if (advance(work, current)) return;
  const ds = current.items[current.offset++];
  enter(work, frame('source', ds.id, { database: current.id, depth: current.depth + 1 }));
}

async function readSource(notion, work, current) {
  if (!current.verified) {
    const source = await notion.request(`/data_sources/${encodeURIComponent(current.id)}`);
    // A linked external data source is not a descendant of this book.
    if (removed(source) || !sameId(source.parent?.database_id, current.database)) {
      work.unavailable++; work.stack.pop(); return;
    }
    current.verified = true;
  }
  if (!current.items) setItems(current, await notion.request(`/data_sources/${encodeURIComponent(current.id)}/query`, sourceQuery(current)), compactPage);
  if (advance(work, current)) return;
  const meta = current.items[current.offset++];
  enter(work, frame('page', meta.id, { meta, source: current.id, depth: current.depth + 1 }));
}

export const readingTree = {
  version: VERSION,
  prepare(meta, old) {
    // Check descendants each cycle even when the root's edited time is unchanged.
    return { ...meta, summary: '', lead: old?.lead || '', body: old?.body || '', edited: null, readingTree: old?.readingTree || null };
  },
  async read(notion, work, page) {
    if (!work.treeVersion) {
      Object.assign(work, { treeVersion: VERSION, stack: [], seen: [], nodes: {}, chars: 0, databases: 0, unavailable: 0,
        oldNodes: page.readingTree?.version === VERSION ? page.readingTree.nodes : {} });
      enter(work, frame('page', page.id, { root: true, meta: { id: page.id, title: page.title, last_edited_time: page.lastEdited } }));
    }
    while (work.stack.length) {
      const current = work.stack.at(-1);
      try {
        await ({ page: readPage, blocks: readBlocks, database: readDatabase, source: readSource })[current.kind](notion, work, current);
      } catch (error) {
        if (![403, 404].includes(error?.status)) throw error;
        // Do not keep the old text of a descendant that is deleted or inaccessible.
        work.unavailable++;
        if (current.kind === 'page') delete work.nodes[key(current.id)];
        else if (current.kind === 'blocks') {
          const node = work.nodes[key(current.owner)];
          if (node) { node.lines = []; node.refs = []; node.edited = ''; }
          while (work.stack.length && work.stack.at(-1).kind === 'blocks') work.stack.pop();
          continue;
        }
        work.stack.pop();
      }
    }
  },
  finish(work) {
    const all = Object.values(work.nodes), lines = all.flatMap(node => [node.title, ...node.lines]).filter(Boolean);
    return { body: lines.join('\n'), summary: '', lead: all[0]?.lines[0]?.slice(0, 90) || '',
      readingTree: { version: VERSION, nodes: work.nodes, pages: all.length, databases: work.databases, unavailable: work.unavailable } };
  },
  same(page, old) { return JSON.stringify(page.readingTree) === JSON.stringify(old.readingTree); },
};

const CHECKPOINT = 'index:reading:checkpoint:v1';
export async function runReadingTree(env, continuation = null) {
  // A cold Worker can resume a large subtree too. Only the encrypted token is
  // checkpointed; the public search index remains intact until all books finish.
  const saved = continuation ? null : await env.SEARCH_INDEX.get(CHECKPOINT);
  let result;
  try { result = await runMeetingIndex(env, continuation || saved || null, readingTree); }
  catch (error) {
    if (!continuation && saved && [400, 409].includes(error?.responseStatus)) result = await runMeetingIndex(env, null, readingTree);
    else throw error;
  }
  if (result.continuation || (result.pending === 0 && (continuation || saved))) {
    try { await env.SEARCH_INDEX.put(CHECKPOINT, result.continuation || '', { expirationTtl: result.continuation ? 86400 : 60 }); }
    catch { console.error('reading index checkpoint storage unavailable'); result.checkpointSaved = false; }
  }
  return result;
}
export async function readingReindex(request, env) {
  const cors = corsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ ok: false, error: 'not found' }, 404, cors);
  if (!allowed(new URL(request.url), env)) return json({ ok: false, error: 'forbidden' }, 403, cors);
  try { return json({ ok: true, ...await runReadingTree(env, await requestContinuation(request)) }, 200, cors); }
  catch (error) {
    console.error('reading index', error?.status || '', error?.publicMessage || 'server error');
    return json({ ok: false, error: error?.publicMessage || 'server error', ...error?.details }, error?.responseStatus || 502, cors);
  }
}
