import { calendarToday, worklogToday, mondayOf, addDays, normalizeWeek, summarizeGoals,
  deadlines, weekDays, monthCells, shiftMonth, goalForTask, createSource } from './read-widgets-model.mjs?v=20260929-priority-goals';

const titles = { goals:'이번 주 목표', deadlines:'3일 안 마감', week:'이번 주 한 일', calendar:'월 캘린더' };

export function mount(root, source, now = () => Date.now()) {
  const kind = root.dataset.readWidget;
  const doc = root.ownerDocument, view = doc.defaultView;
  const touchMedia = view.matchMedia('(any-pointer:coarse)');
  function updateDeviceLayout() {
    // Physical CSS screen size preserves iPad's five columns in a narrow embed,
    // and phone's vertical list in landscape. Desktop embeds remain five columns.
    const shortSide = Math.min(view.screen.width || view.innerWidth, view.screen.height || view.innerHeight);
    doc.body.classList.toggle('read-widget-phone', touchMedia.matches && shortSide < 640);
  }
  updateDeviceLayout();
  view.addEventListener('resize', updateDeviceLayout);
  touchMedia.addEventListener('change', updateDeviceLayout);
  const make = (tag, cls, text) => {
    const node = doc.createElement(tag); node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const card = make('section', 'wr-card'); card.setAttribute('aria-label', titles[kind]);
  const header = make('header', 'wr-header'); header.append(make('h2', 'wr-title', titles[kind]));
  const content = make('div', 'wr-content');
  const error = make('p', 'wr-error'); error.hidden = true; error.setAttribute('role', 'alert');
  const live = make('span', 'wr-sr'); live.setAttribute('role', 'status');
  // The deadline card starts with its list; keep its accessible section name.
  if (kind !== 'deadlines') card.append(header);
  card.append(content, error, live); root.replaceChildren(card);
  content.append(make('p', 'wr-message', '불러오는 중이에요.'));

  let state = null, signature = '', disposed = false, running = null, queued = false, period;
  let selectedWeek = mondayOf(worklogToday(now()));
  let selectedMonth = calendarToday(now()).slice(0, 7);
  let pinned = false;
  // UI only, per tab. No task/goal data or personal instance credentials are stored.
  const periodKey = `widget-view-cream-olive-${kind}-read-v1`;
  if (kind === 'week' || kind === 'calendar') {
    try {
      const saved = view.sessionStorage.getItem(periodKey);
      if (kind === 'week' && saved && normalizeWeek(saved) === saved) { selectedWeek = saved; pinned = true; }
      if (kind === 'calendar' && /^\d{4}-(0[1-9]|1[0-2])$/.test(saved || '')) { selectedMonth = saved; pinned = true; }
    } catch (_) {}
    const nav = make('nav', 'wr-nav'); nav.setAttribute('aria-label', kind === 'week' ? '주 이동' : '월 이동');
    const previous = make('button', 'wr-arrow', '‹'), next = make('button', 'wr-arrow', '›');
    previous.type = next.type = 'button';
    previous.setAttribute('aria-label', kind === 'week' ? '이전 주' : '이전 달');
    next.setAttribute('aria-label', kind === 'week' ? '다음 주' : '다음 달');
    period = make('span', 'wr-period'); nav.append(previous, period, next); header.append(nav);
    const move = delta => {
      pinned = true;
      if (kind === 'week') selectedWeek = addDays(selectedWeek, delta * 7);
      else selectedMonth = shiftMonth(selectedMonth, delta);
      try { view.sessionStorage.setItem(periodKey, kind === 'week' ? selectedWeek : selectedMonth); } catch (_) {}
      updatePeriod();
      if (state) render();
    };
    previous.addEventListener('click', () => move(-1)); next.addEventListener('click', () => move(1));
    updatePeriod();
  }
  function updatePeriod() {
    if (!period) return;
    if (kind === 'week') {
      const end = addDays(selectedWeek, 4);
      const short = date => `${Number(date.slice(5, 7))}.${Number(date.slice(8))}`;
      period.textContent = `${short(selectedWeek)} – ${short(end)}`;
      period.setAttribute('aria-label', `${selectedWeek}부터 ${end}까지`);
    } else {
      period.textContent = `${selectedMonth.slice(0, 4)}년 ${Number(selectedMonth.slice(5))}월`;
    }
  }
  function colorOf(goal) {
    const color = String(goal?.color || '');
    // Match worklog goalsForTask: apply a stored, valid CSS color as one property.
    return color && view.CSS.supports('color', color) ? color : null;
  }
  function dot(task, accessible = true) {
    const goal = goalForTask(state, task), color = colorOf(goal);
    const node = make('span', `wr-dot${color ? '' : ' is-empty'}`);
    if (color) node.style.setProperty('--dot-color', color);
    if (accessible) {
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', goal ? `목표: ${goal.name}${color ? '' : ', 색상 미설정'}` : '연결된 목표 없음');
    } else node.setAttribute('aria-hidden', 'true');
    return node;
  }
  function title(task, cls = '') {
    const node = make('span', `wr-ellipsis ${cls}`, task.title);
    node.dataset.fullText = String(task.title || '');
    return node;
  }
  function render() {
    const today = calendarToday(now()), workDay = worklogToday(now());
    if (!pinned) { selectedWeek = mondayOf(workDay); selectedMonth = today.slice(0, 7); }
    updatePeriod();
    const nextSignature = JSON.stringify([state, today, workDay, selectedWeek, selectedMonth]);
    if (signature === nextSignature) return;
    hideTooltip();
    const fragment = doc.createDocumentFragment();
    if (kind === 'goals') {
      const rows = summarizeGoals(state, mondayOf(today));
      const list = make('ol', 'wg-list');
      for (const goal of rows) {
        const row = make('li', 'wg-row'); row.dataset.goalId = goal.id;
        const color = colorOf(goal);
        const number = make('span', `wg-number${color ? '' : ' is-empty'}`, goal.number);
        number.setAttribute('aria-hidden', 'true');
        if (color) {
          number.style.setProperty('--goal-color', color);
          // Readable numbers on both light and dark saved colors.
          const canvas = doc.createElement('canvas'), context = canvas.getContext('2d');
          context.fillStyle = color; context.fillRect(0, 0, 1, 1);
          const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
          const luminance = [r, g, b].map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
          number.style.setProperty('--goal-number-ink', .2126 * luminance[0] + .7152 * luminance[1] + .0722 * luminance[2] > .18 ? '#252a20' : '#fffdf7');
        }
        const count = make('span', 'wg-count');
        count.setAttribute('aria-label', `연결된 업무 ${goal.total}개 중 ${goal.done}개 완료`);
        count.append(make('span', '', '업무 '), make('strong', '', goal.done), make('span', 'wg-slash', '/'), make('span', '', goal.total));
        row.append(number, make('p', 'wg-name', goal.name), count); list.append(row);
      }
      fragment.append(rows.length ? list : make('p', 'wr-message', '이번 주에 설정된 목표가 없어요.'));
    } else if (kind === 'deadlines') {
      const rows = deadlines(state, today), list = make('ul', 'wr-deadlines');
      for (const task of rows) {
        const row = make('li', 'wr-deadline'); row.dataset.taskId = task.id;
        row.append(make('span', `wr-dday${task.days === 0 ? ' is-today' : ''}`, task.days === 0 ? 'D-DAY' : `D-${task.days}`), dot(task), title(task));
        list.append(row);
      }
      fragment.append(rows.length ? list : make('p', 'wr-message', '3일 안에 마감할 업무가 없어요.'));
    } else if (kind === 'week') {
      const grid = make('div', 'wr-week');
      for (const day of weekDays(state, selectedWeek)) {
        const column = make('section', `wr-day${day.date === today ? ' is-today' : ''}`); column.dataset.date = day.date;
        column.setAttribute('aria-label', `${day.label}요일${day.date === today ? ', 오늘' : ''}`);
        if (day.date === today) column.setAttribute('aria-current', 'date');
        const dayHeader = make('div', 'wr-day-header'), count = make('span', 'wr-day-count', `${day.done} / ${day.total}`);
        count.setAttribute('aria-label', `${day.total}개 중 ${day.done}개 완료`);
        dayHeader.append(make('h3', 'wr-day-title', day.label), count); column.append(dayHeader);
        const list = make('ul', 'wr-task-list');
        for (const task of day.tasks) {
          const row = make('li', `wr-task ${task.done === true ? 'is-done' : 'is-open'}`); row.dataset.taskId = task.id;
          const check = make('span', 'wr-check', task.done === true ? '✓' : '');
          check.setAttribute('role', 'img'); check.setAttribute('aria-label', task.done === true ? '완료' : '미완료');
          row.append(dot(task), check, title(task, 'wr-task-name')); list.append(row);
        }
        column.append(day.tasks.length ? list : make('p', 'wr-day-empty', '업무 없음')); grid.append(column);
      }
      fragment.append(grid);
    } else {
      const calendar = make('div', 'wr-calendar'), weekdays = make('div', 'wr-calendar-weekdays');
      weekdays.setAttribute('aria-hidden', 'true');
      ['월','화','수','목','금','토','일'].forEach((label, i) => weekdays.append(make('span', `wr-weekday${i > 4 ? ' is-weekend' : ''}`, label)));
      const grid = make('div', 'wr-month-grid'); grid.setAttribute('role', 'list'); grid.setAttribute('aria-label', `${period.textContent} 마감 달력`);
      for (const cell of monthCells(state, selectedMonth)) {
        const tile = make('div', `wr-date${cell.otherMonth ? ' is-other-month' : ''}${cell.weekend ? ' is-weekend' : ''}${cell.date === today ? ' is-today' : ''}${cell.lastRow ? ' in-last-row' : ''}`);
        tile.dataset.date = cell.date; tile.setAttribute('role', 'listitem');
        tile.setAttribute('aria-label', `${cell.date}${cell.date === today ? ', 오늘' : ''}, 미완료 마감 ${cell.tasks.length}개`);
        if (cell.date === today) tile.setAttribute('aria-current', 'date');
        tile.append(make('span', 'wr-date-number', cell.day));
        if (cell.tasks.length) {
          const dots = make('div', 'wr-date-dots'); cell.tasks.forEach(task => dots.append(dot(task, false))); tile.append(dots);
        }
        grid.append(tile);
      }
      calendar.append(weekdays, grid); fragment.append(calendar);
    }
    content.replaceChildren(fragment); signature = nextSignature;
    live.textContent = `${titles[kind]} 갱신됨`;
  }
  function refresh() {
    if (disposed) return Promise.resolve();
    if (running) { queued = true; return running; }
    root.setAttribute('aria-busy', 'true');
    running = (async () => {
      try {
        const next = await source.read();
        if (disposed) return;
        state = next; render(); error.hidden = true; root.dataset.status = 'ready';
      } catch (_) {
        if (disposed) return;
        if (!state) content.replaceChildren(make('p', 'wr-message', '불러오지 못했어요. 연결이 돌아오면 다시 확인할게요.'));
        error.textContent = state ? '갱신하지 못했어요. 마지막으로 확인한 내용을 표시하고 있어요.' : '데이터 연결을 확인해 주세요.';
        error.hidden = false; root.dataset.status = 'error';
      } finally {
        running = null;
        if (!disposed) {
          root.setAttribute('aria-busy', 'false');
          if (queued) { queued = false; void refresh(); }
        }
      }
    })();
    return running;
  }
  const tooltip = make('div', 'wr-tooltip'); tooltip.id = `read-tooltip-${kind}`;
  tooltip.setAttribute('role', 'tooltip'); tooltip.hidden = true; doc.body.append(tooltip);
  let tooltipLabel;
  function hideTooltip() {
    tooltip.hidden = true; tooltipLabel?.removeAttribute('aria-describedby'); tooltipLabel = null;
  }
  function showTooltip(event) {
    hideTooltip();
    if (event.pointerType !== 'mouse' || view.matchMedia('(any-pointer:coarse)').matches || !view.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
    const label = event.target.closest?.('[data-full-text]');
    if (!label || !root.contains(label) || label.scrollWidth <= label.clientWidth) return;
    tooltipLabel = label; label.setAttribute('aria-describedby', tooltip.id);
    tooltip.textContent = label.dataset.fullText; tooltip.hidden = false;
    const box = label.getBoundingClientRect(), width = Math.min(320, view.innerWidth - 16);
    tooltip.style.width = `${width}px`;
    tooltip.style.left = `${Math.max(8, Math.min(box.left, view.innerWidth - width - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(box.bottom + 5, view.innerHeight - tooltip.offsetHeight - 8))}px`;
  }
  root.addEventListener('pointerover', showTooltip); root.addEventListener('pointerout', hideTooltip);
  view.addEventListener('resize', hideTooltip); doc.addEventListener('scroll', hideTooltip, true);
  view.addEventListener('widgetlayoutchange', hideTooltip);
  // Day changes update labels without a write or resetting a manually selected period.
  let clockDay = `${calendarToday(now())}:${worklogToday(now())}`;
  const timer = view.setInterval(() => {
    if (doc.hidden || !state) return;
    const nextDay = `${calendarToday(now())}:${worklogToday(now())}`;
    if (nextDay !== clockDay) { clockDay = nextDay; render(); }
  }, 1000);
  const stop = source.subscribe(refresh);
  const pagehide = event => { if (!event.persisted) destroy(); };
  view.addEventListener('pagehide', pagehide);
  function destroy() {
    disposed = true; stop?.(); view.clearInterval(timer); tooltip.remove();
    root.removeEventListener('pointerover', showTooltip); root.removeEventListener('pointerout', hideTooltip);
    view.removeEventListener('resize', hideTooltip); doc.removeEventListener('scroll', hideTooltip, true);
    view.removeEventListener('widgetlayoutchange', hideTooltip); view.removeEventListener('pagehide', pagehide);
    view.removeEventListener('resize', updateDeviceLayout); touchMedia.removeEventListener('change', updateDeviceLayout);
  }
  void refresh();
  return { refresh, destroy };
}

const root = document.getElementById('read-widget');
if (root) mount(root, createSource(window.Store));
