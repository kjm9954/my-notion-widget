/*
 * 인수인계 Q&A 공용 저장 계층 — 목록형(index.html)과 질문형(add.html)이 함께 쓴다.
 *
 * 접근 키: 임베드 주소의 #k= 에서만 읽는다(이전 주소 호환으로 ?room= 도 읽는다).
 *          요청마다 Authorization: Bearer 헤더로만 보내고, 주소·저장소·로그·오류 메시지에 남기지 않는다.
 * 설정:    공개 설정(qa-config.js)에는 서버 주소·이미지 한도·일반 문구만 있다.
 *          이름·역할·카테고리와 그 단어가 들어간 문구는 방 설정으로 서버에 두고, 접근 키로만 받는다.
 *          위젯은 QAStore.ready() 가 끝난 뒤에 사용자·카테고리·문구를 읽어야 한다.
 */
(function (global) {
  'use strict';

  const publicConfig = global.QA_CONFIG || {};
  let cfg = mergeConfig({}, publicConfig);
  const STATUS = Object.freeze({ WAITING: '대기', ANSWERED: '답변됨', DONE: '확인완료' });
  const STATUSES = Object.freeze([STATUS.WAITING, STATUS.ANSWERED, STATUS.DONE]);
  const AUTHOR_KEY = 'qa.author';
  const KEY_RE = /^qa_[A-Za-z0-9_-]{32,80}$/;
  const DAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const INDEX_TTL_MS = 15000;

  /* ───────── 주소 · 키 ───────── */
  const search = new URLSearchParams(global.location.search);
  const hash = new URLSearchParams(global.location.hash.replace(/^#/, ''));
  const rawKey = hash.get('k') || search.get('room') || '';
  const DEV = search.get('dev') === '1';
  const API = String((DEV && search.get('api')) || publicConfig.api || '').replace(/\/+$/, '');

  // 저장 키 이름에 쓸 짧은 식별자. 키 자체는 남기지 않는다.
  function digest(text) {
    let a = 0x811c9dc5, b = 0x9747b28c;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }
  const scope = rawKey ? 'r' + digest(rawKey) : '';
  // 이전 버전은 키를 그대로 저장소 이름에 썼다. 목록형이 새 이름으로 옮기고 지운다.
  const legacyStoreKey = rawKey ? 'handoverQA.v1:' + rawKey : '';

  /* ───────── 오류 ───────── */
  // kind: nokey | expired | denied | notfound | invalid | full | conflict | server | network
  class QAError extends Error {
    constructor(kind, status, detail) {
      super(kind);
      this.name = 'QAError';
      this.kind = kind;
      this.status = status || 0;
      this.detail = detail || '';
    }
    get retryable() {
      return this.kind === 'network' || this.kind === 'server' || this.kind === 'conflict';
    }
  }

  function httpError(status, detail) {
    const kind = status === 401 ? 'expired'
      : status === 403 ? 'denied'
      : status === 404 ? 'notfound'
      : status === 409 ? 'conflict'
      : status === 507 ? 'full'
      : status >= 500 ? 'server'
      : 'invalid';
    return new QAError(kind, status, typeof detail === 'string' ? detail.slice(0, 120) : '');
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // 실패하면 간격을 늘려 가며 최대 tries 번 다시 시도한다. 모두 실패하면 error.exhausted = true
  async function withRetry(fn, { tries = 3, base = 400 } = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn(attempt);
      } catch (error) {
        const retryable = error instanceof QAError && error.retryable;
        if (!retryable || attempt >= tries) {
          if (retryable) error.exhausted = true;
          error.retries = attempt;
          throw error;
        }
        await sleep(base * Math.pow(2, attempt));
      }
    }
  }

  /* ───────── 요청 ───────── */
  function checkKey() {
    if (!rawKey) throw new QAError('nokey');
    if (!KEY_RE.test(rawKey)) throw new QAError('expired', 401, 'invalid key');
  }

  function buildUrl(path, query) {
    const url = new URL(API + path);
    Object.entries(query || {}).forEach(([k, v]) => { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); });
    return url.toString();
  }

  async function send(path, { method = 'GET', query, json, body, contentType } = {}) {
    checkKey();
    const headers = { Authorization: 'Bearer ' + rawKey };
    let payload = body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(json);
    } else if (contentType) {
      headers['Content-Type'] = contentType;
    }
    try {
      return await fetch(buildUrl(path, query), { method, headers, body: payload, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch (_) {
      throw new QAError('network');
    }
  }

  async function sendJson(path, options) {
    const response = await send(path, options);
    let data = null;
    try { data = await response.json(); } catch (_) { data = null; }
    if (!response.ok || !data || !data.ok) throw httpError(response.status || 500, data && data.error);
    return data.data;
  }

  /* ───────── 로컬 저장 ───────── */
  const local = {
    get(key, fallback = null) {
      try {
        const raw = global.localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (_) { return fallback; }
    },
    set(key, value) {
      try { global.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
    },
    remove(key) {
      try { global.localStorage.removeItem(key); } catch (_) { /* 저장소를 못 쓰는 환경 */ }
    },
    raw(key) {
      try { return global.localStorage.getItem(key); } catch (_) { return null; }
    },
  };

  /* ───────── 위젯 사이 알림 ───────── */
  const listeners = { changed: new Set(), author: new Set() };
  const channel = 'BroadcastChannel' in global ? new BroadcastChannel('qa-widget-events') : null;

  function dispatch(type, detail) {
    (listeners[type] || []).forEach(fn => { try { fn(detail); } catch (_) { /* 구독자 오류는 무시 */ } });
  }
  // 같은 페이지의 다른 위젯(iframe)에만 알린다. 보낸 위젯은 이미 결과를 들고 있다.
  function emit(type, detail) {
    if (channel) channel.postMessage({ type, scope, detail });
  }
  if (channel) {
    channel.onmessage = event => {
      const data = event.data || {};
      if (data.scope === scope && listeners[data.type]) dispatch(data.type, data.detail);
    };
  }
  global.addEventListener('storage', event => {
    if (event.key === AUTHOR_KEY) dispatch('author', getAuthor());
  });
  function on(type, fn) {
    if (!listeners[type]) return () => {};
    listeners[type].add(fn);
    return () => listeners[type].delete(fn);
  }

  /* ───────── 방 설정(비공개) ───────── */
  const CONFIG_CACHE_KEY = scope ? 'qa.config.' + scope : '';
  let readyTask = null;
  let roomAccess = 'write';   // 방 설정 응답이 알려 주는 키 권한: write | read

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
  // 객체는 겹쳐 합치고, 배열·값은 뒤의 것으로 바꾼다.
  function mergeConfig(base, extra) {
    const out = { ...base };
    Object.entries(extra || {}).forEach(([key, value]) => {
      out[key] = isPlainObject(value) && isPlainObject(out[key]) ? mergeConfig(out[key], value) : value;
    });
    return out;
  }

  async function fetchRoomConfig() {
    if (rawKey) {
      try {
        const data = await sendJson('/api/qa/config');
        roomAccess = data.access === 'read' ? 'read' : 'write';
        const room = isPlainObject(data.config) ? data.config : {};
        local.set(CONFIG_CACHE_KEY, room);
        return room;
      } catch (error) {
        // 연결이 안 될 때만 이 브라우저에 받아 둔 설정을 쓴다. 키 오류는 그대로 알린다.
        const cached = local.get(CONFIG_CACHE_KEY);
        if ((error.kind === 'network' || error.kind === 'server') && isPlainObject(cached)) return cached;
        throw error;
      }
    }
    if (DEV) {
      // 키 없는 개발 모드는 이 컴퓨터에만 있는 비공개 설정 파일을 읽는다(저장소에 올리지 않음).
      try {
        const response = await fetch('private/qa-config.private.json', { cache: 'no-store' });
        return response.ok ? await response.json() : {};
      } catch (_) {
        return {};
      }
    }
    return {};
  }

  // 방 설정을 받아 공개 설정과 합친다. 실패하면 다음 호출에서 다시 받는다.
  function ready({ force = false } = {}) {
    if (!readyTask || force) {
      const task = fetchRoomConfig().then(room => {
        cfg = mergeConfig(publicConfig, room);
        return cfg;
      });
      task.catch(() => { if (readyTask === task) readyTask = null; });
      readyTask = task;
    }
    return readyTask;
  }
  function getConfig() { return cfg; }
  function getAccess() { return roomAccess; }
  function textOf(section) { return (cfg.text && cfg.text[section]) || {}; }

  /* ───────── 사용자 ───────── */
  function userList() {
    return Array.isArray(cfg.users) ? cfg.users.filter(u => u && u.name) : [];
  }
  function getUsers() { return userList().map(u => ({ ...u })); }
  function getUser(name) { return userList().find(u => u.name === name) || null; }
  function getAuthor() {
    const name = local.raw(AUTHOR_KEY);
    return getUser(name) ? name : null;
  }
  function setAuthor(name) {
    if (!getUser(name)) return false;
    try { global.localStorage.setItem(AUTHOR_KEY, name); } catch (_) { /* 이 브라우저에서만 유지 */ }
    dispatch('author', name);
    return true;
  }
  function isAnswerer(name) { return (getUser(name) || {}).role === 'answerer'; }
  function nextUser(name) {
    const users = userList();
    if (!users.length) return name;
    const i = users.findIndex(u => u.name === name);
    return users[(i + 1) % users.length].name;
  }
  // 답하는 사람이 쓰면 답변됨, 묻는 사람이 쓰면 대기
  function statusAfterPost(name) { return isAnswerer(name) ? STATUS.ANSWERED : STATUS.WAITING; }
  // 쓴 사람만 읽음, 나머지는 안 읽음
  function readAfterPost(name) {
    const read = {};
    userList().forEach(u => { read[u.name] = false; });
    read[name] = true;
    return read;
  }

  /* ───────── 카테고리 ───────── */
  function getCategories() {
    return (Array.isArray(cfg.categories) ? cfg.categories : [])
      .map(c => ({ major: String(c.major || ''), minors: (c.minors || []).map(String) }))
      .filter(c => c.major);
  }
  function majorOf(minor) {
    const found = getCategories().find(c => c.minors.includes(minor));
    return found ? found.major : '';
  }
  function isCategory(major, minor) {
    const found = getCategories().find(c => c.major === major);
    return !!found && (!minor || found.minors.includes(minor));
  }

  /* ───────── 임베드 값 ───────── */
  // 임베드 주소 # 뒤의 값(예: major, guide)을 읽는다. 위젯은 location 을 직접 읽지 않는다.
  function hashParam(name) {
    return String(hash.get(name) || '').trim();
  }

  /* ───────── 위젯 폭 ───────── */
  // 기본은 노션 임베드 블록 폭을 그대로 채운다(노션에서 블록 양옆 손잡이로 조절).
  // 임베드 주소에 w=<px> 를 붙이면 그 폭을 넘지 않게 가운데 정렬한다.
  function applyFrameWidth(root = document.documentElement) {
    const width = Number(hash.get('w') || search.get('w'));
    if (!Number.isFinite(width) || width < 320 || width > 2400) return null;
    root.style.setProperty('--qa-max-width', `${Math.round(width)}px`);
    return Math.round(width);
  }

  /* ───────── 날짜 표기 ───────── */
  const pad = n => String(n).padStart(2, '0');
  function dateLabel(at) { const d = new Date(at); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAYS[d.getDay()]}`; }
  function timeLabel(at) { const d = new Date(at); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  function shortDate(at) { const d = new Date(at); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

  /* ───────── 목록 요약 · 유사 질문 ───────── */
  let indexCache = null;

  function toItem(item) {
    return { ...item, major: item.cat1 || '', minor: item.cat2 || '' };
  }

  async function getRevision() {
    return sendJson('/api/qa/revision');
  }

  // 목록 요약. 15초 안에 다시 부르면 캐시, 그 뒤에는 리비전이 바뀐 경우에만 다시 받는다.
  async function getIndex({ force = false } = {}) {
    if (!force && indexCache) {
      if (Date.now() - indexCache.checkedAt < INDEX_TTL_MS) return indexCache;
      const { revision, access } = await getRevision();
      if (revision === indexCache.revision) {
        indexCache.checkedAt = Date.now();
        indexCache.access = access;
        return indexCache;
      }
    }
    const data = await sendJson('/api/qa/index');
    indexCache = {
      revision: data.revision,
      access: data.access,
      items: (data.items || []).map(toItem),
      checkedAt: Date.now(),
    };
    return indexCache;
  }

  const TRIM_RE = /^[\[\](){}<>「」『』"'`.,!?:;·~…]+|[\[\](){}<>「」『』"'`.,!?:;·~…]+$/g;
  function tokens(text) {
    return [...new Set(String(text || '').toLowerCase().split(/\s+/)
      .map(t => t.replace(TRIM_RE, ''))
      .filter(t => t.length >= 2))];
  }
  function similarity(query, target) {
    const hay = String(target || '').toLowerCase();
    return tokens(query).reduce((score, t) => score + (hay.includes(t) ? 1 : 0), 0);
  }

  // 공백으로 나눈 2글자 이상 단어가 제목에 몇 개 들어 있는지로 점수를 매겨 가장 높은 1건을 돌려준다.
  async function findSimilar(title, { exclude = [] } = {}) {
    if (!tokens(title).length) return null;
    const index = await getIndex();
    let best = null;
    for (const item of index.items) {
      if (exclude.includes(item.id)) continue;
      const score = similarity(title, item.title);
      if (score > 0 && (!best || score > best.score)) best = { item, score };
    }
    return best ? { ...best.item, score: best.score } : null;
  }

  async function getQuestion(id) {
    const data = await sendJson('/api/qa/thread', { query: { id } });
    return data.thread;
  }

  /* ───────── 이미지 ───────── */
  function isStoredImage(ref) {
    return typeof ref === 'string' && ref.startsWith('img:');
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => { const url = String(reader.result); resolve(url.slice(url.indexOf(',') + 1)); };
      reader.onerror = () => reject(new QAError('invalid', 0, 'read'));
      reader.readAsDataURL(blob);
    });
  }

  // 이미지는 base64 로 보내고 받는다. 서버는 조각으로 나눠 저장만 한다.
  async function uploadImage(blob, onProgress = () => {}) {
    checkKey();
    const payload = JSON.stringify({ type: blob.type || 'image/jpeg', data: await blobToBase64(blob) });
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', buildUrl('/api/qa/image'));
      xhr.setRequestHeader('Authorization', 'Bearer ' + rawKey);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch (_) { data = null; }
        if (xhr.status >= 200 && xhr.status < 300 && data && data.ok) {
          onProgress(1);
          resolve(data.data.id);
        } else {
          reject(httpError(xhr.status || 500, data && data.error));
        }
      };
      xhr.onerror = () => reject(new QAError('network'));
      xhr.send(payload);
    });
  }

  const imageCache = new Map();
  function loadImage(ref) {
    if (!imageCache.has(ref)) {
      const task = (async () => {
        const image = await sendJson('/api/qa/image', { query: { id: ref } });
        const blob = await (await fetch(`data:${image.type};base64,${image.data}`)).blob();
        return `url("${URL.createObjectURL(blob)}")`;
      })();
      task.catch(() => imageCache.delete(ref));
      imageCache.set(ref, task);
    }
    return imageCache.get(ref);
  }

  // 저장된 이미지는 data-img-ref 로 표시해 두고, 헤더를 붙여 받아 온 뒤 배경으로 채운다.
  function imageAttr(ref, escape) {
    return isStoredImage(ref)
      ? `data-img-ref="${escape(ref)}"`
      : `style="background-image:${escape(ref)}"`;
  }
  function hydrate(root) {
    if (!root) return;
    root.querySelectorAll('[data-img-ref]').forEach(el => {
      const ref = el.getAttribute('data-img-ref');
      if (el.dataset.imgLoaded === ref) return;
      el.dataset.imgLoaded = ref;
      loadImage(ref).then(css => {
        if (el.getAttribute('data-img-ref') === ref) el.style.backgroundImage = css;
      }).catch(() => {
        el.dataset.imgLoaded = '';
        el.classList.add('img-missing');
      });
    });
  }

  function decodeWithImg(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  // 긴 변 maxSide 이하, JPEG(quality)로 줄인다. 투명한 부분은 흰 바탕으로 채운다.
  async function compressImage(file) {
    const opts = cfg.images || {};
    const maxSide = Number(opts.maxSide) || 1600;
    const quality = Number(opts.quality) || 0.85;
    let source;
    try { source = await createImageBitmap(file); } catch (_) { source = await decodeWithImg(file); }
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    if (typeof source.close === 'function') source.close();
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality);
    });
    return { blob, width: w, height: h };
  }

  // 붙여넣기에서 이미지 파일만 꺼낸다. 표 복사처럼 글자와 그림이 함께 오면 글자 붙여넣기로 둔다.
  function imagesFromClipboard(event) {
    const data = event.clipboardData;
    if (!data) return [];
    const text = data.getData('text/plain');
    if (text && text.trim()) return [];
    const files = [];
    for (const item of Array.from(data.items || [])) {
      if (item.kind === 'file' && /^image\//.test(item.type)) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    return files;
  }

  /* ───────── 입력 보조 ───────── */
  // textarea 의 input 이벤트에 연결한다. 줄바꿈 직후 윗줄이 "N. 내용"이면 "N+1. "을 잇고,
  // 윗줄이 내용 없는 번호 줄이면 번호를 지운다. 한글 조합 중 Enter 에도 동작하도록 input 이벤트를 쓴다.
  function continueNumberedList(event, textarea) {
    const type = event && event.inputType;
    if (type !== 'insertLineBreak' && type !== 'insertParagraph') return false;
    const value = textarea.value;
    const caret = textarea.selectionStart;
    if (caret !== textarea.selectionEnd || value[caret - 1] !== '\n') return false;
    const lineEnd = caret - 1;
    const lineStart = value.lastIndexOf('\n', lineEnd - 1) + 1;
    const match = /^(\d+)\.\s?(.*)$/.exec(value.slice(lineStart, lineEnd));
    if (!match) return false;
    if (match[2].trim()) {
      textarea.setRangeText(`${Number(match[1]) + 1}. `, caret, caret, 'end');
    } else {
      textarea.setRangeText('', lineStart, lineEnd, 'preserve');
    }
    return true;
  }

  /* ───────── 질문 등록 ───────── */
  function newId() {
    const bytes = new Uint8Array(9);
    global.crypto.getRandomValues(bytes);
    return 't_' + Date.now().toString(36) + Array.from(bytes, b => (b % 36).toString(36)).join('');
  }

  // 같은 등록을 다시 시도할 때 넘기는 상태. 이미 올린 이미지와 생성 여부를 재사용해 중복을 막는다.
  function newAttempt(signature = '') {
    return { id: newId(), signature, uploaded: [], created: false, stage: 0, thread: null };
  }

  // 순서: 이미지 업로드 → 질문 생성 → 목록 반영 확인
  async function createQuestion(input, { attempt = newAttempt(), onProgress = () => {} } = {}) {
    const title = String(input.title || '').trim().slice(0, 60);
    const body = String(input.body || '').trim();
    const author = input.author;
    const images = Array.isArray(input.images) ? input.images : [];
    const report = (stage, progress) => { attempt.stage = stage; onProgress({ stage, progress, total: 3 }); };
    try {
      const major = String(input.major || majorOf(input.minor) || '').trim();
      if (!title || !getUser(author) || !major) throw new QAError('invalid', 400, 'missing fields');
      if (!body && !images.length) throw new QAError('invalid', 400, 'empty body');

      if (!attempt.created) {
        report(0, 0);
        for (let i = 0; i < images.length; i++) {
          if (attempt.uploaded[i]) continue;
          const image = images[i];
          attempt.uploaded[i] = isStoredImage(image)
            ? image
            : await withRetry(() => uploadImage(image, p => report(0, (i + p) / images.length)));
          report(0, (i + 1) / images.length);
        }
        report(0, 1);

        report(1, 0);
        const at = Date.now();
        const thread = {
          id: attempt.id,
          cat1: major,
          cat2: String(input.minor || ''),
          guide: String(input.guide || ''),
          title,
          status: statusAfterPost(author),
          read: readAfterPost(author),
          messages: [{
            who: author,
            at,
            date: dateLabel(at),
            time: timeLabel(at),
            images: attempt.uploaded.slice(0, images.length),
            text: body,
          }],
        };
        const result = await withRetry(() => sendJson('/api/qa/op', { method: 'POST', json: { type: 'create', thread } }));
        attempt.thread = result.thread;
        attempt.created = true;
        report(1, 1);
      }

      report(2, 0);
      await withRetry(async () => {
        const index = await getIndex({ force: true });
        if (!index.items.some(item => item.id === attempt.id)) throw new QAError('conflict', 409, 'not listed yet');
      });
      report(2, 1);
      emit('changed', { id: attempt.id });
      return attempt.thread;
    } catch (error) {
      const failure = error instanceof QAError ? error : new QAError('invalid', 0, 'client');
      failure.stage = attempt.stage;
      throw failure;
    }
  }

  /* ───────── 목록형이 쓰는 기능 ───────── */
  function getState(since = 0) {
    return sendJson('/api/qa/state', { query: { since } });
  }
  function createThread(thread) {
    return sendJson('/api/qa/op', { method: 'POST', json: { type: 'create', thread } })
      .then(result => { emit('changed', { id: thread.id }); return result; });
  }
  function postMessage(threadId, message) {
    return sendJson('/api/qa/op', {
      method: 'POST',
      json: { type: 'message', threadId, message, status: statusAfterPost(message.who), read: readAfterPost(message.who) },
    }).then(result => { emit('changed', { id: threadId }); return result; });
  }
  function setStatus(threadId, status, who) {
    return sendJson('/api/qa/op', { method: 'POST', json: { type: 'status', threadId, status, who } })
      .then(result => { emit('changed', { id: threadId }); return result; });
  }
  function markRead(threadId, who) {
    return sendJson('/api/qa/op', { method: 'POST', json: { type: 'read', threadId, who } })
      .then(result => { emit('changed', { id: threadId }); return result; });
  }

  global.QAStore = Object.freeze({
    STATUS,
    STATUSES,
    QAError,
    dev: DEV,
    scope,
    legacyStoreKey,
    hasKey: () => !!rawKey,
    ready,
    getConfig,
    getAccess,
    text: textOf,
    applyFrameWidth,
    hashParam,
    local,
    on,
    emit,
    withRetry,
    // 사용자
    getUsers,
    getUser,
    getAuthor,
    setAuthor,
    isAnswerer,
    nextUser,
    statusAfterPost,
    readAfterPost,
    // 카테고리
    getCategories,
    majorOf,
    isCategory,
    // 날짜
    dateLabel,
    timeLabel,
    shortDate,
    // 조회 · 등록
    getRevision,
    getIndex,
    findSimilar,
    getQuestion,
    newAttempt,
    createQuestion,
    // 목록형
    getState,
    createThread,
    postMessage,
    setStatus,
    markRead,
    // 이미지 · 입력
    isStoredImage,
    uploadImage,
    loadImage,
    imageAttr,
    hydrate,
    compressImage,
    imagesFromClipboard,
    continueNumberedList,
  });
})(window);
