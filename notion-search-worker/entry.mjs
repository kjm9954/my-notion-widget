// Preserve the existing deployed meeting/desktop APIs byte-for-byte; route only
// the explicitly requested reading source to the new index implementation.
import meetings, { runMeetingIndex } from './meeting-production.mjs';
import reading from './worker.js';
import { runReadingTree, readingReindex } from './reading-tree.mjs';

const readingNamespaces = new WeakMap();
const readingAccess = env => ({ ...env, ALLOWED_W: env.READING_ALLOWED_W || env.ALLOWED_W });
function readingEnv(env, budget = env.MAX_NOTION_REQUESTS) {
  let kv = readingNamespaces.get(env.SEARCH_INDEX);
  if (!kv) {
    const key = value => value === 'index:v1' ? 'index:reading:v1' : value;
    kv = { get: (name, options) => env.SEARCH_INDEX.get(key(name), options), put: (name, value, options) => env.SEARCH_INDEX.put(key(name), value, options) };
    readingNamespaces.set(env.SEARCH_INDEX, kv);
  }
  return { ...readingAccess(env), SEARCH_INDEX: kv, NOTION_DATA_SOURCE_ID: env.NOTION_READING_DATA_SOURCE_ID, MAX_NOTION_REQUESTS: budget };
}

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.searchParams.get('source') === 'reading') {
      if (url.pathname === '/search') return reading.fetch(request, readingAccess(env), ctx);
      if (url.pathname === '/reindex') return readingReindex(request, readingEnv(env));
    }
    return meetings.fetch(request, env, ctx);
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const result = await runMeetingIndex(env);
      const budget = Number(env.MAX_NOTION_REQUESTS) > 0 ? Math.floor(Number(env.MAX_NOTION_REQUESTS)) : 45;
      const remaining = Math.max(0, budget - (Number(result.requests) || 0));
      // Reserve three subrequests for reading checkpoint/index KV operations.
      if (!env.NOTION_READING_DATA_SOURCE_ID || remaining <= 3) return;
      // Respect Notion's request spacing when switching between the two clients.
      const delay = Math.max(0, Number(env.NOTION_MIN_INTERVAL_MS ?? 350) || 0);
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      await runReadingTree(readingEnv(env, remaining - 3));
    })().catch(error => {
      console.error('notion-search cron', error?.status || '', error?.publicMessage || 'server error');
    }));
  },
};
