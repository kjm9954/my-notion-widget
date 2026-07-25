(() => {
  'use strict';

  const host = document.querySelector('[data-widget-host]');
  const card = host?.querySelector('[data-widget-card]');
  const scaleHandle = card?.querySelector('[data-widget-scale-handle]');
  const sizeLabel = card?.querySelector('[data-widget-size-label]');
  if (!host || !card || !scaleHandle || !sizeLabel) return;

  scaleHandle.dataset.widgetScalePosition ||= 'bottom-right';
  scaleHandle.dataset.widgetScaleAxis = 'both';
  let topLeftHandle = document.querySelector('[data-widget-scale-position="top-left"]');
  if (!topLeftHandle) {
    topLeftHandle = scaleHandle.cloneNode(false);
    topLeftHandle.classList.add('widget-size-handle-top-left');
    topLeftHandle.dataset.widgetScalePosition = 'top-left';
    topLeftHandle.setAttribute('aria-label', '왼쪽 위에서 위젯 비율 고정 크기 조절');
  }
  topLeftHandle.dataset.widgetScaleAxis = 'both';
  document.body.appendChild(topLeftHandle);

  function viewportWidthHandle(position, label) {
    let handle = document.querySelector(`[data-widget-scale-position="${position}"]`);
    if (!handle) {
      handle = scaleHandle.cloneNode(false);
      handle.className = `widget-width-handle widget-width-handle-${position}`;
      handle.dataset.widgetScalePosition = position;
      handle.dataset.widgetScaleAxis = 'horizontal';
      handle.setAttribute('aria-label', label);
    }
    document.body.appendChild(handle);
    return handle;
  }

  const leftWidthHandle = viewportWidthHandle('left', '왼쪽에서 가로 크기 비율 고정 조절');
  const rightWidthHandle = viewportWidthHandle('right', '오른쪽에서 가로 크기 비율 고정 조절');

  function viewportHeightHandle(position, label) {
    let handle = document.querySelector(`[data-widget-scale-position="${position}"]`);
    if (!handle) {
      handle = scaleHandle.cloneNode(false);
      handle.className = `widget-height-handle widget-height-handle-${position}`;
      handle.dataset.widgetScalePosition = position;
      handle.dataset.widgetScaleAxis = 'vertical';
      handle.setAttribute('aria-label', label);
    }
    document.body.appendChild(handle);
    return handle;
  }

  const topHeightHandle = viewportHeightHandle('top', '위쪽에서 세로 크기 비율 고정 조절');
  const bottomHeightHandle = viewportHeightHandle('bottom', '아래쪽에서 세로 크기 비율 고정 조절');
  const scaleHandles = [
    scaleHandle,
    topLeftHandle,
    leftWidthHandle,
    rightWidthHandle,
    topHeightHandle,
    bottomHeightHandle
  ];

  const key = host.dataset.widgetKey || `widget-size-${location.pathname.split('/').pop() || 'index.html'}`;
  const maximumWidth = Number(host.dataset.widgetMaxWidth || host.dataset.widgetWidth) || card.offsetWidth;
  const defaultHeight = Number(host.dataset.widgetHeight) || card.offsetHeight;
  const configuredMaximumScale = Number(host.dataset.widgetMaxScale);
  const list = card.querySelector('[data-widget-list]');
  const listHandle = card.querySelector('[data-widget-list-handle]');
  const fixed = card.querySelector('[data-widget-fixed]');
  const minimumScale = .05;
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
    if (Number.isFinite(configuredMaximumScale) && configuredMaximumScale > 0) {
      return Math.max(minimumScale, configuredMaximumScale);
    }
    return Math.max(.02, Math.min(widthLimit, heightLimit));
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
      const visualHeight = baseHeight * renderedScale;
      host.style.setProperty('--widget-max-width', `${maximumWidth}px`);
      host.style.setProperty('--widget-base-width', `${baseWidth}px`);
      host.style.setProperty('--widget-base-height', `${baseHeight}px`);
      host.style.setProperty('--widget-scale', String(renderedScale));
      host.style.setProperty('--widget-visual-height', `${visualHeight}px`);
      card.style.setProperty('--widget-max-width', `${maximumWidth}px`);
      card.style.setProperty('--widget-scale', String(renderedScale));
      sizeLabel.textContent = `${Math.round(baseWidth * renderedScale)}×${Math.round(baseHeight * renderedScale)}`;
      scaleHandles.forEach(handle => {
        handle.setAttribute('aria-valuemin', String(Math.round(Math.min(minimumScale, maximumScale()) * 100)));
        handle.setAttribute('aria-valuemax', String(Math.round(maximumScale() * 100)));
        handle.setAttribute('aria-valuenow', String(Math.round(requestedScale * 100)));
      });
      document.body.classList.toggle('is-widget-overflowing', visualHeight > window.innerHeight + .5);
      const rect = card.getBoundingClientRect();
      topLeftHandle.style.left = `${Math.max(6, Math.min(window.innerWidth - 20, rect.left + 6))}px`;
      topLeftHandle.style.top = `${Math.max(6, Math.min(window.innerHeight - 20, rect.top + 6))}px`;
      const visibleTop = Math.max(6, rect.top);
      const visibleBottom = Math.min(window.innerHeight - 6, rect.bottom);
      const visibleMiddle = visibleBottom > visibleTop
        ? (visibleTop + visibleBottom) / 2
        : window.innerHeight / 2;
      const widthHandleTop = Math.max(6, Math.min(window.innerHeight - 52, visibleMiddle - 23));
      const visibleLeft = Math.max(6, rect.left);
      const visibleRight = Math.min(window.innerWidth - 6, rect.right);
      const visibleHorizontalMiddle = visibleRight > visibleLeft
        ? (visibleLeft + visibleRight) / 2
        : window.innerWidth / 2;
      const heightHandleLeft = Math.max(6, Math.min(window.innerWidth - 52, visibleHorizontalMiddle - 23));
      leftWidthHandle.style.left = `${Math.max(6, Math.min(window.innerWidth - 10, rect.left + 6))}px`;
      rightWidthHandle.style.left = `${Math.max(6, Math.min(window.innerWidth - 10, rect.right - 10))}px`;
      leftWidthHandle.style.top = `${widthHandleTop}px`;
      rightWidthHandle.style.top = `${widthHandleTop}px`;
      topHeightHandle.style.left = `${heightHandleLeft}px`;
      bottomHeightHandle.style.left = `${heightHandleLeft}px`;
      topHeightHandle.style.top = `${Math.max(6, Math.min(window.innerHeight - 10, rect.top + 6))}px`;
      bottomHeightHandle.style.top = `${Math.max(6, Math.min(window.innerHeight - 10, rect.bottom - 10))}px`;
    });
  }

  function applyScale(value, fromUser = false) {
    requestedScale = fromUser ? userScale(value) : Math.max(minimumScale, number(value, 1));
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

  scaleHandles.forEach(handle => {
    handle.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      scaleDrag = {
        handle,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        direction: ['top-left', 'left', 'top'].includes(handle.dataset.widgetScalePosition) ? -1 : 1,
        axis: handle.dataset.widgetScaleAxis || 'both',
        scale: renderedScale,
        width: baseWidth,
        height: baseHeight
      };
      handle.setPointerCapture?.(event.pointerId);
      document.body.classList.add('is-widget-scaling');
      updateFrame();
    });

    handle.addEventListener('pointermove', event => {
      if (!scaleDrag || scaleDrag.handle !== handle || event.pointerId !== scaleDrag.pointerId) return;
      event.preventDefault();
      const horizontalDelta = (event.clientX - scaleDrag.x) * 2 * scaleDrag.direction / Math.max(1, scaleDrag.width);
      const verticalDelta = (event.clientY - scaleDrag.y) * scaleDrag.direction / Math.max(1, scaleDrag.height);
      const scaleDelta = scaleDrag.axis === 'horizontal'
        ? horizontalDelta
        : scaleDrag.axis === 'vertical'
          ? verticalDelta
        : Math.abs(horizontalDelta) >= Math.abs(verticalDelta)
          ? horizontalDelta
          : verticalDelta;
      applyScale(scaleDrag.scale + scaleDelta, true);
    });

    const finishScale = event => {
      if (!scaleDrag || scaleDrag.handle !== handle || event.pointerId !== scaleDrag.pointerId) return;
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      scaleDrag = null;
      document.body.classList.remove('is-widget-scaling');
      updateFrame();
      saveSize();
    };

    handle.addEventListener('pointerup', finishScale);
    handle.addEventListener('pointercancel', finishScale);
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
      applyScale(requestedScale + direction * .05, true);
      saveSize();
    });
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
  requestedScale = Math.max(minimumScale, number(saved.scale, 1));
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
    requestedScale = Math.max(minimumScale, number(next.scale, 1));
    if (list) applyListHeight(number(next.listH, requestedListHeight ?? list.offsetHeight));
    applyScale(requestedScale);
  });
})();
