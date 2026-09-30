// Opt-in six-widget size sync. Network only on entry/return or a finished resize.
(() => {
  'use strict';
  const host = document.querySelector('[data-widget-sync]');
  const store = window.Store;
  const instance = store?.getWidgetInstanceId();
  if (!host || !instance || !store.loadWidgetLayouts) return;
  const widget = host.dataset.widgetSync;
  const key = `${host.dataset.widgetKey}:${instance}`;
  const dirtyKey = `${key}:unsaved`;
  const read = name => { try { return JSON.parse(localStorage.getItem(name)); } catch { return null; } };
  let dirty = Boolean(read(dirtyKey));
  let pending = null, saving = false, checking = false, generation = 0, timer = 0;
  const status = document.createElement('p');
  status.className = 'widget-layout-status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  host.appendChild(status);
  function report(state) {
    host.dataset.widgetSyncState = state;
    status.textContent = state === 'unsaved' ? '크기는 이 기기에만 저장됐어요. 연결 후 손잡이를 다시 조절하면 공유됩니다.'
      : state === 'error' ? '공유 크기를 불러오지 못했어요. 이 기기의 크기를 유지합니다.' : '';
    status.hidden = !status.textContent;
  }
  function restore(data) {
    if (dirty || document.body.matches('.is-widget-scaling, .is-widget-list-resizing')) return;
    const entry = data?.layouts?.[widget];
    if (!entry?.size || typeof entry.size !== 'object') return;
    try { localStorage.setItem(key, JSON.stringify(entry.size)); } catch { /* In-memory frame restore still works. */ }
    window.dispatchEvent(new CustomEvent('widgetlayoutrestore', {detail:{key,size:entry.size}}));
  }
  async function check() {
    if (checking || document.hidden) return;
    checking = true;
    try { restore(await store.loadWidgetLayouts()); report(dirty ? 'unsaved' : 'ready'); }
    catch (error) { if (error.cachedData) restore(error.cachedData); report(dirty ? 'unsaved' : 'error'); }
    finally { checking = false; }
  }
  async function flush(keepalive = false) {
    clearTimeout(timer);
    if (saving || !pending) return;
    const size = pending, current = generation;
    pending = null; saving = true;
    report('saving');
    try {
      await store.saveWidgetLayout(widget, size, {keepalive});
      if (generation === current) {
        dirty = false;
        try { localStorage.removeItem(dirtyKey); } catch {}
        report('ready');
      }
    } catch { report('unsaved'); }
    finally {
      saving = false;
      // Only a newer explicit resize is queued, never an automatic failed retry.
      if (pending) timer = setTimeout(flush, 500);
    }
  }
  window.addEventListener('widgetsizechange', event => {
    if (event.detail?.key !== key) return;
    pending = event.detail.size;
    dirty = true; generation++;
    try { localStorage.setItem(dirtyKey, 'true'); } catch {}
    report('saving');
    clearTimeout(timer);
    timer = setTimeout(flush, 500);
  });
  store.subscribeWidgetLayouts(async () => {
    // Broadcast notifications read the already committed browser cache, no GET.
    try {
      if (!saving && !pending && !read(dirtyKey)) dirty = false;
      restore(await store.cachedWidgetLayouts());
    } catch {}
  });
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', check);
  window.addEventListener('online', check);
  window.addEventListener('pagehide', () => { if (pending) void flush(true); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); });
  report(dirty ? 'unsaved' : 'loading');
  void check();
})();
