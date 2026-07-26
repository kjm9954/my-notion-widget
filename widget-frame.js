/* Idle breath: keep exactly one target alive in each widget, prefer the whole
   empty block when the current view is empty, and pause whenever attention is
   elsewhere. A shared helper also lets removed rows close their own place. */
(() => {
  'use strict';

  const card = document.querySelector('[data-widget-card]');
  const file = decodeURIComponent(location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const targets = {
    'index.html': { selector:'.quadrant.is-selected', kind:'outline' },
    'thoughts.html': { selector:'.banner-age, .entry-hint', empty:'.empty-list' },
    'find.html': { selector:'.banner-label, .filter-caption:not([hidden]), .manage-button', empty:'.empty-list' },
    'add.html': { selector:'.detail-toggle' },
    'quote-drawer.html': { selector:'.today-quote .quote-rule', empty:'.empty-state' },
    'life-books.html': { selector:'.quote-panel .quote-rule', empty:'.empty-state' },
    'reading-count.html': { selector:'.eyebrow', empty:'.empty-state' },
    'wishlist.html': { selector:'.bought', kind:'border', empty:'.all-empty, .filter-empty' },
    'drawer.html': { selector:'.banner-title', empty:'.quote-list > .empty' },
    'library.html': { selector:'.title', empty:'#libraryView > .no-books' },
    'session.html': { selector:'.capture-hint', empty:'.draft-list:has(.draft-empty)' },
    'today.html': { selector:'.date-title', empty:'.empty-block' },
    'calendar.html': { selector:'.today-ring' },
    'mood.html': { selector:'.control-label', empty:'.history > .empty' },
    'achieve.html': { selector:'.title', empty:'#content.empty' },
    'empty.html': { selector:'.title' },
    'material.html': { selector:'.label-block .title', empty:'.chip-area > .empty' },
    'stats.html': { selector:'.meter-label' },
    'goals.html': { selector:'.goal-column.accent .column-label, .column-label', empty:'.goal-column .empty' },
    'record.html': { selector:'.legend-item' }
  };
  const fallbackSelector = '.title, .card-title, .date-title, .month-title, .column-label, .meter-label, .label, .section-head';
  let idleSyncQueued = false;

  function isVisible(element) {
    if (!element || element.hidden) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  }

  function firstVisible(selector) {
    if (!selector) return null;
    for (const part of selector.split(',').map(value => value.trim()).filter(Boolean)) {
      const match = Array.from(document.querySelectorAll(part)).find(isVisible);
      if (match) return match;
    }
    return null;
  }

  function idleNode(owner, kind) {
    if (!owner || !kind) return owner;
    owner.classList.add('idle-owner');
    let overlay = Array.from(owner.children).find(child => child.hasAttribute('data-idle-outline'));
    if (!overlay) {
      overlay = document.createElement('span');
      overlay.setAttribute('data-idle-outline', '');
      overlay.setAttribute('aria-hidden', 'true');
      owner.appendChild(overlay);
    }
    const className = `idle-outline idle-outline-${kind}`;
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
    const emptyTarget = firstVisible(config.empty);
    const owner = emptyTarget || firstVisible(config.selector) || firstVisible(fallbackSelector) || card;
    const target = idleNode(owner, emptyTarget ? '' : config.kind);
    const current = Array.from(document.querySelectorAll('.idle'));

    current.forEach(element => {
      if (element !== target) element.classList.remove('idle', 'is-empty', 'is-paused');
    });
    document.querySelectorAll('.idle-owner').forEach(element => {
      if (element !== owner) element.classList.remove('idle-owner');
    });
    target.classList.add('idle');
    target.classList.toggle('is-empty', Boolean(emptyTarget));
    target.classList.toggle('is-paused', document.visibilityState !== 'visible');
    document.body.classList.toggle('has-widget-expanded', hasExpandedState());
  }

  function queueIdleSync() {
    if (idleSyncQueued) return;
    idleSyncQueued = true;
    queueMicrotask(syncIdle);
  }

  function syncBreath() {
    const hidden = document.visibilityState !== 'visible';
    document.body.classList.toggle('is-widget-hidden', hidden);
    document.querySelectorAll('.idle').forEach(element => element.classList.toggle('is-paused', hidden));
    queueIdleSync();
  }

  document.addEventListener('visibilitychange', syncBreath);
  if (card) {
    new MutationObserver(queueIdleSync).observe(card, { childList:true, subtree:true });
    ['click', 'input', 'change'].forEach(type => card.addEventListener(type, () => setTimeout(queueIdleSync, 0)));
  }
  syncBreath();
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
      setTimeout(once, 260);
    }
  };
})();

