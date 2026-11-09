import { $, MOODS, connect, watch, monthLabel, shiftMonth, initialMonth, monthStats, message } from './diary-v2-common.js?v=20261109';
const D = window.DiaryV1, kind = $('root').dataset.kind;
if (connect(D, `diary-v2-${kind === 'mood' ? 'mood-trend' : 'record-days'}.html`)) {
  let month = initialMonth(D), rows = [], token = 0;
  function render() {
    $('month').textContent = monthLabel(month); $('next').disabled = month >= D.seoulDateKey().slice(0, 7);
    const stats = monthStats(rows, month, D.seoulDateKey());
    if (kind === 'mood') {
      const maximum = Math.max(...Object.values(stats.moods));
      $('list').innerHTML = !maximum ? '<p class="empty">이 달에 고른 기분이 없어요.</p>' : Object.entries(MOODS).map(([key, label]) => {
        const n = stats.moods[key], width = n ? Math.max(6, Math.round(n / maximum * 100)) : 0;
        return `<div class="mood-stat"><span class="label">${label}</span><span class="track" aria-hidden="true"><span class="fill" style="width:${width}%"></span></span><span class="mood-count${n ? '' : ' is-zero'}" data-count="${key}">${n}</span></div>`;
      }).join('');
    } else {
      $('count').textContent = stats.count; $('count').classList.toggle('is-zero', !stats.count); $('total').textContent = `/ ${stats.until}일`;
      $('streak').hidden = stats.streak < 2; $('streak').textContent = `${stats.current ? '연속' : '최장 연속'} ${stats.streak}일`;
      $('strip').innerHTML = stats.marked.map((on, i) => `<i class="${i >= stats.days ? 'off' : on ? 'on' : ''}" title="${i + 1}일${on ? ' 기록 있음' : ''}" aria-hidden="true"></i>`).join('');
      $('strip').setAttribute('aria-label', `${monthLabel(month)}, ${stats.count}일 기록`);
    }
  }
  async function load(next = month) {
    if (next > D.seoulDateKey().slice(0, 7)) return;
    const id = ++token;
    if (month !== next) { month = next; rows = []; }
    render(); $('status').textContent = '불러오는 중…';
    const [y, m] = month.split('-').map(Number), b = D.monthBounds(y, m - 1);
    try { const loaded = await D.loadRange(b.start, b.end); if (id !== token) return; rows = loaded; $('status').textContent = ''; render(); }
    catch (error) { if (id === token) $('status').textContent = message(error); }
  }
  $('prev').addEventListener('click', () => void load(shiftMonth(month, -1)));
  $('next').addEventListener('click', () => void load(shiftMonth(month, 1)));
  watch(D, () => load()); await load();
}
