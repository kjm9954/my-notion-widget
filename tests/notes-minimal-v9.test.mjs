import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../cream-olive-garden/Worklog/notes.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../cream-olive-garden/notes-theme.css', import.meta.url), 'utf8');

test('v9 notes keeps the Store, instance path and editing safeguards', () => {
  assert.match(html, /src="\.\.\/\.\.\/store\.js\?v=20260930-size-sync" data-store-isolated data-store-coalesce/);
  for (const feature of ['Store.loadNotesState()', 'Store.patchNotesState(pendingWrites[0])', 'saveQueue.then(', 'Store.watch(syncFromServer', 'event.isComposing', 'event.keyCode === 229', 'localRevision', 'pendingSync', 'notesArea.inert']) {
    assert.ok(html.includes(feature), feature);
  }
  assert.doesNotMatch(html, /localStorage|previewState|sample-handoff/);
});

test('v9 notes isolates the size key and keeps resize handles with a 270px default', () => {
  assert.match(html, /data-widget-key="widget-size-cream-olive-notes-v9"/);
  assert.match(html, /data-widget-max-width="340"/);
  assert.match(html, /data-widget-height="270"/);
  assert.match(html, /data-widget-list-height="224"/);
  for (const handle of ['data-widget-list-handle', 'data-widget-scale-handle', 'data-widget-size-label']) assert.ok(html.includes(handle));
  assert.match(html, /src="\.\.\/\.\.\/widget-frame\.js\?v=20260930-mobile-layout"/);
  assert.match(css, /\.notes-size-frame \{ height:270px; padding:6px; \}/);
});

test('v9 notes uses the supplied palette, separators and scoped wrapping styles', () => {
  for (const color of ['#faf7ef', '#f4f1e7', '#424a36', '#747963', '#6b7b49', '#e2dece', '#e5e1d5']) assert.ok(css.includes(color), color);
  assert.match(css, /border-bottom:1px solid var\(--memo-line\)/);
  assert.match(css, /white-space:normal; word-break:keep-all; overflow-wrap:anywhere/);
  assert.match(css, /overflow-y:auto/);
  assert.match(css, /#notes-roof-v8 \.memo-input/);
});

test('v9 notes removes decorative markup, sprite styles and decorative script', () => {
  assert.doesNotMatch(html, /notes-motion\.js|class="notes-roof"|notes-perch|notes-atmosphere|<img\b|<canvas\b/);
  assert.doesNotMatch(css, /memo-sprites|roof-birds|memo-leaf|memo-bird|fall-distance|padding:50px/);
});
