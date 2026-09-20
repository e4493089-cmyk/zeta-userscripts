// ==UserScript==
// @name         Zeta Room Manager (iOS)
// @namespace    zeta-room-manager-ios
// @version      0.3.10
// @description  iOS/Stay용. 별명과 플롯명·캐릭터명·제작자명 검색, API 기반 전체 방 인덱싱을 지원합니다.
// @match        https://zeta-ai.io/*
// @updateURL    https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-room-manager-ios.user.js
// @downloadURL  https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-room-manager-ios.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self) return;

  const STORAGE_KEY = 'zeta-room-manager:v1';
  const STYLE_ID = 'zeta-room-manager-style';
  const PANEL_ID = 'zeta-room-manager-panel';
  const MODAL_ID = 'zeta-room-manager-modal';
  const NATIVE_RESULTS_ID = 'zeta-room-manager-native-results';
  const PLOT_NATIVE_RESULTS_ID = 'zeta-room-manager-plot-native-results';

  const state = loadState();
  let observer = null;
  let swipeGesture = null;
  let rafPending = false;
  let lastRoomContextRecord = null;

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        aliases: parsed.aliases && typeof parsed.aliases === 'object' ? parsed.aliases : {},
        index: parsed.index && typeof parsed.index === 'object' ? parsed.index : {},
        plotMeta: parsed.plotMeta && typeof parsed.plotMeta === 'object' ? parsed.plotMeta : {}
      };
    } catch (_) {
      return { aliases: {}, index: {}, plotMeta: {} };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function keyOf(type, id) {
    return `${type}:${id}`;
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
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
        const charContext = /character|characters|charprofile|persona/.test(context);
        const creatorContext = /creator|author|writer|owner/.test(context);
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

    for (let depth = 0; fiber && depth < 18; depth++, fiber = fiber.return) {
      inspect(fiber.memoizedProps, ['props'], 0);
      inspect(fiber.pendingProps, ['pendingProps'], 0);
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
    const first = normalizeText(plot && plot.firstCharacterName);
    if (first) names.push(first);
    for (const character of Array.isArray(plot && plot.characters) ? plot.characters : []) {
      const name = normalizeText(character && (
        character.name || character.nickname || character.displayName || character.display_name
      ));
      if (name && !names.includes(name)) names.push(name);
    }
    return names.slice(0, 20);
  }

  function plotCreatorNames(plot) {
    const creator = plot && plot.creator;
    if (!creator || typeof creator !== 'object') return [];
    return uniqueTexts([
      creator.name,
      creator.nickname,
      creator.displayName,
      creator.display_name,
      creator.username,
      creator.handle
    ]).slice(0, 10);
  }

  function searchValues(entry) {
    const characters = Array.isArray(entry?.characterNames) ? entry.characterNames : [];
    const creators = Array.isArray(entry?.creatorNames) ? entry.creatorNames : [];
    return [entry?.alias, entry?.original, ...characters, ...creators]
      .map(normalizeText)
      .filter(Boolean);
  }

  function matchesSearch(entry, query) {
    return searchValues(entry).some(value => value.toLocaleLowerCase('ko-KR').includes(query));
  }

  function searchDetail(entry, fallback) {
    const parts = [];
    if (normalizeText(entry?.alias) && normalizeText(entry?.original) && entry.alias !== entry.original) {
      parts.push(entry.original);
    }
    const characterName = (Array.isArray(entry?.characterNames) ? entry.characterNames : [])
      .map(normalizeText).find(Boolean);
    const creatorName = (Array.isArray(entry?.creatorNames) ? entry.creatorNames : [])
      .map(normalizeText).find(Boolean);
    if (characterName) parts.push('캐릭터: ' + characterName);
    if (creatorName) parts.push('제작자: ' + creatorName);
    return parts.join(' · ') || fallback;
  }

  const BACKGROUND_INDEX_STAMP_KEY = 'zeta-room-manager:last-full-index-at:v3';
  const API_BASE = 'https://api.zeta-ai.io';
  const WEB_CLIENT_VERSION = '3.44.7';
  let backgroundIndexPromise = null;
  let apiUnavailableUntil = 0;

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

  async function apiGet(path, params) {
    if (Date.now() < apiUnavailableUntil) return null;
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
        return null;
      }
      if (response.status === 429) {
        apiUnavailableUntil = Date.now() + 30000;
        return null;
      }
      if (!response.ok) return null;
      return await response.json();
    } catch (_) {
      apiUnavailableUntil = Date.now() + 30000;
      return null;
    }
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

  function ingestPlotMeta(plot, plotIdHint) {
    if (!plot || typeof plot !== 'object') return null;
    const plotId = normalizeText(plot.id || plot.plotId || plotIdHint);
    if (!plotId) return null;

    const previous = state.plotMeta[plotId] || {};
    const characters = plotCharacterNames(plot);
    const creators = plotCreatorNames(plot);

    state.plotMeta[plotId] = {
      plotId: plotId,
      originatedId: normalizeText(plot.originatedId || plot.originalId || previous.originatedId),
      name: normalizeText(plot.name || plot.title || previous.name),
      image: normalizeText(plot.imageUrl || plot.initialRoomImageUrl || previous.image),
      characterNames: characters.length ? characters : (previous.characterNames || []),
      creatorNames: creators.length ? creators : (previous.creatorNames || []),
      updatedAt: Date.now()
    };
    return state.plotMeta[plotId];
  }

  function applyPlotMetaToRooms(plotId, meta) {
    if (!plotId || !meta) return;
    for (const entry of Object.values(state.index)) {
      if (!entry || entry.type !== 'room' || entry.plotId !== plotId) continue;
      entry.originatedId = entry.originatedId || meta.originatedId || '';
      entry.characterNames = uniqueTexts(entry.characterNames, meta.characterNames);
      entry.creatorNames = uniqueTexts(entry.creatorNames, meta.creatorNames);
      if (!entry.image && meta.image) entry.image = meta.image;
    }
  }

  function ingestApiRoom(room) {
    if (!room || typeof room !== 'object') return null;
    const roomId = normalizeText(room.id || room.roomId);
    if (!roomId) return null;

    const plot = room.plot && typeof room.plot === 'object' ? room.plot : {};
    const plotId = normalizeText(room.plotId || plot.id || plot.plotId);
    const meta = ingestPlotMeta(plot, plotId) || (plotId ? state.plotMeta[plotId] : null);
    const key = keyOf('room', roomId);
    const previous = state.index[key] || {};

    state.index[key] = {
      ...previous,
      type: 'room',
      id: roomId,
      href: previous.href || '/' + localePrefix() + '/rooms/' + roomId,
      original: normalizeText(plot.name || plot.title || previous.original),
      alias: normalizeText(state.aliases[key]),
      image: normalizeText(plot.imageUrl || plot.initialRoomImageUrl || previous.image),
      plotId: plotId || previous.plotId || '',
      originatedId: normalizeText(plot.originatedId || plot.originalId || previous.originatedId),
      characterNames: uniqueTexts(previous.characterNames, meta && meta.characterNames),
      creatorNames: uniqueTexts(previous.creatorNames, meta && meta.creatorNames)
    };

    if (plotId && meta) applyPlotMetaToRooms(plotId, meta);
    return state.index[key];
  }

  async function fetchAllRoomsFromApi() {
    let cursor = '';
    const seen = new Set();
    let gotAny = false;

    for (let page = 0; page < 250; page++) {
      const payload = await apiGet('/v2/rooms', { limit: 100, cursor: cursor || undefined });
      if (!payload) return gotAny;

      const body = unwrapApi(payload);
      const rooms = Array.isArray(body && body.rooms)
        ? body.rooms
        : (Array.isArray(payload.rooms) ? payload.rooms : []);

      for (const room of rooms) ingestApiRoom(room);
      if (rooms.length) gotAny = true;

      saveState();
      scheduleRefresh();

      const next = normalizeText(
        (body && (body.nextCursor || body.next_cursor)) ||
        payload.nextCursor ||
        payload.next_cursor
      );
      if (!next || seen.has(next)) break;
      seen.add(next);
      cursor = next;
    }
    return gotAny;
  }

  async function enrichMissingPlotMeta() {
    const ids = [];
    const now = Date.now();

    for (const entry of Object.values(state.index)) {
      if (!entry || entry.type !== 'room') continue;
      const plotId = normalizeText(entry.plotId);
      if (!plotId || ids.includes(plotId)) continue;

      const cached = state.plotMeta[plotId];
      const hasCharacters = Array.isArray(cached && cached.characterNames) && cached.characterNames.length > 0;
      const hasCreators = Array.isArray(cached && cached.creatorNames) && cached.creatorNames.length > 0;
      const fresh = Number((cached && cached.updatedAt) || 0) > now - 7 * 24 * 60 * 60 * 1000;

      if (fresh && hasCharacters && hasCreators) applyPlotMetaToRooms(plotId, cached);
      else ids.push(plotId);
    }

    let nextIndex = 0;
    let stop = false;

    const worker = async () => {
      while (!stop) {
        const index = nextIndex++;
        if (index >= ids.length) return;

        const plotId = ids[index];
        const payload = await apiGet('/v1/plots/' + encodeURIComponent(plotId));
        if (!payload) {
          if (Date.now() < apiUnavailableUntil) stop = true;
          continue;
        }

        const plot = unwrapApi(payload);
        const meta = ingestPlotMeta(plot, plotId);
        if (meta) applyPlotMetaToRooms(plotId, meta);

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

  async function buildFullRoomIndexInBackground(force) {
    if (currentSection() !== 'room') return false;

    // 화면 스크롤은 절대 건드리지 않는다.
    harvestRoomDocument(document);

    const last = Number(localStorage.getItem(BACKGROUND_INDEX_STAMP_KEY) || 0);
    if (!force && Date.now() - last < 5 * 60 * 1000) return true;

    const gotRooms = await fetchAllRoomsFromApi();
    if (!gotRooms) {
      saveState();
      scheduleRefresh();
      return false;
    }

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

      /* 제타 기본 모션으로 열린 뒤 스크롤 재렌더링에도 168px 상태를 유지한다. */
      .zrm-room-item > a[href*="/rooms/"] { padding-right: 16px !important; }
      .zrm-room-item.zrm-swipe-open {
        transform: translateX(-168px) !important;
      }
      .zrm-room-actions > button {
        width: 56px !important;
        min-width: 56px !important;
        gap: 6px !important;
      }
      .zrm-room-actions > button > span {
        font-size: 10px !important;
        white-space: nowrap;
      }
      .zrm-room-rename {
        display: flex !important;
        width: 56px !important;
        min-width: 56px !important;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        border: 0;
        background: #6957d9;
        color: #fff;
      }
      .zrm-room-rename svg { width: 16px; height: 16px; flex: 0 0 auto; }
      .zrm-room-rename span { font-size: 10px; white-space: nowrap; }
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
      || stableLocalId(original + '\n' + image.split('?')[0]);
    if (!id) return null;

    const key = keyOf(type, id);
    const alias = normalizeText(state.aliases[key]);
    const previous = state.index[key] || {};
    const searchMeta = collectSearchMeta(item, titleEl);
    const roomPlot = type === 'room' ? reactRoomPlotMeta(item) : null;
    const roomPlotId = normalizeText((roomPlot && (roomPlot.id || roomPlot.plotId)) || previous.plotId);
    const roomMeta = roomPlot
      ? ingestPlotMeta(roomPlot, roomPlotId)
      : (roomPlotId ? state.plotMeta[roomPlotId] : null);

    state.index[key] = {
      ...previous,
      type: type,
      id: id,
      href: (link && link.href) || previous.href
        || (type === 'plot' && !id.startsWith('local-') ? '/ko/plots/' + id + '/edit' : ''),
      original: original,
      alias: alias,
      image: image || previous.image || '',
      plotId: type === 'room' ? (roomPlotId || previous.plotId || '') : (previous.plotId || ''),
      originatedId: type === 'room'
        ? normalizeText((roomPlot && (roomPlot.originatedId || roomPlot.originalId)) || previous.originatedId)
        : (previous.originatedId || ''),
      characterNames: uniqueTexts(searchMeta.characterNames, roomMeta && roomMeta.characterNames, previous.characterNames),
      creatorNames: uniqueTexts(searchMeta.creatorNames, roomMeta && roomMeta.creatorNames, previous.creatorNames)
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
    state.index[record.key] = {
      ...indexed,
      type: record.type,
      id: record.id,
      href: record.link?.href || indexed.href || '',
      original: record.original,
      alias,
      image: (record.link || record.item).querySelector('img')?.src || indexed.image || ''
    };
  }

  function makeRenameButton(record) {
    if (record.type === 'room') {
      record.item.classList.add('zrm-room-item');
      const actions = record.item.querySelector(
        '[data-sentry-element="RoomListItemRightActions"], ' +
        '[data-sentry-source-file="SwipeableRoomListItem.tsx"].absolute.translate-x-full'
      );
      if (!actions) return;
      actions.classList.add('zrm-room-actions');
      if (actions.querySelector('.zrm-room-rename')) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'zrm-room-rename';
      btn.setAttribute('aria-label', `${record.original} 별명 편집`);
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M21.675 7.905c.433-.433.433-1.155 0-1.566l-4.014-4.014c-.41-.433-1.133-.433-1.566 0L14.05 4.358l5.58 5.58M2.293 16.127a1 1 0 0 0-.293.707V21a1 1 0 0 0 1 1h4.166a1 1 0 0 0 .707-.293l10.58-10.591-5.58-5.58z"/>
        </svg>
        <span>별명</span>
      `;
      btn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openRenameModal(snapshotRecord(record));
      }, true);
      actions.prepend(btn);
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

  function nativeRoomSearchInput() {
    return document.querySelector('input[name="room-list-search-input"]');
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

  function nativeRoomListHost() {
    const roomList = document.querySelector('[data-sentry-component="RoomList"]');
    if (!roomList) return null;
    const input = nativeRoomSearchInput();
    return input?.closest('.flex.flex-col.grow')
      || roomList.querySelector('[data-sentry-component="WrappedDiv"][data-sentry-source-file="index.tsx"]')
      || roomList.querySelector('.overflow-y-auto')
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
    const matches = Object.values(state.index)
      .filter(entry => entry?.type === 'room' && entry.href)
      .filter(entry => matchesSearch(entry, q))
      .filter(entry => !nativeIds.has(entry.id))
      .slice(0, 20);

    if (!matches.length) {
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
      title.textContent = entry.alias || entry.original;
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
    return document.querySelector('input[type="search"], input[placeholder*="검색"], input');
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
      .slice(0, 20);

    if (!matches.length) {
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
      title.textContent = entry.alias || entry.original;
      const original = document.createElement('div');
      original.className = 'caption1 text-white/50';
      original.textContent = searchDetail(entry, '검색으로 찾은 플롯');
      text.append(title, original);
      link.appendChild(text);
      line.appendChild(link);
      row.appendChild(line);
      box.appendChild(row);
    }
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
      return;
    }

    injectStyle();
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

  function swipeX(item) {
    const match = (item?.style?.transform || '').match(/translateX\((-?[\d.]+)px\)/);
    return match ? Number(match[1]) : 0;
  }

  function bindSwipeOpenLock() {
    document.addEventListener('touchstart', event => {
      const touch = event.touches?.[0];
      const item = event.target?.closest?.('[data-sentry-component="SwipeableRoomListItem"]');
      if (!touch || !item) {
        swipeGesture = null;
        return;
      }
      swipeGesture = { item, x: touch.clientX, y: touch.clientY, horizontal: false };
    }, { capture: true, passive: true });

    document.addEventListener('touchmove', event => {
      if (!swipeGesture) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const dx = touch.clientX - swipeGesture.x;
      const dy = touch.clientY - swipeGesture.y;
      if (!swipeGesture.horizontal && Math.abs(dx) > Math.abs(dy) + 6) {
        swipeGesture.horizontal = true;
        swipeGesture.item.classList.remove('zrm-swipe-open');
      }
    }, { capture: true, passive: true });

    document.addEventListener('touchend', event => {
      const gesture = swipeGesture;
      swipeGesture = null;
      if (!gesture) return;

      const touch = event.changedTouches?.[0];
      const dx = touch ? touch.clientX - gesture.x : 0;
      const dy = touch ? touch.clientY - gesture.y : 0;
      const horizontal = gesture.horizontal || Math.abs(dx) > Math.abs(dy) + 6;
      if (!horizontal) return;

      // 오른쪽으로 닫는 동작이면 즉시 해제한다.
      if (dx > 0) {
        gesture.item.classList.remove('zrm-swipe-open');
        return;
      }

      // 제타의 스프링 종료 시간이 기기마다 달라 여러 시점에서 열린 상태를 확인한다.
      const lockIfOpen = () => {
        if (swipeX(gesture.item) <= -90) gesture.item.classList.add('zrm-swipe-open');
      };
      lockIfOpen();
      setTimeout(lockIfOpen, 160);
      setTimeout(lockIfOpen, 320);
      setTimeout(lockIfOpen, 520);
    }, { capture: true, passive: true });
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
    injectStyle();

    document.addEventListener('pointerdown', rememberRoomContextTarget, true);
    document.addEventListener('contextmenu', rememberRoomContextTarget, true);
    document.addEventListener('touchstart', rememberRoomContextTarget, { capture: true, passive: true });

    observer = new MutationObserver(scheduleRefresh);
    bindSwipeOpenLock();
    refresh();
    ensureBackgroundRoomIndex();

    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        scheduleRefresh();
        if (currentSection() === 'room') ensureBackgroundRoomIndex();
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

