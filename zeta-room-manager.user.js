// ==UserScript==
// @name         Zeta Room Manager (Android/PC)
// @namespace    zeta-room-manager
// @version      0.8.2
// @description  Android/PC용. 별명과 플롯명·캐릭터명·제작자명 검색, API 기반 전체 방 인덱싱을 지원합니다.
// @match        https://zeta-ai.io/*
// @updateURL    https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-room-manager.user.js
// @downloadURL  https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-room-manager.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self) return;

  const STORAGE_KEY = 'zeta-room-manager:v1';
  const STATE_VERSION = 2;
  const BACKGROUND_INDEX_STAMP_KEY = 'zeta-room-manager:last-full-index-at:v3';
  const STYLE_ID = 'zeta-room-manager-style';
  const PANEL_ID = 'zeta-room-manager-panel';
  const MODAL_ID = 'zeta-room-manager-modal';
  const NATIVE_RESULTS_ID = 'zeta-room-manager-native-results';
  const PLOT_NATIVE_RESULTS_ID = 'zeta-room-manager-plot-native-results';
  const PLOT_TOOLS_ID = 'zeta-room-manager-plot-tools';
  const PLOT_COLLECTION_STAMP_KEY = 'zeta-room-manager:plot-collection-at:v1';

  const state = loadState();
  let observer = null;
  let rafPending = false;
  let lastRoomContextRecord = null;
  let plotCollectionPromise = null;
  let plotCollectionProgress = { running: false, count: 0 };

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const loaded = {
        version: STATE_VERSION,
        aliases: parsed.aliases && typeof parsed.aliases === 'object' ? parsed.aliases : {},
        index: parsed.index && typeof parsed.index === 'object' ? parsed.index : {},
        plotMeta: parsed.plotMeta && typeof parsed.plotMeta === 'object' ? parsed.plotMeta : {}
      };

      // v1 인덱스에는 화면에서 긁어온 캐릭터·제작자 이름이 섞여 있다.
      // 페이지 전역 정보가 모든 항목에 붙어 검색이 전부 매칭되므로 한 번 비우고
      // API 기반 정보(plotMeta)로 다시 채운다. 별명은 그대로 둔다.
      if (Number(parsed.version || 1) < 2) {
        for (const entry of Object.values(loaded.index)) {
          if (!entry || typeof entry !== 'object') continue;
          delete entry.characterNames;
          delete entry.creatorNames;
        }
        try {
          localStorage.removeItem(BACKGROUND_INDEX_STAMP_KEY);
        } catch (_) {}
      }

      return loaded;
    } catch (_) {
      return { version: STATE_VERSION, aliases: {}, index: {}, plotMeta: {} };
    }
  }

  let saveTimer = null;

  function saveStateNow() {
    saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  // 인덱스가 커지면 JSON.stringify 비용이 커진다.
  // 렌더 루프에서 매번 저장하면 검색 입력이 눈에 띄게 끊기므로 묶어서 저장한다.
  function saveState() {
    if (saveTimer) return;
    saveTimer = setTimeout(saveStateNow, 400);
  }

  function keyOf(type, id) {
    return `${type}:${id}`;
  }

  // 0.7.0까지는 삭제된 원본(originatedId)을 캐시 키로 삼아, 내 플롯이 살아있어도
  // 캐릭터명을 못 받는 방이 생겼다. 그 흔적을 한 번만 비워 다시 수집하게 한다.
  const CLEANUP_STAMP_KEY = 'zeta-room-manager:cleanup:v071';
  function cleanupLegacyState() {
    if (localStorage.getItem(CLEANUP_STAMP_KEY)) return;

    for (const [plotId, meta] of Object.entries(state.plotMeta || {})) {
      if (!meta) continue;
      const hasNames = (meta.characterNames || []).length || (meta.creatorNames || []).length;
      if (meta.failedAt || meta.missing || !hasNames) delete state.plotMeta[plotId];
    }

    for (const [key, entry] of Object.entries(state.index || {})) {
      if (!entry || entry.type !== 'room') continue;
      delete entry.missingSince;
      delete entry.plotMissing;
    }

    localStorage.setItem(CLEANUP_STAMP_KEY, String(Date.now()));
    localStorage.removeItem('zeta-room-manager:last-full-index-at:v3');
    saveStateNow();
  }

  // 전부 지우고 처음부터 다시 수집한다. 별명은 유지된다.
  window.zrmResetIndex = function () {
    state.index = {};
    state.plotMeta = {};
    localStorage.removeItem('zeta-room-manager:last-full-index-at:v3');
    localStorage.removeItem('zeta-room-manager:last-plot-index-at:v1');
    localStorage.removeItem('zeta-room-manager:last-plot-index-at:v2');
    localStorage.removeItem(PLOT_COLLECTION_STAMP_KEY);
    localStorage.removeItem(CLEANUP_STAMP_KEY);
    saveStateNow();
    try { ensureBackgroundRoomIndex(true); } catch (_) {}
    return '인덱스를 비웠습니다. 별명은 그대로입니다. 비공개 플롯은 제작자센터에서 전체 수집을 다시 실행해 주세요.';
  };

  function normalizeText(value) {
    // 제타에서 제목이 빈 플롯은 한글 채움문자(ㅤ) 등으로 채워져 있다.
    return String(value || '')
      .replace(/[\u115F\u1160\u3164\u2800\uFFA0\u200B-\u200D\uFEFF]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function collectSearchMeta(item, titleEl) {
    const characterNames = [];
    const creatorNames = [];
    const originalTitle = normalizeText(titleEl?.dataset?.zrmOriginalTitle || titleEl?.textContent);

    const addUnique = (list, value) => {
      const text = normalizeText(value);
      if (!text || text === originalTitle || text.length > 100) return;
      if (/^(?:이미지|썸네일|프로필|avatar|image|thumbnail)$/i.test(text)) return;
      if (!list.includes(text)) list.push(text);
    };

    const elements = [item, ...Array.from(item?.querySelectorAll?.('*') || []).slice(0, 180)];
    for (const el of elements) {
      if (!el) continue;

      for (const [key, value] of Object.entries(el.dataset || {})) {
        const compact = key.toLowerCase().replace(/[_-]/g, '');
        if (compact.includes('character') && /(name|nickname|display)/.test(compact)) addUnique(characterNames, value);
        if (
          (compact.includes('creator') || compact.includes('author') || compact.includes('writer')) &&
          /(name|nickname|display|username|handle)/.test(compact)
        ) addUnique(creatorNames, value);
      }

      const component = String(el.dataset?.sentryComponent || '').toLowerCase();
      if (component.includes('character')) addUnique(characterNames, el.getAttribute?.('aria-label'));
      if (component.includes('creator') || component.includes('author')) addUnique(creatorNames, el.getAttribute?.('aria-label'));

      if (el.matches?.('img[alt]')) addUnique(characterNames, el.getAttribute('alt'));
      if (el.matches?.('[aria-label*="캐릭터"], [aria-label*="character" i]')) addUnique(characterNames, el.getAttribute('aria-label'));
      if (el.matches?.('[aria-label*="제작자"], [aria-label*="creator" i], [aria-label*="author" i]')) addUnique(creatorNames, el.getAttribute('aria-label'));
      if (el.matches?.('a[href*="/character/"], a[href*="/characters/"]')) addUnique(characterNames, el.textContent);
      if (el.matches?.('a[href*="/creator/"], a[href*="/creators/"], a[href*="/author/"], a[href*="/authors/"]')) {
        addUnique(creatorNames, el.textContent);
      }
    }

    const fiberKey = Object.keys(item || {}).find(key => key.startsWith('__reactFiber'));
    let fiber = fiberKey ? item[fiberKey] : null;
    const seen = new WeakSet();
    let inspected = 0;

    const cleanKey = value => String(value || '').toLowerCase().replace(/[_-]/g, '');

    const inspect = (value, path = [], depth = 0) => {
      if (value == null || depth > 7 || inspected > 1200) return;

      if (typeof value === 'string') {
        const leaf = cleanKey(path[path.length - 1]);
        const context = path.map(cleanKey).join('.');
        // persona/user 는 "로그인한 나"를 가리키는 경우가 많아 캐릭터로 보지 않는다.
        const charContext = /character|characters|charprofile|chatprofile/.test(context);
        const creatorContext = /creator|author|writer/.test(context);
        const nameLeaf = /^(?:name|nickname|displayname|username|handle|charactername|charname|characternickname|characterdisplayname)$/.test(leaf);

        if (
          /^(?:charactername|charname|characternickname|characterdisplayname)$/.test(leaf) ||
          (charContext && nameLeaf)
        ) addUnique(characterNames, value);

        if (
          /^(?:creatorname|creatornickname|creatordisplayname|authorname|authornickname|writername|writernickname)$/.test(leaf) ||
          (creatorContext && nameLeaf)
        ) addUnique(creatorNames, value);

        return;
      }

      if (typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      inspected++;

      if (Array.isArray(value)) {
        for (let i = 0; i < Math.min(value.length, 60); i++) {
          inspect(value[i], path.concat(String(i)), depth + 1);
          if (inspected > 1200) break;
        }
        return;
      }

      for (const [key, child] of Object.entries(value)) {
        if (['children', 'ref', '_owner', 'return', 'stateNode'].includes(key)) continue;
        inspect(child, path.concat(key), depth + 1);
        if (inspected > 1200) break;
      }
    };

    // 이 항목 자체를 렌더한 컴포넌트의 props 중, 항목에 속한 값만 본다.
    // 조상으로 멀리 올라가면 로그인 사용자·페르소나·목록 전체 데이터가 걸려서
    // 모든 항목에 똑같은 캐릭터명이 붙고, 그 이름으로 검색하면 전부 매칭된다.
    const ITEM_SCOPED = /^(?:plot|room|character|characters|chatprofile|chatprofiles|characterprofiles)$/;

    for (let depth = 0; fiber && depth < 4; depth++, fiber = fiber.return) {
      for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
        if (!props || typeof props !== 'object' || Array.isArray(props)) continue;

        // props 자체가 플롯/캐릭터 객체인 경우(펼쳐서 넘긴 경우)
        if (props.characters || props.chatProfiles) inspect(props, ['props'], 0);

        for (const [key, value] of Object.entries(props)) {
          if (!ITEM_SCOPED.test(cleanKey(key))) continue;
          inspect(value, ['props', key], 1);
        }
      }
      if (characterNames.length && creatorNames.length) break;
    }

    return {
      characterNames: characterNames.slice(0, 10),
      creatorNames: creatorNames.slice(0, 10)
    };
  }

  function reactRoomPlotMeta(item) {
    const fiberKey = Object.keys(item || {}).find(key => key.startsWith('__reactFiber$'));
    const root = fiberKey ? item[fiberKey] : null;
    if (!root) return null;

    const queue = [root];
    const seen = new Set();
    let inspected = 0;

    while (queue.length && inspected < 220) {
      const fiber = queue.shift();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      inspected++;

      for (const props of [fiber.pendingProps, fiber.memoizedProps]) {
        const plot = props && props.plot;
        if (plot && typeof plot === 'object' && normalizeText(plot.id || plot.plotId)) return plot;
      }

      if (fiber.child) queue.push(fiber.child);
      if (fiber.sibling) queue.push(fiber.sibling);
    }
    return null;
  }

  function uniqueTexts() {
    const out = [];
    for (const list of arguments) {
      for (const value of Array.isArray(list) ? list : []) {
        const text = normalizeText(value);
        if (text && !out.includes(text)) out.push(text);
      }
    }
    return out;
  }

  function plotCharacterNames(plot) {
    const names = [];
    const add = value => {
      const text = normalizeText(value);
      if (text && !names.includes(text)) names.push(text);
    };
    const push = list => {
      for (const character of Array.isArray(list) ? list : []) {
        add(character && (
          character.name ||
          character.nickname ||
          character.displayName ||
          character.display_name ||
          character.characterName
        ));
      }
    };

    add(plot && plot.firstCharacterName);
    add(plot && plot.characterName);
    push(plot && plot.characters);
    push(plot && plot.characterProfiles);
    push(plot && plot.chatProfiles);
    push(plot && plot.plotCharacters);
    push(plot && plot.about && plot.about.characters);

    return names.slice(0, 20);
  }

  function plotCreatorNames(plot) {
    const names = [];
    const add = value => {
      const text = normalizeText(value);
      if (text && !names.includes(text)) names.push(text);
    };
    const addObject = creator => {
      if (!creator || typeof creator !== 'object') return;
      add(creator.name);
      add(creator.nickname);
      add(creator.displayName);
      add(creator.display_name);
      add(creator.username);
      add(creator.handle);
      add(creator.creatorName);
      if (creator.profile && typeof creator.profile === 'object') {
        addObject(creator.profile);
      }
    };

    add(plot && plot.creatorName);
    add(plot && plot.creatorNickname);
    add(plot && plot.authorName);
    add(plot && plot.writerName);

    addObject(plot && plot.creator);
    addObject(plot && plot.author);
    addObject(plot && plot.writer);
    addObject(plot && plot.owner);
    addObject(plot && plot.user);
    addObject(plot && plot.creatorUser);

    return names.slice(0, 10);
  }

  function canonicalPlotId(plotId, originatedId) {
    // 내 계정에 있는 실제 플롯(plot.id)을 우선한다.
    // originatedId는 원본이며, 원본이 삭제된 경우 조회가 영구 실패한다.
    return normalizeText(plotId) || normalizeText(originatedId);
  }

  function plotMetaForEntry(entry) {
    if (!entry) return null;
    const canonical = canonicalPlotId(entry.plotId, entry.originatedId);
    return (canonical && state.plotMeta[canonical])
      || (entry.plotId && state.plotMeta[entry.plotId])
      || (entry.originatedId && state.plotMeta[entry.originatedId])
      || null;
  }

  function searchValues(entry) {
    const characters = Array.isArray(entry?.characterNames) ? entry.characterNames : [];
    const creators = Array.isArray(entry?.creatorNames) ? entry.creatorNames : [];
    const meta = plotMetaForEntry(entry);
    const metaCharacters = Array.isArray(meta?.characterNames) ? meta.characterNames : [];
    const metaCreators = Array.isArray(meta?.creatorNames) ? meta.creatorNames : [];
    return [
      entry?.alias,
      entry?.original,
      meta?.name,
      ...characters,
      ...creators,
      ...metaCharacters,
      ...metaCreators
    ].map(normalizeText).filter(Boolean);
  }

  function matchesSearch(entry, query) {
    return searchValues(entry).some(value => value.toLocaleLowerCase('ko-KR').includes(query));
  }

  // 제타에는 제목이 공백인 플롯·방이 실제로 존재한다.
  // 숨기면 영영 찾을 수 없으므로, 플롯명 → 대체 표기 순으로 보여준다.
  function entryTitle(entry) {
    const meta = plotMetaForEntry(entry);
    return normalizeText(entry?.alias)
      || normalizeText(entry?.original)
      || normalizeText(meta && meta.name)
      || '(제목 없음)';
  }

  // 플롯이 삭제됐거나 제타 목록에서 사라진 방은 눌러도 "없는 페이지"로 간다.
  function isDeadEntry(entry) {
    if (!entry) return true;
    // 크리에이터 센터의 내 플롯은 비공개라 API가 404를 줄 수 있으므로 숨기지 않는다.
    if (entry.type !== 'room') return false;
    if (entry.missingSince) return true;
    if (entry.plotMissing) return true;
    const meta = plotMetaForEntry(entry);
    return Boolean(meta && meta.missing);
  }

  function roomIndexStats() {
    let rooms = 0;
    let dead = 0;
    for (const entry of Object.values(state.index)) {
      if (!entry || entry.type !== 'room') continue;
      rooms++;
      if (isDeadEntry(entry)) dead++;
    }
    return { rooms, dead };
  }

  // 검색이 "안 되는" 이유를 화면에서 바로 알 수 있게 한 줄로 설명한다.
  function indexStatusText() {
    if (Date.now() < apiUnavailableUntil) {
      if (lastApiIssue === 'auth') {
        return '제타 로그인 정보를 읽지 못해 전체 대화방 인덱스를 만들 수 없어요. 제타에 로그인한 상태에서 새로고침해 주세요.';
      }
      if (lastApiIssue === 'rate') return '제타 서버 요청이 잠시 제한됐어요. 곧 자동으로 다시 시도합니다.';
      return '제타 서버에 연결하지 못했어요. 곧 자동으로 다시 시도합니다.';
    }
    if (backgroundIndexPromise) return '전체 대화방을 인덱싱하는 중이에요. 잠시 후 다시 검색해 주세요.';
    if (!roomIndexStats().rooms) {
      return '아직 인덱싱된 대화방이 없어요. 대화방 목록을 연 채로 잠시 기다리면 자동으로 만들어집니다.';
    }
    return '';
  }

  // 인덱스가 비어 있는데 사용자가 검색을 시작했다면 즉시 한 번 더 시도한다.
  function ensureIndexForSearch() {
    if (currentSection() !== 'room') return;
    if (backgroundIndexPromise || Date.now() < apiUnavailableUntil) return;
    if (roomIndexStats().rooms) return;
    if (Date.now() - lastForcedIndexAt < 30000) return;
    lastForcedIndexAt = Date.now();
    ensureBackgroundRoomIndex(true);
  }

  function noteElement(text) {
    const note = document.createElement('div');
    note.className = 'zrm-native-note';
    note.textContent = text;
    return note;
  }

  function searchDetail(entry, fallback) {
    const parts = [];
    if (normalizeText(entry?.alias) && normalizeText(entry?.original) && entry.alias !== entry.original) {
      parts.push(entry.original);
    }
    const meta = plotMetaForEntry(entry);
    const characterName = uniqueTexts(entry?.characterNames, meta && meta.characterNames)[0];
    const creatorName = uniqueTexts(entry?.creatorNames, meta && meta.creatorNames)[0];
    if (characterName) parts.push('캐릭터: ' + characterName);
    if (creatorName) parts.push('제작자: ' + creatorName);
    return parts.join(' · ') || fallback;
  }

  const API_BASE = 'https://api.zeta-ai.io';
  const WEB_CLIENT_VERSION = '3.44.7';
  let backgroundIndexPromise = null;
  let apiUnavailableUntil = 0;
  let lastApiIssue = '';
  let lastForcedIndexAt = 0;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function roomItemsFromDocument(doc) {
    const roomItems = new Set(doc.querySelectorAll('[data-sentry-component="SwipeableRoomListItem"]'));
    doc.querySelectorAll('a[href*="/rooms/"]').forEach(link => {
      const item = link.closest('[data-sentry-component="SwipeableRoomListItem"], li, [role="listitem"]')
        || (link.parentElement && link.parentElement.parentElement);
      if (item) roomItems.add(item);
    });
    return Array.from(roomItems);
  }

  function harvestRoomDocument(doc) {
    let harvested = 0;
    for (const item of roomItemsFromDocument(doc)) {
      const record = parseItem(item, 'room');
      if (record) harvested++;
    }
    return harvested;
  }

  function readCookie(name) {
    try {
      const wanted = name + '=';
      for (const part of String(document.cookie || '').split(';')) {
        const text = part.trim();
        if (text.startsWith(wanted)) return decodeURIComponent(text.slice(wanted.length));
      }
    } catch (_) {}
    return '';
  }

  function tokenFromValue(value) {
    let text = normalizeText(value);
    if (!text) return '';

    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'string') text = parsed;
      else if (parsed && typeof parsed === 'object') {
        text = normalizeText(parsed.accessToken || parsed.access_token || parsed.token || parsed.TOKEN);
      }
    } catch (_) {}

    text = text.replace(/^Bearer\s+/i, '');
    const match = text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    return match ? match[0] : '';
  }

  function findStorageToken() {
    for (const storage of [localStorage, sessionStorage]) {
      try {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i) || '';
          if (!/token|auth|session/i.test(key)) continue;
          const token = tokenFromValue(storage.getItem(key));
          if (token) return token;
        }
      } catch (_) {}
    }
    return '';
  }

  function zetaAccessToken() {
    return tokenFromValue(readCookie('TOKEN')) || findStorageToken();
  }

  function jwtPayload(token) {
    try {
      const part = token.split('.')[1];
      if (!part) return {};
      const padded = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4);
      const binary = atob(padded);
      const bytes = Array.from(binary, ch => '%' + ('00' + ch.charCodeAt(0).toString(16)).slice(-2)).join('');
      return JSON.parse(decodeURIComponent(bytes));
    } catch (_) {
      return {};
    }
  }

  function zetaDeviceId(token) {
    const cookie = normalizeText(readCookie('DEVICE_ID'));
    if (cookie) return cookie;

    for (const storage of [localStorage, sessionStorage]) {
      for (const key of ['DEVICE_ID', 'deviceId', 'device_id']) {
        try {
          const value = normalizeText(storage.getItem(key));
          if (value) return value.replace(/^"|"$/g, '');
        } catch (_) {}
      }
    }

    return normalizeText(jwtPayload(token).did);
  }

  function apiHeaders() {
    const token = zetaAccessToken();
    const deviceId = zetaDeviceId(token);
    const headers = {
      Accept: 'application/json',
      'X-Client-Version': WEB_CLIENT_VERSION,
      'X-Client-Native-Version': WEB_CLIENT_VERSION,
      'X-Client-Type': 'web',
      'X-Device-Type': /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'web' : 'pc_web',
      'X-User-Language': 'KOREAN'
    };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (deviceId) headers['X-Sticky'] = deviceId;
    return headers;
  }

  // 상태 코드가 필요할 때가 있다(404 = 삭제된 플롯).
  async function apiRequest(path, params) {
    if (Date.now() < apiUnavailableUntil) return { ok: false, status: 0, data: null, skipped: true };

    const url = new URL(path, API_BASE);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }

    try {
      const response = await fetch(url.href, {
        method: 'GET',
        headers: apiHeaders(),
        credentials: 'include',
        cache: 'no-store'
      });

      if (response.status === 401 || response.status === 403) {
        apiUnavailableUntil = Date.now() + 60000;
        lastApiIssue = 'auth';
        return { ok: false, status: response.status, data: null };
      }
      if (response.status === 429) {
        apiUnavailableUntil = Date.now() + 30000;
        lastApiIssue = 'rate';
        return { ok: false, status: 429, data: null };
      }
      if (!response.ok) {
        if (response.status >= 500) lastApiIssue = 'server';
        return { ok: false, status: response.status, data: null };
      }

      const data = await response.json();
      lastApiIssue = '';
      return { ok: true, status: response.status, data };
    } catch (_) {
      apiUnavailableUntil = Date.now() + 30000;
      lastApiIssue = 'network';
      return { ok: false, status: 0, data: null };
    }
  }

  async function apiGet(path, params) {
    const result = await apiRequest(path, params);
    return result.ok ? result.data : null;
  }

  function unwrapApi(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return payload.data;
    return payload;
  }

  function localePrefix() {
    const first = location.pathname.split('/').filter(Boolean)[0] || 'ko';
    return /^[a-z]{2}(?:-[a-z]{2})?$/i.test(first) ? first : 'ko';
  }

  function ingestPlotMeta(plot, plotIdHint, originatedIdHint, options) {
    if (!plot || typeof plot !== 'object') return null;

    const plotId = normalizeText(plot.id || plot.plotId || plotIdHint);
    const originatedId = normalizeText(
      plot.originatedId ||
      plot.originalId ||
      originatedIdHint
    );
    const canonicalId = canonicalPlotId(plotIdHint || plotId, originatedId);
    if (!canonicalId) return null;

    const previous = state.plotMeta[canonicalId]
      || (plotId && state.plotMeta[plotId])
      || {};
    const characters = plotCharacterNames(plot);
    const creators = plotCreatorNames(plot);
    const detailFetched = Boolean(options && options.detailFetched);

    const next = {
      ...previous,
      canonicalId,
      plotId: normalizeText(plotIdHint || plotId || previous.plotId),
      sourcePlotId: plotId || previous.sourcePlotId || '',
      originatedId: originatedId || previous.originatedId || '',
      name: normalizeText(plot.name || plot.title || previous.name),
      image: normalizeText(plot.imageUrl || plot.initialRoomImageUrl || previous.image),
      characterNames: characters.length ? characters : (previous.characterNames || []),
      creatorNames: creators.length ? creators : (previous.creatorNames || []),
      updatedAt: Date.now()
    };

    if (detailFetched) {
      next.detailFetchedAt = Date.now();
      delete next.failedAt;
      delete next.missing;
      delete next.missingAt;
      next.failCount = 0;
      next.emptyDetail = next.characterNames.length === 0 && next.creatorNames.length === 0;
    }

    state.plotMeta[canonicalId] = next;

    if (plotId && plotId !== canonicalId && state.plotMeta[plotId]) {
      delete state.plotMeta[plotId];
    }

    return next;
  }

  function applyPlotMetaToRooms(canonicalId, meta) {
    if (!canonicalId || !meta) return;
    for (const entry of Object.values(state.index)) {
      if (!entry || entry.type !== 'room') continue;
      if (canonicalPlotId(entry.plotId, entry.originatedId) !== canonicalId) continue;

      entry.originatedId = entry.originatedId || meta.originatedId || '';
      entry.characterNames = uniqueTexts(entry.characterNames, meta.characterNames);
      entry.creatorNames = uniqueTexts(entry.creatorNames, meta.creatorNames);
      if (!entry.image && meta.image) entry.image = meta.image;
      if (meta.missing) entry.plotMissing = true;
      else delete entry.plotMissing;
    }
  }

  function ingestApiRoom(room) {
    if (!room || typeof room !== 'object') return null;
    const roomId = normalizeText(room.id || room.roomId);
    if (!roomId) return null;

    const plot = room.plot && typeof room.plot === 'object' ? room.plot : {};
    const plotId = normalizeText(room.plotId || plot.id || plot.plotId);
    const originatedId = normalizeText(plot.originatedId || plot.originalId || room.originatedId);
    const canonicalId = canonicalPlotId(plotId, originatedId);
    const meta = ingestPlotMeta(plot, plotId, originatedId)
      || (canonicalId ? state.plotMeta[canonicalId] : null);

    const key = keyOf('room', roomId);
    const previous = state.index[key] || {};

    delete previous.missingSince;

    state.index[key] = {
      ...previous,
      type: 'room',
      id: roomId,
      apiSeenAt: Date.now(),
      href: previous.href || '/' + localePrefix() + '/rooms/' + roomId,
      original: normalizeText(plot.name || plot.title || previous.original),
      alias: normalizeText(state.aliases[key]),
      image: normalizeText(plot.imageUrl || plot.initialRoomImageUrl || previous.image),
      plotId: plotId || previous.plotId || '',
      originatedId: originatedId || previous.originatedId || '',
      characterNames: uniqueTexts(previous.characterNames, meta && meta.characterNames),
      creatorNames: uniqueTexts(previous.creatorNames, meta && meta.creatorNames)
    };

    if (canonicalId && meta) applyPlotMetaToRooms(canonicalId, meta);
    return state.index[key];
  }

  async function fetchAllRoomsFromApi() {
    let cursor = '';
    const seen = new Set();
    let gotAny = false;
    const roomIds = new Set();
    let complete = false;

    for (let page = 0; page < 250; page++) {
      const result = await apiRequest('/v2/rooms', { limit: 100, cursor: cursor || undefined });
      if (!result.ok) return { gotAny, complete: false, roomIds };

      const payload = result.data;
      const body = unwrapApi(payload);
      const rooms = Array.isArray(body && body.rooms)
        ? body.rooms
        : (Array.isArray(payload.rooms) ? payload.rooms : []);

      for (const room of rooms) {
        const entry = ingestApiRoom(room);
        if (entry && entry.id) roomIds.add(entry.id);
      }
      if (rooms.length) gotAny = true;

      saveState();
      scheduleRefresh();

      const next = normalizeText(
        (body && (body.nextCursor || body.next_cursor)) ||
        payload.nextCursor ||
        payload.next_cursor
      );
      if (!next || seen.has(next)) {
        complete = true;
        break;
      }
      seen.add(next);
      cursor = next;
    }
    return { gotAny, complete, roomIds };
  }

  // 목록을 끝까지 받아왔는데 없는 방은 제타에서 사라진 방이다.
  // 바로 지우지 않고 한 번 표시해 둔 뒤(동기화 지연 대비) 다음 순회에서 정리한다.
  function pruneVanishedRooms(roomIds) {
    if (!(roomIds instanceof Set) || !roomIds.size) return 0;

    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of Object.entries(state.index)) {
      if (!entry || entry.type !== 'room' || !entry.id) continue;
      if (roomIds.has(entry.id)) continue;
      // 실제 방 ID가 없는 임시 항목은 대조할 수 없으니 건드리지 않는다.
      if (String(entry.id).startsWith('local-')) continue;

      if (!entry.missingSince) {
        entry.missingSince = now;
        continue;
      }
      if (now - entry.missingSince < 10 * 60 * 1000) continue;

      delete state.index[key];
      removed++;
    }
    return removed;
  }

  // 플롯이 삭제돼도 대화방 자체는 목록에 남는데, 그 방은 열면 "없는 페이지"가 된다.
  // 검색 결과에서 걸러낼 수 있도록 삭제 사실을 캐시에 남긴다.
  function markPlotMissing(target) {
    if (!target || !target.canonicalId) return null;

    const previous = state.plotMeta[target.canonicalId]
      || (target.plotId ? state.plotMeta[target.plotId] : null)
      || {};

    const meta = {
      ...previous,
      canonicalId: target.canonicalId,
      plotId: target.plotId || previous.plotId || '',
      originatedId: target.originatedId || previous.originatedId || '',
      characterNames: previous.characterNames || [],
      creatorNames: previous.creatorNames || [],
      missing: true,
      missingAt: Date.now(),
      detailFetchedAt: Date.now(),
      failCount: 0
    };
    delete meta.failedAt;

    state.plotMeta[target.canonicalId] = meta;
    applyPlotMetaToRooms(target.canonicalId, meta);
    return meta;
  }

  async function enrichMissingPlotMeta() {
    const targets = [];
    const now = Date.now();
    const seenCanonical = new Set();

    for (const entry of Object.values(state.index)) {
      if (!entry || entry.type !== 'room') continue;

      const plotId = normalizeText(entry.plotId);
      const originatedId = normalizeText(entry.originatedId);
      const canonicalId = canonicalPlotId(plotId, originatedId);
      if (!canonicalId || seenCanonical.has(canonicalId)) continue;
      seenCanonical.add(canonicalId);

      const cached = state.plotMeta[canonicalId] || (plotId ? state.plotMeta[plotId] : null);
      const detailFresh = Number((cached && cached.detailFetchedAt) || 0) > now - 7 * 24 * 60 * 60 * 1000;

      if (detailFresh) {
        applyPlotMetaToRooms(canonicalId, cached);
        continue;
      }

      const failedAt = Number((cached && cached.failedAt) || 0);
      const failCount = Number((cached && cached.failCount) || 0);
      const backoff = Math.min(
        7 * 24 * 60 * 60 * 1000,
        30 * 60 * 1000 * Math.pow(2, Math.min(failCount, 8))
      );

      if (failedAt && now - failedAt < backoff) {
        if (cached) applyPlotMetaToRooms(canonicalId, cached);
        continue;
      }

      targets.push({ plotId, originatedId, canonicalId });
    }

    let nextIndex = 0;
    let stop = false;

    const worker = async () => {
      while (!stop) {
        const index = nextIndex++;
        if (index >= targets.length) return;

        const target = targets[index];
        // 내 플롯(plot.id)을 먼저 조회한다. 원본이 삭제돼 있어도 이쪽은 살아있다.
        const candidates = uniqueTexts([
          target.plotId,
          target.originatedId
        ]);

        let meta = null;
        let sawGone = false;
        let sawLive = false;

        for (const candidate of candidates) {
          const result = await apiRequest('/v1/plots/' + encodeURIComponent(candidate));

          // 404/410은 "삭제된 플롯"이라는 확실한 신호다. 통신 실패와 구분한다.
          if (result.status === 404 || result.status === 410) {
            sawGone = true;
            continue;
          }
          if (!result.ok) {
            if (Date.now() < apiUnavailableUntil) {
              stop = true;
              break;
            }
            continue;
          }

          const plot = unwrapApi(result.data);
          if (!plot || typeof plot !== 'object') continue;
          if (!plot.id && !plot.name && !plot.title && !plot.characters && !plot.chatProfiles) continue;
          sawLive = true;

          meta = ingestPlotMeta(
            plot,
            target.plotId,
            target.originatedId || plot.originatedId || plot.originalId,
            { detailFetched: true }
          );
          if (meta) break;
        }

        if (meta) {
          applyPlotMetaToRooms(target.canonicalId, meta);
        } else if (sawGone && !sawLive && !stop) {
          markPlotMissing(target);
        } else if (!stop) {
          const previous = state.plotMeta[target.canonicalId]
            || (target.plotId ? state.plotMeta[target.plotId] : null)
            || {};
          state.plotMeta[target.canonicalId] = {
            ...previous,
            canonicalId: target.canonicalId,
            plotId: target.plotId || previous.plotId || '',
            originatedId: target.originatedId || previous.originatedId || '',
            characterNames: previous.characterNames || [],
            creatorNames: previous.creatorNames || [],
            failedAt: Date.now(),
            failCount: Number(previous.failCount || 0) + 1
          };
        }

        if (index % 10 === 0) {
          saveState();
          scheduleRefresh();
        }
        await sleep(80);
      }
    };

    await Promise.all([worker(), worker(), worker()]);
    saveState();
    scheduleRefresh();
  }

  async function harvestScrappedPlots() {
    let cursor = '';
    const seen = new Set();

    for (let page = 0; page < 40; page++) {
      const payload = await apiGet('/v1/plots/scrapped', {
        limit: 30,
        cursor: cursor || undefined
      });
      if (!payload) return;

      const body = unwrapApi(payload);
      const plots = Array.isArray(body && body.plots)
        ? body.plots
        : Array.isArray(body && body.items)
          ? body.items
          : Array.isArray(body && body.contents)
            ? body.contents
            : [];

      for (const plot of plots) {
        const plotId = normalizeText(plot && (plot.id || plot.plotId));
        const originatedId = normalizeText(plot && (plot.originatedId || plot.originalId));
        const canonicalId = canonicalPlotId(plotId, originatedId);
        const meta = ingestPlotMeta(plot, plotId, originatedId);
        if (canonicalId && meta) applyPlotMetaToRooms(canonicalId, meta);
      }

      const next = normalizeText(
        (body && (body.nextCursor || body.next_cursor)) ||
        (payload && (payload.nextCursor || payload.next_cursor))
      );
      if (!next || seen.has(next)) break;
      seen.add(next);
      cursor = next;
    }

    saveState();
    scheduleRefresh();
  }

  async function buildFullRoomIndexInBackground(force) {
    if (currentSection() !== 'room') return false;

    // 화면 스크롤은 절대 건드리지 않는다.
    harvestRoomDocument(document);

    const last = Number(localStorage.getItem(BACKGROUND_INDEX_STAMP_KEY) || 0);
    if (!force && Date.now() - last < 5 * 60 * 1000) return true;

    const sweep = await fetchAllRoomsFromApi();
    if (!sweep.gotAny) {
      saveState();
      scheduleRefresh();
      return false;
    }

    if (sweep.complete) pruneVanishedRooms(sweep.roomIds);

    await harvestScrappedPlots();
    await enrichMissingPlotMeta();

    localStorage.setItem(BACKGROUND_INDEX_STAMP_KEY, String(Date.now()));
    saveState();
    scheduleRefresh();
    return true;
  }

  function ensureBackgroundRoomIndex(force) {
    if (backgroundIndexPromise) return backgroundIndexPromise;
    backgroundIndexPromise = buildFullRoomIndexInBackground(Boolean(force))
      .finally(() => { backgroundIndexPromise = null; });
    return backgroundIndexPromise;
  }


  // ── 내 플롯 수동 전체 수집 / 백업 ───────────────────────────────────
  // Room Manager가 플롯 API를 직접 호출하지 않는다.
  // 사용자가 '전체 수집'을 눌렀을 때 Creator Center 목록을 실제로 스크롤하고,
  // 제타가 화면에 렌더링한 항목만 로컬 인덱스에 누적 저장한다.

  function plotCollectionCount() {
    return Object.values(state.index).filter(entry => entry && entry.type === 'plot' && entry.id).length;
  }

  function collectRenderedPlots() {
    let seen = 0;
    const items = document.querySelectorAll('[data-sentry-component="CreatorCenterMyPlotListItem"]');
    for (const item of items) {
      const record = parseItem(item, 'plot');
      if (!record) continue;
      applyAlias(record);
      seen++;
    }
    if (seen) saveState();
    return seen;
  }

  function plotCollectionScrollHost() {
    const first = document.querySelector('[data-sentry-component="CreatorCenterMyPlotListItem"]');
    let node = first && first.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 20) return node;
      node = node.parentElement;
    }

    const main = document.querySelector('main#contents, main, [role="main"]');
    if (main) {
      const candidates = Array.from(main.querySelectorAll('*')).filter(el => {
        const style = getComputedStyle(el);
        return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 20;
      });
      candidates.sort((x, y) => y.scrollHeight - x.scrollHeight);
      if (candidates[0]) return candidates[0];
    }
    return document.scrollingElement || document.documentElement;
  }

  function scrollMetrics(host) {
    const root = host === document.scrollingElement || host === document.documentElement || host === document.body;
    return {
      root,
      top: root ? (window.scrollY || document.documentElement.scrollTop || 0) : host.scrollTop,
      height: root ? Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) : host.scrollHeight,
      client: root ? window.innerHeight : host.clientHeight
    };
  }

  function setScrollTop(host, value) {
    const root = host === document.scrollingElement || host === document.documentElement || host === document.body;
    if (root) window.scrollTo(0, value);
    else host.scrollTop = value;
  }

  async function collectAllPlotsByScrolling() {
    const section = currentSection();
    if (section !== 'plot' && section !== 'plot-search') {
      alert('제작자센터의 플롯 목록에서 실행해 주세요.');
      return false;
    }
    if (plotCollectionPromise) return plotCollectionPromise;

    plotCollectionPromise = (async () => {
      plotCollectionProgress = { running: true, count: plotCollectionCount() };
      renderPlotTools();

      const host = plotCollectionScrollHost();
      const originalTop = scrollMetrics(host).top;
      let lastHeight = 0;
      let lastCount = plotCollectionCount();
      let stableRounds = 0;

      // 처음부터 훑어야 가상 목록에서 빠지는 항목이 없다.
      setScrollTop(host, 0);
      await sleep(450);
      collectRenderedPlots();

      for (let round = 0; round < 1600; round++) {
        collectRenderedPlots();
        const before = scrollMetrics(host);
        const count = plotCollectionCount();

        plotCollectionProgress.count = count;
        renderPlotTools();

        const nearBottom = before.top + before.client >= before.height - Math.max(80, before.client * 0.15);
        if (nearBottom) {
          setScrollTop(host, before.height);
          await sleep(700);
          collectRenderedPlots();

          const after = scrollMetrics(host);
          const afterCount = plotCollectionCount();
          if (after.height <= before.height + 2 && afterCount <= count) stableRounds++;
          else stableRounds = 0;

          if (stableRounds >= 4) break;
        } else {
          stableRounds = 0;
          const step = Math.max(320, Math.floor(before.client * 0.78));
          setScrollTop(host, Math.min(before.height, before.top + step));
          await sleep(320);
        }

        const now = scrollMetrics(host);
        const nowCount = plotCollectionCount();
        if (now.height === lastHeight && nowCount === lastCount && nearBottom) stableRounds++;
        lastHeight = now.height;
        lastCount = nowCount;
      }

      collectRenderedPlots();
      saveStateNow();
      localStorage.setItem(PLOT_COLLECTION_STAMP_KEY, String(Date.now()));

      // 사용자가 보던 위치로 돌아간다.
      setScrollTop(host, originalTop);
      await sleep(100);

      const total = plotCollectionCount();
      plotCollectionProgress = { running: false, count: total };
      renderPlotTools();
      alert('전체 수집 완료 · 저장된 플롯 ' + total + '개');
      return true;
    })().finally(() => {
      plotCollectionPromise = null;
      plotCollectionProgress.running = false;
      renderPlotTools();
    });

    return plotCollectionPromise;
  }

  function exportRoomManagerData() {
    saveStateNow();
    const payload = {
      format: 'zeta-room-manager-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      state: {
        version: STATE_VERSION,
        aliases: state.aliases,
        index: state.index,
        plotMeta: state.plotMeta
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = 'zeta-room-manager-' + date + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importRoomManagerData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return input.remove();
      try {
        const parsed = JSON.parse(await file.text());
        const incoming = parsed && parsed.format === 'zeta-room-manager-backup' ? parsed.state : parsed;
        if (!incoming || typeof incoming !== 'object') throw new Error('올바른 Room Manager 백업 파일이 아닙니다.');

        const aliases = incoming.aliases && typeof incoming.aliases === 'object' ? incoming.aliases : {};
        const index = incoming.index && typeof incoming.index === 'object' ? incoming.index : {};
        const plotMeta = incoming.plotMeta && typeof incoming.plotMeta === 'object' ? incoming.plotMeta : {};

        Object.assign(state.aliases, aliases);
        Object.assign(state.index, index);
        Object.assign(state.plotMeta, plotMeta);
        saveStateNow();
        localStorage.setItem(PLOT_COLLECTION_STAMP_KEY, String(Date.now()));
        scheduleRefresh();
        alert('불러오기 완료 · 저장된 플롯 ' + plotCollectionCount() + '개');
      } catch (error) {
        alert('불러오기 실패: ' + (error && error.message ? error.message : error));
      } finally {
        input.remove();
      }
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  }

  function plotIndexStatusText() {
    if (plotCollectionProgress.running) {
      return '전체 수집 중 · 현재 ' + plotCollectionProgress.count + '개 저장됨';
    }
    if (!Number(localStorage.getItem(PLOT_COLLECTION_STAMP_KEY) || 0)) {
      return '캐릭터명·제작자명 전체 검색은 먼저 Room Manager의 ‘전체 수집’을 한 번 실행해 주세요.';
    }
    return '';
  }

  function renderPlotTools() {
    const section = currentSection();
    let tools = document.getElementById(PLOT_TOOLS_ID);
    if (section !== 'plot' && section !== 'plot-search') {
      tools?.remove();
      return;
    }

    if (!tools) {
      tools = document.createElement('div');
      tools.id = PLOT_TOOLS_ID;
      tools.innerHTML =
        '<button type="button" data-zrm-action="collect">전체 수집</button>' +
        '<button type="button" data-zrm-action="export">내보내기</button>' +
        '<button type="button" data-zrm-action="import">불러오기</button>' +
        '<span data-zrm-count></span>';

      tools.querySelector('[data-zrm-action="collect"]').addEventListener('click', () => collectAllPlotsByScrolling());
      tools.querySelector('[data-zrm-action="export"]').addEventListener('click', exportRoomManagerData);
      tools.querySelector('[data-zrm-action="import"]').addEventListener('click', importRoomManagerData);
      document.body.appendChild(tools);
    }

    const collect = tools.querySelector('[data-zrm-action="collect"]');
    if (collect) {
      collect.disabled = plotCollectionProgress.running;
      collect.textContent = plotCollectionProgress.running ? '수집 중…' : '전체 수집';
    }
    const count = tools.querySelector('[data-zrm-count]');
    if (count) count.textContent = '저장 ' + plotCollectionCount() + '개';
  }

  function extractId(href, type) {
    if (!href) return null;
    const re = type === 'room'
      ? /\/rooms\/([^/?#]+)/i
      : /\/plots\/([^/?#]+)(?:\/|$)/i;
    return href.match(re)?.[1] || null;
  }

  function stableLocalId(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `local-${(hash >>> 0).toString(36)}`;
  }

  // 제목도 이미지도 없으면 항목을 구분할 근거가 없다.
  // 그래도 해시를 만들면 빈 항목이 전부 같은 키로 뭉쳐서, 서로 무관한
  // (예: 탈퇴한 제작자의) 캐릭터명이 한 항목에 계속 쌓인다.
  // 항목의 ID와 일치하는 객체만 골라낸다.
  // ID로 못을 박으므로 조상까지 넉넉히 올라가도 남의 항목이나
  // 페이지 전역 정보(로그인한 나·페르소나)가 섞일 수 없다.
  function reactEntityForId(item, wantedId) {
    const id = normalizeText(wantedId);
    if (!id || id.startsWith('local-')) return null;

    const fiberKey = Object.keys(item || {}).find(key => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? item[fiberKey] : null;

    const isMatch = value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      return [value.id, value.plotId, value.originatedId, value.originalId]
        .some(candidate => normalizeText(candidate) === id);
    };

    for (let depth = 0; fiber && depth < 16; depth++, fiber = fiber.return) {
      for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
        if (!props || typeof props !== 'object' || Array.isArray(props)) continue;
        if (isMatch(props)) return props;

        for (const value of Object.values(props)) {
          if (isMatch(value)) return value;
          if (value && typeof value === 'object' && isMatch(value.plot)) return value.plot;
          // 목록 배열이 걸리면 그 안에서 이 항목에 해당하는 것만 꺼낸다.
          if (Array.isArray(value)) {
            const hit = value.find(isMatch);
            if (hit) return hit;
          }
        }
      }
    }
    return null;
  }

  function localFallbackId(original, image) {
    const title = normalizeText(original);
    const picture = normalizeText(image).split('?')[0];
    if (!title && !picture) return null;
    return stableLocalId(title + '\n' + picture);
  }

  function reactPlotId(item) {
    const fiberKey = Object.keys(item || {}).find(key => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? item[fiberKey] : null;
    const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
    for (let depth = 0; fiber && depth < 18; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps || fiber.pendingProps;
      for (const candidate of [props?.plotId, props?.plot_id, props?.id, props?.plot?.id, props?.plot?.plotId]) {
        if (typeof candidate === 'string' && uuid.test(candidate)) return candidate;
      }
    }
    return null;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${NATIVE_RESULTS_ID} {
        flex: 0 0 auto;
      }
      #${NATIVE_RESULTS_ID}:empty { display: none; }
      #${NATIVE_RESULTS_ID} .zrm-native-avatar {
        width: 42px;
        height: 56px;
        object-fit: cover;
        border-radius: 7px;
        background: #2a2a2e;
      }
      #${NATIVE_RESULTS_ID} .zrm-native-avatar-placeholder {
        width: 42px;
        height: 56px;
        border-radius: 7px;
        background: #2a2a2e;
      }
      #${NATIVE_RESULTS_ID} .zrm-native-note,
      #${PLOT_NATIVE_RESULTS_ID} .zrm-native-note {
        padding: 10px 16px;
        color: rgba(255,255,255,.45);
        font-size: 11px;
        line-height: 1.5;
        white-space: pre-wrap;
      }
      [data-zrm-dead="1"] a[href*="/rooms/"] { opacity: .45; }
      [data-zrm-dead="1"] a[href*="/rooms/"]::after {
        content: '플롯 삭제됨';
        align-self: center;
        flex: 0 0 auto;
        margin-left: 6px;
        padding: 2px 6px;
        border-radius: 6px;
        background: rgba(255,120,120,.16);
        color: #ff9a9a;
        font-size: 10px;
        white-space: nowrap;
      }
      #${PLOT_NATIVE_RESULTS_ID} { flex: 0 0 auto; padding: 0 16px; }
      #${PLOT_NATIVE_RESULTS_ID}:empty { display: none; }
      #${PLOT_NATIVE_RESULTS_ID} .zrm-plot-avatar,
      #${PLOT_NATIVE_RESULTS_ID} .zrm-plot-avatar-placeholder {
        width: 39px;
        height: 52px;
        flex: 0 0 auto;
        border-radius: 6px;
        object-fit: cover;
        background: #2a2a2e;
      }

      /* 대화방 목록에는 별명 버튼을 상시 표시하지 않음.
         별명 편집은 제타의 길게 누르기 메뉴에 주입한다. */
      .zrm-room-item > a[href*="/rooms/"] { padding-right: 16px !important; }
      .zrm-room-rename { display: none !important; }
      .zrm-context-rename svg { flex: 0 0 auto; }
      .zrm-plot-rename {
        height: 30px;
        padding: 0 8px;
        border: 0;
        border-radius: 7px;
        background: rgba(255,255,255,.07);
        color: rgba(255,255,255,.64);
        cursor: pointer;
        font-size: 11px;
        white-space: nowrap;
      }
      .zrm-plot-rename:hover { background: rgba(255,255,255,.12); color: #fff; }

      #${PLOT_TOOLS_ID} {
        position: fixed;
        right: 12px;
        bottom: calc(12px + env(safe-area-inset-bottom, 0px));
        z-index: 2147483000;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 7px;
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 12px;
        background: rgba(28,28,31,.94);
        box-shadow: 0 8px 28px rgba(0,0,0,.28);
        backdrop-filter: blur(12px);
      }
      #${PLOT_TOOLS_ID} button {
        height: 30px;
        padding: 0 9px;
        border: 0;
        border-radius: 8px;
        background: rgba(255,255,255,.08);
        color: #fff;
        font-size: 11px;
        white-space: nowrap;
      }
      #${PLOT_TOOLS_ID} button:disabled { opacity: .45; }
      #${PLOT_TOOLS_ID} [data-zrm-count] {
        padding: 0 4px;
        color: rgba(255,255,255,.5);
        font-size: 10px;
        white-space: nowrap;
      }

      #${MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px;
        background: rgba(0,0,0,.58);
        box-sizing: border-box;
      }
      #${MODAL_ID} .zrm-dialog {
        width: min(360px, 100%);
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 16px;
        background: #202023;
        color: #fff;
        box-shadow: 0 20px 60px rgba(0,0,0,.35);
        overflow: hidden;
      }
      #${MODAL_ID} .zrm-dialog-body { padding: 18px; }
      #${MODAL_ID} h3 { margin: 0 0 6px; font-size: 17px; }
      #${MODAL_ID} p { margin: 0 0 13px; color: rgba(255,255,255,.55); font-size: 12px; line-height: 1.5; }
      #${MODAL_ID} input {
        width: 100%;
        height: 42px;
        box-sizing: border-box;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 10px;
        background: #2a2a2e;
        color: #fff;
        padding: 0 12px;
        outline: none;
        font: inherit;
      }
      #${MODAL_ID} input:focus { border-color: #7c67ff; }
      #${MODAL_ID} .zrm-actions {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 8px;
        padding: 0 18px 18px;
      }
      #${MODAL_ID} button {
        height: 38px;
        border: 0;
        border-radius: 9px;
        cursor: pointer;
        font: inherit;
      }
      #${MODAL_ID} .zrm-cancel { background: #343438; color: #ddd; }
      #${MODAL_ID} .zrm-reset { background: #3a3030; color: #ffaaaa; }
      #${MODAL_ID} .zrm-save { background: #6d52ff; color: #fff; font-weight: 700; }
    `;
    document.documentElement.appendChild(style);
  }

  function titleElementForRoom(item, link) {
    return link?.querySelector('span.body1.font-medium')
      || link?.querySelector('.body1.font-medium')
      || link?.querySelector('[class*="line-clamp"]')
      || Array.from(link?.querySelectorAll('span, div') || []).find(el => !el.children.length && normalizeText(el.textContent))
      || null;
  }

  function titleElementForPlot(item, link) {
    const candidates = Array.from(link?.querySelectorAll('div.body1.font-medium') || []);
    return candidates.find(el => !el.querySelector('*'))
      || link?.querySelector('.line-clamp-1.body1.font-medium')
      || null;
  }

  function parseItem(item, type) {
    if (item.closest && item.closest('#' + NATIVE_RESULTS_ID + ', #' + PLOT_NATIVE_RESULTS_ID)) return null;
    const link = type === 'room'
      ? item.querySelector('a[href*="/rooms/"]')
      : item.querySelector('a[href*="/plots/"]');
    if (type === 'room' && !link) return null;

    const titleEl = type === 'room'
      ? titleElementForRoom(item, link)
      : titleElementForPlot(item, link || item);
    if (!titleEl) return null;

    if (!titleEl.dataset.zrmOriginalTitle) titleEl.dataset.zrmOriginalTitle = normalizeText(titleEl.textContent);

    const original = titleEl.dataset.zrmOriginalTitle;
    const image = (link || item).querySelector('img')?.src || '';
    const id = extractId(link && link.href, type)
      || item.getAttribute('data-plot-id')
      || (type === 'plot' ? reactPlotId(item) : null)
      || localFallbackId(original, image);
    if (!id) return null;

    const key = keyOf(type, id);
    const alias = normalizeText(state.aliases[key]);
    const previous = state.index[key] || {};
    // 제타가 실제로 그려준 방이면 사라진 방이 아니다.
    delete previous.missingSince;
    const searchMeta = collectSearchMeta(item, titleEl);
    // 플롯 목록 항목은 API 보강 대상이 아니라 화면 데이터가 유일한 출처다.
    const ownEntity = reactEntityForId(item, id);
    const roomPlot = type === 'room' ? (reactRoomPlotMeta(item) || ownEntity) : null;
    const plotEntity = type === 'plot' ? ownEntity : null;
    const plotEntityMeta = plotEntity
      ? ingestPlotMeta(
          plotEntity,
          id,
          plotEntity.originatedId || plotEntity.originalId
        )
      : null;
    const roomPlotId = normalizeText((roomPlot && (roomPlot.id || roomPlot.plotId)) || previous.plotId);
    const roomOriginatedId = normalizeText(
      (roomPlot && (roomPlot.originatedId || roomPlot.originalId)) ||
      previous.originatedId
    );
    const roomCanonicalId = canonicalPlotId(roomPlotId, roomOriginatedId);
    const roomMeta = roomPlot
      ? ingestPlotMeta(roomPlot, roomPlotId, roomOriginatedId)
      : (roomCanonicalId ? state.plotMeta[roomCanonicalId] : null);

    state.index[key] = {
      ...previous,
      type: type,
      id: id,
      href: (link && link.href) || previous.href
        || (type === 'plot' && !id.startsWith('local-') ? '/ko/plots/' + id + '/edit' : ''),
      original: original,
      alias: alias,
      image: image || previous.image || '',
      plotId: type === 'room'
        ? (roomPlotId || previous.plotId || '')
        : (previous.plotId || (id.startsWith('local-') ? '' : id)),
      originatedId: type === 'room'
        ? (roomOriginatedId || previous.originatedId || '')
        : (previous.originatedId || ''),
      characterNames: uniqueTexts(
        searchMeta.characterNames,
        plotEntity && plotCharacterNames(plotEntity),
        plotEntityMeta && plotEntityMeta.characterNames,
        roomMeta && roomMeta.characterNames,
        previous.characterNames
      ),
      creatorNames: uniqueTexts(
        searchMeta.creatorNames,
        plotEntity && plotCreatorNames(plotEntity),
        plotEntityMeta && plotEntityMeta.creatorNames,
        roomMeta && roomMeta.creatorNames,
        previous.creatorNames
      )
    };

    return { key, type, id, item, link, titleEl, original, alias };
  }

  function renderedItems() {
    const out = [];
    const roomItems = new Set(document.querySelectorAll('[data-sentry-component="SwipeableRoomListItem"]'));
    document.querySelectorAll('a[href*="/rooms/"]').forEach(link => {
      const item = link.closest('[data-sentry-component="SwipeableRoomListItem"], li, [role="listitem"]') || link.parentElement?.parentElement;
      if (item) roomItems.add(item);
    });
    roomItems.forEach(el => {
      const x = parseItem(el, 'room');
      if (x) out.push(x);
    });
    document.querySelectorAll('[data-sentry-component="CreatorCenterMyPlotListItem"]').forEach(el => {
      const x = parseItem(el, 'plot');
      if (x) out.push(x);
    });
    return out;
  }

  function applyAlias(record) {
    const alias = normalizeText(state.aliases[record.key]);
    record.alias = alias;
    const nextTitle = alias || record.original;
    if (normalizeText(record.titleEl.textContent) !== nextTitle) record.titleEl.textContent = nextTitle;
    record.titleEl.classList.toggle('zrm-has-alias', !!alias);

    const indexed = state.index[record.key] || {};
    const next = {
      ...indexed,
      type: record.type,
      id: record.id,
      href: record.link?.href || indexed.href || '',
      original: record.original,
      alias,
      image: (record.link || record.item).querySelector('img')?.src || indexed.image || ''
    };
    state.index[record.key] = next;

    // 삭제된 플롯의 방은 눌러도 열리지 않으므로 목록에서 미리 표시해 준다.
    if (record.type === 'room' && next.plotMissing) record.item.dataset.zrmDead = '1';
    else if (record.item.dataset.zrmDead) delete record.item.dataset.zrmDead;
  }

  function makeRenameButton(record) {
    if (record.type === 'room') {
      record.item.querySelector('.zrm-room-rename')?.remove();
      record.item.classList.add('zrm-room-item');
      return;
    }

    if (record.item.querySelector(`.zrm-${record.type}-rename`)) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `zrm-${record.type}-rename`;
    btn.textContent = '별명';
    btn.setAttribute('aria-label', `${record.original} 별명 편집`);

    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openRenameModal(record);
    }, true);

    const row = record.link?.parentElement
      || record.item.querySelector(':scope > div.flex.flex-row.items-center')
      || record.item.firstElementChild;
    const actions = row?.lastElementChild;
    if (actions && actions !== record.link && actions !== row) actions.insertBefore(btn, actions.firstChild);
    else record.item.appendChild(btn);
  }

  function snapshotRecord(record) {
    if (!record) return null;
    return {
      key: record.key,
      type: record.type,
      id: record.id,
      item: record.item,
      link: record.link,
      titleEl: record.titleEl,
      original: record.original,
      alias: normalizeText(state.aliases[record.key])
    };
  }

  function rememberRoomContextTarget(event) {
    const link = event.target?.closest?.('a[href*="/rooms/"]');
    const target = event.target?.closest?.('[data-sentry-component="SwipeableRoomListItem"], li, [role="listitem"]') || link?.parentElement?.parentElement;
    if (!target) return;
    const record = parseItem(target, 'room');
    if (record) lastRoomContextRecord = snapshotRecord(record);
  }

  function closeNativeRoomContextMenu(menu) {
    const layer = menu?.closest?.('[data-sentry-component="KeyboardAvoidingView"]');
    const backdrop = layer?.querySelector?.('[role="presentation"]');
    if (backdrop) {
      try { backdrop.click(); } catch (_) {}
    }
  }

  function injectRoomContextMenu() {
    const menus = new Set(document.querySelectorAll('[data-sentry-source-file="RoomListItemContextMenu.tsx"]'));
    document.querySelectorAll('[role="dialog"], [role="menu"]').forEach(menu => {
      if (Array.from(menu.querySelectorAll('button')).some(btn => normalizeText(btn.textContent) === '나가기')) menus.add(menu);
    });
    for (const menu of menus) {
      if (menu.querySelector('.zrm-context-rename')) continue;
      if (!lastRoomContextRecord) continue;

      const nativeButtons = Array.from(menu.querySelectorAll(':scope > button'));
      const template = nativeButtons[0];

      const button = document.createElement('button');
      button.type = 'button';
      button.className = template?.className
        || 'group flex flex-row gap-2.5 bg-gray-sub2 p-[18px] active:bg-gray-900 disabled:bg-gray-900 rounded-t-lg rounded-b-lg';
      button.classList.add('zrm-context-rename');
      button.setAttribute('aria-label', '별명 변경');
      button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
             class="size-4 text-white group-disabled:text-white/20" aria-hidden="true">
          <path fill="currentColor"
                d="M21.675 7.905c.433-.433.433-1.155 0-1.566l-4.014-4.014c-.41-.433-1.133-.433-1.566 0L14.05 4.358l5.58 5.58M2.293 16.127a1 1 0 0 0-.293.707V21a1 1 0 0 0 1 1h4.166a1 1 0 0 0 .707-.293l10.58-10.591-5.58-5.58z"/>
        </svg>
        <span class="body14 font-medium text-white group-disabled:text-white/20">별명 변경</span>
      `;

      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const record = lastRoomContextRecord;
        if (!record) return;
        closeNativeRoomContextMenu(menu);
        setTimeout(() => openRenameModal(record), 30);
      }, true);

      const leaveButton = nativeButtons.find(btn => normalizeText(btn.textContent) === '나가기');
      menu.insertBefore(button, leaveButton || null);
    }
  }

  function openRenameModal(record) {
    document.getElementById(MODAL_ID)?.remove();

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.innerHTML = `
      <div class="zrm-dialog" role="dialog" aria-modal="true" aria-label="별명 편집">
        <div class="zrm-dialog-body">
          <h3>별명 바꾸기</h3>
          <p>원래 이름: <strong></strong><br>제타 서버의 실제 이름은 바뀌지 않고 이 브라우저에서만 보여요.</p>
          <input type="text" maxlength="80" placeholder="별명을 입력하세요">
        </div>
        <div class="zrm-actions">
          <button type="button" class="zrm-cancel">취소</button>
          <button type="button" class="zrm-reset">원래 이름</button>
          <button type="button" class="zrm-save">저장</button>
        </div>
      </div>
    `;

    const input = overlay.querySelector('input');
    overlay.querySelector('strong').textContent = record.original;
    input.value = normalizeText(state.aliases[record.key]);

    const close = () => overlay.remove();
    const commit = value => {
      const alias = normalizeText(value);
      if (alias) state.aliases[record.key] = alias;
      else delete state.aliases[record.key];
      saveState();
      close();
      refresh();
    };

    overlay.querySelector('.zrm-cancel').addEventListener('click', close);
    overlay.querySelector('.zrm-reset').addEventListener('click', () => commit(''));
    overlay.querySelector('.zrm-save').addEventListener('click', () => commit(input.value));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') commit(input.value);
      if (e.key === 'Escape') close();
    });

    document.body.appendChild(overlay);
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  function currentSection() {
    if (/^\/(?:[^/]+\/)?rooms\/?$/i.test(location.pathname)) return 'room';
    if (/^\/(?:[^/]+\/)?creator-center\/search\/?$/i.test(location.pathname)) return 'plot-search';
    if (/^\/(?:[^/]+\/)?creator-center(?:\/|$)/i.test(location.pathname)) return 'plot';
    return null;
  }

  function removeLegacyPanel() {
    // 이전 버전에서 삽입했던 별도 검색 패널이 남아 있으면 제거한다.
    document.getElementById(PANEL_ID)?.remove();
  }

  function usableInputs(scope) {
    return Array.from((scope || document).querySelectorAll('input')).filter(el => {
      if (el.closest('#' + MODAL_ID)) return false;
      if (el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio') return false;
      return true;
    });
  }

  function looksLikeSearchInput(el) {
    if (!el) return false;
    if (el.type === 'search') return true;
    const hints = [
      el.getAttribute('name'),
      el.getAttribute('placeholder'),
      el.getAttribute('aria-label'),
      el.getAttribute('id')
    ].map(value => String(value || ''));
    return hints.some(value => /검색|search/i.test(value));
  }

  // 제타가 마크업을 바꿔도 검색 입력을 놓치지 않도록 단계적으로 찾는다.
  function nativeRoomSearchInput() {
    const direct = document.querySelector('input[name="room-list-search-input"]');
    if (direct) return direct;

    const roomList = document.querySelector('[data-sentry-component="RoomList"]');
    return usableInputs(roomList).find(looksLikeSearchInput)
      || usableInputs(document).find(looksLikeSearchInput)
      || null;
  }

  function nativeRoomQuery() {
    const input = nativeRoomSearchInput();
    if (input) return input.value;
    try {
      return new URL(location.href).searchParams.get('query') || '';
    } catch (_) {
      return '';
    }
  }

  function anyRoomLink() {
    return Array.from(document.querySelectorAll('a[href*="/rooms/"]'))
      .find(link => !link.closest('#' + NATIVE_RESULTS_ID)) || null;
  }

  function nativeRoomListHost() {
    const roomList = document.querySelector('[data-sentry-component="RoomList"]');
    const input = nativeRoomSearchInput();

    if (roomList) {
      const inner = input?.closest('.flex.flex-col.grow')
        || roomList.querySelector('[data-sentry-component="WrappedDiv"][data-sentry-source-file="index.tsx"]')
        || roomList.querySelector('.overflow-y-auto');
      if (inner) return inner;
      return roomList;
    }

    // RoomList 컴포넌트 표식이 사라져도 검색 결과는 보여줄 수 있어야 한다.
    return input?.closest('.flex.flex-col.grow')
      || anyRoomLink()?.closest('.overflow-y-auto, main, [role="main"]')
      || document.querySelector('main#contents, main, [role="main"]')
      || null;
  }

  function renderNativeAliasResults(query) {
    const q = normalizeText(query).toLocaleLowerCase('ko-KR');
    let box = document.getElementById(NATIVE_RESULTS_ID);

    if (!q || currentSection() !== 'room') {
      box?.remove();
      return;
    }

    const nativeIds = new Set(
      Array.from(document.querySelectorAll('a[href*="/rooms/"]'))
        .filter(link => !link.closest(`#${NATIVE_RESULTS_ID}`))
        .filter(link => normalizeText(link.textContent).toLocaleLowerCase('ko-KR').includes(q))
        .map(link => extractId(link.href, 'room'))
        .filter(Boolean)
    );
    const found = Object.values(state.index)
      .filter(entry => entry?.type === 'room' && entry.href)
      .filter(entry => matchesSearch(entry, q))
      .filter(entry => !nativeIds.has(entry.id));

    const alive = found.filter(entry => !isDeadEntry(entry));
    const matches = alive.slice(0, 20);
    const deadCount = found.length - alive.length;
    const status = matches.length ? '' : indexStatusText();

    if (status) ensureIndexForSearch();

    if (!matches.length && !deadCount && !status) {
      box?.remove();
      return;
    }

    const host = nativeRoomListHost();
    if (!host) return;

    if (!box) {
      box = document.createElement('div');
      box.id = NATIVE_RESULTS_ID;
    }
    box.textContent = '';

    for (const entry of matches) {
      const row = document.createElement('div');
      row.className = 'flex w-full min-w-0 flex-col';
      row.dataset.zrmAliasResult = entry.id;

      const item = document.createElement('div');
      item.className = 'relative flex flex-col';

      const link = document.createElement('a');
      link.className = 'group flex min-w-[215px] flex-row items-center justify-between gap-3 px-4 py-2.5';
      link.href = entry.href;
      link.setAttribute('testid', `room-list-item-${entry.id}`);

      const content = document.createElement('div');
      content.className = 'flex flex-1 flex-row items-center gap-3';

      const avatarWrap = document.createElement('div');
      avatarWrap.className = 'relative shrink-0';
      if (entry.image) {
        const image = document.createElement('img');
        image.className = 'zrm-native-avatar';
        image.src = entry.image;
        image.alt = '';
        image.width = 42;
        image.height = 56;
        image.loading = 'lazy';
        avatarWrap.appendChild(image);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'zrm-native-avatar-placeholder';
        avatarWrap.appendChild(placeholder);
      }

      const text = document.createElement('div');
      text.className = 'flex min-w-0 flex-1 flex-col';
      const title = document.createElement('div');
      title.className = 'body1 font-medium text-white line-clamp-1';
      title.textContent = entryTitle(entry);
      const original = document.createElement('div');
      original.className = 'body12 text-white/50 line-clamp-1';
      original.textContent = searchDetail(entry, '검색으로 찾은 대화방');
      text.append(title, original);
      content.append(avatarWrap, text);
      link.appendChild(content);
      item.appendChild(link);
      row.appendChild(item);
      box.appendChild(row);
    }

    if (deadCount) {
      box.appendChild(noteElement(
        '제타에서 사라진 대화방 ' + deadCount + '개는 결과에서 숨겼어요. 눌러도 열리지 않는 방이에요.'
      ));
    }
    if (status) box.appendChild(noteElement(status));

    const input = nativeRoomSearchInput();
    const searchRow = input?.closest('.p-4');
    const searchBlock = searchRow?.parentElement;
    if (searchBlock?.parentElement === host) {
      if (box.parentElement !== host || box.previousElementSibling !== searchBlock) {
        searchBlock.after(box);
      }
    } else if (box.parentElement !== host) {
      host.prepend(box);
    }
  }

  function bindNativeRoomSearch() {
    const input = nativeRoomSearchInput();
    if (!input || input.dataset.zrmAliasSearchBound === '1') return;
    input.dataset.zrmAliasSearchBound = '1';
    const update = () => scheduleRefresh();
    input.addEventListener('input', update);
    input.addEventListener('search', update);
    input.addEventListener('change', update);
  }

  function nativePlotSearchInput() {
    if (currentSection() !== 'plot-search') return null;
    const inputs = usableInputs(document);
    return inputs.find(looksLikeSearchInput) || inputs[0] || null;
  }

  function nativePlotResultsHost() {
    const main = document.querySelector('main#contents, main, [role="main"]');
    return main?.querySelector('[data-sentry-element="FlatList"], .overflow-y-auto') || main;
  }

  function renderNativePlotAliasResults(query) {
    const q = normalizeText(query).toLocaleLowerCase('ko-KR');
    let box = document.getElementById(PLOT_NATIVE_RESULTS_ID);
    if (!q || currentSection() !== 'plot-search') {
      box?.remove();
      return;
    }

    const nativeIds = new Set(
      Array.from(document.querySelectorAll('a[href*="/plots/"]'))
        .filter(link => !link.closest(`#${PLOT_NATIVE_RESULTS_ID}`))
        .filter(link => normalizeText(link.textContent).toLocaleLowerCase('ko-KR').includes(q))
        .map(link => extractId(link.href, 'plot'))
        .filter(Boolean)
    );
    const matches = Object.values(state.index)
      .filter(entry => entry?.type === 'plot' && entry.href)
      .filter(entry => matchesSearch(entry, q))
      .filter(entry => !nativeIds.has(entry.id))
      .filter(entry => !isDeadEntry(entry))
      .slice(0, 20);

    const status = matches.length ? '' : plotIndexStatusText();

    if (!matches.length && !status) {
      box?.remove();
      return;
    }
    const host = nativePlotResultsHost();
    if (!host) return;
    if (!box) {
      box = document.createElement('div');
      box.id = PLOT_NATIVE_RESULTS_ID;
    }
    box.textContent = '';

    for (const entry of matches) {
      const row = document.createElement('div');
      row.className = 'flex flex-col gap-2 border-b border-b-white/[3%] py-3';
      const line = document.createElement('div');
      line.className = 'flex flex-row items-center';
      const link = document.createElement('a');
      link.className = 'flex flex-1 flex-row items-center gap-3 pr-2';
      link.href = entry.href;

      if (entry.image) {
        const image = document.createElement('img');
        image.className = 'zrm-plot-avatar';
        image.src = entry.image;
        image.alt = '';
        image.width = 39;
        image.height = 52;
        link.appendChild(image);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'zrm-plot-avatar-placeholder';
        link.appendChild(placeholder);
      }

      const text = document.createElement('div');
      text.className = 'flex shrink flex-col';
      const title = document.createElement('div');
      title.className = 'line-clamp-1 shrink body1 font-medium text-ellipsis';
      title.textContent = entryTitle(entry);
      const original = document.createElement('div');
      original.className = 'caption1 text-white/50';
      original.textContent = searchDetail(entry, '검색으로 찾은 플롯');
      text.append(title, original);
      link.appendChild(text);
      line.appendChild(link);
      row.appendChild(line);
      box.appendChild(row);
    }
    if (status) box.appendChild(noteElement(status));
    if (box.parentElement !== host) host.prepend(box);
  }

  function bindNativePlotSearch() {
    const input = nativePlotSearchInput();
    if (!input || input.dataset.zrmAliasSearchBound === '1') return;
    input.dataset.zrmAliasSearchBound = '1';
    const update = () => scheduleRefresh();
    input.addEventListener('input', update);
    input.addEventListener('search', update);
    input.addEventListener('change', update);
  }

  function refresh() {
    observer?.disconnect();
    const section = currentSection();
    removeLegacyPanel();

    if (!section) {
      document.getElementById(NATIVE_RESULTS_ID)?.remove();
      document.getElementById(PLOT_NATIVE_RESULTS_ID)?.remove();
      document.getElementById(PLOT_TOOLS_ID)?.remove();
      return;
    }

    injectStyle();
    renderPlotTools();
    const records = renderedItems();

    for (const record of records) {
      applyAlias(record);
      makeRenameButton(record);
    }

    injectRoomContextMenu();
    saveState();

    if (section === 'room') {
      bindNativeRoomSearch();
      renderNativeAliasResults(nativeRoomQuery());
    } else if (section === 'plot-search') {
      bindNativePlotSearch();
      renderNativePlotAliasResults(nativePlotSearchInput()?.value || '');
    }
    observer?.observe(document.documentElement, { childList: true, subtree: true });
  }

  function scheduleRefresh() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      refresh();
    });
  }

  function start() {
    cleanupLegacyState();
    injectStyle();

    window.addEventListener('pagehide', saveStateNow);
    window.addEventListener('beforeunload', saveStateNow);

    document.addEventListener('pointerdown', rememberRoomContextTarget, true);
    document.addEventListener('contextmenu', rememberRoomContextTarget, true);
    document.addEventListener('touchstart', rememberRoomContextTarget, { capture: true, passive: true });

    observer = new MutationObserver(scheduleRefresh);
    refresh();
    ensureBackgroundRoomIndex();

    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        scheduleRefresh();
        const section = currentSection();
        if (section === 'room') ensureBackgroundRoomIndex();
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

