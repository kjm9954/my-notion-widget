/* Shared motion v2: choose only the small non-text targets named by the design
   system, relay them in two-second steps, and pause whenever attention is on
   the widget. A shared helper also lets removed rows close their own place. */
(() => {
  'use strict';

  const card = document.querySelector('[data-widget-card]');
  const file = decodeURIComponent(location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const targets = {
    'quote-drawer.html': { selector:'.quote-item', kind:'dot', max:3, empty:'.empty-state' },
    'thoughts.html': { selector:'.item', kind:'dot', max:3, filter:'aged', empty:'.empty-list' },
    'life-books.html': { selector:'.cover-button.is-selected', kind:'outline', max:1, empty:'.empty-state' },
    'reading-count.html': { selector:'.year-row', kind:'dot', max:3, empty:'.empty-state' },
    'wishlist.html': { selector:'.grid-cover', kind:'outline', max:3, empty:'.all-empty, .filter-empty' },
    'today.html': { empty:'.empty-block' },
    'calendar.html': { selector:'.today-ring', max:1 },
    'material.html': { selector:'.pill > .done-marker, .pill > .thought-marker, .pill > .q-marker', max:3, empty:'.chip-area > .empty' },
    'empty.html': { disabled:true },
    'mood.html': { selector:'.temperature-part.active', max:1, empty:'.history > .empty' },
    'achieve.html': { selector:'#content.list .row', kind:'dot', max:3, empty:'#content.empty' },
    'index.html': { selector:'.quadrant.is-selected', kind:'outline', max:1 },
    'stats.html': { selector:'.meter-fill', max:2, continuous:true },
    'worklog.html': { empty:'.list-shell.is-empty' },
    'goals.html': { selector:'.goal-row:not(.done) .check', max:3, empty:'.goals-grid .empty' },
    'find.html': { empty:'.empty-list' },
    'drawer.html': { empty:'.quote-list > .empty' },
    'library.html': { empty:'#libraryView > .no-books' },
    'session.html': { empty:'.draft-list:has(.draft-empty)' },
    'record.html': { disabled:true },
    'add.html': { disabled:true }
  };
  const genericEmptySelector = '.empty-state, .empty-block, .empty-list, .all-empty, .filter-empty, .no-books, .draft-empty';
  const fileOrder = [
    'quote-drawer.html', 'thoughts.html', 'life-books.html', 'reading-count.html', 'wishlist.html',
    'today.html', 'calendar.html', 'material.html', 'empty.html', 'mood.html', 'achieve.html',
    'index.html', 'stats.html', 'worklog.html', 'goals.html', 'record.html', 'find.html', 'add.html',
    'drawer.html', 'library.html', 'session.html'
  ];
  const fileOffset = Math.max(0, fileOrder.indexOf(file) % 5) * .7;
  let idleSyncQueued = false;

  function isVisible(element) {
    if (!element || element.hidden) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  }

  function visibleMatches(selector) {
    if (!selector) return [];
    const matches = [];
    selector.split(',').map(value => value.trim()).filter(Boolean).forEach(part => {
      document.querySelectorAll(part).forEach(element => {
        if (isVisible(element) && !matches.includes(element)) matches.push(element);
      });
    });
    return matches;
  }

  function firstVisible(selector) {
    return visibleMatches(selector)[0] || null;
  }

  function relayNode(owner, kind) {
    if (!owner || !kind) return owner;
    owner.classList.add('idle-owner');
    owner.setAttribute('data-idle-relay-owner', '');
    let overlay = Array.from(owner.children).find(child => child.hasAttribute('data-idle-relay'));
    if (!overlay) {
      overlay = document.createElement('span');
      overlay.setAttribute('data-idle-relay', '');
      overlay.setAttribute('aria-hidden', 'true');
      owner.appendChild(overlay);
    }
    const className = kind === 'dot' ? 'idle-relay-dot' : `idle-outline idle-outline-${kind}`;
    if (overlay.className !== className) overlay.className = className;
    return overlay;
  }

  function hasExpandedState() {
    const selector = '[aria-expanded="true"], .expanded, .detail:not(.hidden), .overlay:not(.hidden):not([hidden]), .settings-view';
    return Array.from(document.querySelectorAll(selector)).some(isVisible);
  }

  function syncIdle() {
    idleSyncQueued = false;
    if (!card) return;
    const config = targets[file] || {};
    const completed = firstVisible(config.complete);
    let owners = config.disabled || completed ? [] : visibleMatches(config.selector);
    if (config.filter === 'aged') {
      owners = owners.filter(element => {
        const text = element.querySelector('.item-meta')?.textContent || '';
        const match = text.match(/(\d+)일 전/);
        return match && Number(match[1]) >= 30;
      });
    }
    if (owners.length > 4) owners = owners.slice(0, 1);
    else owners = owners.slice(0, Math.min(4, Math.max(0, Number(config.max) || 4)));

    let emptyTarget = null;
    if (!owners.length && !config.disabled && !completed) {
      emptyTarget = firstVisible(config.empty || genericEmptySelector);
      if (emptyTarget) owners = [emptyTarget];
    }

    const selectedOwners = new Set(owners);
    const relayTargets = owners.map(owner => relayNode(owner, emptyTarget ? 'empty' : config.kind));
    const selectedTargets = new Set(relayTargets);

    document.querySelectorAll('.idle').forEach(element => {
      if (selectedTargets.has(element)) return;
      element.classList.remove('idle', 'is-empty', 'is-paused');
      element.style.removeProperty('--idle-delay');
      element.style.removeProperty('--idle-dur');
    });
    document.querySelectorAll('[data-idle-relay]').forEach(element => {
      if (!selectedTargets.has(element)) element.remove();
    });
    document.querySelectorAll('[data-idle-relay-owner]').forEach(element => {
      if (!selectedOwners.has(element)) {
        element.classList.remove('idle-owner');
        element.removeAttribute('data-idle-relay-owner');
      }
    });

    relayTargets.forEach((target, index) => {
      const stagger = relayTargets.length === 1 ? 0 : index * 2;
      target.classList.add('idle');
      target.classList.toggle('is-empty', Boolean(emptyTarget));
      target.classList.toggle('is-paused', document.visibilityState !== 'visible');
      const delay = fileOffset + stagger;
      target.style.setProperty('--idle-delay', `${config.continuous ? -delay : delay}s`);
      target.style.setProperty('--idle-dur', emptyTarget ? '10s' : '6s');
    });
    document.body.classList.toggle('has-widget-expanded', hasExpandedState());
  }

  function queueIdleSync() {
    if (idleSyncQueued) return;
    idleSyncQueued = true;
    queueMicrotask(syncIdle);
  }

  function syncRelay() {
    const hidden = document.visibilityState !== 'visible';
    document.body.classList.toggle('is-widget-hidden', hidden);
    document.querySelectorAll('.idle').forEach(element => element.classList.toggle('is-paused', hidden));
    queueIdleSync();
  }

  document.addEventListener('visibilitychange', syncRelay);
  if (card) {
    new MutationObserver(queueIdleSync).observe(card, { childList:true, subtree:true });
    ['click', 'input', 'change'].forEach(type => card.addEventListener(type, () => setTimeout(queueIdleSync, 0)));
  }
  syncRelay();
  queueIdleSync();

  window.widgetMotion = {
    close(element, done) {
      if (!element) return;
      const finish = () => { try { done?.(); } catch (_) {} };
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        finish();
        return;
      }
      element.style.setProperty('--close-height', `${element.offsetHeight}px`);
      element.classList.add('motion-close');
      let settled = false;
      const once = () => { if (settled) return; settled = true; finish(); };
      element.addEventListener('animationend', once, { once: true });
      const duration = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--t-close')) || 160;
      setTimeout(once, duration * 2);
    }
  };
})();

