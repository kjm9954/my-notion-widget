// UI-only helpers. Persistence and instance isolation remain in DiaryV1.
export const MOODS = { calm: '차분', good: '좋음', tired: '피곤' };
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const $ = id => document.getElementById(id);
const face = mouth => `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.3"/><circle cx="5.9" cy="6.6" r=".5" fill="currentColor" stroke="none"/><circle cx="10.1" cy="6.6" r=".5" fill="currentColor" stroke="none"/>${mouth}</svg>`;
const icons = { calm: face('<path d="M5.8 10.2h4.4"/>'), good: face('<path d="M5.5 9.6c.7 1.2 4.3 1.2 5 0"/>'), tired: face('<path d="M5.5 11c.7-1.2 4.3-1.2 5 0"/>') };
export function moodButtons(value) {
  return Object.entries(MOODS).map(([key, label]) => `<button class="mood" type="button" data-mood="${key}" aria-pressed="${key === value}">${icons[key]}${label}</button>`).join('');
}
export function shiftMonth(month, amount) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + amount, 1)).toISOString().slice(0, 7);
}
export const monthLabel = month => `${Number(month.slice(0, 4))}년 ${Number(month.slice(5))}월`;
export function initialMonth(D) {
  const requested = new URLSearchParams(location.search).get('month');
  return D.validDateKey(`${requested}-01`) && requested <= D.seoulDateKey().slice(0, 7) ? requested : D.seoulDateKey().slice(0, 7);
}
export function monthStats(entries, month, today) {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const current = month === today.slice(0, 7);
  const until = current ? Number(today.slice(8)) : days;
  const dates = new Set(entries.filter(e => e.date.startsWith(`${month}-`) && e.date <= today).map(e => e.date));
  const has = d => dates.has(`${month}-${String(d).padStart(2, '0')}`);
  const moods = { calm: 0, good: 0, tired: 0 };
  // One record per date, including mood-only and photo-only records.
  for (const e of new Map(entries.map(e => [e.date, e])).values()) {
    if (dates.has(e.date) && Object.hasOwn(moods, e.mood)) moods[e.mood]++;
  }
  let count = 0, streak = 0, run = 0;
  for (let d = 1; d <= until; d++) { if (has(d)) count++; run = has(d) ? run + 1 : 0; if (!current) streak = Math.max(streak, run); }
  // The supplied design counts streaks within the displayed month.
  if (current) { let d = until; if (!has(d)) d--; while (d >= 1 && has(d--)) streak++; }
  return { days, until, current, count, streak, moods, marked: Array.from({ length: 31 }, (_, i) => i < until && has(i + 1)) };
}
export const photoSource = photo => photo.url || photo.dataUrl || '';
export const snapshot = entry => ({ text: String(entry?.text || ''), mood: MOODS[entry?.mood] ? entry.mood : null,
  photos: (entry?.photos || []).slice(0, 4).map(p => ({ ...p })), revision: entry?.revision ?? null });
