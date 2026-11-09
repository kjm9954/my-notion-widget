import { $, esc, MOODS, moodButtons, photoSource, connect, watch, installDialogs, EntryEditor, conflictMarkup, monthLabel, shiftMonth, initialMonth, message, clipboardImages } from './diary-v2-common.js?v=20261109-paste';
const D = window.DiaryV1;
if (connect(D, 'diary-v2-calendar.html')) {
  let month = initialMonth(D), entries = new Map(), token = 0, selected = '', detailEntry = null, opening = 0, deleting = false, loading = false;
  const editor = new EntryEditor(D, renderEditor, conflict => { $('conflict-body').innerHTML = conflictMarkup(conflict); $('conflict').hidden = false; $('conflict').querySelector('button').focus(); });
  function renderEditor() {
    if ($('quick-text').value !== editor.value.text) $('quick-text').value = editor.value.text;
    const rendered = $('quick-moods').dataset.value;
    if (rendered !== String(editor.value.mood)) { $('quick-moods').innerHTML = moodButtons(editor.value.mood); $('quick-moods').dataset.value = String(editor.value.mood); }
    $('quick-count').textContent = `${editor.value.text.length} / 2000`;
    $('quick-status').textContent = editor.status;
    const photos = JSON.stringify(editor.value.photos.map(p => [p.id, photoSource(p)]));
    if ($('quick-photos').dataset.photos !== photos) {
      $('quick-photos').dataset.photos = photos;
      $('quick-photos').innerHTML = editor.value.photos.map((p, i) => `<div class="photo"><img src="${esc(photoSource(p))}" alt="첨부 사진 ${i + 1}"><button class="remove" data-remove="${i}" type="button" aria-label="사진 ${i + 1} 빼기">✕</button></div>`).join('');
    }
    const locked = editor.busy || editor.loading;
    document.querySelectorAll('#quick button,#quick textarea,#conflict button').forEach(el => { el.disabled = locked; });
    $('quick-save').disabled = !editor.canSave();
  }
  function grid() {
    const [y, m] = month.split('-').map(Number), b = D.monthBounds(y, m - 1), today = D.seoulDateKey();
    $('month').textContent = monthLabel(month); $('next').disabled = month >= today.slice(0, 7);
    $('grid').style.gridTemplateRows = `repeat(${b.cells / 7},minmax(0,1fr))`;
    $('grid').innerHTML = Array.from({ length: b.cells }, (_, i) => {
      const d = i - b.lead + 1;
      if (d < 1 || d > b.lastDay) return '<span class="blank" aria-hidden="true"></span>';
      const date = `${month}-${String(d).padStart(2, '0')}`, r = entries.get(date);
      return `<button class="day${r ? ' has-record' : ''}${date === today ? ' is-today' : ''}" type="button" data-date="${date}" aria-label="${esc(D.formatDate(date))}${r ? ', 기록 있음' : ''}" aria-pressed="${date === selected}"${date > today ? ' disabled' : ''}><span class="day-head"><span class="num">${d}</span>${MOODS[r?.mood] ? `<span class="day-mood ${r.mood}">${MOODS[r.mood]}</span>` : ''}</span>${r?.coverUrl ? `<img class="day-photo" src="${esc(r.coverUrl)}" alt="${esc(D.formatDate(date))} 대표 사진">` : r?.text ? `<span class="caption">${esc(r.text)}</span>` : ''}</button>`;
    }).join('');
    if (!loading) $('note').textContent = [...entries.keys()].some(k => k.startsWith(month)) ? '날짜를 누르면 기록을 보거나 남길 수 있어요.' : '빈 날짜를 눌러 그날을 남겨 보세요.';
  }
  async function loadMonth(next = month) {
    if (next > D.seoulDateKey().slice(0, 7)) return;
    const id = ++token;
    if (next !== month) { month = next; entries = new Map(); }
    loading = true; grid(); $('note').textContent = '불러오는 중…';
    const [y, m] = month.split('-').map(Number), b = D.monthBounds(y, m - 1);
    try { const rows = await D.loadRange(b.start, b.end); if (id !== token) return; entries = new Map(rows.map(e => [e.date, e])); loading = false; grid(); }
    catch (error) { if (id === token) { loading = false; $('note').textContent = message(error); } }
  }
  function close() {
    if (editor.busy || deleting) return;
    if (!$('conflict').hidden) { $('conflict').hidden = true; return; }
    if (!$('confirm').hidden) { $('confirm').hidden = true; $('delete').focus(); return; }
    if (!editor.persist()) { renderEditor(); return; }
    ++opening;
    document.querySelectorAll('.dim').forEach(el => { el.hidden = true; });
    const date = selected; selected = ''; grid(); document.querySelector(`[data-date="${date}"]`)?.focus();
  }
  function showDetail(entry) {
    detailEntry = entry; $('detail-title').textContent = D.formatDate(entry.date);
    $('detail-body').innerHTML = (entry.photos || []).map((p, i) => `<img class="detail-photo" src="${esc(photoSource(p))}" alt="${i + 1}번째 첨부 사진">`).join('')
      + (entry.text ? `<p class="detail-copy">${esc(entry.text)}</p>` : '') + (MOODS[entry.mood] ? `<p class="detail-mood">기분 · ${MOODS[entry.mood]}</p>` : '');
    $('detail').hidden = false; $('edit').focus();
  }
  async function quick(date) {
    $('detail').hidden = true; $('quick-title').textContent = D.formatDate(date); $('quick').hidden = false;
    await editor.load(date); if (!$('quick').hidden) $('quick-text').focus();
  }
  async function openDate(date) {
    if (date > D.seoulDateKey() || editor.busy || deleting) return;
    const id = ++opening; selected = date; grid(); $('note').textContent = '불러오는 중…';
    try {
      const entry = await D.loadEntry(date);
      if (id !== opening) return;
      grid();
      if (entry) showDetail(entry); else await quick(date);
    } catch (error) { if (id === opening) $('note').textContent = message(error); }
  }
  $('grid').addEventListener('click', e => { const day = e.target.closest('[data-date]'); if (day) void openDate(day.dataset.date); });
  $('edit').addEventListener('click', () => void quick(selected));
  $('delete').addEventListener('click', () => { $('delete-status').textContent = ''; $('confirm').hidden = false; $('confirm').querySelector('button').focus(); });
  $('quick-text').addEventListener('input', e => editor.edit({ text: e.target.value }));
  $('quick-photos').addEventListener('click', e => {
    const button = e.target.closest('[data-remove]');
    if (!button || editor.busy || editor.loading) return;
    const photos = [...editor.value.photos]; photos.splice(Number(button.dataset.remove), 1); editor.edit({ photos });
  });
  document.addEventListener('paste', e => {
    if ($('quick').hidden || !$('conflict').hidden || editor.busy || editor.loading) return;
    const files = clipboardImages(e.clipboardData);
    if (files.length) { e.preventDefault(); void editor.addFiles(files); }
  });
  $('quick-moods').addEventListener('click', e => { const b = e.target.closest('[data-mood]'); if (b) editor.edit({ mood: editor.value.mood === b.dataset.mood ? null : b.dataset.mood }); });
  $('quick-save').addEventListener('click', async () => {
    const saved = await editor.save();
    if (saved) { entries.set(saved.date, { ...saved, coverUrl: saved.photos[0]?.url, photoCount: saved.photos.length }); close(); await loadMonth(); }
  });
  $('confirm-delete').addEventListener('click', async () => {
    if (deleting || !detailEntry) return;
    deleting = true; $('delete-status').textContent = '삭제 중…';
    document.querySelectorAll('#confirm button').forEach(b => { b.disabled = true; });
    const date = detailEntry.date;
    try {
      await D.deleteEntry(date, detailEntry.revision);
      D.announce({ type: 'deleted', date }); entries.delete(date); detailEntry = null;
      $('confirm').hidden = true; $('detail').hidden = true; selected = ''; grid();
      await loadMonth();
    } catch (error) {
      $('delete-status').textContent = message(error);
      if (error.status === 409) {
        // Delete conflicts do not include `current` in v1; read it before another explicit confirmation.
        try {
          const latest = await D.loadEntry(date);
          $('confirm').hidden = true;
          if (latest) { showDetail(latest); $('detail-body').insertAdjacentHTML('afterbegin', '<p class="status">다른 기기에서 바뀐 최신 기록입니다. 확인한 뒤 다시 삭제해 주세요.</p>'); }
          else { $('detail').hidden = true; await loadMonth(); }
        } catch (readError) { $('delete-status').textContent = message(readError); }
      }
    } finally { deleting = false; document.querySelectorAll('#confirm button').forEach(b => { b.disabled = false; }); }
  });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  document.querySelectorAll('.dim').forEach(el => el.addEventListener('click', e => { if (e.target === el) close(); }));
  $('use-latest').addEventListener('click', () => { editor.resolve(false); $('conflict').hidden = true; });
  $('use-draft').addEventListener('click', () => { editor.resolve(true); $('conflict').hidden = true; });
  for (const [id, amount] of [['prev', -1], ['next', 1]]) $(id).addEventListener('click', () => { ++opening; selected = ''; void loadMonth(shiftMonth(month, amount)); });
  $('this-month').addEventListener('click', () => void loadMonth(D.seoulDateKey().slice(0, 7)));
  window.addEventListener('beforeunload', e => { if (editor.dirty || editor.busy) { editor.persist(); e.preventDefault(); e.returnValue = ''; } });
  installDialogs(close);
  watch(D, async () => {
    await loadMonth();
    if (!$('quick').hidden) await editor.refresh();
    else if (!$('detail').hidden && $('confirm').hidden) {
      const date = selected, id = ++opening;
      try { const entry = await D.loadEntry(date); if (id !== opening || $('detail').hidden) return; if (entry) showDetail(entry); else close(); }
      catch (error) { $('note').textContent = message(error); }
    }
  }, () => editor.persist());
  await loadMonth();
}
