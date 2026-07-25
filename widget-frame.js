(() => {
  'use strict';

  const host = document.querySelector('[data-widget-host]');
  const card = host?.querySelector('[data-widget-card]');
  const scaleHandle = card?.querySelector('[data-widget-scale-handle]');
  const sizeLabel = card?.querySelector('[data-widget-size-label]');
  if (!host || !card || !scaleHandle || !sizeLabel) return;

  const key = host.dataset.widgetKey || `widget-size-${location.pathname.split('/').pop() || 'index.html'}`;
  const defaultWidth = Number(host.dataset.widgetWidth) || card.offsetWidth;
  const defaultHeight = Number(host.dataset.widgetHeight) || card.offsetHeight;
  const list = card.querySelector('[data-widget-list]');
  const listHandle = card.querySelector('[data-widget-list-handle]');
  const fixed = card.querySelector('[data-widget-fixed]');
  const minimumScale = .7;
  let scale = 1;
  let baseHeight = defaultHeight;
  let listHeight = null;
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
    const value = { scale };
    if (list) value.listH = Math.round(listHeight ?? list.getBoundingClientRect().height / scale);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function maximumScale() {
    const widthLimit = window.innerWidth / defaultWidth;
    const heightLimit = window.innerHeight / Math.max(1, baseHeight);
    return Math.max(.1, Math.min(widthLimit, heightLimit));
  }

  function clampScale(value) {
    const maximum = maximumScale();
    const minimum = Math.min(minimumScale, maximum);
    return Math.max(minimum, Math.min(maximum, number(value, 1)));
  }

  function updateFrame() {
    cancelAnimationFrame(frameRequest);
    frameRequest = requestAnimationFrame(() => {
      const measuredHeight = card.offsetHeight || defaultHeight;
      baseHeight = measuredHeight;
      scale = clampScale(scale);
      host.style.setProperty('--widget-base-width', `${defaultWidth}px`);
      host.style.setProperty('--widget-base-height', `${baseHeight}px`);
      host.style.setProperty('--widget-scale', String(scale));
      host.style.setProperty('--widget-visual-height', `${baseHeight * scale}px`);
      card.style.setProperty('--widget-scale', String(scale));
      sizeLabel.textContent = `${Math.round(defaultWidth * scale)}×${Math.round(baseHeight * scale)}`;
      scaleHandle.setAttribute('aria-valuenow', String(Math.round(scale * 100)));
    });
  }

  function applyScale(value) {
    scale = clampScale(value);
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
    return Math.max(160, window.innerHeight / Math.max(scale, .1) - offset);
  }

  function applyListHeight(value) {
    if (!list) return;
    const offset = listOffset();
    listHeight = Math.max(160, Math.min(listMaximum(offset), number(value, list.offsetHeight)));
    list.style.flex = `0 0 ${listHeight}px`;
    list.style.height = `${listHeight}px`;
    card.style.height = `${offset + listHeight}px`;
    listHandle?.setAttribute('aria-valuenow', String(Math.round(listHeight)));
    updateFrame();
  }

  scaleHandle.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    scaleDrag = { pointerId: event.pointerId, x: event.clientX, scale };
    scaleHandle.setPointerCapture?.(event.pointerId);
    document.body.classList.add('is-widget-scaling');
    updateFrame();
  });

  scaleHandle.addEventListener('pointermove', event => {
    if (!scaleDrag || event.pointerId !== scaleDrag.pointerId) return;
    event.preventDefault();
    const delta = event.clientX - scaleDrag.x;
    applyScale(scaleDrag.scale + delta / defaultWidth);
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
    applyScale(scale + direction * .05);
    saveSize();
  });

  if (list && listHandle) {
    listHandle.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      listDrag = { pointerId: event.pointerId, y: event.clientY, height: list.offsetHeight, offset: listOffset() };
      listHandle.setPointerCapture?.(event.pointerId);
      document.body.classList.add('is-widget-list-resizing');
    });

    listHandle.addEventListener('pointermove', event => {
      if (!listDrag || event.pointerId !== listDrag.pointerId) return;
      event.preventDefault();
      applyListHeight(listDrag.height + (event.clientY - listDrag.y) / Math.max(scale, .1));
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
      applyListHeight(list.offsetHeight + (event.key === 'ArrowDown' ? 20 : -20));
      saveSize();
    });
  }

  const saved = readSize();
  scale = number(saved.scale, 1);
  if (list) applyListHeight(number(saved.listH, list.offsetHeight));
  applyScale(scale);

  new ResizeObserver(() => updateFrame()).observe(card);
  if (fixed) {
    new ResizeObserver(() => {
      if (!listDrag) applyListHeight(listHeight ?? list.offsetHeight);
    }).observe(fixed);
  }
  window.addEventListener('resize', () => {
    if (list && listHeight !== null) applyListHeight(listHeight);
    else updateFrame();
  });
  window.addEventListener('storage', event => {
    if (event.key !== key) return;
    const next = readSize();
    scale = number(next.scale, 1);
    if (list) applyListHeight(number(next.listH, listHeight ?? list.offsetHeight));
    applyScale(scale);
  });
})();