export const photoPayload = photos => photos.map(p => p.isNew ? { id: p.id, dataUrl: p.dataUrl } : { id: p.id });
export function rebaseDraft(draft, current) {
  const available = new Set((current?.photos || []).map(p => p.id));
  const photos = draft.photos.filter(p => p.isNew || available.has(p.id));
  return { ...snapshot(draft), revision: current?.revision ?? null, photos };
}
export function message(error) {
  return /Failed to fetch|NetworkError|Load failed/i.test(error?.message || '')
    ? '인터넷 연결을 확인한 뒤 다시 시도해 주세요. 작성 내용은 화면에 남아 있어요.'
    : error?.message || '저장소에 연결하지 못했습니다. 다시 시도해 주세요.';
}
export function connect(D, target) {
  if (D.connected) return true;
  $('root').innerHTML = `<section class="connection"><strong>개인 위젯 연결이 필요합니다</strong><p>기존 개인 연결 주소로 열어 주세요.</p><a href="${esc(D.connectionUrl(target))}" target="_top">내 위젯 연결하기</a></section>`;
  return false;
}
export function watch(D, reload, stash = () => {}) {
  const safely = async () => { try { await reload(); } catch (error) { document.querySelector('[data-status]')?.replaceChildren(message(error)); } };
  D.onChange(detail => { if (detail?.type === 'saved' || detail?.type === 'deleted') void safely(); });
  window.addEventListener('focus', safely);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stash(); else void safely(); });
}
export function installDialogs(close) {
  document.addEventListener('keydown', e => {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(el => el.getClientRects().length);
    const dialog = dialogs.at(-1);
    if (!dialog) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const nodes = [...dialog.querySelectorAll('button:not(:disabled), textarea:not(:disabled), a[href], input:not(:disabled)')].filter(el => el.getClientRects().length);
      if (!nodes.length) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === nodes[0] || !dialog.contains(document.activeElement))) { e.preventDefault(); nodes.at(-1).focus(); }
      else if (!e.shiftKey && (document.activeElement === nodes.at(-1) || !dialog.contains(document.activeElement))) { e.preventDefault(); nodes[0].focus(); }
    }
  });
}