(() => {
  const wm = window.widgetMotion = window.widgetMotion || {};
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 1회성 클래스 부착: animationend 또는 타임아웃에 제거
  function once(el, className, ms) {
    if (!el || reduced()) return;
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    let done = false;
    const clear = () => { if (done) return; done = true; el.classList.remove(className); };
    el.addEventListener('animationend', clear, { once: true });
    setTimeout(clear, (ms || 700) + 400);
  }

  wm.pop = el => once(el, 'motion-pop', 240);
  wm.popIn = el => once(el, 'motion-pop-in', 240);
  wm.drop = el => once(el, 'motion-drop', 240);

  // 캐스케이드: 노드 목록 앞 4개에 --i 0~3, 이후는 --i 3(동시)
  wm.cascade = nodes => {
    if (reduced()) return;
    [...nodes].forEach((el, i) => {
      el.style.setProperty('--i', String(Math.min(i, 3)));
      once(el, 'motion-cascade', 320 + Math.min(i, 3) * 60);
    });
  };

  // 셀 팝(요일·분면): 순서대로 stagger. maxStagger 기본 4, weekly 요일은 7 허용
  wm.cellPop = (nodes, maxStagger = 4) => {
    if (reduced()) return;
    [...nodes].forEach((el, i) => {
      el.style.setProperty('--i', String(Math.min(i, maxStagger - 1)));
      once(el, 'motion-cell-pop', 240 + Math.min(i, maxStagger - 1) * 60);
    });
  };

  // 링 확산: 대상의 부모에 절대배치 링 1개 생성 → 재생 후 제거
  wm.burst = el => {
    if (!el || reduced()) return;
    const host = el.parentElement;
    if (!host) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const ring = document.createElement('span');
    ring.className = 'v2-burst-ring';
    ring.setAttribute('aria-hidden', 'true');
    host.appendChild(ring);
    setTimeout(() => ring.remove(), 800);
  };

  // 점 스파크 3개: anchor(절대배치 기준 요소) 안의 (x,y)px 지점에서 발사 → 제거
  wm.spark = (anchor, x, y) => {
    if (!anchor || reduced()) return;
    if (getComputedStyle(anchor).position === 'static') anchor.style.position = 'relative';
    const dots = [
      { c: '#0E5C7A', d: ['8px', '-9px', '12px', '-4px'] },
      { c: '#C6D6DD', d: ['10px', '-1px', '16px', '2px'] },
      { c: '#0E5C7A', d: ['6px', '6px', '11px', '9px'] }
    ];
    dots.forEach(({ c, d }) => {
      const s = document.createElement('span');
      s.className = 'v2-spark';
      s.setAttribute('aria-hidden', 'true');
      s.style.background = c;
      s.style.left = x + 'px'; s.style.top = y + 'px';
      s.style.setProperty('--dx', d[0]); s.style.setProperty('--dy', d[1]);
      s.style.setProperty('--dx2', d[2]); s.style.setProperty('--dy2', d[3]);
      anchor.appendChild(s);
      setTimeout(() => s.remove(), 800);
    });
  };

  // 매칭 스윕: 컨테이너 안의 .match들에 20ms 간격 딜레이 스윕
  wm.sweepMatches = container => {
    if (!container || reduced()) return;
    container.querySelectorAll('.match').forEach((m, i) => {
      m.style.setProperty('--sweep-delay', (i * 20) + 'ms');
      once(m, 'motion-sweep', 180 + i * 20);
    });
  };
})();

