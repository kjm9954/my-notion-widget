(() => {
  'use strict';

  const host = document.querySelector('[data-widget-host]');
  const card = host?.querySelector('[data-widget-card]');
  const scaleHandle = card?.querySelector('[data-widget-scale-handle]');
  const sizeLabel = card?.querySelector('[data-widget-size-label]');
  if (!host || !card || !scaleHandle || !sizeLabel) return;

  const key = host.dataset.widgetKey || `widget-size-${location.pathname.split('/').pop() || 'index.html'}`;
  const maximumWidth = Number(host.dataset.widgetMaxWidth || host.dataset.widgetWidth) || card.offsetWidth;
  const defaultHeight = Number(host.dataset.widgetHeight) || card.offsetHeight;
  const list = card.querySelector('[data-widget-list]');
  const listHandle = card.querySelector('[data-widget-list-handle]');
  const fixed = card.querySelector('[data-widget-fixed]');
  const minimumScale = .7;
  let requestedScale = 1;
  let renderedScale = 1;
  let baseHeight = defaultHeight;
  let baseWidth = Math.min(maximumWidth, window.innerWidth);
  let requestedListHeight = null;
  let renderedListHeight = null;
  let scaleDrag = null;
  let listDrag = null;
  let frameRequest = 0;

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
    const value = { scale: requestedScale };
    if (list) value.listH = Math.round(requestedListHeight ?? list.offsetHeight);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function maximumScale() {
    const widthLimit = window.innerWidth / Math.max(1, baseWidth);
    const heightLimit = window.innerHeight / Math.max(1, baseHeight);
    return Math.max(.1, Math.min(1, widthLimit, heightLimit));
  }

  function displayScale(value) {
    const maximum = maximumScale();
    const minimum = Math.min(minimumScale, maximum);
    return Math.max(minimum, Math.min(maximum, number(value, 1)));
  }

  function userScale(value) {
    const maximum = maximumScale();
    const minimum = Math.min(minimumScale, maximum);
    return Math.max(minimum, Math.min(maximum, number(value, 1)));
  }

  function updateFrame() {
    cancelAnimationFrame(frameRequest);
    frameRequest = requestAnimationFrame(() => {
      const measuredHeight = card.offsetHeight || defaultHeight;
      const measuredWidth = card.offsetWidth || Math.min(maximumWidth, window.innerWidth);
      baseHeight = measuredHeight;
      baseWidth = measuredWidth;
      renderedScale = displayScale(requestedScale);
      host.style.setProperty('--widget-max-width', `${maximumWidth}px`);
      host.style.setProperty('--widget-base-width', `${baseWidth}px`);
      host.style.setProperty('--widget-base-height', `${baseHeight}px`);
      host.style.setProperty('--widget-scale', String(renderedScale));
      host.style.setProperty('--widget-visual-height', `${baseHeight * renderedScale}px`);
      card.style.setProperty('--widget-max-width', `${maximumWidth}px`);
      card.style.setProperty('--widget-scale', String(renderedScale));
      sizeLabel.textContent = `${Math.round(baseWidth * renderedScale)}×${Math.round(baseHeight * renderedScale)}`;
      scaleHandle.setAttribute('aria-valuenow', String(Math.round(requestedScale * 100)));
    });
  }

  function applyScale(value, fromUser = false) {
    requestedScale = fromUser ? userScale(value) : Math.max(.1, number(value, 1));
    updateFrame();
  }

  function listOffset() {
    if (fixed) {
      const style = getComputedStyle(card);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const gap = parseFloat(style.rowGap || style.gap);
      return fixed.offsetHeight + padding + gap;
    }
    const measuredList = list.offsetHeight;
    return Math.max(0, card.offsetHeight - measuredList);
  }

  function listMaximum(offset) {
    return Math.max(40, window.innerHeight / Math.max(renderedScale, .1) - offset);
  }

  function applyListHeight(value, fromUser = false) {
    if (!list) return;
    const offset = listOffset();
    const maximum = listMaximum(offset);
    const desired = number(value, requestedListHeight ?? list.offsetHeight);
    requestedListHeight = fromUser
      ? Math.max(Math.min(160, maximum), Math.min(maximum, desired))
      : Math.max(40, desired);
    renderedListHeight = Math.max(40, Math.min(maximum, requestedListHeight));
    list.style.flex = `0 0 ${renderedListHeight}px`;
    list.style.height = `${renderedListHeight}px`;
    card.style.height = `${offset + renderedListHeight}px`;
    listHandle?.setAttribute('aria-valuenow', String(Math.round(requestedListHeight)));
    updateFrame();
  }

  scaleHandle.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    scaleDrag = { pointerId: event.pointerId, x: event.clientX, scale: renderedScale };
    scaleHandle.setPointerCapture?.(event.pointerId);
    document.body.classList.add('is-widget-scaling');
    updateFrame();
  });

  scaleHandle.addEventListener('pointermove', event => {
    if (!scaleDrag || event.pointerId !== scaleDrag.pointerId) return;
    event.preventDefault();
    const delta = event.clientX - scaleDrag.x;
    applyScale(scaleDrag.scale + delta / Math.max(1, baseWidth), true);
  });

  function finishScale(event) {
    if (!scaleDrag || event.pointerId !== scaleDrag.pointerId) return;
    if (scaleHandle.hasPointerCapture?.(event.pointerId)) scaleHandle.releasePointerCapture(event.pointerId);
    scaleDrag = null;
    document.body.classList.remove('is-widget-scaling');
    updateFrame();
    saveSize();
  }

  scaleHandle.addEventListener('pointerup', finishScale);
  scaleHandle.addEventListener('pointercancel', finishScale);
  scaleHandle.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
  });

  scaleHandle.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const direction = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1;
    applyScale(requestedScale + direction * .05, true);
    saveSize();
  });

  if (list && listHandle) {
    listHandle.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      listDrag = { pointerId: event.pointerId, y: event.clientY, height: renderedListHeight ?? list.offsetHeight, offset: listOffset() };
      listHandle.setPointerCapture?.(event.pointerId);
      document.body.classList.add('is-widget-list-resizing');
    });

    listHandle.addEventListener('pointermove', event => {
      if (!listDrag || event.pointerId !== listDrag.pointerId) return;
      event.preventDefault();
      applyListHeight(listDrag.height + (event.clientY - listDrag.y) / Math.max(renderedScale, .1), true);
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
  requestedScale = Math.max(.1, number(saved.scale, 1));
  if (list) applyListHeight(number(saved.listH, list.offsetHeight));
  applyScale(requestedScale);

  new ResizeObserver(() => updateFrame()).observe(card);
  if (fixed) {
    new ResizeObserver(() => {
      if (!listDrag) applyListHeight(requestedListHeight ?? list.offsetHeight);
    }).observe(fixed);
  }
  window.addEventListener('resize', () => {
    if (list && requestedListHeight !== null) applyListHeight(requestedListHeight);
    else updateFrame();
  });
  window.addEventListener('storage', event => {
    if (event.key !== key) return;
    const next = readSize();
    requestedScale = Math.max(.1, number(next.scale, 1));
    if (list) applyListHeight(number(next.listH, requestedListHeight ?? list.offsetHeight));
    applyScale(requestedScale);
  });
})();