(() => {
  'use strict';

  const host = document.querySelector('[data-widget-host]');
  const card = host?.querySelector('[data-widget-card]');
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
  const designWidth = Number(host.dataset.widgetMaxWidth || host.dataset.widgetWidth) || card.offsetWidth || 320;
  const declaredHeight = Number(host.dataset.widgetHeight) || card.offsetHeight || 200;
  const configuredMaximumScale = Number(host.dataset.widgetMaxScale);
  const list = card.querySelector('[data-widget-list]');
  const listHandle = card.querySelector('[data-widget-list-handle]');
  const fixed = card.querySelector('[data-widget-fixed]');
  const ABSOLUTE_MINIMUM_SCALE = .08;

  let contentWidth = designWidth;
  host.style.setProperty('--widget-content-width', `${contentWidth}px`);
  card.style.setProperty('--widget-content-width', `${contentWidth}px`);

  let naturalHeight = Math.max(1, card.offsetHeight || declaredHeight);
  let requestedScale = 1;
  let renderedScale = 1;
  let scaleLocked = false;
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

  function readSize() {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveSize() {
    const value = { scale: requestedScale, scaleLocked };
    if (list) {
      value.listH = Math.round(requestedListHeight ?? list.offsetHeight);
      value.listLocked = listLocked;
    }
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  /* The widget never letterboxes: the white frame is always exactly the scaled
     card, so a wide or short embed can never leave an empty band around it. */
  function maximumScale() {
    if (Number.isFinite(configuredMaximumScale) && configuredMaximumScale > 0) return configuredMaximumScale;
    const byWidth = Math.max(1, window.innerWidth) / contentWidth;
    const byHeight = Math.max(1, window.innerHeight) / naturalHeight;
    return Math.max(ABSOLUTE_MINIMUM_SCALE, Math.min(byWidth, byHeight));
  }

  function minimumScale() {
    return Math.min(ABSOLUTE_MINIMUM_SCALE, maximumScale());
  }

  function measureContentWidth() {
    return designWidth;
  }

  function scaleFromSaved(saved, fallback) {
    if (Number.isFinite(Number(saved.scale))) return Number(saved.scale);
    const axisScales = ['scaleX', 'scaleY'].map(name => Number(saved[name])).filter(Number.isFinite);
    if (axisScales.length) return Math.min(...axisScales);
    const legacy = [];
    if (Number.isFinite(Number(saved.width))) legacy.push(Number(saved.width) / contentWidth);
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
        handle.setAttribute('aria-valuemin', String(Math.round(contentWidth * minimumScale())));
        handle.setAttribute('aria-valuemax', String(Math.round(contentWidth * maximumScale())));
        handle.setAttribute('aria-valuenow', String(Math.round(visualWidth)));
        handle.setAttribute('aria-valuetext', `가로 ${Math.round(visualWidth)}픽셀`);
      } else if (axis === 'vertical') {
        handle.setAttribute('aria-valuemin', String(Math.round(naturalHeight * minimumScale())));
        handle.setAttribute('aria-valuemax', String(Math.round(naturalHeight * maximumScale())));
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
    if (fromUser) scaleLocked = true;
    updateFrame();
  }

  function listOffset() {
    if (fixed) {
      const style = getComputedStyle(card);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const gap = parseFloat(style.rowGap || style.gap);
      return fixed.offsetHeight + padding + gap;
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

  sizeHandles.forEach(handle => {
    handle.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      sizeDrag = {
        handle,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        direction: ['top-left', 'left', 'top'].includes(handle.dataset.widgetScalePosition) ? -1 : 1,
        axis: handle.dataset.widgetScaleAxis || 'both',
        scale: renderedScale,
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
        applyScale((sizeDrag.width + widthDelta) / contentWidth, true);
      } else if (sizeDrag.axis === 'vertical') {
        applyScale((sizeDrag.height + heightDelta) / naturalHeight, true);
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
      if (axis === 'horizontal') {
        applyScale((contentWidth * renderedScale + direction * 20) / contentWidth, true);
      } else if (axis === 'vertical') {
        applyScale((naturalHeight * renderedScale + direction * 20) / naturalHeight, true);
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
  scaleLocked = saved.scaleLocked === true || ['scale', 'scaleX', 'scaleY', 'width', 'height'].some(property => Object.prototype.hasOwnProperty.call(saved, property));
  requestedScale = Math.max(ABSOLUTE_MINIMUM_SCALE, scaleFromSaved(saved, 1));
  listLocked = saved.listLocked === true || (Object.prototype.hasOwnProperty.call(saved, 'listH') && !Object.prototype.hasOwnProperty.call(saved, 'listLocked'));
  if (list) applyListHeight(number(saved.listH, list.offsetHeight));
  commitFrame();

  new ResizeObserver(() => {
    const measured = Math.max(1, card.offsetHeight || naturalHeight);
    if (Math.abs(measured - naturalHeight) < .5) return;
    naturalHeight = measured;
    updateFrame();
  }).observe(card);

  if (fixed) {
    new ResizeObserver(() => {
      if (!listDrag) applyListHeight(requestedListHeight ?? list.offsetHeight);
    }).observe(fixed);
  }

  window.addEventListener('resize', () => {
    if (!scaleLocked) requestedScale = 1;
    if (list && requestedListHeight !== null) applyListHeight(requestedListHeight);
    else updateFrame();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') updateFrame();
  });

  window.addEventListener('storage', event => {
    if (event.key !== key) return;
    const next = readSize();
    scaleLocked = next.scaleLocked === true || ['scale', 'scaleX', 'scaleY', 'width', 'height'].some(property => Object.prototype.hasOwnProperty.call(next, property));
    requestedScale = Math.max(ABSOLUTE_MINIMUM_SCALE, scaleFromSaved(next, 1));
    listLocked = next.listLocked === true || (Object.prototype.hasOwnProperty.call(next, 'listH') && !Object.prototype.hasOwnProperty.call(next, 'listLocked'));
    if (list) applyListHeight(number(next.listH, requestedListHeight ?? list.offsetHeight));
    updateFrame();
  });
})();