(() => {
  'use strict';

  function setupListOnlyFrame(host, card) {
    const list = card?.querySelector('[data-widget-list]');
    const listHandle = card?.querySelector('[data-widget-list-handle]');
    if (!host || !card || !list || !listHandle) return;

    const fixedParts = Array.from(card.querySelectorAll('[data-widget-fixed]'));
    const designWidth = Number(host.dataset.widgetMaxWidth || host.dataset.widgetWidth) || card.offsetWidth || 320;
    const declaredHeight = Number(host.dataset.widgetHeight) || card.offsetHeight || 200;
    const defaultListHeight = Number(list.dataset.widgetListHeight) || list.offsetHeight || 160;
    const key = host.dataset.widgetKey || `widget-size-${location.pathname.split('/').pop() || 'index.html'}`;
    let requestedListHeight = defaultListHeight;
    let renderedListHeight = defaultListHeight;
    let listLocked = false;
    let drag = null;

    function number(value, fallback) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    }

    function readSize() {
      try {
        const parsed = JSON.parse(localStorage.getItem(key));
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (_) {
        return {};
      }
    }

    function saveSize() {
      try {
        localStorage.setItem(key, JSON.stringify({
          scale: 1,
          scaleLocked: true,
          contentW: designWidth,
          widthLocked: false,
          frameH: Math.round(card.offsetHeight),
          heightLocked: true,
          listH: Math.round(requestedListHeight),
          listLocked,
        }));
      } catch (_) {}
    }

    function listOffset() {
      const style = getComputedStyle(card);
      const verticalPadding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const gap = parseFloat(style.rowGap || style.gap) || 0;
      const visible = fixedParts.filter(part => part.offsetParent !== null);
      return verticalPadding + visible.reduce((sum, part) => sum + part.offsetHeight, 0) + gap * visible.length;
    }

    function commit() {
      const visualWidth = Math.max(1, Math.min(designWidth, window.innerWidth));
      const offset = listOffset();
      const maximum = Math.max(120, window.innerHeight - offset);
      if (!listLocked) requestedListHeight = Math.max(120, declaredHeight - offset);
      renderedListHeight = Math.max(Math.min(160, maximum), Math.min(maximum, requestedListHeight));
      const frameHeight = offset + renderedListHeight;
      host.style.setProperty('--widget-content-width', `${visualWidth}px`);
      host.style.setProperty('--widget-base-width', `${visualWidth}px`);
      host.style.setProperty('--widget-visual-width', `${visualWidth}px`);
      host.style.setProperty('--widget-base-height', `${frameHeight}px`);
      host.style.setProperty('--widget-visual-height', `${frameHeight}px`);
      host.style.setProperty('--widget-content-scale', '1');
      card.style.setProperty('--widget-content-width', `${visualWidth}px`);
      card.style.setProperty('--widget-content-scale', '1');
      card.style.height = `${frameHeight}px`;
      list.style.flex = `0 0 ${renderedListHeight}px`;
      list.style.height = `${renderedListHeight}px`;
      listHandle.setAttribute('aria-valuemin', String(Math.round(Math.min(160, maximum))));
      listHandle.setAttribute('aria-valuemax', String(Math.round(maximum)));
      listHandle.setAttribute('aria-valuenow', String(Math.round(renderedListHeight)));
      host.dataset.widgetSizeReady = 'true';
      document.body.classList.toggle('is-widget-overflowing', frameHeight > window.innerHeight + .5);
    }

    function applyListHeight(value, fromUser = false) {
      if (!Number.isFinite(Number(value))) return;
      if (fromUser) listLocked = true;
      requestedListHeight = Math.max(120, Number(value));
      commit();
      if (fromUser) saveSize();
    }

    listHandle.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      drag = { pointerId: event.pointerId, y: event.clientY, height: renderedListHeight };
      listLocked = true;
      listHandle.setPointerCapture?.(event.pointerId);
      document.body.classList.add('is-widget-list-resizing');
    });
    listHandle.addEventListener('pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      requestedListHeight = Math.max(120, drag.height + event.clientY - drag.y);
      commit();
    });
    const finish = event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (listHandle.hasPointerCapture?.(event.pointerId)) listHandle.releasePointerCapture(event.pointerId);
      drag = null;
      document.body.classList.remove('is-widget-list-resizing');
      saveSize();
    };
    listHandle.addEventListener('pointerup', finish);
    listHandle.addEventListener('pointercancel', finish);
    listHandle.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      applyListHeight(renderedListHeight + (event.key === 'ArrowDown' ? 20 : -20), true);
    });

    const saved = readSize();
    listLocked = saved.listLocked === true;
    requestedListHeight = Math.max(120, number(saved.listH, defaultListHeight));
    commit();
    new ResizeObserver(() => { if (!drag) commit(); }).observe(card);
    const fixedObserver = new ResizeObserver(() => { if (!drag) commit(); });
    fixedParts.forEach(part => fixedObserver.observe(part));
    function settleFrame() {
      commit();
      [60, 250, 1000].forEach(delay => setTimeout(commit, delay));
    }

    window.addEventListener('resize', settleFrame);
    window.visualViewport?.addEventListener('resize', settleFrame);
    window.addEventListener('load', settleFrame, { once:true });
    window.addEventListener('pageshow', settleFrame);
    window.addEventListener('focus', settleFrame);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) settleFrame(); });
    new ResizeObserver(settleFrame).observe(document.documentElement);
    window.addEventListener('storage', event => {
      if (event.key !== key) return;
      const next = readSize();
      listLocked = next.listLocked === true;
      requestedListHeight = Math.max(120, number(next.listH, requestedListHeight));
      commit();
    });
  }

  const host = document.querySelector('[data-widget-host]');
  const card = host?.querySelector('[data-widget-card]');
  if (host?.dataset.widgetResize === 'list-only') {
    setupListOnlyFrame(host, card);
    return;
  }
  const scaleHandle = card?.querySelector('[data-widget-scale-handle]');
  const sizeLabel = card?.querySelector('[data-widget-size-label]');
  if (!host || !card || !scaleHandle || !sizeLabel) return;

  scaleHandle.className = 'widget-size-handle widget-size-handle-bottom-right';
  scaleHandle.dataset.widgetScalePosition = 'bottom-right';
  scaleHandle.dataset.widgetScaleAxis = 'both';
  document.body.appendChild(scaleHandle);

  let topLeftHandle = document.querySelector('[data-widget-scale-position="top-left"]');
  if (!topLeftHandle) {
    topLeftHandle = scaleHandle.cloneNode(false);
    topLeftHandle.className = 'widget-size-handle widget-size-handle-top-left';
    topLeftHandle.dataset.widgetScalePosition = 'top-left';
    topLeftHandle.dataset.widgetScaleAxis = 'both';
    topLeftHandle.setAttribute('aria-label', '왼쪽 위에서 위젯 크기 비율 고정 조절');
  }
  document.body.appendChild(topLeftHandle);

  function viewportAxisHandle(position, axis, className, label) {
    let handle = document.querySelector(`[data-widget-scale-position="${position}"]`);
    if (!handle) {
      handle = scaleHandle.cloneNode(false);
      handle.className = className;
      handle.dataset.widgetScalePosition = position;
      handle.dataset.widgetScaleAxis = axis;
      handle.setAttribute('aria-label', label);
    }
    document.body.appendChild(handle);
    return handle;
  }

  const leftWidthHandle = viewportAxisHandle('left', 'horizontal', 'widget-width-handle widget-width-handle-left', '왼쪽에서 위젯 가로 크기 조절');
  const rightWidthHandle = viewportAxisHandle('right', 'horizontal', 'widget-width-handle widget-width-handle-right', '오른쪽에서 위젯 가로 크기 조절');
  const topHeightHandle = viewportAxisHandle('top', 'vertical', 'widget-height-handle widget-height-handle-top', '위쪽에서 위젯 세로 크기 조절');
  const bottomHeightHandle = viewportAxisHandle('bottom', 'vertical', 'widget-height-handle widget-height-handle-bottom', '아래쪽에서 위젯 세로 크기 조절');
  const sizeHandles = [scaleHandle, topLeftHandle, leftWidthHandle, rightWidthHandle, topHeightHandle, bottomHeightHandle];

  const key = host.dataset.widgetKey || `widget-size-${location.pathname.split('/').pop() || 'index.html'}`;
  const widthKey = host.dataset.widgetWidthKey || '';
  const designWidth = Number(host.dataset.widgetMaxWidth || host.dataset.widgetWidth) || card.offsetWidth || 320;
  const declaredHeight = Number(host.dataset.widgetHeight) || card.offsetHeight || 200;
  const configuredMaximumScale = Number(host.dataset.widgetMaxScale);
  const list = card.querySelector('[data-widget-list]');
  const listHandle = card.querySelector('[data-widget-list-handle]');
  const fixedParts = Array.from(card.querySelectorAll('[data-widget-fixed]'));
  const defaultListHeight = Number(list?.dataset.widgetListHeight) || list?.offsetHeight || 0;
  const ABSOLUTE_MINIMUM_SCALE = .08;
  const MINIMUM_CONTENT_WIDTH = Math.min(designWidth, Math.max(120, designWidth * .3));
  const MINIMUM_FRAME_HEIGHT = Math.min(declaredHeight, Math.max(48, declaredHeight * .2));

  let contentWidth = designWidth;
  host.style.setProperty('--widget-content-width', `${contentWidth}px`);
  card.style.setProperty('--widget-content-width', `${contentWidth}px`);

  let naturalHeight = Math.max(1, card.offsetHeight || declaredHeight);
  let requestedScale = 1;
  let renderedScale = 1;
  let scaleLocked = false;
  let sharedVisualWidth = null;
  let widthLocked = false;
  let heightLocked = false;
  let requestedListHeight = null;
  let renderedListHeight = null;
  let listLocked = false;
  let sizeDrag = null;
  let listDrag = null;
  let frameRequest = 0;
  let frameTimer = 0;

  function number(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function readStoredSize(storageKey) {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function readSize() {
    return readStoredSize(key);
  }

  function readWidthSize() {
    return widthKey ? readStoredSize(widthKey) : {};
  }

  function saveSize() {
    const nextScale = Math.max(minimumScale(), Math.min(maximumScale(), requestedScale));
    if (widthKey) sharedVisualWidth = Math.round(contentWidth * nextScale);
    const value = {
      scale: requestedScale,
      scaleLocked,
      contentW: Math.round(contentWidth),
      widthLocked,
      frameH: Math.round(naturalHeight),
      heightLocked
    };
    if (list) {
      value.listH = Math.round(requestedListHeight ?? list.offsetHeight);
      value.listLocked = listLocked;
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
      if (widthKey) {
        localStorage.setItem(widthKey, JSON.stringify({
          scale: requestedScale,
          scaleLocked,
          visualW: sharedVisualWidth,
          widthLocked
        }));
      }
    } catch (_) {}
  }

  /* The widget never letterboxes: the white frame is always exactly the scaled
     card, so a wide or short embed can never leave an empty band around it. */
  function maximumScale() {
    const byWidth = Math.max(1, window.innerWidth) / contentWidth;
    const byHeight = Math.max(1, window.innerHeight) / naturalHeight;
    const configured = Number.isFinite(configuredMaximumScale) && configuredMaximumScale > 0
      ? configuredMaximumScale
      : Number.POSITIVE_INFINITY;
    return Math.max(ABSOLUTE_MINIMUM_SCALE, Math.min(configured, byWidth, byHeight));
  }

  function minimumScale() {
    return Math.min(ABSOLUTE_MINIMUM_SCALE, maximumScale());
  }

  function measureContentWidth() {
    if (sizeDrag) return contentWidth;
    if (widthKey) {
      /* Members can have different natural heights, so their height-limited
         scales may differ. Compensate with logical width so the outer widths
         still land on the same shared visual target. */
      const target = Math.max(MINIMUM_CONTENT_WIDTH, number(sharedVisualWidth, designWidth));
      const byHeight = Math.max(1, window.innerHeight) / naturalHeight;
      const configured = Number.isFinite(configuredMaximumScale) && configuredMaximumScale > 0
        ? configuredMaximumScale
        : Number.POSITIVE_INFINITY;
      const scaleWithoutWidth = Math.max(ABSOLUTE_MINIMUM_SCALE, Math.min(configured, byHeight, requestedScale));
      return target / scaleWithoutWidth;
    }
    if (widthLocked) return contentWidth;
    return designWidth;
  }

  function scaleFromSaved(saved, fallback) {
    if (Number.isFinite(Number(saved.scale))) return Number(saved.scale);
    const axisScales = ['scaleX', 'scaleY'].map(name => Number(saved[name])).filter(Number.isFinite);
    if (axisScales.length) return Math.min(...axisScales);
    const legacy = [];
    if (Number.isFinite(Number(saved.width))) legacy.push(Number(saved.width) / designWidth);
    if (Number.isFinite(Number(saved.height))) legacy.push(Number(saved.height) / naturalHeight);
    if (legacy.length) return Math.min(...legacy);
    return fallback;
  }

  function commitFrame() {
    cancelAnimationFrame(frameRequest);
    clearTimeout(frameTimer);
    frameRequest = 0;
    frameTimer = 0;

    const nextContentWidth = measureContentWidth();
    if (nextContentWidth !== contentWidth) {
      contentWidth = nextContentWidth;
      host.style.setProperty('--widget-content-width', `${contentWidth}px`);
      card.style.setProperty('--widget-content-width', `${contentWidth}px`);
    }

    /* Height tracks the card's content on every commit, not only on a
       ResizeObserver tick — so widgets that grow/shrink (e.g. an overlay that
       opens) still fit in contexts where animation frames are parked. List
       widgets keep the height applyListHeight computed for them. */
    if (!list && !sizeDrag && !heightLocked) {
      const measured = Math.max(1, card.offsetHeight || naturalHeight);
      if (Math.abs(measured - naturalHeight) >= .5) naturalHeight = measured;
    }

    renderedScale = Math.max(minimumScale(), Math.min(maximumScale(), requestedScale));
    const visualWidth = contentWidth * renderedScale;
    const visualHeight = naturalHeight * renderedScale;

    host.style.setProperty('--widget-base-width', `${contentWidth}px`);
    host.style.setProperty('--widget-base-height', `${naturalHeight}px`);
    host.style.setProperty('--widget-visual-width', `${visualWidth}px`);
    host.style.setProperty('--widget-visual-height', `${visualHeight}px`);
    host.style.setProperty('--widget-content-scale', String(renderedScale));
    card.style.setProperty('--widget-content-scale', String(renderedScale));
    host.dataset.widgetSizeReady = 'true';
    sizeLabel.textContent = `${Math.round(visualWidth)}×${Math.round(visualHeight)}`;

    sizeHandles.forEach(handle => {
      const axis = handle.dataset.widgetScaleAxis || 'both';
      if (axis === 'horizontal') {
        handle.setAttribute('aria-valuemin', String(Math.round(MINIMUM_CONTENT_WIDTH * renderedScale)));
        handle.setAttribute('aria-valuemax', String(Math.round(window.innerWidth)));
        handle.setAttribute('aria-valuenow', String(Math.round(visualWidth)));
        handle.setAttribute('aria-valuetext', `가로 ${Math.round(visualWidth)}픽셀`);
      } else if (axis === 'vertical') {
        handle.setAttribute('aria-valuemin', String(Math.round(MINIMUM_FRAME_HEIGHT * renderedScale)));
        handle.setAttribute('aria-valuemax', String(Math.round(window.innerHeight)));
        handle.setAttribute('aria-valuenow', String(Math.round(visualHeight)));
        handle.setAttribute('aria-valuetext', `세로 ${Math.round(visualHeight)}픽셀`);
      } else {
        handle.setAttribute('aria-valuemin', String(Math.round(minimumScale() * 100)));
        handle.setAttribute('aria-valuemax', String(Math.round(maximumScale() * 100)));
        handle.setAttribute('aria-valuenow', String(Math.round(renderedScale * 100)));
        handle.setAttribute('aria-valuetext', `${Math.round(visualWidth)} × ${Math.round(visualHeight)}픽셀`);
      }
    });

    document.body.classList.toggle('is-widget-overflowing', visualHeight > window.innerHeight + .5);
    const rect = host.getBoundingClientRect();
    topLeftHandle.style.left = `${Math.max(6, Math.min(window.innerWidth - 20, rect.left + 6))}px`;
    topLeftHandle.style.top = `${Math.max(6, Math.min(window.innerHeight - 20, rect.top + 6))}px`;
    scaleHandle.style.left = `${Math.max(6, Math.min(window.innerWidth - 20, rect.right - 20))}px`;
    scaleHandle.style.top = `${Math.max(6, Math.min(window.innerHeight - 20, rect.bottom - 20))}px`;

    const visibleTop = Math.max(6, rect.top);
    const visibleBottom = Math.min(window.innerHeight - 6, rect.bottom);
    const visibleMiddle = visibleBottom > visibleTop ? (visibleTop + visibleBottom) / 2 : window.innerHeight / 2;
    const widthHandleTop = Math.max(6, Math.min(window.innerHeight - 52, visibleMiddle - 23));
    leftWidthHandle.style.left = `${Math.max(6, Math.min(window.innerWidth - 10, rect.left + 6))}px`;
    rightWidthHandle.style.left = `${Math.max(6, Math.min(window.innerWidth - 10, rect.right - 10))}px`;
    leftWidthHandle.style.top = `${widthHandleTop}px`;
    rightWidthHandle.style.top = `${widthHandleTop}px`;

    const visibleLeft = Math.max(6, rect.left);
    const visibleRight = Math.min(window.innerWidth - 6, rect.right);
    const visibleHorizontalMiddle = visibleRight > visibleLeft ? (visibleLeft + visibleRight) / 2 : window.innerWidth / 2;
    const heightHandleLeft = Math.max(6, Math.min(window.innerWidth - 52, visibleHorizontalMiddle - 23));
    topHeightHandle.style.left = `${heightHandleLeft}px`;
    bottomHeightHandle.style.left = `${heightHandleLeft}px`;
    topHeightHandle.style.top = `${Math.max(6, Math.min(window.innerHeight - 10, rect.top + 6))}px`;
    bottomHeightHandle.style.top = `${Math.max(6, Math.min(window.innerHeight - 10, rect.bottom - 10))}px`;
  }

  /* A hidden or off-screen embed never gets an animation frame, so the timer
     guarantees the frame is committed even when rAF stays parked. */
  function updateFrame() {
    if (frameRequest || frameTimer) return;
    frameRequest = requestAnimationFrame(commitFrame);
    frameTimer = setTimeout(commitFrame, 48);
  }

  function applyScale(value, fromUser = false) {
    if (!Number.isFinite(value)) return;
    requestedScale = fromUser
      ? Math.max(minimumScale(), Math.min(maximumScale(), value))
      : Math.max(ABSOLUTE_MINIMUM_SCALE, value);
    if (fromUser) {
      scaleLocked = true;
      widthLocked = true;
    }
    updateFrame();
  }

  function maximumContentWidth(scale = renderedScale || requestedScale || 1) {
    return Math.max(1, window.innerWidth) / Math.max(ABSOLUTE_MINIMUM_SCALE, scale);
  }

  function maximumFrameHeight(scale = renderedScale || requestedScale || 1) {
    return Math.max(1, window.innerHeight) / Math.max(ABSOLUTE_MINIMUM_SCALE, scale);
  }

  function clampAxisSize(value, minimum, maximum) {
    const safeMaximum = Math.max(1, maximum);
    return Math.max(Math.min(minimum, safeMaximum), Math.min(safeMaximum, number(value, minimum)));
  }

  function applyContentWidth(value, fromUser = false, scale = renderedScale || requestedScale || 1) {
    const next = fromUser
      ? clampAxisSize(value, MINIMUM_CONTENT_WIDTH, maximumContentWidth(scale))
      : Math.max(MINIMUM_CONTENT_WIDTH, number(value, designWidth));
    if (fromUser) widthLocked = true;
    if (Math.abs(next - contentWidth) < .5) return;
    contentWidth = next;
    host.style.setProperty('--widget-content-width', `${contentWidth}px`);
    card.style.setProperty('--widget-content-width', `${contentWidth}px`);
    updateFrame();
  }

  function listOffset() {
    if (fixedParts.length) {
      const style = getComputedStyle(card);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const gap = parseFloat(style.rowGap || style.gap);
      const visibleParts = fixedParts.filter(part => part.offsetParent !== null);
      const fixedHeight = visibleParts.reduce((sum, part) => sum + part.offsetHeight, 0);
      return fixedHeight + padding + gap * visibleParts.length;
    }
    return Math.max(0, card.offsetHeight - list.offsetHeight);
  }

  function applyListHeight(value, fromUser = false) {
    if (!list) return;
    if (fromUser) listLocked = true;
    const offset = listOffset();
    const maximum = Math.max(40, (window.innerHeight / Math.max(ABSOLUTE_MINIMUM_SCALE, renderedScale)) - offset);
    const desired = number(value, requestedListHeight ?? list.offsetHeight);
    requestedListHeight = fromUser ? Math.max(Math.min(160, maximum), Math.min(maximum, desired)) : Math.max(40, desired);
    renderedListHeight = Math.max(40, Math.min(maximum, requestedListHeight));
    list.style.flex = `0 0 ${renderedListHeight}px`;
    list.style.height = `${renderedListHeight}px`;
    const nextCardHeight = Math.max(listLocked ? 1 : declaredHeight, offset + renderedListHeight);
    card.style.height = `${nextCardHeight}px`;
    naturalHeight = nextCardHeight;
    listHandle?.setAttribute('aria-valuenow', String(Math.round(requestedListHeight)));
    updateFrame();
  }

  function applyFrameHeight(value, fromUser = false, scale = renderedScale || requestedScale || 1) {
    const next = fromUser
      ? clampAxisSize(value, MINIMUM_FRAME_HEIGHT, maximumFrameHeight(scale))
      : Math.max(MINIMUM_FRAME_HEIGHT, number(value, naturalHeight));
    if (list) {
      applyListHeight(next - listOffset(), fromUser);
      heightLocked = listLocked;
      return;
    }
    if (fromUser) heightLocked = true;
    naturalHeight = next;
    card.style.height = `${naturalHeight}px`;
    updateFrame();
  }

  function lockAxisResize(axis) {
    requestedScale = renderedScale;
    scaleLocked = true;
    if (axis === 'horizontal') applyFrameHeight(naturalHeight, true, renderedScale);
    if (axis === 'vertical') widthLocked = true;
  }

  sizeHandles.forEach(handle => {
    handle.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const axis = handle.dataset.widgetScaleAxis || 'both';
      if (axis !== 'both') lockAxisResize(axis);
      sizeDrag = {
        handle,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        direction: ['top-left', 'left', 'top'].includes(handle.dataset.widgetScalePosition) ? -1 : 1,
        axis,
        scale: renderedScale,
        contentWidth,
        naturalHeight,
        width: contentWidth * renderedScale,
        height: naturalHeight * renderedScale
      };
      handle.setPointerCapture?.(event.pointerId);
      document.body.classList.add('is-widget-scaling');
      updateFrame();
    });

    handle.addEventListener('pointermove', event => {
      if (!sizeDrag || sizeDrag.handle !== handle || event.pointerId !== sizeDrag.pointerId) return;
      event.preventDefault();
      const widthDelta = (event.clientX - sizeDrag.x) * 2 * sizeDrag.direction;
      const heightDelta = (event.clientY - sizeDrag.y) * 2 * sizeDrag.direction;
      if (sizeDrag.axis === 'horizontal') {
        applyContentWidth((sizeDrag.width + widthDelta) / sizeDrag.scale, true, sizeDrag.scale);
        applyFrameHeight(sizeDrag.naturalHeight, true, sizeDrag.scale);
      } else if (sizeDrag.axis === 'vertical') {
        applyFrameHeight((sizeDrag.height + heightDelta) / sizeDrag.scale, true, sizeDrag.scale);
      } else {
        const widthRatio = widthDelta / Math.max(1, sizeDrag.width);
        const heightRatio = heightDelta / Math.max(1, sizeDrag.height);
        const ratio = Math.abs(widthRatio) >= Math.abs(heightRatio) ? widthRatio : heightRatio;
        applyScale(sizeDrag.scale * Math.max(.05, 1 + ratio), true);
      }
    });

    const finishSize = event => {
      if (!sizeDrag || sizeDrag.handle !== handle || event.pointerId !== sizeDrag.pointerId) return;
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      sizeDrag = null;
      document.body.classList.remove('is-widget-scaling');
      updateFrame();
      saveSize();
    };

    handle.addEventListener('pointerup', finishSize);
    handle.addEventListener('pointercancel', finishSize);
    handle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
    });

    handle.addEventListener('keydown', event => {
      const axis = handle.dataset.widgetScaleAxis || 'both';
      const allowedKeys = axis === 'horizontal'
        ? ['ArrowLeft', 'ArrowRight']
        : axis === 'vertical'
          ? ['ArrowUp', 'ArrowDown']
          : ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (!allowedKeys.includes(event.key)) return;
      event.preventDefault();
      const direction = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1;
      if (axis !== 'both') lockAxisResize(axis);
      if (axis === 'horizontal') {
        applyContentWidth(contentWidth + direction * 20 / Math.max(ABSOLUTE_MINIMUM_SCALE, renderedScale), true);
      } else if (axis === 'vertical') {
        applyFrameHeight(naturalHeight + direction * 20 / Math.max(ABSOLUTE_MINIMUM_SCALE, renderedScale), true);
      } else {
        applyScale(renderedScale * (1 + direction * .05), true);
      }
      saveSize();
    });
  });

  if (list && listHandle) {
    listHandle.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      listDrag = { pointerId: event.pointerId, y: event.clientY, height: renderedListHeight ?? list.offsetHeight };
      listHandle.setPointerCapture?.(event.pointerId);
      document.body.classList.add('is-widget-list-resizing');
    });

    listHandle.addEventListener('pointermove', event => {
      if (!listDrag || event.pointerId !== listDrag.pointerId) return;
      event.preventDefault();
      applyListHeight(listDrag.height + (event.clientY - listDrag.y) / Math.max(ABSOLUTE_MINIMUM_SCALE, renderedScale), true);
    });

    const finishList = event => {
      if (!listDrag || event.pointerId !== listDrag.pointerId) return;
      if (listHandle.hasPointerCapture?.(event.pointerId)) listHandle.releasePointerCapture(event.pointerId);
      listDrag = null;
      document.body.classList.remove('is-widget-list-resizing');
      saveSize();
    };

    listHandle.addEventListener('pointerup', finishList);
    listHandle.addEventListener('pointercancel', finishList);
    listHandle.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      applyListHeight((renderedListHeight ?? list.offsetHeight) + (event.key === 'ArrowDown' ? 20 : -20), true);
      saveSize();
    });
  }

  const saved = readSize();
  const horizontalSaved = widthKey ? readWidthSize() : saved;
  const hasHorizontal = property => Object.prototype.hasOwnProperty.call(horizontalSaved, property);
  scaleLocked = horizontalSaved.scaleLocked === true || (!hasHorizontal('scaleLocked') && ['scale', 'scaleX', 'scaleY', 'width', 'height'].some(hasHorizontal));
  requestedScale = Math.max(ABSOLUTE_MINIMUM_SCALE, scaleFromSaved(horizontalSaved, 1));
  widthLocked = horizontalSaved.widthLocked === true || (!hasHorizontal('widthLocked') && hasHorizontal('contentW'));
  if (widthKey) {
    const storedVisualWidth = Number(horizontalSaved.visualW);
    sharedVisualWidth = Number.isFinite(storedVisualWidth) && storedVisualWidth > 0 ? storedVisualWidth : null;
  } else {
    applyContentWidth(number(horizontalSaved.contentW, designWidth), false, requestedScale);
  }
  const hasOwn = property => Object.prototype.hasOwnProperty.call(saved, property);
  heightLocked = saved.heightLocked === true || (!hasOwn('heightLocked') && hasOwn('frameH'));
  listLocked = saved.listLocked === true || (Object.prototype.hasOwnProperty.call(saved, 'listH') && !Object.prototype.hasOwnProperty.call(saved, 'listLocked'));
  if (list && heightLocked) applyFrameHeight(number(saved.frameH, naturalHeight), false, requestedScale);
  else if (list) applyListHeight(number(saved.listH, defaultListHeight));
  else if (heightLocked) applyFrameHeight(number(saved.frameH, naturalHeight), false, requestedScale);
  commitFrame();

  new ResizeObserver(() => {
    if (heightLocked || sizeDrag) return;
    const measured = Math.max(1, card.offsetHeight || naturalHeight);
    if (Math.abs(measured - naturalHeight) < .5) return;
    naturalHeight = measured;
    updateFrame();
  }).observe(card);

  if (fixedParts.length) {
    const fixedObserver = new ResizeObserver(() => {
      if (listDrag) return;
      if (heightLocked) applyFrameHeight(naturalHeight);
      else applyListHeight(requestedListHeight ?? list.offsetHeight);
    });
    fixedParts.forEach(part => fixedObserver.observe(part));
  }

  function settleFrame() {
    if (!scaleLocked) requestedScale = 1;
    if (list && requestedListHeight !== null) applyListHeight(requestedListHeight);
    commitFrame();
    [60, 250, 1000].forEach(delay => setTimeout(commitFrame, delay));
  }

  window.addEventListener('resize', settleFrame);
  window.visualViewport?.addEventListener('resize', settleFrame);
  window.addEventListener('load', settleFrame, { once:true });
  window.addEventListener('pageshow', settleFrame);
  window.addEventListener('focus', settleFrame);
  new ResizeObserver(settleFrame).observe(document.documentElement);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') settleFrame();
  });

  settleFrame();

  window.addEventListener('storage', event => {
    const localChanged = event.key === key;
    const sharedWidthChanged = Boolean(widthKey) && event.key === widthKey;
    if (!localChanged && !sharedWidthChanged) return;
    if (sharedWidthChanged || (!widthKey && localChanged)) {
      const nextHorizontal = widthKey ? readWidthSize() : readSize();
      const ownsHorizontal = property => Object.prototype.hasOwnProperty.call(nextHorizontal, property);
      scaleLocked = nextHorizontal.scaleLocked === true || (!ownsHorizontal('scaleLocked') && ['scale', 'scaleX', 'scaleY', 'width', 'height'].some(ownsHorizontal));
      requestedScale = Math.max(ABSOLUTE_MINIMUM_SCALE, scaleFromSaved(nextHorizontal, 1));
      widthLocked = nextHorizontal.widthLocked === true || (!ownsHorizontal('widthLocked') && ownsHorizontal('contentW'));
      if (widthKey) {
        const storedVisualWidth = Number(nextHorizontal.visualW);
        sharedVisualWidth = Number.isFinite(storedVisualWidth) && storedVisualWidth > 0 ? storedVisualWidth : null;
      } else {
        applyContentWidth(number(nextHorizontal.contentW, designWidth), false, requestedScale);
      }
    }
    if (localChanged) {
      const next = readSize();
      const owns = property => Object.prototype.hasOwnProperty.call(next, property);
      heightLocked = next.heightLocked === true || (!owns('heightLocked') && owns('frameH'));
      listLocked = next.listLocked === true || (Object.prototype.hasOwnProperty.call(next, 'listH') && !Object.prototype.hasOwnProperty.call(next, 'listLocked'));
      if (list && heightLocked) applyFrameHeight(number(next.frameH, naturalHeight), false, requestedScale);
      else if (list) applyListHeight(number(next.listH, requestedListHeight ?? list.offsetHeight));
      else if (heightLocked) applyFrameHeight(number(next.frameH, naturalHeight), false, requestedScale);
    }
    updateFrame();
  });
})();
