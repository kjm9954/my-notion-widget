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
  const designWidth = Number(host.dataset.widgetMaxWidth || host.dataset.widgetWidth) || card.offsetWidth;
  const defaultWidth = Math.min(designWidth, Math.max(1, window.innerWidth));
  host.style.setProperty('--widget-content-width', `${defaultWidth}px`);
  card.style.setProperty('--widget-content-width', `${defaultWidth}px`);
  const declaredHeight = Number(host.dataset.widgetHeight) || card.offsetHeight;
  const initialNaturalHeight = card.offsetHeight || declaredHeight;
  const configuredMaximumScale = Number(host.dataset.widgetMaxScale);
  const list = card.querySelector('[data-widget-list]');
  const listHandle = card.querySelector('[data-widget-list-handle]');
  const fixed = card.querySelector('[data-widget-fixed]');
  const minimumWidth = Math.max(20, Math.min(80, defaultWidth));
  const minimumHeight = Math.max(20, Math.min(60, initialNaturalHeight));
  let requestedWidth = defaultWidth;
  let requestedHeight = initialNaturalHeight;
  let renderedWidth = defaultWidth;
  let renderedHeight = initialNaturalHeight;
  let naturalHeight = initialNaturalHeight;
  let widthLocked = false;
  let heightLocked = false;
  let requestedListHeight = null;
  let renderedListHeight = null;
  let sizeDrag = null;
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
    const value = { width: requestedWidth, height: requestedHeight, widthLocked, heightLocked };
    if (list) value.listH = Math.round(requestedListHeight ?? list.offsetHeight);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function maximumWidth() {
    if (Number.isFinite(configuredMaximumScale) && configuredMaximumScale > 0) {
      return Math.max(minimumWidth, designWidth * configuredMaximumScale);
    }
    return Math.max(minimumWidth, window.innerWidth);
  }

  function maximumHeight() {
    if (Number.isFinite(configuredMaximumScale) && configuredMaximumScale > 0) {
      return Math.max(minimumHeight, declaredHeight * configuredMaximumScale);
    }
    return Math.max(minimumHeight, window.innerHeight);
  }

  function visibleDimension(value, minimum, maximum) {
    return Math.max(Math.min(minimum, maximum), Math.min(maximum, number(value, minimum)));
  }

  function updateFrame() {
    cancelAnimationFrame(frameRequest);
    frameRequest = requestAnimationFrame(() => {
      renderedWidth = visibleDimension(requestedWidth, minimumWidth, maximumWidth());
      renderedHeight = visibleDimension(requestedHeight, minimumHeight, maximumHeight());
      const contentScale = Math.max(.01, Math.min(
        renderedWidth / Math.max(1, defaultWidth),
        renderedHeight / Math.max(1, naturalHeight)
      ));
      host.style.setProperty('--widget-base-width', `${defaultWidth}px`);
      host.style.setProperty('--widget-base-height', `${naturalHeight}px`);
      host.style.setProperty('--widget-visual-width', `${renderedWidth}px`);
      host.style.setProperty('--widget-visual-height', `${renderedHeight}px`);
      host.style.setProperty('--widget-content-scale', String(contentScale));
      card.style.setProperty('--widget-content-scale', String(contentScale));
      host.dataset.widgetSizeReady = 'true';
      sizeLabel.textContent = `${Math.round(renderedWidth)}×${Math.round(renderedHeight)}`;

      sizeHandles.forEach(handle => {
        const axis = handle.dataset.widgetScaleAxis || 'both';
        if (axis === 'horizontal') {
          handle.setAttribute('aria-valuemin', String(Math.round(minimumWidth)));
          handle.setAttribute('aria-valuemax', String(Math.round(maximumWidth())));
          handle.setAttribute('aria-valuenow', String(Math.round(requestedWidth)));
          handle.setAttribute('aria-valuetext', `가로 ${Math.round(renderedWidth)}픽셀`);
        } else if (axis === 'vertical') {
          handle.setAttribute('aria-valuemin', String(Math.round(minimumHeight)));
          handle.setAttribute('aria-valuemax', String(Math.round(maximumHeight())));
          handle.setAttribute('aria-valuenow', String(Math.round(requestedHeight)));
          handle.setAttribute('aria-valuetext', `세로 ${Math.round(renderedHeight)}픽셀`);
        } else {
          handle.setAttribute('aria-valuemin', '5');
          handle.setAttribute('aria-valuemax', '400');
          handle.setAttribute('aria-valuenow', '100');
          handle.setAttribute('aria-valuetext', `${Math.round(renderedWidth)} × ${Math.round(renderedHeight)}픽셀`);
        }
      });

      document.body.classList.toggle('is-widget-overflowing', renderedHeight > window.innerHeight + .5);
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
    });
  }

  function applySize(width, height, fromUser = false) {
    if (Number.isFinite(width)) requestedWidth = fromUser ? visibleDimension(width, minimumWidth, maximumWidth()) : Math.max(minimumWidth, width);
    if (Number.isFinite(height)) requestedHeight = fromUser ? visibleDimension(height, minimumHeight, maximumHeight()) : Math.max(minimumHeight, height);
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

  function listMaximum(offset) {
    return Math.max(40, maximumHeight() - offset);
  }

  function applyListHeight(value, fromUser = false) {
    if (!list) return;
    const offset = listOffset();
    const maximum = listMaximum(offset);
    const desired = number(value, requestedListHeight ?? list.offsetHeight);
    requestedListHeight = fromUser ? Math.max(Math.min(160, maximum), Math.min(maximum, desired)) : Math.max(40, desired);
    renderedListHeight = Math.max(40, Math.min(maximum, requestedListHeight));
    list.style.flex = `0 0 ${renderedListHeight}px`;
    list.style.height = `${renderedListHeight}px`;
    const nextCardHeight = offset + renderedListHeight;
    card.style.height = `${nextCardHeight}px`;
    naturalHeight = Math.max(minimumHeight, nextCardHeight);
    if (fromUser) heightLocked = true;
    if (fromUser || !heightLocked) requestedHeight = naturalHeight;
    listHandle?.setAttribute('aria-valuenow', String(Math.round(requestedListHeight)));
    updateFrame();
  }

  sizeHandles.forEach(handle => {
    handle.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const axis = handle.dataset.widgetScaleAxis || 'both';
      widthLocked = axis === 'horizontal' || axis === 'both' ? true : widthLocked;
      heightLocked = true;
      sizeDrag = {
        handle,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        direction: ['top-left', 'left', 'top'].includes(handle.dataset.widgetScalePosition) ? -1 : 1,
        axis,
        width: renderedWidth,
        height: renderedHeight
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
        applySize(sizeDrag.width + widthDelta, null, true);
      } else if (sizeDrag.axis === 'vertical') {
        applySize(null, sizeDrag.height + heightDelta, true);
      } else {
        const widthRatio = widthDelta / Math.max(1, sizeDrag.width);
        const heightRatio = heightDelta / Math.max(1, sizeDrag.height);
        const ratio = Math.abs(widthRatio) >= Math.abs(heightRatio) ? widthRatio : heightRatio;
        const factor = Math.max(.05, 1 + ratio);
        applySize(sizeDrag.width * factor, sizeDrag.height * factor, true);
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
        widthLocked = true;
        heightLocked = true;
        applySize(requestedWidth + direction * 20, null, true);
      } else if (axis === 'vertical') {
        heightLocked = true;
        applySize(null, requestedHeight + direction * 20, true);
      } else {
        widthLocked = true;
        heightLocked = true;
        const factor = 1 + direction * .05;
        applySize(requestedWidth * factor, requestedHeight * factor, true);
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
      applyListHeight(listDrag.height + event.clientY - listDrag.y, true);
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
  const legacyScale = number(saved.scale, 1);
  const legacyScaleX = number(saved.scaleX, legacyScale);
  const legacyScaleY = number(saved.scaleY, legacyScale);
  const hasLegacySize = ['scale', 'scaleX', 'scaleY'].some(property => Object.prototype.hasOwnProperty.call(saved, property));
  requestedWidth = Math.max(minimumWidth, number(saved.width, defaultWidth * legacyScaleX));
  requestedHeight = Math.max(minimumHeight, number(saved.height, initialNaturalHeight * legacyScaleY));
  widthLocked = saved.widthLocked === true || Object.prototype.hasOwnProperty.call(saved, 'width') || (hasLegacySize && Math.abs(legacyScaleX - 1) > .001);
  heightLocked = saved.heightLocked === true || Object.prototype.hasOwnProperty.call(saved, 'height') || hasLegacySize;
  if (list) applyListHeight(number(saved.listH, list.offsetHeight));
  applySize(requestedWidth, requestedHeight);

  new ResizeObserver(() => {
    naturalHeight = Math.max(minimumHeight, card.offsetHeight || naturalHeight);
    if (!heightLocked && !listDrag) {
      requestedHeight = naturalHeight;
      updateFrame();
    } else {
      updateFrame();
    }
  }).observe(card);

  if (fixed) {
    new ResizeObserver(() => {
      if (!listDrag) applyListHeight(requestedListHeight ?? list.offsetHeight);
    }).observe(fixed);
  }

  window.addEventListener('resize', () => {
    if (!widthLocked) requestedWidth = Math.min(designWidth, Math.max(minimumWidth, window.innerWidth));
    if (!heightLocked) requestedHeight = Math.max(minimumHeight, card.offsetHeight || naturalHeight);
    if (list && requestedListHeight !== null) applyListHeight(requestedListHeight);
    else updateFrame();
  });

  window.addEventListener('storage', event => {
    if (event.key !== key) return;
    const next = readSize();
    const nextLegacyScale = number(next.scale, 1);
    requestedWidth = Math.max(minimumWidth, number(next.width, defaultWidth * number(next.scaleX, nextLegacyScale)));
    requestedHeight = Math.max(minimumHeight, number(next.height, initialNaturalHeight * number(next.scaleY, nextLegacyScale)));
    widthLocked = next.widthLocked === true || Object.prototype.hasOwnProperty.call(next, 'width');
    heightLocked = next.heightLocked === true || Object.prototype.hasOwnProperty.call(next, 'height');
    if (list) applyListHeight(number(next.listH, requestedListHeight ?? list.offsetHeight));
    applySize(requestedWidth, requestedHeight);
  });
})();