export class EntryEditor {
  constructor(D, changed, conflict) {
    this.D = D; this.changed = changed; this.showConflict = conflict;
    this.date = ''; this.value = snapshot(null); this.dirty = false;
    this.busy = false; this.loading = false; this.known = false; this.token = 0; this.status = ''; this.conflict = null;
  }
  notify() { this.changed(this); }
  persist() {
    if (!this.dirty || !this.date) return true;
    try {
      const result = this.D.saveDraft(this.date, this.value);
      if (!result.saved || !result.photosSaved) {
        this.status = result.saved ? '글은 임시 보관했지만 새 사진은 보관 공간이 부족해요. 이동 전에 저장해 주세요.' : '임시 보관 공간이 부족해요. 이동 전에 저장해 주세요.';
        return false;
      }
      return true;
    } catch (error) { this.status = message(error); return false; }
  }
  edit(patch) {
    if (this.busy || this.loading) return;
    Object.assign(this.value, patch); this.dirty = true;
    this.status = '작성 중';
    if (this.persist()) this.status = '작성 중 · 임시 보관됨';
    this.notify();
  }
  async load(date) {
    if (this.busy || date > this.D.seoulDateKey()) return false;
    if (!this.persist()) { this.notify(); return false; }
    const token = ++this.token;
    this.date = date; this.loading = true; this.known = false; this.dirty = false;
    this.value = snapshot(null); this.conflict = null; this.status = '불러오는 중…';
    let draft = null;
    try { draft = this.D.loadDraft(date); if (draft) { this.value = snapshot(draft); this.dirty = true; } }
    catch (error) { this.status = message(error); }
    this.notify();
    try {
      const entry = await this.D.loadEntry(date);
      if (token !== this.token) return false;
      this.known = true;
      if (draft) {
        this.status = '임시 보관한 내용을 불러왔어요.';
        if ((entry?.revision ?? null) !== this.value.revision) this.conflict = { current: entry, draft: snapshot(this.value) };
      } else { this.value = snapshot(entry); this.status = ''; }
    } catch (error) { if (token === this.token) this.status = message(error); }
    finally { if (token === this.token) { this.loading = false; this.notify(); } }
    return token === this.token;
  }
  async refresh() {
    if (!this.date || this.busy || this.loading) return;
    const token = ++this.token, date = this.date;
    try {
      const entry = await this.D.loadEntry(date);
      if (token !== this.token || this.busy) return;
      this.known = true;
      if (!this.dirty && !this.conflict) { this.value = snapshot(entry); this.status = ''; }
      else if ((entry?.revision ?? null) !== this.value.revision) {
        this.conflict = { current: entry, draft: snapshot(this.value) };
        this.status = '다른 화면에서 기록이 바뀌었어요. 저장 전에 최신 기록을 확인해 주세요.';
      }
    } catch (error) { if (token !== this.token) return; this.status = message(error); }
    this.notify();
  }
  canSave() { return this.known && !this.busy && !this.loading && Boolean(this.value.text.trim() || this.value.mood || this.value.photos.length); }
  async save() {
    if (!this.canSave()) return null;
    if (this.conflict) { this.conflict.draft = snapshot(this.value); this.showConflict(this.conflict); return null; }
    this.persist(); this.busy = true; ++this.token; this.status = '저장 중…'; this.notify();
    try {
      const saved = await this.D.saveEntry({ date: this.date, text: this.value.text, mood: this.value.mood,
        photos: photoPayload(this.value.photos), expectedRevision: this.value.revision });
      this.value = snapshot(saved); this.dirty = false; this.conflict = null;
      this.D.clearDraft(this.date); this.D.announce({ type: 'saved', date: this.date, revision: saved.revision });
      this.status = '저장 완료'; return saved;
    } catch (error) {
      this.dirty = true; this.persist(); this.status = message(error);
      if (error.status === 409) {
        this.conflict = { current: error.data?.current ?? null, draft: snapshot(this.value) };
        this.showConflict(this.conflict);
      }
      return null;
    } finally { this.busy = false; this.notify(); }
  }
  resolve(useDraft) {
    if (!this.conflict) return;
    const { current, draft } = this.conflict;
    this.value = useDraft ? rebaseDraft(draft, current) : snapshot(current);
    // Do not write automatically; a separate Save is always required after comparison.
    this.conflict = null; this.dirty = useDraft; this.known = true;
    if (useDraft) {
      this.persist(); this.status = this.value.photos.length < draft.photos.length
        ? '다른 기기에서 삭제된 사진은 제외했어요. 초안을 확인한 뒤 저장해 주세요.' : '초안을 복원했어요. 확인한 뒤 저장해 주세요.';
    } else { this.status = '최신 기록을 표시했어요. 이전 초안은 임시 보관되어 있어요.'; }
    this.notify();
  }
  async addFiles(files) {
    if (this.busy || this.loading) return;
    const selected = [...files], available = 4 - this.value.photos.length;
    if (!available) { this.status = '사진은 최대 4장까지 추가할 수 있어요. 기존 사진을 뺀 뒤 골라 주세요.'; this.notify(); return; }
    this.busy = true; this.status = '사진을 읽는 중…'; this.notify();
    const notices = [];
    if (selected.length > available) notices.push(`사진은 최대 4장이라 앞의 ${available}장만 추가했어요.`);
    try {
      for (const file of selected.slice(0, available)) {
        try { this.value.photos.push(await this.D.photoFromFile(file)); this.dirty = true; }
        catch (error) { notices.push(message(error)); }
      }
    } finally {
      this.busy = false; const persisted = this.persist();
      if (persisted) this.status = notices.join(' ') || '사진을 추가했어요. 저장하면 다른 기기에서도 볼 수 있어요.';
      else if (notices.length) this.status += ` ${notices.join(' ')}`;
      this.notify();
    }
  }
}

export function conflictMarkup(conflict) {
  const entry = conflict.current;
  return `<p class="conflict-copy">다른 기기의 최신 기록입니다. 내 초안은 임시 보관되어 있어요.</p>${entry
    ? `${entry.mood ? `<p class="detail-mood">기분 · ${MOODS[entry.mood] || ''}</p>` : ''}<p class="detail-copy">${esc(entry.text)}</p><div class="conflict-photos">${(entry.photos || []).map(p => `<img src="${esc(photoSource(p))}" alt="최신 기록 사진">`).join('')}</div>`
    : '<p class="detail-copy">다른 기기에서 이 날짜의 기록을 삭제했어요.</p>'}`;
}
