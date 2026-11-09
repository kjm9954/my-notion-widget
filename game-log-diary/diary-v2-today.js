import { $, esc, moodButtons, photoSource, connect, watch, installDialogs, EntryEditor, conflictMarkup, clipboardImages } from './diary-v2-common.js?v=20261109-paste';
const D = window.DiaryV1;
if (connect(D, 'diary-v2-today.html')) {
  let lastPhotos = '', lastMood, returnFocus;
  const editor = new EntryEditor(D, render, conflict => {
    $('conflict-body').innerHTML = conflictMarkup(conflict); open('conflict');
  });
  function open(id) { returnFocus = document.activeElement; $(id).hidden = false; $(id).querySelector('textarea,button')?.focus(); }
  function close() {
    if (editor.busy) return;
    if (!$('conflict').hidden) $('conflict').hidden = true;
    else document.querySelectorAll('.layer').forEach(el => { el.hidden = true; });
    render(); returnFocus?.focus();
  }
  function preview() {
    const input = $('writing');
    input.hidden = false; $('preview').hidden = true;
    if (editor.value.text && document.activeElement !== input && input.scrollHeight > input.clientHeight + 2) {
      $('preview-copy').textContent = editor.value.text; input.hidden = true; $('preview').hidden = false;
    }
  }
  function renderSlots() {
    $('slots').innerHTML = Array.from({ length: 4 }, (_, i) => editor.value.photos[i]
      ? `<div class="slot"><img src="${esc(photoSource(editor.value.photos[i]))}" alt="첨부 사진 ${i + 1}"><button class="remove" data-remove="${i}" type="button" aria-label="사진 ${i + 1} 빼기">✕</button></div>`
      : '<div class="slot"><button class="pick" data-pick type="button">+ 사진 고르기</button></div>').join('');
  }
  function render() {
    const v = editor.value, locked = editor.busy || editor.loading;
    $('date').textContent = editor.date ? D.formatDate(editor.date) : '';
    $('today').hidden = editor.date === D.seoulDateKey();
    $('caption').textContent = `${editor.date === D.seoulDateKey() ? '오늘의' : '그날의'} 기분 · 선택`;
    if (lastMood !== v.mood) { $('moods').innerHTML = moodButtons(v.mood); lastMood = v.mood; }
    for (const id of ['writing', 'long']) if ($(id).value !== v.text) $(id).value = v.text;
    const photos = JSON.stringify(v.photos.map(p => [p.id, photoSource(p)]));
    if (photos !== lastPhotos) {
      lastPhotos = photos;
      $('content').classList.toggle('no-photos', !v.photos.length); $('photos').hidden = !v.photos.length;
      $('photos').style.setProperty('--cols', v.photos.length > 1 ? 2 : 1);
      $('photos').innerHTML = v.photos.map((p, i) => `<div class="photo"><button type="button" data-view="${i}" aria-label="사진 ${i + 1} 크게 보기"><img src="${esc(photoSource(p))}" alt="첨부 사진 ${i + 1}"></button></div>`).join('');
      renderSlots();
    }
    $('add').textContent = v.photos.length ? `사진 ${v.photos.length}/4` : '+ 사진 추가';
    $('char-count').textContent = `${v.text.length} / 2000`;
    $('status').textContent = editor.status; $('status').title = editor.status;
    document.querySelectorAll('[data-editor-status]').forEach(el => { el.textContent = editor.status; });
    document.querySelectorAll('button,textarea,input').forEach(el => { el.disabled = locked; });
    $('next').disabled = locked || editor.date >= D.seoulDateKey();
    $('save').disabled = $('long-save').disabled = !editor.canSave();
    $('root').setAttribute('aria-busy', String(locked)); preview();
  }
  async function navigate(date) {
    if (editor.busy || !D.validDateKey(date) || date > D.seoulDateKey()) return;
    if (!editor.persist()) { render(); return; }
    close(); await editor.load(date);
  }
  async function save() { if (await editor.save()) close(); }
  function openLong() { $('long').value = editor.value.text; open('long-layer'); $('long').focus(); }
  $('form').addEventListener('submit', e => { e.preventDefault(); void save(); });
  $('long-save').addEventListener('click', () => void save());
  $('moods').addEventListener('click', e => { const b = e.target.closest('[data-mood]'); if (b) editor.edit({ mood: editor.value.mood === b.dataset.mood ? null : b.dataset.mood }); });
  for (const id of ['writing', 'long']) $(id).addEventListener('input', e => editor.edit({ text: e.target.value }));
  $('writing').addEventListener('blur', preview);
  $('preview').addEventListener('click', openLong); $('long-open').addEventListener('click', openLong);
  $('add').addEventListener('click', () => { renderSlots(); open('add-layer'); });
  $('slots').addEventListener('click', e => {
    const remove = e.target.closest('[data-remove]');
    if (remove) { const photos = [...editor.value.photos]; photos.splice(Number(remove.dataset.remove), 1); editor.edit({ photos }); }
    else if (e.target.closest('[data-pick]')) $('file').click();
  });
  $('file').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; void editor.addFiles(files); });
  $('photos').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) { $('view-img').src = photoSource(editor.value.photos[Number(b.dataset.view)]); open('view-layer'); } });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  $('prev').addEventListener('click', () => void navigate(D.shiftDate(editor.date, -1)));
  $('next').addEventListener('click', () => void navigate(D.shiftDate(editor.date, 1)));
  $('today').addEventListener('click', () => void navigate(D.seoulDateKey()));
  $('use-latest').addEventListener('click', () => { editor.resolve(false); close(); });
  $('use-draft').addEventListener('click', () => { editor.resolve(true); close(); });
  let depth = 0;
  $('root').addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); depth++; $('root').classList.add('is-dragging'); } });
  $('root').addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  $('root').addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('root').classList.remove('is-dragging'); } });
  $('root').addEventListener('drop', e => { e.preventDefault(); depth = 0; $('root').classList.remove('is-dragging'); void editor.addFiles(e.dataTransfer.files); });
  document.addEventListener('paste', e => {
    if (!$('conflict').hidden || editor.busy || editor.loading) return;
    const files = clipboardImages(e.clipboardData);
    if (files.length) { e.preventDefault(); void editor.addFiles(files); }
  });
  window.addEventListener('beforeunload', e => { if (editor.dirty || editor.busy) { editor.persist(); e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('resize', preview);
  installDialogs(close); watch(D, () => editor.refresh(), () => editor.persist());
  const requested = new URLSearchParams(location.search).get('date');
  await editor.load(D.validDateKey(requested) && requested <= D.seoulDateKey() ? requested : D.seoulDateKey());
}
