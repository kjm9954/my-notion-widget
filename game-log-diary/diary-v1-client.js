(function () {
  'use strict';

  const API = 'https://notion-widget.wldnjsdkk.workers.dev';
  const INSTANCE_RE = /^w_[A-Za-z0-9_-]{24,176}$/;
  const DRAFT_KEY = 'diary-v1-drafts-v1';
  const MAX_PHOTOS = 4;
  const MAX_PHOTO_BYTES = 5_000_000;
  const params = new URLSearchParams(location.search || '');
  const instanceId = params.get('w') || '';
  const connected = INSTANCE_RE.test(instanceId);
  const channel = connected && 'BroadcastChannel' in window
    ? new BroadcastChannel(`diary-v1:${instanceId}`)
    : null;
  const listeners = new Set();

  function apiUrl(path, query = {}) {
    const url = new URL(path, API);
    if (connected) url.searchParams.set('w', instanceId);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
    return url.toString();
  }

  async function request(path, options = {}, query = {}) {
    if (!connected) {
      const error = new Error('개인 위젯 연결 주소가 필요합니다.');
      error.code = 'NOT_CONNECTED';
      throw error;
    }
    const response = await fetch(apiUrl(path, query), { cache: 'no-store', ...options });
    const raw = await response.text();
    let data = null;
    try { data = JSON.parse(raw); } catch (_) {}
    if (!response.ok || !data?.ok) {
      const error = new Error(readableError(response.status, data?.error));
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data.data;
  }

  function readableError(status, detail) {
    if (status === 409) return '다른 기기에서 먼저 수정한 기록이 있습니다.';
    if (status === 413 || /too large/i.test(detail || '')) return '사진 용량이 너무 큽니다. 사진 한 장은 5MB까지 저장할 수 있어요.';
    if (status === 401 || status === 403) return '연결이 만료되었습니다. 위젯 연결을 다시 확인해 주세요.';
    if (status === 404 && /instance/i.test(detail || '')) return '이 위젯 연결 주소를 찾을 수 없습니다.';
    if (String(detail || '').startsWith('D1_ERROR:')) return '서버 사용량 한도에 도달했습니다. 오전 9시 이후 다시 시도해 주세요.';
    if (!navigator.onLine) return '인터넷 연결을 확인해 주세요. 작성 내용은 임시 보관했습니다.';
    return '저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }

  function post(path, body) {
    return request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function loadEntry(date) { return request('/api/diary-v1/entry', {}, { date }); }
  function loadRange(start, end) { return request('/api/diary-v1/range', {}, { start, end }); }
  function loadExport() { return request('/api/diary-v1/export'); }
  function saveEntry(entry) { return post('/api/diary-v1/save', entry); }
  function deleteEntry(date, expectedRevision) { return post('/api/diary-v1/delete', { date, expectedRevision }); }

  function seoulDateKey(value = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(value);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function keyParts(key) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
  }

  function validDateKey(key) {
    const parts = keyParts(key);
    if (!parts) return false;
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    return date.getUTCFullYear() === parts.year && date.getUTCMonth() === parts.month - 1 && date.getUTCDate() === parts.day;
  }

  function shiftDate(key, amount) {
    const parts = keyParts(key);
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  function formatDate(key, options = {}) {
    const parts = keyParts(key);
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'UTC', month: options.year ? 'long' : 'long', day: 'numeric', weekday: 'short',
      ...(options.year ? { year: 'numeric' } : {}),
    }).format(date).replace(/\.$/, '');
  }

  function monthBounds(year, month) {
    const first = new Date(Date.UTC(year, month, 1));
    const lead = first.getUTCDay();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const cells = Math.ceil((lead + lastDay) / 7) * 7;
    const start = new Date(Date.UTC(year, month, 1 - lead));
    const end = new Date(Date.UTC(year, month, cells - lead));
    const toKey = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    return { start: toKey(start), end: toKey(end), cells, lead, lastDay };
  }

  function fileId() {
    return `p_${(crypto.randomUUID?.() || `${Date.now()}_${Math.random()}`).replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 64);
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('사진을 읽지 못했습니다. 다른 파일을 선택해 주세요.'));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  async function photoFromFile(file) {
    if (!file?.type?.startsWith('image/')) throw new Error('이미지 파일만 추가할 수 있어요.');
    if (file.size > MAX_PHOTO_BYTES) throw new Error('사진 한 장은 5MB까지 추가할 수 있어요.');
    const dataUrl = await readFile(file);
    return { id: fileId(), type: file.type, size: file.size, dataUrl, url: dataUrl, isNew: true };
  }

  function drafts() {
    try {
      const value = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (_) { return {}; }
  }

  function loadDraft(date) {
    if (!connected) return null;
    return drafts()?.[instanceId]?.[date] || null;
  }

  function saveDraft(date, draft) {
    if (!connected) return { saved: false, photosSaved: false };
    const root = drafts();
    root[instanceId] ||= {};
    const serializable = {
      savedAt: new Date().toISOString(),
      text: String(draft?.text || ''), mood: draft?.mood || null,
      revision: draft?.revision ?? null,
      photos: (draft?.photos || []).map(photo => ({
        id: photo.id, type: photo.type, size: photo.size, url: photo.url,
        dataUrl: photo.isNew ? photo.dataUrl : undefined, isNew: photo.isNew === true,
      })),
    };
    root[instanceId][date] = serializable;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(root));
      return { saved: true, photosSaved: true };
    } catch (_) {
      serializable.photos = serializable.photos.filter(photo => !photo.isNew).map(photo => ({ ...photo, dataUrl: undefined }));
      root[instanceId][date] = serializable;
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(root));
        return { saved: true, photosSaved: false };
      } catch (_) { return { saved: false, photosSaved: false }; }
    }
  }

  function clearDraft(date) {
    if (!connected) return;
    const root = drafts();
    if (root[instanceId]) {
      delete root[instanceId][date];
      if (!Object.keys(root[instanceId]).length) delete root[instanceId];
    }
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(root)); } catch (_) {}
  }

  function announce(detail) {
    try { channel?.postMessage(detail); } catch (_) {}
  }

  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  channel?.addEventListener('message', event => listeners.forEach(listener => listener(event.data)));
  window.addEventListener('storage', event => {
    if (event.key === DRAFT_KEY) listeners.forEach(listener => listener({ type: 'draft' }));
  });

  function connectionUrl(target) {
    const url = new URL('../public-connect.html', location.href);
    url.searchParams.set('from', `game-log-diary/${target}`);
    return url.toString();
  }

  async function blobToDataUrl(blob) {
    return readFile(new File([blob], 'photo', { type: blob.type || 'application/octet-stream' }));
  }

  window.DiaryV1 = {
    API, instanceId, connected, MAX_PHOTOS, MAX_PHOTO_BYTES,
    apiUrl, loadEntry, loadRange, loadExport, saveEntry, deleteEntry,
    seoulDateKey, validDateKey, shiftDate, formatDate, monthBounds,
    photoFromFile, loadDraft, saveDraft, clearDraft, announce, onChange,
    connectionUrl, blobToDataUrl,
  };
})();
