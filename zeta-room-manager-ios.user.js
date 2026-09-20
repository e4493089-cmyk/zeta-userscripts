// ==UserScript==
// @name         Zeta Room Manager (iOS)
// @namespace    zeta-room-manager-ios
// @version      0.10.0
// @description  iOS/Stay용. 별명과 플롯명·캐릭터명·제작자명 검색, 화면/네이티브 로드 데이터 기반 수동 전체 수집.
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
  const STATE_VERSION = 2;
  const BACKGROUND_INDEX_STAMP_KEY = 'zeta-room-manager:last-full-index-at:v3';
  const STYLE_ID = 'zeta-room-manager-style';
  const PANEL_ID = 'zeta-room-manager-panel';
  const MODAL_ID = 'zeta-room-manager-modal';
  const NATIVE_RESULTS_ID = 'zeta-room-manager-native-results';
  const PLOT_NATIVE_RESULTS_ID = 'zeta-room-manager-plot-native-results';
  const PLOT_TOOLS_ID = 'zeta-room-manager-plot-tools';
  const COLLECTION_BANNER_ID = 'zeta-room-manager-collection-banner';
  const COLLECTION_MODAL_ID = 'zeta-room-manager-collection-modal';
  const PLOT_COLLECTION_STAMP_KEY = 'zeta-room-manager:plot-collection-at:v1';
  const ROOM_COLLECTION_STAMP_KEY = 'zeta-room-manager:room-collection-at:v1';

  const state = loadState();
  let observer = null;
  let swipeGesture = null;
  let rafPending = false;
  let lastRoomContextRecord = null;
  let plotCollectionPromise = null;
  let plotCollectionProgress = { running: false, count: 0 };
  let roomCollectionPromise = null;
  let roomCollectionProgress = { running: false, count: 0 };

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
    localStorage.removeItem(ROOM_COLLECTION_STAMP_KEY);
    localStorage.removeItem(CLEANUP_STAMP_KEY);
    saveStateNow();
    return '인덱스를 비웠습니다. 별명은 그대로입니다. 대화방/플롯 목록에서 전체 수집을 다시 실행해 주세요.';
  };

  const NO_API_CLEANUP_STAMP_KEY = 'zeta-room-manager:no-api-cleanup:v1';
  function cleanupOldApiFlags() {
    if (localStorage.getItem(NO_API_CLEANUP_STAMP_KEY)) return;
    for (const entry of Object.values(state.index || {})) {
      if (!entry || typeof entry !== 'object') continue;
      delete entry.missingSince;
      delete entry.plotMissing;
    }
    for (const meta of Object.values(state.plotMeta || {})) {
      if (!meta || typeof meta !== 'object') continue;
      delete meta.failedAt;
      delete meta.failCount;
      delete meta.missing;
      delete meta.missingAt;
      delete meta.emptyDetail;
      delete meta.detailFetchedAt;
    }
    localStorage.setItem(NO_API_CLEANUP_STAMP_KEY, String(Date.now()));
    saveStateNow();
  }

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
    push(plot && plot.draft && plot.draft.characters);
    push(plot && plot.draft && plot.draft.characterProfiles);
    push(plot && plot.draft && plot.draft.chatProfiles);
    push(plot && plot.draft && plot.draft.about && plot.draft.about.characters);

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

  function looksLikePlotData(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const id = normalizeText(value.id || value.plotId);
    if (!id) return false;
    return Boolean(
      value.originatedId || value.originalId ||
      value.creator || value.author || value.writer || value.creatorUser ||
      value.creatorName || value.creatorNickname || value.authorName || value.writerName ||
      Array.isArray(value.characters) || Array.isArray(value.characterProfiles) ||
      Array.isArray(value.chatProfiles) || Array.isArray(value.plotCharacters) ||
      value.draft || value.about ||
      value.initialRoomImageUrl || value.shortDescription || value.longDescription ||
      value.mode || value.status
    );
  }

  function mergeMetaIntoIndex(meta) {
    if (!meta) return;
    const ids = new Set([
      normalizeText(meta.canonicalId),
      normalizeText(meta.plotId),
      normalizeText(meta.sourcePlotId),
      normalizeText(meta.originatedId)
    ].filter(Boolean));
    const metaName = normalizeText(meta.name).toLocaleLowerCase('ko-KR');
    const metaImage = imageKeyOf(meta.image);

    for (const entry of Object.values(state.index || {})) {
      if (!entry || typeof entry !== 'object') continue;
      const entryIds = [
        normalizeText(entry.type === 'plot' ? entry.id : ''),
        normalizeText(entry.plotId),
        normalizeText(entry.originatedId)
      ].filter(Boolean);
      const linkedById = entryIds.some(id => ids.has(id));
      const linkedByName = !linkedById
        && metaName
        && normalizeText(entry.original).toLocaleLowerCase('ko-KR') === metaName;
      const linkedByImage = !linkedById && !linkedByName
        && metaImage
        && imageKeyOf(entry.image) === metaImage;
      if (!linkedById && !linkedByName && !linkedByImage) continue;

      entry.characterNames = uniqueTexts(entry.characterNames, meta.characterNames);
      entry.creatorNames = uniqueTexts(entry.creatorNames, meta.creatorNames);
    }
  }

  function harvestPlotDataTree(root, options = {}) {
    if (!root || typeof root !== 'object') return 0;
    const seen = new WeakSet();
    const stack = [{ value: root, depth: 0 }];
    const maxDepth = Number(options.maxDepth || 9);
    const maxNodes = Number(options.maxNodes || 5000);
    let nodes = 0;
    let harvested = 0;

    while (stack.length && nodes < maxNodes) {
      const current = stack.pop();
      const value = current.value;
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      nodes++;

      if (looksLikePlotData(value)) {
        const meta = ingestPlotMeta(value, value.id || value.plotId, value.originatedId || value.originalId);
        if (meta) {
          mergeMetaIntoIndex(meta);
          harvested++;
        }
      }

      if (current.depth >= maxDepth) continue;
      if (Array.isArray(value)) {
        for (let i = Math.min(value.length, 120) - 1; i >= 0; i--) {
          const child = value[i];
          if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
        }
        continue;
      }

      for (const [key, child] of Object.entries(value)) {
        if (['children', 'ref', '_owner', 'return', 'stateNode'].includes(key)) continue;
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
      }
    }

    if (harvested) saveState();
    return harvested;
  }

  function harvestReactPlotData(item) {
    const fiberKey = Object.keys(item || {}).find(key => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? item[fiberKey] : null;
    if (!fiber) return 0;

    let harvested = 0;
    for (let depth = 0; fiber && depth < 10; depth++, fiber = fiber.return) {
      for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
        if (!props || typeof props !== 'object') continue;
        harvested += harvestPlotDataTree(props, { maxDepth: 7, maxNodes: 1800 });
      }
      if (harvested > 6) break;
    }
    return harvested;
  }

  function shouldInspectNativeResponse(url) {
    const text = String(url || '');
    return /(?:api\.zeta-ai\.io|zeta-ai\.io).*\/(?:v1\/plots|v2\/rooms)(?:[/?#]|$)/i.test(text);
  }

  function inspectNativeResponsePayload(payload) {
    const count = harvestPlotDataTree(payload, { maxDepth: 10, maxNodes: 12000 });
    if (count) saveState();
  }

  function installPassiveNativeDataCapture() {
    if (window.__zrmPassiveNativeCaptureInstalled) return;
    window.__zrmPassiveNativeCaptureInstalled = true;

    // 새 요청은 만들지 않는다. 제타 페이지가 원래 보내는 fetch/XHR 응답만 복사해 읽는다.
    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      window.fetch = async function () {
        const response = await originalFetch.apply(this, arguments);
        try {
          const first = arguments[0];
          const url = typeof first === 'string' ? first : first && first.url;
          if (shouldInspectNativeResponse(url)) {
            const clone = response.clone();
            clone.json().then(inspectNativeResponsePayload).catch(() => {});
          }
        } catch (_) {}
        return response;
      };
    }

    const xhrOpen = XMLHttpRequest.prototype.open;
    const xhrSend = XMLHttpRequest.prototype.send;
    const xhrUrl = new WeakMap();

    XMLHttpRequest.prototype.open = function (method, url) {
      try { xhrUrl.set(this, String(url || '')); } catch (_) {}
      return xhrOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      const xhr = this;
      const url = xhrUrl.get(xhr) || '';
      if (shouldInspectNativeResponse(url)) {
        xhr.addEventListener('load', () => {
          try {
            if (xhr.responseType === 'json' && xhr.response) {
              inspectNativeResponsePayload(xhr.response);
              return;
            }
            if (!xhr.responseType || xhr.responseType === 'text') {
              const body = xhr.responseText;
              if (body && /^[\s]*[\[{]/.test(body)) inspectNativeResponsePayload(JSON.parse(body));
            }
          } catch (_) {}
        }, { once: true });
      }
      return xhrSend.apply(this, arguments);
    };
  }

  function metadataCoverage(type) {
    let total = 0;
    let character = 0;
    let creator = 0;
    for (const entry of Object.values(state.index || {})) {
      if (!entry || entry.type !== type) continue;
      total++;
      const meta = plotMetaForEntry(entry);
      if (uniqueTexts(entry.characterNames, meta && meta.characterNames).length) character++;
      if (uniqueTexts(entry.creatorNames, meta && meta.creatorNames).length) creator++;
    }
    return { total, character, creator };
  }

  function canonicalPlotId(plotId, originatedId) {
    // 내 계정에 있는 실제 플롯(plot.id)을 우선한다.
    // originatedId는 원본이며, 원본이 삭제된 경우 조회가 영구 실패한다.
    return normalizeText(plotId) || normalizeText(originatedId);
  }

  // 방 목록 데이터에는 플롯 ID가 없는 경우가 많다. 그러면 내 플롯에서 모은
  // 캐릭터·제작자명이 방으로 흘러가지 못한다. ID가 없을 때는 이름으로 잇는다.
  // 같은 이름의 플롯이 둘 이상이면 어느 쪽인지 알 수 없으므로 잇지 않는다.
  // 썸네일 주소는 플롯마다 고유한 UUID 경로다.
  //   https://image.zeta-ai.io/plot-cover-image/<uuid>/<uuid>.png?w=96&q=75&f=webp
  // 표시 크기에 따라 쿼리만 달라지므로 경로만 비교하면 같은 플롯인지 알 수 있다.
  function imageKeyOf(value) {
    const text = normalizeText(value).split('?')[0];
    if (!text) return '';
    const match = text.match(/^https?:\/\/[^/]+\/(.+)$/);
    const path = match ? match[1] : text;
    return path.length < 8 ? '' : path.toLocaleLowerCase('ko-KR');
  }

  let plotLookup = null;
  let plotLookupDirty = true;

  function plotLookupTables() {
    if (plotLookup && !plotLookupDirty) return plotLookup;

    const byName = new Map();
    const byImage = new Map();
    const add = (map, key, meta) => {
      if (!key) return;
      if (map.has(key) && map.get(key) !== meta) map.set(key, 'ambiguous');
      else map.set(key, meta);
    };

    for (const meta of Object.values(state.plotMeta || {})) {
      if (!meta) continue;
      add(byName, normalizeText(meta.name).toLocaleLowerCase('ko-KR'), meta);
      add(byImage, imageKeyOf(meta.image), meta);
    }

    plotLookup = { byName, byImage };
    plotLookupDirty = false;
    return plotLookup;
  }

  function plotMetaByName(name) {
    const wanted = normalizeText(name).toLocaleLowerCase('ko-KR');
    if (!wanted) return null;
    const hit = plotLookupTables().byName.get(wanted);
    return hit && hit !== 'ambiguous' ? hit : null;
  }

  // 방 제목을 바꿨거나 플롯명과 달라도, 썸네일이 같으면 같은 플롯이다.
  function plotMetaByImage(image) {
    const wanted = imageKeyOf(image);
    if (!wanted) return null;
    const hit = plotLookupTables().byImage.get(wanted);
    return hit && hit !== 'ambiguous' ? hit : null;
  }

  function plotMetaForEntry(entry) {
    if (!entry) return null;
    const canonical = canonicalPlotId(entry.plotId, entry.originatedId);
    return (canonical && state.plotMeta[canonical])
      || (entry.plotId && state.plotMeta[entry.plotId])
      || (entry.originatedId && state.plotMeta[entry.originatedId])
      || plotMetaByName(entry.original)
      || plotMetaByImage(entry.image)
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

  // 전체 검색 범위는 사용자가 한 번 수동 수집한 로컬 인덱스 기준이다.
  function indexStatusText() {
    if (roomCollectionProgress.running) {
      return '대화방 전체 수집 중 · 현재 ' + roomCollectionProgress.count + '개 저장됨';
    }
    if (!Number(localStorage.getItem(ROOM_COLLECTION_STAMP_KEY) || 0)) {
      return '전체 대화방 검색은 먼저 Room Manager의 ‘전체 수집’을 한 번 실행해 주세요.';
    }
    return '';
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
      if (!record) continue;
      applyAlias(record);
      harvested++;
    }
    if (harvested) saveState();
    return harvested;
  }

  function ingestPlotMeta(plot, plotIdHint, originatedIdHint) {
    if (!plot || typeof plot !== 'object') return null;

    const plotId = normalizeText(plot.id || plot.plotId || plotIdHint);
    const originatedId = normalizeText(plot.originatedId || plot.originalId || originatedIdHint);
    const canonicalId = canonicalPlotId(plotIdHint || plotId, originatedId);
    if (!canonicalId) return null;

    const previous = state.plotMeta[canonicalId]
      || (plotId && state.plotMeta[plotId])
      || {};
    const characters = plotCharacterNames(plot);
    const creators = plotCreatorNames(plot);

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

    delete next.failedAt;
    delete next.missing;
    delete next.missingAt;
    delete next.emptyDetail;

    state.plotMeta[canonicalId] = next;
    plotLookupDirty = true;
    if (plotId && plotId !== canonicalId && state.plotMeta[plotId]) delete state.plotMeta[plotId];
    return next;
  }

  // ── 대화방 수동 전체 수집 ───────────────────────────────────────────
  // API를 직접 호출하지 않고, 사용자가 버튼을 눌렀을 때 실제 방 목록을 끝까지
  // 스크롤하면서 제타가 화면에 렌더링한 방만 로컬 인덱스에 누적 저장한다.

  function roomCollectionCount() {
    return Object.values(state.index).filter(entry => entry && entry.type === 'room' && entry.id).length;
  }

  function roomCollectionScrollHost() {
    const first = roomItemsFromDocument(document)[0];
    let node = first && first.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 20) return node;
      node = node.parentElement;
    }

    const roomList = document.querySelector('[data-sentry-component="RoomList"]');
    if (roomList) {
      const candidates = Array.from(roomList.querySelectorAll('*')).filter(el => {
        const style = getComputedStyle(el);
        return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 20;
      });
      candidates.sort((x, y) => y.scrollHeight - x.scrollHeight);
      if (candidates[0]) return candidates[0];
    }
    return document.scrollingElement || document.documentElement;
  }


  // ── 빈 플롯만 숨긴 화면으로 열어 이름 채우기 ─────────────────────────
  // 방 목록 데이터에는 characters가 빈 배열이고 creator 키가 아예 없다.
  // 방 화면 → 플롯 프로필에는 있으므로, 아직 모르는 플롯만 숨긴 iframe으로
  // 열어서 읽는다. 요청을 직접 만들지 않고 제타 화면이 부르는 대로 둔다.
  const PROFILE_BUTTON = 'button[data-testid="chat-header-profile"][aria-label="Open plot profile"]';
  const PROFILE_PATH = /^\/(?:[^/]+\/)?plots\/[a-f\d-]{36}\/profile\/?$/i;
  const ROOM_UUID = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
  let collectionAborted = false;

  // 현재 주소의 언어 구간(/ko/...)을 그대로 쓴다.
  function localeSegment() {
    const first = location.pathname.split('/').filter(Boolean)[0] || 'ko';
    return /^[a-z]{2}(?:-[a-z]{2})?$/i.test(first) ? first : 'ko';
  }

  function abortCollection() {
    collectionAborted = true;
  }

  // 같은 플롯을 쓰는 방이 여럿이면 한 번만 연다.
  // 이미 이름을 아는 플롯(항목이든 plotMeta든)은 건너뛴다.
  function profileCollectionTargets() {
    const handledPlots = new Set();
    const targets = [];

    for (const entry of Object.values(state.index || {})) {
      if (!entry || entry.type !== 'room' || !ROOM_UUID.test(entry.id || '')) continue;

      const meta = plotMetaForEntry(entry);
      const characters = uniqueTexts(entry.characterNames, meta && meta.characterNames);
      const creators = uniqueTexts(entry.creatorNames, meta && meta.creatorNames);
      if (characters.length && creators.length) continue;

      const keys = [normalizeText(entry.plotId), normalizeText(entry.originatedId)].filter(Boolean);
      if (keys.length) {
        if (keys.some(key => handledPlots.has(key))) continue;
        for (const key of keys) handledPlots.add(key);
      }

      targets.push({
        roomId: entry.id,
        plotId: normalizeText(entry.plotId),
        originatedId: normalizeText(entry.originatedId)
      });
    }
    return targets;
  }

  async function readInFrame(frame, read, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (collectionAborted) throw new Error('중지됨');
      try {
        const win = frame.contentWindow;
        if (win && win.document) {
          const value = read(win);
          if (value) return value;
        }
      } catch (error) {
        if (error && error.name === 'SecurityError') throw new Error('숨김 화면 접근이 막혔습니다');
        throw error;
      }
      await sleep(250);
    }
    throw new Error('시간 초과');
  }

  function readPlotProfile(win) {
    const root = win.document.querySelector('[data-sentry-component="PlotProfile"]');
    if (!root) return null;

    const creators = uniqueTexts(
      Array.from(root.querySelectorAll('a[href*="/creators/"][href*="/profile"]'))
        .map(a => a.querySelector('span.caption1:not([data-sentry-element="Span"])')?.textContent)
    );
    if (!creators.length) return null;

    const characters = uniqueTexts(
      Array.from(root.querySelectorAll('img[alt^="Profile image of "]'))
        .map(img => normalizeText(img.getAttribute('alt')).slice('Profile image of '.length))
    );
    return { creators, characters, profileId: win.location.pathname.split('/')[3] || '' };
  }

  function hiddenFrame() {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:390px;height:850px;opacity:0;pointer-events:none;border:0';
    document.body.appendChild(frame);
    return frame;
  }

  function dropFrame(frame) {
    if (frame && frame.isConnected) {
      frame.src = 'about:blank';
      frame.remove();
    }
  }

  // 플롯 ID를 알면 프로필 주소로 바로 간다(페이지 1번).
  async function visitPlotProfile(plotId) {
    const frame = hiddenFrame();
    frame.src = '/' + localeSegment() + '/plots/' + plotId + '/profile';
    try {
      return await readInFrame(frame, win => {
        if (!PROFILE_PATH.test(win.location.pathname)) return null;
        return readPlotProfile(win);
      }, 12000);
    } finally {
      dropFrame(frame);
    }
  }

  // 프로필 주소를 모르거나 열리지 않으면 방을 거쳐 간다(페이지 2번).
  async function visitRoomProfile(roomId) {
    const frame = hiddenFrame();
    frame.src = '/' + localeSegment() + '/rooms/' + roomId;

    try {
      const button = await readInFrame(frame, win => {
        if (!win.location.pathname.includes(roomId)) return null;
        return win.document.querySelector(PROFILE_BUTTON);
      }, 18000);
      button.click();

      return await readInFrame(frame, win => {
        if (!PROFILE_PATH.test(win.location.pathname)) return null;
        return readPlotProfile(win);
      }, 18000);
    } finally {
      dropFrame(frame);
    }
  }

  // 가능하면 프로필로 바로, 안 되면 방을 거쳐서.
  async function collectOneProfile(target) {
    if (target.plotId) {
      try {
        return await visitPlotProfile(target.plotId);
      } catch (_) {}
    }
    if (target.originatedId && target.originatedId !== target.plotId) {
      try {
        return await visitPlotProfile(target.originatedId);
      } catch (_) {}
    }
    return await visitRoomProfile(target.roomId);
  }

  function applyProfileResult(target, result) {
    const canonicalId = target.plotId || normalizeText(result.profileId) || target.originatedId;
    if (!canonicalId) return;

    const previous = state.plotMeta[canonicalId] || {};
    const meta = {
      ...previous,
      canonicalId,
      plotId: target.plotId || previous.plotId || '',
      originatedId: target.originatedId || previous.originatedId || '',
      characterNames: uniqueTexts(previous.characterNames, result.characters),
      creatorNames: uniqueTexts(previous.creatorNames, result.creators),
      updatedAt: Date.now()
    };

    state.plotMeta[canonicalId] = meta;
    plotLookupDirty = true;
    mergeMetaIntoIndex(meta);
  }

  async function collectProfilesForEmptyPlots() {
    const targets = profileCollectionTargets();
    let done = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      if (collectionAborted || currentSection() !== 'room') break;

      roomCollectionProgress = {
        running: true,
        count: roomCollectionCount(),
        phase: '이름 수집 ' + (i + 1) + '/' + targets.length
      };
      renderCollectionTools();

      try {
        applyProfileResult(targets[i], await collectOneProfile(targets[i]));
        done++;
      } catch (_) {
        failed++;
      }

      if ((done + failed) % 5 === 0) saveStateNow();
      await sleep(150);
    }

    saveStateNow();
    scheduleRefresh();
    return { targets: targets.length, done, failed };
  }

  async function collectAllRoomsByScrolling() {
    if (currentSection() !== 'room') {
      alert('대화방 목록에서 실행해 주세요.');
      return false;
    }
    if (roomCollectionPromise) return roomCollectionPromise;

    roomCollectionPromise = (async () => {
      collectionAborted = false;
      roomCollectionProgress = { running: true, count: roomCollectionCount(), phase: '목록 수집' };
      renderCollectionTools();

      const host = roomCollectionScrollHost();
      const originalTop = scrollMetrics(host).top;
      let lastHeight = 0;
      let lastCount = roomCollectionCount();
      let stableRounds = 0;

      setScrollTop(host, 0);
      await sleep(450);
      harvestRoomDocument(document);

      for (let round = 0; round < 1600; round++) {
        harvestRoomDocument(document);
        const before = scrollMetrics(host);
        const count = roomCollectionCount();
        roomCollectionProgress.count = count;
        renderCollectionTools();

        const nearBottom = before.top + before.client >= before.height - Math.max(80, before.client * 0.15);
        if (nearBottom) {
          setScrollTop(host, before.height);
          await sleep(700);
          harvestRoomDocument(document);

          const after = scrollMetrics(host);
          const afterCount = roomCollectionCount();
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
        const nowCount = roomCollectionCount();
        if (now.height === lastHeight && nowCount === lastCount && nearBottom) stableRounds++;
        lastHeight = now.height;
        lastCount = nowCount;
      }

      harvestRoomDocument(document);
      saveStateNow();
      localStorage.setItem(ROOM_COLLECTION_STAMP_KEY, String(Date.now()));
      setScrollTop(host, originalTop);
      await sleep(100);

      const profiles = await collectProfilesForEmptyPlots();

      const total = roomCollectionCount();
      roomCollectionProgress = { running: false, count: total };
      renderCollectionTools();
      const coverage = metadataCoverage('room');
      const aliases = Object.values(state.index).filter(entry =>
        entry && entry.type === 'room' && normalizeText(entry.alias)
      ).length;
      alert(
        (collectionAborted ? '대화방 수집 중지됨' : '대화방 전체 수집 완료') + ' · 저장된 방 ' + total + '개' +
        '\n별명 ' + aliases + '개 · 캐릭터명 ' + coverage.character + '개 · 제작자명 ' + coverage.creator + '개' +
        '\n이름 수집: 플롯 ' + profiles.targets + '개 중 ' + profiles.done + '개 성공' +
        (profiles.failed ? ' · ' + profiles.failed + '개 실패' : '')
      );
      return true;
    })().finally(() => {
      roomCollectionPromise = null;
      roomCollectionProgress.running = false;
      renderCollectionTools();
    });

    return roomCollectionPromise;
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
      renderCollectionTools();

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
        renderCollectionTools();

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
      renderCollectionTools();
      const coverage = metadataCoverage('plot');
      const aliases = Object.values(state.index).filter(entry =>
        entry && entry.type === 'plot' && normalizeText(entry.alias)
      ).length;
      alert(
        '전체 수집 완료 · 저장된 플롯 ' + total + '개' +
        '\n별명 ' + aliases + '개 · 캐릭터명 ' + coverage.character + '개 · 제작자명 ' + coverage.creator + '개'
      );
      return true;
    })().finally(() => {
      plotCollectionPromise = null;
      plotCollectionProgress.running = false;
      renderCollectionTools();
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

        // 예전/부분 백업에서 aliases 맵이 빠졌더라도 index.alias가 있으면 복구한다.
        for (const [key, entry] of Object.entries(state.index)) {
          const alias = normalizeText(entry && entry.alias);
          if (alias && !normalizeText(state.aliases[key])) state.aliases[key] = alias;
        }
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

  // 다른 유저스크립트가 띄운 떠 있는 버튼(진단 런처 등)을 제타 헤더의
  // 버튼으로 착각하면, 그 버튼의 부모 안에 룸매니저 ⋯ 이 들어가 버린다.
  function foreignScriptUi(el) {
    return Boolean(el && el.closest && el.closest(
      '[id^="zrm-"], [id^="zeta-rm"], [id^="zeta-room-manager"], [id^="zeta-diag"], [id^="tm-"]'
    ));
  }

  function visibleControl(el) {
    if (foreignScriptUi(el)) return false;
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 18 || rect.height < 18) return false;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function roomSearchControl() {
    if (currentSection() !== 'room') return null;

    const controls = Array.from(document.querySelectorAll('button, a, [role="button"]'))
      .filter(visibleControl)
      .filter(el => !el.closest('#' + PLOT_TOOLS_ID));

    const labeled = controls.find(el => {
      const hint = [
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('data-testid'),
        el.getAttribute('testid'),
        el.textContent
      ].map(value => normalizeText(value)).join(' ');
      return /검색|search/i.test(hint);
    });
    if (labeled) return labeled;

    // 라벨이 없는 아이콘 버튼인 경우: '대화' 제목과 같은 상단 행의 우측 버튼 중
    // 첫 번째를 검색 버튼으로 본다. 현재 제타 헤더에서 검색이 가장 왼쪽 액션이다.
    const title = Array.from(document.querySelectorAll('h1,h2,h3,div,span'))
      .find(el => el.children.length <= 2 && normalizeText(el.textContent) === '대화' && visibleControl(el));
    if (!title) return null;

    const titleRect = title.getBoundingClientRect();
    return controls
      .filter(el => {
        const r = el.getBoundingClientRect();
        const cy = r.top + r.height / 2;
        const ty = titleRect.top + titleRect.height / 2;
        return Math.abs(cy - ty) < 38 && r.left > titleRect.right && r.top < 140;
      })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0] || null;
  }

  function roomHeaderActionHost() {
    if (currentSection() !== 'room') return null;

    const title = Array.from(document.querySelectorAll('h1,h2,h3,div,span'))
      .find(el => el.children.length <= 2 && normalizeText(el.textContent) === '대화' && visibleControl(el));
    if (!title) return null;

    const titleRect = title.getBoundingClientRect();
    let row = title.parentElement;

    for (let depth = 0; row && depth < 6; depth++, row = row.parentElement) {
      const rect = row.getBoundingClientRect();
      if (rect.height > 120 || rect.width < 180) continue;

      const controls = Array.from(row.querySelectorAll('button, a'))
        .filter(visibleControl)
        .filter(el => {
          const r = el.getBoundingClientRect();
          const cy = r.top + r.height / 2;
          const ty = titleRect.top + titleRect.height / 2;
          return Math.abs(cy - ty) < 40 && r.left > titleRect.right;
        })
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

      if (controls.length) {
        const parent = controls[0].parentElement;
        if (parent && parent !== row && parent.children.length <= 8) return parent;
        return row;
      }
    }
    return null;
  }

  function creatorCenterSearchLink() {
    return Array.from(document.querySelectorAll('a[href*="/creator-center/search"]'))
      .filter(el => !el.closest('#' + PLOT_TOOLS_ID))
      .filter(visibleControl)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
  }

  function collectionToolsAnchor() {
    const section = currentSection();

    if (section === 'room') {
      const search = roomSearchControl();
      if (search && search.parentElement) {
        return { host: search.parentElement, before: search };
      }
      const host = roomHeaderActionHost();
      if (host) return { host, before: host.firstElementChild || null };
    }

    if (section === 'plot') {
      const search = creatorCenterSearchLink();
      if (search && search.parentElement) {
        const host = search.parentElement;
        return { host, before: host.firstElementChild || search };
      }
    }

    return null;
  }

  function closeCollectionPopup() {
    document.getElementById(COLLECTION_MODAL_ID)?.remove();
  }

  function openCollectionPopup() {
    closeCollectionPopup();

    const section = currentSection();
    if (!['room', 'plot'].includes(section)) return;

    const isRoom = section === 'room';
    const progress = isRoom ? roomCollectionProgress : plotCollectionProgress;
    const countValue = isRoom ? roomCollectionCount() : plotCollectionCount();

    const modal = document.createElement('div');
    modal.id = COLLECTION_MODAL_ID;
    modal.innerHTML =
      '<div class="zrm-collection-dialog" role="dialog" aria-modal="true" aria-label="Room Manager">' +
        '<div class="zrm-collection-head">' +
          '<div class="zrm-collection-title">Room Manager</div>' +
          '<button type="button" class="zrm-collection-close" aria-label="닫기">×</button>' +
        '</div>' +
        '<div class="zrm-collection-count"></div>' +
        '<div class="zrm-collection-actions">' +
          '<button type="button" data-zrm-action="collect"></button>' +
          '<button type="button" data-zrm-action="export">내보내기</button>' +
          '<button type="button" data-zrm-action="import">불러오기</button>' +
        '</div>' +
      '</div>';

    modal.querySelector('.zrm-collection-count').textContent =
      (isRoom ? '저장된 대화방 ' : '저장된 플롯 ') + countValue + '개' +
      (progress.running && progress.phase ? ' · ' + progress.phase : '');

    const collect = modal.querySelector('[data-zrm-action="collect"]');
    collect.disabled = false;
    collect.textContent = progress.running ? '중지' : '전체 수집';

    modal.querySelector('.zrm-collection-close').addEventListener('click', closeCollectionPopup);
    modal.addEventListener('click', event => {
      if (event.target === modal) closeCollectionPopup();
    });
    collect.addEventListener('click', () => {
      closeCollectionPopup();
      if (progress.running) {
        abortCollection();
        return;
      }
      if (isRoom) collectAllRoomsByScrolling();
      else collectAllPlotsByScrolling();
    });
    modal.querySelector('[data-zrm-action="export"]').addEventListener('click', () => {
      closeCollectionPopup();
      exportRoomManagerData();
    });
    modal.querySelector('[data-zrm-action="import"]').addEventListener('click', () => {
      closeCollectionPopup();
      importRoomManagerData();
    });

    document.body.appendChild(modal);
  }

  // 수집은 이 화면에서 돈다. 닫으면 멈추므로 진행 중에는 크게 알린다.
  function renderCollectionBanner() {
    const progress = currentSection() === 'plot' ? plotCollectionProgress : roomCollectionProgress;
    let banner = document.getElementById(COLLECTION_BANNER_ID);

    if (!progress.running) {
      banner?.remove();
      return;
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.id = COLLECTION_BANNER_ID;
      banner.innerHTML =
        '<div class="zrm-banner-body">' +
          '<div class="zrm-banner-title"></div>' +
          '<div class="zrm-banner-note">이 화면을 닫거나 다른 곳으로 이동하면 멈춰요. 다시 실행하면 남은 것만 이어서 합니다.</div>' +
        '</div>' +
        '<button type="button" class="zrm-banner-stop">중지</button>';
      banner.querySelector('.zrm-banner-stop').addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        abortCollection();
        banner.querySelector('.zrm-banner-title').textContent = '중지하는 중…';
      });
      document.body.appendChild(banner);
    }

    if (banner.parentElement !== document.body) document.body.appendChild(banner);
    const title = banner.querySelector('.zrm-banner-title');
    if (!collectionAborted) {
      title.textContent = 'Room Manager 수집 중 · ' + (progress.phase || '진행 중');
    }
  }

  function renderCollectionTools() {
    const section = currentSection();
    let tools = document.getElementById(PLOT_TOOLS_ID);
    if (!['room', 'plot'].includes(section)) {
      tools?.remove();
      closeCollectionPopup();
      return;
    }

    if (!tools) {
      tools = document.createElement('div');
      tools.id = PLOT_TOOLS_ID;
      tools.innerHTML =
        '<button type="button" class="zrm-tools-trigger" aria-label="Room Manager 메뉴">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true">' +
            '<circle cx="5" cy="12" r="1.7" fill="currentColor"></circle>' +
            '<circle cx="12" cy="12" r="1.7" fill="currentColor"></circle>' +
            '<circle cx="19" cy="12" r="1.7" fill="currentColor"></circle>' +
          '</svg>' +
        '</button>';
      tools.querySelector('.zrm-tools-trigger').addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openCollectionPopup();
      });
    }

    renderCollectionBanner();

    const anchor = collectionToolsAnchor();
    if (anchor && anchor.host) {
      tools.classList.remove('zrm-tools-fallback');
      if (tools.parentElement !== anchor.host) {
        anchor.host.insertBefore(tools, anchor.before || null);
      } else if (anchor.before && tools.nextElementSibling !== anchor.before) {
        anchor.host.insertBefore(tools, anchor.before);
      }
    } else {
      tools.classList.add('zrm-tools-fallback');
      if (tools.parentElement !== document.body) document.body.appendChild(tools);
    }
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

      #${PLOT_TOOLS_ID} {
        position: relative;
        width: 34px;
        min-width: 34px;
        max-width: 34px;
        z-index: 2147483000;
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
      }
      #${COLLECTION_BANNER_ID} {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 2147483645;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: #6d52ff;
        color: #fff;
        font: 500 12px/1.45 system-ui, -apple-system, sans-serif;
        box-shadow: 0 4px 14px rgba(0,0,0,.35);
      }
      #${COLLECTION_BANNER_ID} .zrm-banner-body { flex: 1; min-width: 0; }
      #${COLLECTION_BANNER_ID} .zrm-banner-title { font-weight: 700; }
      #${COLLECTION_BANNER_ID} .zrm-banner-note { margin-top: 2px; color: rgba(255,255,255,.82); font-size: 11px; }
      #${COLLECTION_BANNER_ID} .zrm-banner-stop {
        flex: 0 0 auto;
        height: 30px;
        padding: 0 12px;
        border: 0;
        border-radius: 8px;
        background: rgba(0,0,0,.28);
        color: #fff;
        font: 700 12px/1 system-ui, sans-serif;
        cursor: pointer;
      }
      #${PLOT_TOOLS_ID}.zrm-tools-fallback {
        position: fixed;
        top: 14px;
        right: 88px;
      }
      #${PLOT_TOOLS_ID} .zrm-tools-trigger {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        padding: 0;
        border: 0;
        border-radius: 9px;
        background: transparent;
        color: rgba(255,255,255,.92);
        font-size: 23px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: 1px;
        cursor: pointer;
      }
      #${PLOT_TOOLS_ID} .zrm-tools-trigger svg {
        display: block;
        width: 24px;
        height: 24px;
        flex: 0 0 24px;
      }
      #${PLOT_TOOLS_ID} .zrm-tools-trigger:hover {
        background: rgba(255,255,255,.08);
      }

      #${COLLECTION_MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483645;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px;
        background: rgba(0,0,0,.58);
        box-sizing: border-box;
      }
      #${COLLECTION_MODAL_ID} .zrm-collection-dialog {
        width: min(330px, 100%);
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 16px;
        background: #202023;
        color: #fff;
        box-shadow: 0 20px 60px rgba(0,0,0,.38);
      }
      #${COLLECTION_MODAL_ID} .zrm-collection-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 16px 10px;
      }
      #${COLLECTION_MODAL_ID} .zrm-collection-title {
        font-size: 16px;
        font-weight: 700;
      }
      #${COLLECTION_MODAL_ID} .zrm-collection-close {
        width: 32px;
        height: 32px;
        padding: 0;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: rgba(255,255,255,.7);
        font-size: 22px;
        line-height: 1;
      }
      #${COLLECTION_MODAL_ID} .zrm-collection-count {
        padding: 0 16px 12px;
        color: rgba(255,255,255,.5);
        font-size: 12px;
      }
      #${COLLECTION_MODAL_ID} .zrm-collection-actions {
        display: grid;
        gap: 7px;
        padding: 0 16px 16px;
      }
      #${COLLECTION_MODAL_ID} .zrm-collection-actions button {
        width: 100%;
        height: 42px;
        padding: 0 12px;
        border: 0;
        border-radius: 10px;
        background: rgba(255,255,255,.08);
        color: #fff;
        font-size: 13px;
        text-align: left;
      }
      #${COLLECTION_MODAL_ID} .zrm-collection-actions button:disabled {
        opacity: .45;
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

    // 카드에 텍스트로 안 보여도 React props 안의 plot 데이터에서 이름을 보강한다.
    harvestReactPlotData(item);

    const key = keyOf(type, id);
    const previous = state.index[key] || {};
    const alias = normalizeText(state.aliases[key] || previous.alias);
    if (alias && state.aliases[key] !== alias) state.aliases[key] = alias;
    // 제타가 실제로 그려준 방이면 사라진 방이 아니다.
    delete previous.missingSince;
    const searchMeta = collectSearchMeta(item, titleEl);
    // 플롯 목록 항목은 API 보강 대상이 아니라 화면 데이터가 유일한 출처다.
    const ownEntity = reactEntityForId(item, id);
    // 방 항목의 React 데이터는 조상 쪽에 room = {id, plot, ...} 형태로 있다.
    // reactEntityForId가 돌려주는 건 room 자체이므로 plot을 꺼내 써야 한다.
    // 그대로 쓰면 plotId 자리에 방 ID가 들어가 플롯 연결이 전부 어긋난다.
    const ownPlot = ownEntity && typeof ownEntity.plot === 'object' ? ownEntity.plot : null;
    const roomPlot = type === 'room' ? (reactRoomPlotMeta(item) || ownPlot) : null;
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
    const indexed = state.index[record.key] || {};
    const alias = normalizeText(state.aliases[record.key] || indexed.alias);
    if (alias && state.aliases[record.key] !== alias) state.aliases[record.key] = alias;
    record.alias = alias;
    const nextTitle = alias || record.original;
    if (normalizeText(record.titleEl.textContent) !== nextTitle) record.titleEl.textContent = nextTitle;
    record.titleEl.classList.toggle('zrm-has-alias', !!alias);

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


  // ── 대화창에서 수집 ──────────────────────────────────────────────────
  // 대화방을 열어보는 것만으로 캐릭터명·제작자명이 쌓인다.
  // 요청은 보내지 않고, 이미 화면에 그려진 것만 읽는다.
  let lastChatHarvest = { roomId: '', at: 0 };

  function currentRoomId() {
    const match = location.pathname.match(/\/rooms\/([^/?#]+)/i);
    return match ? match[1] : null;
  }

  // 말풍선 위의 발화자 이름이 곧 캐릭터명이다.
  // 내 말풍선(RightTextContent)의 이름은 내 페르소나이므로 절대 넣지 않는다.
  // 이 구분은 zeta-full-chat-export.user.js가 쓰던 것과 같다.
  function bubbleCharacterNames() {
    const names = [];
    for (const el of document.querySelectorAll('[data-sentry-component="LeftTextContent"] .caption1')) {
      const text = normalizeText(el.textContent).replace(/^@+/, '').replace(/[:：]+$/, '').trim();
      if (!text || text.length > 40) continue;
      if (!names.includes(text)) names.push(text);
    }
    return names.slice(0, 20);
  }

  function profileCardCreatorNames() {
    const names = [];
    const links = document.querySelectorAll([
      '[data-sentry-component="PlotProfileCard"] a[href*="/profile"]',
      '[data-sentry-component="PlotProfileCard"] a[href*="/users/"]',
      '[data-sentry-component="ChatSidebar"] a[href*="/profile"]',
      '[data-sentry-component="ChatSidebar"] a[href*="/users/"]',
      'a[href*="/creator/"]',
      'a[href*="/creators/"]'
    ].join(','));

    for (const link of links) {
      const text = normalizeText(link.textContent).replace(/^@+/, '').trim();
      if (!text || text.length > 40) continue;
      if (!names.includes(text)) names.push(text);
    }
    return names.slice(0, 5);
  }

  function harvestChatRoom() {
    const roomId = currentRoomId();
    if (!roomId) return;

    // 대화 중에는 DOM이 계속 바뀌므로 방당 4초에 한 번만 수집한다.
    const now = Date.now();
    if (lastChatHarvest.roomId === roomId && now - lastChatHarvest.at < 4000) return;
    lastChatHarvest = { roomId, at: now };

    const anchor = document.querySelector(
      '[data-sentry-component="ChatMessageList"], [data-sentry-component="BodyView"], main#contents, main'
    ) || document.body;

    // 화면이 이미 들고 있는 플롯 데이터부터 줍는다(요청 아님).
    harvestReactPlotData(anchor);

    const roomEntity = reactEntityForId(anchor, roomId);
    const plot = (roomEntity && roomEntity.plot) || reactRoomPlotMeta(anchor) || null;
    const plotId = normalizeText(plot && (plot.id || plot.plotId));
    const originatedId = normalizeText(plot && (plot.originatedId || plot.originalId));
    const meta = plot ? ingestPlotMeta(plot, plotId, originatedId) : null;

    const characters = uniqueTexts(
      plot ? plotCharacterNames(plot) : [],
      bubbleCharacterNames()
    );
    const creators = uniqueTexts(
      plot ? plotCreatorNames(plot) : [],
      profileCardCreatorNames()
    );
    if (!characters.length && !creators.length && !meta) return;

    const key = keyOf('room', roomId);
    const previous = state.index[key] || {};

    state.index[key] = {
      ...previous,
      type: 'room',
      id: roomId,
      href: previous.href || location.pathname,
      original: normalizeText(previous.original || (plot && (plot.name || plot.title))),
      alias: normalizeText(state.aliases[key]),
      image: previous.image || normalizeText(plot && (plot.imageUrl || plot.initialRoomImageUrl)) || '',
      plotId: plotId || previous.plotId || '',
      originatedId: originatedId || previous.originatedId || '',
      characterNames: uniqueTexts(characters, meta && meta.characterNames, previous.characterNames),
      creatorNames: uniqueTexts(creators, meta && meta.creatorNames, previous.creatorNames)
    };

    if (meta) mergeMetaIntoIndex(meta);
    saveState();
  }

  function currentSection() {
    if (/^\/(?:[^/]+\/)?rooms\/?$/i.test(location.pathname)) return 'room';
    if (/^\/(?:[^/]+\/)?creator-center\/search\/?$/i.test(location.pathname)) return 'plot-search';
    if (/^\/(?:[^/]+\/)?creator-center(?:\/|$)/i.test(location.pathname)) return 'plot';
    if (currentRoomId()) return 'chat';
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
    const direct = document.querySelector('input[name="creator-center-search"]');
    if (direct) return direct;
    const page = document.querySelector('[data-sentry-component="CreatorCenterSearchPage"]');
    const inputs = usableInputs(page || document);
    return inputs.find(looksLikeSearchInput) || inputs[0] || null;
  }

  function nativePlotResultsHost() {
    const page = document.querySelector('[data-sentry-component="CreatorCenterSearchPage"]');
    if (page) {
      const scroll = page.querySelector('[data-sentry-component="WrappedDiv"], .overflow-y-auto');
      if (scroll) {
        return scroll.querySelector(':scope > .grow, :scope > div') || scroll;
      }
      return page;
    }
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
    if (document.documentElement.dataset.zrmPlotSearchDelegated === '1') return;
    document.documentElement.dataset.zrmPlotSearchDelegated = '1';

    const update = event => {
      if (currentSection() !== 'plot-search') return;
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const input = nativePlotSearchInput();
      if (!input || target !== input) return;

      // React가 입력 이벤트 직후 검색 결과 영역을 다시 그릴 수 있으므로
      // 현재 입력값으로 즉시 그리고 다음 프레임에도 한 번 복구한다.
      renderNativePlotAliasResults(input.value || '');
      requestAnimationFrame(() => {
        if (currentSection() === 'plot-search') {
          renderNativePlotAliasResults(nativePlotSearchInput()?.value || '');
        }
      });
    };

    document.addEventListener('input', update, true);
    document.addEventListener('search', update, true);
    document.addEventListener('change', update, true);
  }

  function refresh() {
    observer?.disconnect();
    const section = currentSection();
    removeLegacyPanel();

    if (!section || section === 'chat') {
      document.getElementById(NATIVE_RESULTS_ID)?.remove();
      document.getElementById(PLOT_NATIVE_RESULTS_ID)?.remove();
      document.getElementById(PLOT_TOOLS_ID)?.remove();
      closeCollectionPopup();

      if (section === 'chat') {
        harvestChatRoom();
        observer?.observe(document.documentElement, { childList: true, subtree: true });
      }
      return;
    }

    injectStyle();
    renderCollectionTools();
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
    cleanupLegacyState();
    cleanupOldApiFlags();
    installPassiveNativeDataCapture();
    injectStyle();

    window.addEventListener('pagehide', saveStateNow);
    window.addEventListener('beforeunload', saveStateNow);

    document.addEventListener('pointerdown', rememberRoomContextTarget, true);
    document.addEventListener('contextmenu', rememberRoomContextTarget, true);
    document.addEventListener('touchstart', rememberRoomContextTarget, { capture: true, passive: true });

    observer = new MutationObserver(scheduleRefresh);
    bindSwipeOpenLock();
    refresh();

    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        scheduleRefresh();
        const section = currentSection();
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

