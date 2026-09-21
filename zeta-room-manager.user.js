// ==UserScript==
// @name         Zeta Room Manager (Android/PC)
// @namespace    zeta-room-manager
// @version      0.23.43
// @description  Android/PC용. 별명과 플롯명·캐릭터명·제작자명 검색, 화면/네이티브 로드 데이터 기반 수동 전체 수집.
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
  // 별명만 따로 둔다. 목록을 그리는 데는 이것만 있으면 된다.
  const ALIAS_KEY = 'zeta-room-manager:alias:v1';
  const STATE_VERSION = 3;
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
  const PROFILE_RESUME_KEY = 'zeta-room-manager:profile-resume:v1';
  const BOOKMARKLET_MODE = Boolean(
    window.__zetaRoomManagerBookmarklet ||
    window.__zetaRoomManagerIosBookmarklet
  );

  function bookmarkletControllerReady() {
    if (!BOOKMARKLET_MODE || !window.__zrmBookmarkletControllerReady) return false;
    try {
      return Boolean(window.__zrmBookmarkletController && !window.__zrmBookmarkletController.closed);
    } catch (_) {
      return false;
    }
  }

  function closeBookmarkletController() {
    if (!BOOKMARKLET_MODE) return;
    try {
      const controller = window.__zrmBookmarkletController;
      window.__zrmBookmarkletControllerReady = false;
      if (controller && !controller.closed) controller.close();
    } catch (_) {}
  }

  function requestBookmarkletAutoResume() {
    return new Promise(resolve => {
      const old = document.getElementById('zrm-auto-resume-prompt');
      if (old) old.remove();

      const wrap = document.createElement('div');
      wrap.id = 'zrm-auto-resume-prompt';
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(18,28,34,.48);display:flex;align-items:center;justify-content:center;padding:20px';
      wrap.innerHTML =
        '<div style="width:min(340px,100%);background:#fff;color:#233139;border-radius:18px;padding:20px;box-shadow:0 18px 55px #0005;font:14px/1.5 -apple-system,BlinkMacSystemFont,\'Noto Sans KR\',sans-serif">' +
          '<b style="display:block;font-size:17px;margin-bottom:8px">자동 이어받기 연결</b>' +
          '<div style="color:#52636b;margin-bottom:16px">보조 탭이 연결되지 않았습니다. 아래 버튼을 직접 누르면 보조 탭을 열고 남은 수집을 자동으로 이어갑니다.</div>' +
          '<div style="display:flex;gap:8px">' +
            '<button type="button" data-zrm-helper-cancel style="flex:1;border:0;border-radius:11px;padding:12px;background:#edf1f3;color:#26343c;font-weight:700">이번엔 멈춤</button>' +
            '<button type="button" data-zrm-helper-enable style="flex:1;border:0;border-radius:11px;padding:12px;background:#fee500;color:#171717;font-weight:800">자동 이어받기 켜기</button>' +
          '</div>' +
        '</div>';

      const finish = value => {
        wrap.remove();
        resolve(value);
      };
      wrap.querySelector('[data-zrm-helper-cancel]').addEventListener('click', () => finish(false));
      wrap.querySelector('[data-zrm-helper-enable]').addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = '연결 중…';
        const ok = await enableBookmarkletAutoResume();
        if (!ok) {
          button.disabled = false;
          button.textContent = '다시 시도';
          return;
        }
        finish(true);
      });
      document.body.appendChild(wrap);
    });
  }

  async function enableBookmarkletAutoResume() {
    if (!BOOKMARKLET_MODE) return false;
    if (bookmarkletControllerReady()) return true;

    const key = window.__zetaRoomManagerIosBookmarklet
      ? '__zetaRoomManagerIosBookmarklet'
      : '__zetaRoomManagerBookmarklet';
    const name = window.__zetaRoomManagerIosBookmarklet ? 'Room Manager (iOS)' : 'Room Manager';
    const sourceUrl = window.__zetaRoomManagerIosBookmarklet
      ? 'https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-room-manager-ios.user.js'
      : 'https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-room-manager.user.js';
    const controllerUrl = 'https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts-site/main/zeta-room-manager-bookmarklet-controller.js';

    let helper = null;
    try {
      helper = window.open('', 'zeta-room-manager-auto-resume', 'popup,width=390,height=260');
      if (!helper) return false;
      helper.document.open();
      helper.document.write(
        '<!doctype html><meta charset="utf-8"><title>Room Manager 자동 이어받기</title>' +
        '<body style="font-family:sans-serif;padding:24px">자동 이어받기 준비 중…</body>'
      );
      helper.document.close();

      const [controllerResponse, sourceResponse] = await Promise.all([
        fetch(controllerUrl + '?bm=' + Date.now(), { cache: 'no-store' }),
        fetch(sourceUrl + '?bm=' + Date.now(), { cache: 'no-store' })
      ]);
      if (!controllerResponse.ok) throw new Error('controller HTTP ' + controllerResponse.status);
      if (!sourceResponse.ok) throw new Error('HTTP ' + sourceResponse.status);

      (0, eval)(await controllerResponse.text());
      const installer = window.__zrmBookmarkletControllerInstall;
      if (!installer) throw new Error('자동 이어받기 컨트롤러를 불러오지 못했습니다');

      const ready = Boolean(installer(helper, {
        key,
        name,
        source: await sourceResponse.text()
      }));
      window.__zrmBookmarkletControllerReady = ready;
      if (!ready && helper && !helper.closed) helper.close();
      return ready;
    } catch (_) {
      window.__zrmBookmarkletControllerReady = false;
      try { if (helper && !helper.closed) helper.close(); } catch (_) {}
      return false;
    }
  }

  // 방 목록을 그리는 데 필요한 건 별명뿐이다.
  // 캐릭터명·제작자명이 든 큰 덩어리는 검색을 시작할 때 읽는다.
  let dataIndex = {};
  let dataPlotMeta = {};
  let dataLoaded = false;
  const pendingIndex = {};
  const pendingPlotMeta = {};

  const state = { version: STATE_VERSION, aliases: loadAliases() };
  Object.defineProperty(state, 'index', {
    get() { ensureDataLoaded(); return dataIndex; },
    set(value) { ensureDataLoaded(); dataIndex = value || {}; }
  });
  Object.defineProperty(state, 'plotMeta', {
    get() { ensureDataLoaded(); return dataPlotMeta; },
    set(value) { ensureDataLoaded(); dataPlotMeta = value || {}; }
  });

  let observer = null;
  let rafPending = false;
  let suspendObserverRefresh = false;
  let lastRoomContextRecord = null;
  let plotCollectionPromise = null;
  let plotCollectionProgress = { running: false, count: 0 };
  let roomCollectionPromise = null;
  let roomCollectionProgress = { running: false, count: 0 };

  function readProfileResume() {
    try {
      return JSON.parse(sessionStorage.getItem(PROFILE_RESUME_KEY) || 'null');
    } catch (_) {
      return null;
    }
  }

  function writeProfileResume(value) {
    try { sessionStorage.setItem(PROFILE_RESUME_KEY, JSON.stringify(value)); } catch (_) {}
  }

  function clearProfileResume() {
    try { sessionStorage.removeItem(PROFILE_RESUME_KEY); } catch (_) {}
  }

  // 별명 파일이 아직 없으면(업데이트 직후) 이번 한 번만 통째로 읽어 떼어낸다.
  function loadAliases() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ALIAS_KEY) || 'null');
      if (parsed && parsed.aliases && typeof parsed.aliases === 'object') return parsed.aliases;
    } catch (_) {}

    try {
      const whole = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const aliases = whole.aliases && typeof whole.aliases === 'object' ? whole.aliases : {};
      try {
        localStorage.setItem(ALIAS_KEY, JSON.stringify({ version: STATE_VERSION, aliases }));
      } catch (_) {}
      return aliases;
    } catch (_) {
      return {};
    }
  }

  // 화면에서 주운 항목을 저장본과 합친다. 저장본의 이름을 지우지 않는다.
  function mergeHarvestedEntry(stored, fresh) {
    if (!stored) return fresh;
    const merged = {
      ...stored,
      ...fresh,
      href: fresh.href || stored.href || '',
      image: fresh.image || stored.image || '',
      plotId: fresh.plotId || stored.plotId || '',
      originatedId: fresh.originatedId || stored.originatedId || '',
      characterNames: uniqueTexts(fresh.characterNames, stored.characterNames),
      creatorNames: uniqueTexts(fresh.creatorNames, stored.creatorNames)
    };
    if (!(stored.needsProfileRefresh || fresh.needsProfileRefresh)) delete merged.needsProfileRefresh;
    else merged.needsProfileRefresh = true;
    return merged;
  }

  // 큰 덩어리를 아직 안 읽었으면 화면에서 주운 건 잠시 손에 들고 있는다.
  function peekEntry(key) {
    return (dataLoaded ? dataIndex[key] : pendingIndex[key]) || null;
  }

  function putEntry(key, value) {
    if (dataLoaded) dataIndex[key] = value;
    else pendingIndex[key] = value;
  }

  function peekMeta(id) {
    if (!id) return null;
    return (dataLoaded ? dataPlotMeta[id] : pendingPlotMeta[id]) || null;
  }

  function putMeta(id, value) {
    if (dataLoaded) dataPlotMeta[id] = value;
    else pendingPlotMeta[id] = value;
  }

  function ensureDataLoaded() {
    if (dataLoaded) return;
    // 아래에서 state.index를 다시 건드려도 여기로 되돌아오지 않게 먼저 세운다.
    dataLoaded = true;

    const loaded = loadStoredData();
    dataIndex = loaded.index;
    dataPlotMeta = loaded.plotMeta;

    for (const [key, entry] of Object.entries(pendingIndex)) {
      dataIndex[key] = mergeHarvestedEntry(dataIndex[key], entry);
      delete pendingIndex[key];
    }
    const heldMeta = Object.entries(pendingPlotMeta);
    for (const [id, meta] of heldMeta) {
      dataPlotMeta[id] = mergeHarvestedEntry(dataPlotMeta[id], meta);
      delete pendingPlotMeta[id];
    }
    plotLookup = null;
    plotLookupDirty = true;
    // 대화방에서 주운 이름은 같은 플롯을 쓰는 다른 방에도 퍼뜨려야 한다.
    for (const [, meta] of heldMeta) mergeMetaIntoIndex(dataPlotMeta[meta.canonicalId] || meta);

    // 한 번만 도는 정리 작업도 여기서 돈다. 시작할 때 돌리면 큰 덩어리를 읽게 된다.
    cleanupLegacyState();
    cleanupOldApiFlags();
    saveState();
  }

  function loadStoredData() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const loaded = {
        version: STATE_VERSION,
        index: parsed.index && typeof parsed.index === 'object' ? parsed.index : {},
        plotMeta: parsed.plotMeta && typeof parsed.plotMeta === 'object' ? parsed.plotMeta : {}
      };

      // v1 인덱스에는 화면에서 긁어온 캐릭터·제작자 이름이 섞여 있다.
      // 페이지 전역 정보가 모든 항목에 붙어 검색이 전부 매칭되므로 한 번 비우고
      // API 기반 정보(plotMeta)로 다시 채운다. 별명은 그대로 둔다.
      // v3: 제작자명이 "@" 한 글자로만 저장된 항목이 있다. 쓸모없는 조각을 지운다.
      if (Number(parsed.version || 1) < 3) {
        const clean = list => Array.isArray(list)
          ? list.filter(value => {
              const text = String(value || '').trim();
              return text && text !== '@' && /[0-9A-Za-z가-힣]/.test(text.replace(/^@/, ''));
            })
          : list;
        for (const entry of Object.values(loaded.index)) {
          if (entry && typeof entry === 'object') entry.creatorNames = clean(entry.creatorNames);
        }
        for (const meta of Object.values(loaded.plotMeta)) {
          if (meta && typeof meta === 'object') meta.creatorNames = clean(meta.creatorNames);
        }
      }

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
      localStorage.setItem(ALIAS_KEY, JSON.stringify({
        version: STATE_VERSION,
        aliases: state.aliases
      }));
    } catch (_) {}

    // 아직 안 읽은 덩어리는 건드리지 않는다. 저장본이 그대로 남아 있어야 한다.
    if (!dataLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: STATE_VERSION,
        aliases: state.aliases,
        index: dataIndex,
        plotMeta: dataPlotMeta
      }));
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

  // 수집 데이터만 비운다. 사용자가 붙인 별명은 유지한다.
  function resetCollectedIndex() {
    state.index = {};
    state.plotMeta = {};
    plotLookup = null;
    plotLookupDirty = true;
    localStorage.removeItem('zeta-room-manager:last-full-index-at:v3');
    localStorage.removeItem('zeta-room-manager:last-plot-index-at:v1');
    localStorage.removeItem('zeta-room-manager:last-plot-index-at:v2');
    localStorage.removeItem(PLOT_COLLECTION_STAMP_KEY);
    localStorage.removeItem(ROOM_COLLECTION_STAMP_KEY);
    localStorage.removeItem(CLEANUP_STAMP_KEY);
    saveStateNow();
  }

  // 전부 지우고 처음부터 다시 수집한다. 별명은 유지된다.
  window.zrmResetIndex = function () {
    resetCollectedIndex();
    return '인덱스를 비웠습니다. 별명은 그대로입니다. 대화방/플롯 목록에서 전체 수집을 다시 실행해 주세요.';
  };

  function deleteAllRoomManagerData() {
    if (roomCollectionPromise || plotCollectionPromise || roomCollectionProgress.running || plotCollectionProgress.running) {
      alert('수집 중에는 데이터를 삭제할 수 없습니다. 먼저 중지를 눌러 주세요.');
      return false;
    }

    if (!confirm(
      'Room Manager 데이터를 전부 삭제할까요?' +
      '\n\n삭제되는 항목' +
      '\n· 저장된 대화방/플롯' +
      '\n· 캐릭터명/제작자명' +
      '\n· 별명' +
      '\n· 수집 기록' +
      '\n· 자동 이어받기 상태' +
      '\n\n이 작업은 되돌릴 수 없습니다.'
    )) return false;

    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    clearProfileResume();
    closeBookmarkletController();

    state.aliases = {};
    state.index = {};
    state.plotMeta = {};
    plotLookup = null;
    plotLookupDirty = true;

    const keys = [
      STORAGE_KEY,
      ALIAS_KEY,
      BACKGROUND_INDEX_STAMP_KEY,
      PLOT_COLLECTION_STAMP_KEY,
      ROOM_COLLECTION_STAMP_KEY,
      CLEANUP_STAMP_KEY,
      NO_API_CLEANUP_STAMP_KEY,
      'zeta-room-manager:last-plot-index-at:v1',
      'zeta-room-manager:last-plot-index-at:v2'
    ];
    for (const key of keys) {
      try { localStorage.removeItem(key); } catch (_) {}
    }

    roomCollectionProgress = { running: false, count: 0 };
    plotCollectionProgress = { running: false, count: 0 };
    renderCollectionTools();
    scheduleRefresh();
    alert('Room Manager 데이터를 전부 삭제했습니다.');
    return true;
  }

  window.zrmDeleteAllData = deleteAllRoomManagerData;

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

  function mergeMetaIntoIndex(meta, options = {}) {
    if (!meta) return;
    const ids = new Set([
      normalizeText(meta.canonicalId),
      normalizeText(meta.plotId),
      normalizeText(meta.sourcePlotId),
      normalizeText(meta.originatedId)
    ].filter(Boolean));
    const metaName = normalizeText(meta.name).toLocaleLowerCase('ko-KR');
    const metaImage = imageKeyOf(meta.image);
    const replaceNames = Boolean(options.replaceNames);
    const strictIds = Boolean(options.strictIds);

    for (const entry of Object.values(state.index || {})) {
      if (!entry || typeof entry !== 'object') continue;
      const entryIds = [
        normalizeText(entry.type === 'plot' ? entry.id : ''),
        normalizeText(entry.plotId),
        normalizeText(entry.originatedId)
      ].filter(Boolean);
      const linkedById = entryIds.some(id => ids.has(id));
      const linkedByName = !strictIds && !linkedById
        && metaName
        && normalizeText(entry.original).toLocaleLowerCase('ko-KR') === metaName;
      const linkedByImage = !strictIds && !linkedById && !linkedByName
        && metaImage
        && imageKeyOf(entry.image) === metaImage;
      if (!linkedById && !linkedByName && !linkedByImage) continue;

      if (replaceNames) {
        entry.characterNames = uniqueTexts(meta.characterNames);
        entry.creatorNames = uniqueTexts(meta.creatorNames);
        delete entry.needsProfileRefresh;
      } else {
        entry.characterNames = uniqueTexts(entry.characterNames, meta.characterNames);
        entry.creatorNames = uniqueTexts(entry.creatorNames, meta.creatorNames);
      }
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
    if (suspendPassiveNativeCapture) return;
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
          if (!suspendPassiveNativeCapture && shouldInspectNativeResponse(url)) {
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
      if (!suspendPassiveNativeCapture && shouldInspectNativeResponse(url)) {
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
      if (forceReconcileSeenRoomKeys) forceReconcileSeenRoomKeys.add(record.key);
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

    const previous = peekMeta(canonicalId) || (plotId && peekMeta(plotId)) || {};
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

    putMeta(canonicalId, next);
    plotLookupDirty = true;
    if (plotId && plotId !== canonicalId && peekMeta(plotId)) {
      if (dataLoaded) delete dataPlotMeta[plotId];
      else delete pendingPlotMeta[plotId];
    }
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


  // ── 숨긴 대화방을 거쳐 플롯 이름 채우기 ─────────────────────────────
  // 방 목록 데이터에는 characters가 빈 배열이고 creator 키가 아예 없다.
  // 대화방 → 플롯 프로필에는 있으므로 필요한 플롯을 숨긴 iframe으로 열어 읽는다.
  // 요청이나 프로필 주소를 직접 만들지 않고 제타 화면이 이동하는 대로 둔다.
  const PROFILE_BUTTON = 'button[data-testid="chat-header-profile"][aria-label="Open plot profile"]';
  const PROFILE_PATH = /^\/(?:[^/]+\/)?plots\/([a-f\d-]{36})\/profile\/?$/i;
  const ROOM_UUID = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
  let collectionAborted = false;
  let forceReconcileSeenRoomKeys = null;
  let wakeLock = null;
  let wakeStatus = '';
  // 숨김 프로필을 연속으로 읽는 동안 fetch/XHR 응답까지 복제하면 메모리 사용량이 크게 늘어난다.
  let suspendPassiveNativeCapture = false;

  function plotProfileId(pathname) {
    return normalizeText((String(pathname || '').match(PROFILE_PATH) || [])[1]);
  }

  function collectionRunning() {
    return Boolean(roomCollectionProgress.running || plotCollectionProgress.running);
  }

  // 모바일은 화면이 꺼지면 브라우저가 멈춘다. 수집 동안 화면을 붙잡는다.
  async function holdScreenAwake() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) {
      wakeStatus = '이 브라우저는 화면 꺼짐 방지를 지원하지 않아요. 화면이 꺼지면 멈춥니다.';
      return;
    }
    if (wakeLock || document.visibilityState !== 'visible') return;

    try {
      const lock = await navigator.wakeLock.request('screen');
      wakeLock = lock;
      wakeStatus = '';
      // 탭을 가리면 브라우저가 알아서 놓는다. 돌아오면 다시 잡는다.
      lock.addEventListener('release', () => {
        if (wakeLock !== lock) return;
        wakeLock = null;
      });
    } catch (_) {
      wakeStatus = '화면 꺼짐 방지를 켜지 못했어요. 화면이 꺼지면 멈춥니다.';
    }
    renderCollectionBanner();
  }

  async function releaseScreenAwake() {
    const lock = wakeLock;
    wakeLock = null;
    wakeStatus = '';
    if (lock) {
      try { await lock.release(); } catch (_) {}
    }
  }

  // 현재 주소의 언어 구간(/ko/...)을 그대로 쓴다.
  function localeSegment() {
    const first = location.pathname.split('/').filter(Boolean)[0] || 'ko';
    return /^[a-z]{2}(?:-[a-z]{2})?$/i.test(first) ? first : 'ko';
  }

  function abortCollection() {
    collectionAborted = true;
    clearProfileResume();
    closeBookmarkletController();
    saveStateNow();

    if (roomCollectionProgress.running) {
      roomCollectionProgress.note = '중지 요청됨 · 현재 작업을 정리하는 중';
    }
    if (plotCollectionProgress.running) {
      plotCollectionProgress.note = '중지 요청됨 · 현재 작업을 정리하는 중';
    }
    renderCollectionTools();
  }

  // 끝내 읽히지 않는 방은 몇 번 시도한 뒤 접어둔다.
  const PROFILE_FAIL_LIMIT = 2;
  const PROFILE_FAIL_COOLDOWN = 7 * 24 * 60 * 60 * 1000;

  function profileFailCount(entry, meta) {
    return Math.max(
      Number((meta && meta.profileFailCount) || 0),
      Number((entry && entry.profileFailCount) || 0)
    );
  }

  function profileFailedAt(entry, meta) {
    return Math.max(
      Number((meta && meta.profileFailedAt) || 0),
      Number((entry && entry.profileFailedAt) || 0)
    );
  }

  // 프로필을 열어봤는데 한쪽이 비어 있으면, 그 플롯에는 그 이름이 없는 것이다.
  // 비었다는 사실을 남기지 않으면 그 방은 매번 다시 대상이 되고,
  // 남은 개수가 줄지 않아 새로고침이 끝나지 않는다.
  function profileSettled(entry, meta, characters, creators) {
    const creatorDone = creators.length > 0 ||
      Boolean((meta && meta.creatorUnavailable) || (entry && entry.creatorUnavailable));
    const characterDone = characters.length > 0 ||
      Boolean((meta && meta.characterUnavailable) || (entry && entry.characterUnavailable));
    return creatorDone && characterDone;
  }

  // 한 방이 이름 수집 대상인지는 여기 한 곳에서만 판단한다.
  function entryNeedsProfile(entry, force = false) {
    if (!entry || entry.type !== 'room' || !ROOM_UUID.test(entry.id || '')) return false;
    if (force || entry.needsProfileRefresh) return true;

    const meta = plotMetaForEntry(entry);
    const characters = uniqueTexts(entry.characterNames, meta && meta.characterNames);
    const creators = uniqueTexts(entry.creatorNames, meta && meta.creatorNames);
    if (profileSettled(entry, meta, characters, creators)) return false;
    if (profileFailCount(entry, meta) >= PROFILE_FAIL_LIMIT &&
      Date.now() - profileFailedAt(entry, meta) < PROFILE_FAIL_COOLDOWN) return false;
    return true;
  }

  // 같은 플롯을 쓰는 방이 여럿이면 한 번만 연다.
  // 이미 이름을 아는 플롯(항목이든 plotMeta든)은 건너뛴다.
  function profileCollectionTargets(force = false, roomKeys = null) {
    const handledPlots = new Set();
    const targets = [];

    for (const [entryKey, entry] of Object.entries(state.index || {})) {
      if (!entry || entry.type !== 'room' || !ROOM_UUID.test(entry.id || '')) continue;
      if (roomKeys && !roomKeys.has(entryKey)) continue;

      const needsProfileRefresh = Boolean(entry.needsProfileRefresh);
      if (!entryNeedsProfile(entry, force)) continue;

      const keys = [normalizeText(entry.plotId), normalizeText(entry.originatedId)].filter(Boolean);
      if (keys.length) {
        if (keys.some(key => handledPlots.has(key))) continue;
        for (const key of keys) handledPlots.add(key);
      }

      targets.push({
        roomId: entry.id,
        plotId: normalizeText(entry.plotId),
        originatedId: normalizeText(entry.originatedId),
        replaceNames: needsProfileRefresh
      });
    }
    return targets;
  }

  // 숨긴 화면에서 confirm()이 뜨면 그 창의 스크립트가 통째로 멈춘다.
  // "비공개로 전환할까요?" 같은 물음이 뜨면 수집이 거기서 정지한다.
  function muteFrameDialogs(win) {
    try {
      if (!win || win.__zrmNoDialogs) return;
      win.__zrmNoDialogs = true;
      win.alert = () => {};
      win.confirm = () => false;
      win.prompt = () => null;
      win.onbeforeunload = null;
    } catch (_) {}
  }

  // 숨긴 화면에서 제일 많이 먹는 건 그림이다. 캐릭터 프사 한 장이
  // 펼쳐지면 수십 MB가 되고, 수백 번 띄우면 renderer가 Out of Memory로 죽는다.
  // 이름은 img의 alt에서 읽으므로 그림 자체는 받지 않아도 된다.
  const MEDIA_TAGS = /^(?:IMG|SOURCE|VIDEO|AUDIO)$/;
  const MEDIA_ATTRS = /^(?:src|srcset|poster)$/;
  let blockFrameMedia = true;

  function stripMediaElement(el) {
    try {
      for (const name of ['src', 'srcset', 'poster']) {
        const value = el.getAttribute && el.getAttribute(name);
        if (value === null || value === undefined) continue;
        el.removeAttribute(name);
        el.setAttribute('data-zrm-' + name, value);
      }
    } catch (_) {}
  }

  function stripFrameMedia(win) {
    if (!blockFrameMedia) return;
    try {
      const doc = win && win.document;
      if (!doc || doc.__zrmNoMedia) return;
      doc.__zrmNoMedia = true;

      // 문서가 바뀌면 생성자도 새로 생긴다. 문서마다 다시 건다.
      const setAttribute = win.Element.prototype.setAttribute;
      win.Element.prototype.setAttribute = function (name, value) {
        const lower = String(name).toLowerCase();
        if (MEDIA_ATTRS.test(lower) && MEDIA_TAGS.test(this.tagName || '')) {
          return setAttribute.call(this, 'data-zrm-' + lower, value);
        }
        return setAttribute.call(this, name, value);
      };

      const image = win.HTMLImageElement && win.HTMLImageElement.prototype;
      for (const name of ['src', 'srcset']) {
        const own = image && Object.getOwnPropertyDescriptor(image, name);
        if (!own || !own.set) continue;
        Object.defineProperty(image, name, {
          configurable: true,
          enumerable: own.enumerable,
          get() { return this.getAttribute('data-zrm-' + name) || ''; },
          set(value) { setAttribute.call(this, 'data-zrm-' + name, value); }
        });
      }

      doc.querySelectorAll('img, source, video, audio').forEach(stripMediaElement);

      const observer = new win.MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!node || node.nodeType !== 1) continue;
            if (MEDIA_TAGS.test(node.tagName || '')) stripMediaElement(node);
            if (node.querySelectorAll) node.querySelectorAll('img, source, video, audio').forEach(stripMediaElement);
          }
        }
      });
      observer.observe(doc.documentElement, { childList: true, subtree: true });
    } catch (_) {}
  }

  // 화면이 바뀌는 순간을 놓치면 그림이 이미 떠 버린다.
  // 주소를 바꾼 직후 잠깐만 촘촘히 확인한다.
  function armMediaGuard(frame) {
    if (!blockFrameMedia || !frame) return;
    let left = 80;
    const timer = setInterval(() => {
      if (--left <= 0 || !frame.isConnected) {
        clearInterval(timer);
        return;
      }
      try {
        const win = frame.contentWindow;
        if (win && win.document && !win.document.__zrmNoMedia) stripFrameMedia(win);
      } catch (_) {}
    }, 25);
  }

  async function readInFrame(frame, read, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (collectionAborted) throw new Error('중지됨');
      if (!frame || !frame.isConnected) throw new Error('숨김 화면을 다시 여는 중');
      try {
        const win = frame.contentWindow;
        if (win && win.document) {
          muteFrameDialogs(win);
          stripFrameMedia(win);
          const value = read(win);
          if (value) return value;
        }
      } catch (error) {
        if (error && error.name === 'SecurityError') throw new Error('숨김 화면 접근이 막혔습니다');
        throw error;
      }
      await sleep(100);
    }
    throw new Error('시간 초과');
  }

  // "@" 처럼 쪼개진 조각이나 지나치게 긴 글자는 제작자명이 아니다.
  function usefulCreatorName(text) {
    const value = normalizeText(text);
    if (!value || value.length > 40) return false;
    return /[0-9A-Za-z가-힣]/.test(value.replace(/^@/, ''));
  }

  function readPlotProfile(win) {
    const root = win.document.querySelector('[data-sentry-component="PlotProfile"]');
    if (!root) return null;

    // 이름이 여러 span으로 쪼개진 경우(@ 와 아이디가 따로)를 대비해 링크 전체 글자도 본다.
    const creators = uniqueTexts(
      Array.from(root.querySelectorAll('a[href*="/creators/"][href*="/profile"]'))
        .reduce((out, a) => {
          out.push(a.querySelector('span.caption1:not([data-sentry-element="Span"])')?.textContent);
          out.push(a.textContent);
          return out;
        }, [])
    ).filter(usefulCreatorName);

    const characters = uniqueTexts(
      Array.from(root.querySelectorAll('img[alt^="Profile image of "]'))
        .map(img => normalizeText(img.getAttribute('alt')).slice('Profile image of '.length))
    );

    // 닉네임 아래의 @아이디는 탈퇴한 계정에도 남는다.
    // 닉네임으로 못 찾을 때의 대안이자, 아이디로도 검색할 수 있게 함께 담는다.
    const handles = uniqueTexts(
      Array.from(root.querySelectorAll('span, a'))
        .map(el => normalizeText(el.textContent))
        .filter(text => /^@[^\s@]{1,40}$/.test(text))
    );
    for (const handle of handles) {
      if (!creators.includes(handle)) creators.push(handle);
    }

    // 제작자가 탈퇴하면 프로필 링크가 사라지고 "탈퇴한 계정"만 남는다.
    // 링크가 있어야만 읽은 것으로 치면 캐릭터명까지 통째로 버리게 된다.
    if (!creators.length && /탈퇴한 계정/.test(root.textContent || '')) {
      creators.push('탈퇴한 계정');
    }
    const profileId = plotProfileId(win.location.pathname);
    if (creators.length) return { creators, characters, profileId };

    // 제작자를 끝내 못 읽어도 캐릭터명까지 버릴 이유는 없다.
    // 다만 그리는 중일 수 있으므로 화면이 안정된 뒤에만 받는다(readProfileIn이 판단).
    if (characters.length) return { creators: [], characters, profileId, partial: true };
    return null;
  }

  function hiddenFrame() {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    // allow-modals를 주지 않으면 그 안에서 alert/confirm이 무시된다.
    // "비공개로 전환할까요?" 같은 물음이 뜨면 창 전체가 멈추기 때문에 막아 둔다.
    frame.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:390px;height:850px;opacity:0;pointer-events:none;border:0';
    document.body.appendChild(frame);
    return frame;
  }

  // 숨긴 화면 하나가 제타 앱 전체를 들고 있다. 수백 번 띄우면 메모리가 쌓여
  // 브라우저가 Out of Memory로 죽는다. 버리기 전에 안을 확실히 비운다.
  function dropFrame(frame) {
    if (!frame) return;
    try {
      const win = frame.contentWindow;
      if (win) {
        // 앱이 걸어둔 타이머를 끊어 문서가 붙잡히지 않게 한다.
        const highest = win.setTimeout(() => {}, 0);
        for (let id = highest; id >= 0 && id > highest - 800; id--) {
          win.clearTimeout(id);
          win.clearInterval(id);
        }
      }
    } catch (_) {}

    try { frame.src = 'about:blank'; } catch (_) {}
    try { frame.srcdoc = ''; } catch (_) {}
    if (frame.isConnected) frame.remove();
  }

  // 남은 메모리가 빠듯하면 모두 정리하고 숨을 돌린다.
  function memoryPressure() {
    try {
      const memory = performance && performance.memory;
      if (!memory || !memory.jsHeapSizeLimit) return 0;
      return memory.usedJSHeapSize / memory.jsHeapSizeLimit;
    } catch (_) {
      return 0;
    }
  }

  function applyProfileResult(target, result, options = {}) {
    const canonicalId = target.plotId || normalizeText(result.profileId) || target.originatedId;
    const replaceNames = Boolean(options.replaceNames);

    // 플롯 아이디를 끝내 못 찾은 방은 방 자체에 적어둔다.
    // 그냥 돌아서면 읽어낸 이름이 버려지고,
    // 그 방은 다음 수집에서 또 대상이 되어 수집이 끝나지 않는다.
    if (!canonicalId) {
      const roomEntry = state.index[keyOf('room', target.roomId)];
      if (!roomEntry) return;

      roomEntry.characterNames = replaceNames
        ? uniqueTexts(result.characters)
        : uniqueTexts(roomEntry.characterNames, result.characters);
      roomEntry.creatorNames = replaceNames
        ? uniqueTexts(result.creators)
        : uniqueTexts(roomEntry.creatorNames, result.creators);

      if (roomEntry.characterNames.length) delete roomEntry.characterUnavailable;
      else roomEntry.characterUnavailable = true;
      if (roomEntry.creatorNames.length) delete roomEntry.creatorUnavailable;
      else roomEntry.creatorUnavailable = true;

      delete roomEntry.profileFailCount;
      delete roomEntry.profileFailedAt;
      delete roomEntry.needsProfileRefresh;
      return;
    }

    const previous = state.plotMeta[canonicalId] || {};
    const meta = {
      ...previous,
      canonicalId,
      plotId: target.plotId || previous.plotId || '',
      originatedId: target.originatedId || previous.originatedId || '',
      characterNames: replaceNames
        ? uniqueTexts(result.characters)
        : uniqueTexts(previous.characterNames, result.characters),
      creatorNames: replaceNames
        ? uniqueTexts(result.creators)
        : uniqueTexts(previous.creatorNames, result.creators),
      updatedAt: Date.now()
    };

    // 읽어낸 쪽이 비어 있으면 '없음'으로 못 박는다. 그래야 대상에서 빠진다.
    if (meta.creatorNames.length) delete meta.creatorUnavailable;
    else meta.creatorUnavailable = true;
    if (meta.characterNames.length) delete meta.characterUnavailable;
    else meta.characterUnavailable = true;
    delete meta.profileFailCount;
    delete meta.profileFailedAt;

    state.plotMeta[canonicalId] = meta;
    plotLookupDirty = true;
    mergeMetaIntoIndex(meta, {
      replaceNames,
      strictIds: replaceNames
    });

    const roomEntry = state.index[keyOf('room', target.roomId)];
    if (roomEntry) {
      delete roomEntry.profileFailCount;
      delete roomEntry.profileFailedAt;
    }
  }

  // 프로필을 아예 못 연 플롯(삭제된 플롯 등)은 몇 번 시도한 뒤 접어둔다.
  // 매번 되풀이하면 시간만 쓴다.
  function notePlotProfileFailure(target) {
    // 플롯 아이디가 없는 방도 세어둬야 한다.
    // 아무 데도 적지 않으면 그 방은 영원히 대상으로 남는다.
    const roomEntry = state.index[keyOf('room', target.roomId)];
    if (roomEntry) {
      roomEntry.profileFailCount = Number(roomEntry.profileFailCount || 0) + 1;
      roomEntry.profileFailedAt = Date.now();
    }

    const canonicalId = target.plotId || target.originatedId;
    if (!canonicalId) return;

    const previous = state.plotMeta[canonicalId] || {};
    state.plotMeta[canonicalId] = {
      ...previous,
      canonicalId,
      plotId: target.plotId || previous.plotId || '',
      originatedId: target.originatedId || previous.originatedId || '',
      characterNames: previous.characterNames || [],
      creatorNames: previous.creatorNames || [],
      profileFailCount: Number(previous.profileFailCount || 0) + 1,
      profileFailedAt: Date.now()
    };
    plotLookupDirty = true;
  }

  // 플롯마다 iframe을 새로 띄우면 제타 앱을 매번 처음부터 부팅한다.
  // 손으로 할 때처럼, 앱은 한 번만 띄우고 그 안에서 화면만 바꾼다.
  const PROFILE_WORKERS = 2;
  const MOBILE_PROFILE_WORKERS = 2;
  const PROFILE_FRAME_RECYCLE = 8;
  // 이 비율을 넘기면 화면을 모두 버리고 잠시 쉰다.
  // 다만 performance.memory는 JS 힙만 본다. 문서·이미지가 차지하는
  // renderer 메모리는 여기에 잡히지 않으므로, 이것만 믿으면 안 된다.
  const MEMORY_PAUSE_RATIO = 0.7;
  const WORKERS_KEY = 'zeta-room-manager:workers:v1';

  function configuredWorkers(mobile) {
    let saved = 0;
    try { saved = Number(localStorage.getItem(WORKERS_KEY) || 0); } catch (_) {}
    if (saved >= 1 && saved <= 6) return saved;
    return mobile ? MOBILE_PROFILE_WORKERS : PROFILE_WORKERS;
  }

  // 메모리가 빠듯하면 1~2, 빠르게 돌리고 싶으면 3~4.
  window.zrmSetWorkers = function (count) {
    const value = Math.max(1, Math.min(6, Number(count) || 0));
    try { localStorage.setItem(WORKERS_KEY, String(value)); } catch (_) {}
    return '동시 수집을 ' + value + '개로 맞췄어요. 다음 수집부터 적용됩니다. (기본값으로 되돌리려면 zrmSetWorkers(0))';
  };
  const PROFILE_SETTLE_MS = 200;
  // 한 번에 너무 많이 돌면 renderer 메모리가 회복될 틈이 없다.
  // 끊어서 돌리고, 남은 개수는 완료 알림에 알려 다시 누르게 한다.
  // 한 배치를 마치면 새로고침으로 renderer 메모리를 비우는 구조인데,
  // 한 배치가 크면 새로고침 전에 바닥난다. 도입 당시 모바일 80은 문제가
  // 없었으므로 PC도 그 선까지 내린다.
  const PROFILE_BATCH_DESKTOP = 80;
  const PROFILE_BATCH_MOBILE = 50;
  const BATCH_KEY = 'zeta-room-manager:batch:v1';

  function configuredBatch(mobile) {
    let saved = 0;
    try { saved = Number(localStorage.getItem(BATCH_KEY) || 0); } catch (_) {}
    if (saved >= 10 && saved <= 200) return saved;
    return mobile ? PROFILE_BATCH_MOBILE : PROFILE_BATCH_DESKTOP;
  }

  // 그래도 메모리가 터지면 한 번에 도는 개수를 줄인다.
  window.zrmSetBatch = function (count) {
    const value = Math.max(0, Math.min(200, Number(count) || 0));
    try {
      if (value) localStorage.setItem(BATCH_KEY, String(value));
      else localStorage.removeItem(BATCH_KEY);
    } catch (_) {}
    return value
      ? '한 번에 ' + value + '개씩 돌게 맞췄어요. 다음 수집부터 적용됩니다. (기본값으로 되돌리려면 zrmSetBatch(0))'
      : '기본값으로 되돌렸어요.';
  };

  // 그림 차단이 수집을 망가뜨리면 이걸로 끈다.
  window.zrmBlockImages = function (on) {
    blockFrameMedia = on !== false;
    return blockFrameMedia
      ? '숨김 화면에서 그림을 받지 않습니다.'
      : '숨김 화면에서 그림을 그대로 받습니다. (메모리를 더 씁니다)';
  };

  let lastProfileFailures = [];

  function isMobileProfileDevice() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  }

  // ID만으로는 어느 방인지 알 수 없다. 이름과 주소를 남겨 바로 열어볼 수 있게 한다.
  function describeFailure(target, reason) {
    const entry = state.index[keyOf('room', target.roomId)];
    const meta = entry ? plotMetaForEntry(entry) : null;
    const name = (entry ? entryTitle(entry) : '') || normalizeText(meta && meta.name) || '(제목 없음)';
    const path = normalizeText(entry && entry.href) || ('/' + localeSegment() + '/rooms/' + target.roomId);

    return {
      name,
      url: path.startsWith('http') ? path : location.origin + path,
      plotId: target.plotId || '',
      roomId: target.roomId,
      reason
    };
  }

  // 실패 사유별로 묶는다. 같은 이유가 반복되는 경우가 대부분이다.
  function failureSummary(failures) {
    const counts = new Map();
    for (const item of failures) counts.set(item.reason, (counts.get(item.reason) || 0) + 1);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => reason + ' ' + count + '건');
  }

  // 실패 목록 전체를 파일로 받는다.
  window.zrmFailures = function () {
    if (!lastProfileFailures.length) return '마지막 수집에서 실패한 항목이 없어요.';

    const lines = ['Zeta Room Manager 이름 수집 실패 목록', new Date().toISOString(), ''];
    for (const item of failureSummary(lastProfileFailures)) lines.push('- ' + item);
    lines.push('');

    // 사유별로 묶어서, 각 항목은 플롯 이름과 대화방 주소로 적는다.
    const groups = new Map();
    for (const item of lastProfileFailures) {
      if (!groups.has(item.reason)) groups.set(item.reason, []);
      groups.get(item.reason).push(item);
    }
    for (const [reason, items] of groups) {
      lines.push('════ ' + reason + ' (' + items.length + '건)', '');
      for (const item of items) {
        lines.push(item.name);
        lines.push('  ' + item.url);
        if (item.plotId) lines.push('  플롯 ' + item.plotId);
        lines.push('');
      }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zeta-room-manager-failures-' + new Date().toISOString().slice(0, 10) + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return lastProfileFailures.length + '건을 파일로 내려받았어요.';
  };
  // 실패했을 때 어디까지 갔는지 알아야 원인을 말해줄 수 있다.
  function profileFailureReason(error, trace, plotId) {
    const message = normalizeText((error && error.message) || error);
    if (message !== '시간 초과') return message || '알 수 없는 오류';
    if (!trace.path) return '화면이 열리지 않음';
    if (!trace.path.includes(plotId)) return '프로필 주소로 이동하지 않음';
    if (!trace.root) return '프로필 화면이 그려지지 않음';
    return '제작자명을 찾지 못함';
  }

  async function readProfileIn(frame, plotId, timeoutMs) {
    const trace = { path: '', root: false };
    const end = Date.now() + timeoutMs;
    let settledAt = 0;
    let fullResultSignature = '';
    let fullResultSince = 0;

    while (Date.now() < end) {
      if (collectionAborted) throw new Error('중지됨');
      if (!frame || !frame.isConnected) throw new Error('숨김 화면을 다시 여는 중');

      try {
        const win = frame.contentWindow;
        if (win && win.document) {
          trace.path = win.location.pathname;

          if (trace.path.includes(plotId)) {
            const root = win.document.querySelector('[data-sentry-component="PlotProfile"]');
            trace.root = Boolean(root);

            let result = root ? readPlotProfile(win) : null;
            if (result && !result.partial) {
              // URL만 먼저 바뀌고 React 프로필 내용이 직전 플롯 값으로 잠깐 남는
              // 순간을 피한다. 같은 결과가 일정 시간 유지될 때만 확정한다.
              const signature = JSON.stringify([
                result.profileId || '',
                ...(result.characters || []),
                '|',
                ...(result.creators || [])
              ]);
              if (signature !== fullResultSignature) {
                fullResultSignature = signature;
                fullResultSince = Date.now();
              } else if (Date.now() - fullResultSince >= PROFILE_SETTLE_MS) {
                return result;
              }
            } else {
              fullResultSignature = '';
              fullResultSince = 0;
            }

            // 주소도 맞고 문서도 다 불렸는데 없으면 오래 기다릴 이유가 없다.
            // 실패 하나가 제한 시간을 다 쓰면 전체가 크게 느려진다.
            if (win.document.readyState === 'complete') {
              if (!settledAt) settledAt = Date.now();
              else if (Date.now() - settledAt > 2000) {
                // 제작자가 끝내 안 나오면 캐릭터명만이라도 챙긴다.
                if (result && result.partial) return result;
                if (Date.now() - settledAt > 3500) break;
              }
            }
          }
        }
      } catch (error) {
        if (error && error.name === 'SecurityError') throw new Error('숨김 화면 접근이 막혔습니다');
        throw error;
      }

      await sleep(100);
    }

    throw new Error(profileFailureReason(new Error('시간 초과'), trace, plotId));
  }

  async function profileWorker(queue, onResult, options = {}) {
    const onPressure = typeof options.onPressure === 'function' ? options.onPressure : () => {};
    const pauseMs = options.mobile ? 120 : 80;
    const recycleEvery = options.mobile ? 6 : PROFILE_FRAME_RECYCLE;
    const targetBudgetMs = options.mobile ? 22000 : 48000;
    let frame = null;
    let used = 0;

    const ensureFrame = () => {
      if (!frame || !frame.isConnected) frame = hiddenFrame();
      return frame;
    };

    // iframe을 만들었다 지우기를 반복하면 떼어낸 문서가 회수되지 않고 쌓인다.
    // 하나를 계속 쓰되, 다음 화면을 띄우기 전에 반드시 비워서
    // 무거운 문서가 두 개 동시에 살아 있지 않게 한다.
    const blankFrame = async (delayMs = 120) => {
      if (frame && frame.isConnected) {
        try {
          const win = frame.contentWindow;
          if (win) {
            const highest = win.setTimeout(() => {}, 0);
            for (let id = highest; id >= 0 && id > highest - 800; id--) {
              win.clearTimeout(id);
              win.clearInterval(id);
            }
          }
        } catch (_) {}
        try { frame.src = 'about:blank'; } catch (_) {}
        if (delayMs) await sleep(delayMs);
      }
    };

    const resetFrame = async (delayMs = 120) => {
      // 완전히 버려야 할 때만 요소까지 새로 만든다.
      await blankFrame(0);
      dropFrame(frame);
      frame = null;
      used = 0;
      if (delayMs) await sleep(delayMs);
    };

    const timeLeft = (deadline, cap) => {
      const left = deadline - Date.now();
      if (left <= 800) throw new Error('프로필 처리 시간 초과');
      return Math.max(800, Math.min(cap, left));
    };

    // 제작자명은 대화방에서 플롯 프로필 버튼을 눌러 들어가야 안정적으로 보인다.
    // 직접 /plots/.../profile 주소를 여는 우회 경로는 쓰지 않는다.
    const navigateRoom = async (roomId, deadline) => {
      await blankFrame();
      const active = ensureFrame();
      active.src = '/' + localeSegment() + '/rooms/' + roomId;
      armMediaGuard(active);

      const button = await readInFrame(active, win => {
        if (!win.location.pathname.includes(roomId)) return null;
        return win.document.querySelector(PROFILE_BUTTON);
      }, timeLeft(deadline, options.mobile ? 6500 : 10000));
      button.click();

      const profileId = await readInFrame(active, win => {
        if (!PROFILE_PATH.test(win.location.pathname)) return null;
        return plotProfileId(win.location.pathname) || null;
      }, timeLeft(deadline, options.mobile ? 6500 : 10000));

      return await readProfileIn(
        active,
        profileId,
        timeLeft(deadline, options.mobile ? 10000 : 18000)
      );
    };

    // 프로필 주소로 바로 가면 화면을 한 번만 불러도 된다.
    // 제작자가 안 잡히는 경우에만 방을 거치는 느린 경로로 넘어간다.
    const navigateProfile = async (plotId, deadline) => {
      await blankFrame();
      const active = ensureFrame();
      active.src = '/' + localeSegment() + '/plots/' + plotId + '/profile';
      armMediaGuard(active);
      // 직행은 빨리 뜨거나 안 뜨거나다. 오래 기다리면 느린 경로로 넘어가는 게 손해다.
      return await readProfileIn(active, plotId, timeLeft(deadline, options.mobile ? 4500 : 6000));
    };

    const collectOne = async (target, deadline) => {
      if (target.plotId) {
        try {
          const quick = await navigateProfile(target.plotId, deadline);
          if (quick && quick.creators && quick.creators.length) return quick;
          // 캐릭터만 얻었으면 제작자를 얻으러 방을 거쳐 본다.
          try {
            await resetFrame(0);
            return await navigateRoom(target.roomId, deadline);
          } catch (_) {
            if (quick) return quick;
            throw _;
          }
        } catch (error) {
          await resetFrame(0);
        }
      }
      return await navigateRoom(target.roomId, deadline);
    };

    try {
      for (;;) {
        const target = queue.next();
        if (!target) return;

        // 모바일은 메모리가 빠듯하므로 iframe을 조금 더 자주 갈아준다.
        // 평상시 속도는 3-worker 그대로 두고, 오래 붙잡힌 worker만 복구한다.
        if (used >= recycleEvery) {
          await resetFrame(180);
        }

        const deadline = Date.now() + targetBudgetMs;

        try {
          // 내부 대기가 어떤 이유로 풀리지 않아도 예산이 지나면 넘어간다.
          const result = await Promise.race([
            collectOne(target, deadline),
            (async () => {
              await sleep(targetBudgetMs + 1500);
              throw new Error('시간 초과 — 건너뜀');
            })()
          ]);
          onResult(target, result, null);
        } catch (error) {
          // 어떤 실패든 다음 타깃은 깨끗한 iframe에서 시작한다.
          await resetFrame();
          onResult(target, null, error);
        }

        // 결과를 얻었으면 더 들고 있을 이유가 없다. 즉시 비운다.
        await blankFrame(0);
        used++;

        // 메모리가 빠듯하면 화면을 버리고 회수될 틈을 준다.
        if (memoryPressure() > MEMORY_PAUSE_RATIO) {
          await resetFrame(0);
          onPressure();
          await sleep(1200);
        }

        await sleep(pauseMs);
      }
    } finally {
      dropFrame(frame);
    }
  }

  // 한 바퀴 돌았는데 남은 개수가 줄지 않으면 더 돌려도 똑같다.
  // 두 바퀴 연속 제자리면 새로고침을 멈추고 마무리한다.
  const PROFILE_STALL_LIMIT = 2;

  function newProfileRunId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  // 제자리걸음은 같은 회차 안에서만 센다.
  // 지난 회차가 남긴 숫자를 이어받으면, 새로 시작한 수집이
  // 첫 묶음만 하고 끝나 버린다.
  function profileStallCount(previousResume, remaining, runId) {
    if (!previousResume || !runId || previousResume.runId !== runId) return 0;
    const before = Number(previousResume.lastRemaining);
    if (!Number.isFinite(before) || remaining < before) return 0;
    return Number(previousResume.stalls || 0) + 1;
  }

  function remainingText(startedAt, completed, total) {
    if (completed < 3) return '';
    const perItem = (Date.now() - startedAt) / completed;
    const left = Math.round(perItem * (total - completed) / 1000);
    const speed = ' · ' + (perItem / 1000).toFixed(1) + '초/건';
    if (left < 60) return '약 ' + left + '초 남음' + speed;
    return '약 ' + Math.round(left / 60) + '분 남음' + speed;
  }

  async function collectProfilesForEmptyPlots(force = false, explicitTargets = null) {
    const hasExplicitTargets = Array.isArray(explicitTargets);
    const allTargets = hasExplicitTargets ? explicitTargets : profileCollectionTargets(false);
    if (!allTargets.length) {
      return {
        targets: 0, attempted: 0, done: 0, failed: 0,
        remaining: 0, limited: false, failures: [], remainingTargets: []
      };
    }

    const mobile = isMobileProfileDevice();
    const batchLimit = configuredBatch(mobile);
    const targets = allTargets.slice(0, batchLimit);
    const queuedRemainingTargets = allTargets.slice(targets.length);
    const startedAt = Date.now();
    const failures = [];
    let cursor = 0;
    let done = 0;
    let failed = 0;

    const queue = {
      next() {
        if (collectionAborted || currentSection() !== 'room') return null;
        return cursor < targets.length ? targets[cursor++] : null;
      }
    };

    const progressNote = completed => {
      const eta = remainingText(startedAt, completed, targets.length);
      const guard = BOOKMARKLET_MODE && !bookmarkletControllerReady()
        ? '메모리 정리 · 이번 ' + targets.length + '개'
        : '메모리 정리 · ' + targets.length + '개마다 자동 새로고침';
      return eta ? eta + ' · ' + guard : guard;
    };

    const onResult = (target, result, error) => {
      // 재검증 표시는 시도한 순간 내린다. 결과와 무관하다.
      // 성공했을 때만 내리면, 끝내 못 읽는 방이 영원히 대상으로 남아
      // 새로고침이 끝나지 않는다.
      const attemptedEntry = state.index[keyOf('room', target.roomId)];
      if (attemptedEntry && attemptedEntry.needsProfileRefresh) {
        delete attemptedEntry.needsProfileRefresh;
      }

      if (result) {
        applyProfileResult(target, result, { replaceNames: force || Boolean(target.replaceNames) });
        done++;
        // 열어보긴 했는데 여전히 대상으로 남는다면 다음 바퀴도 결과가 같다.
        // 세어두지 않으면 남은 개수가 줄지 않아 새로고침이 끝나지 않는다.
        if (entryNeedsProfile(state.index[keyOf('room', target.roomId)], false)) {
          notePlotProfileFailure(target);
        }
      } else {
        failed++;
        // 그림 차단 때문에 화면이 안 그려지는 제타 화면일 수도 있다.
        // 앞부분이 전부 실패하면 차단을 스스로 풀고 그대로 이어간다.
        if (blockFrameMedia && done === 0 && failed >= 8) {
          blockFrameMedia = false;
          try { console.warn('[zrm] 그림 차단을 껐습니다 — 앞 ' + failed + '개가 모두 실패했습니다.'); } catch (_) {}
        }
        const reason = normalizeText((error && error.message) || error) || '알 수 없는 오류';
        const record = describeFailure(target, reason);
        failures.push(record);
        notePlotProfileFailure(target);
        try { console.warn('[zrm] 이름 수집 실패 ·', record.name, '·', record.url, '·', reason); } catch (_) {}
      }

      const completed = done + failed;
      roomCollectionProgress = {
        running: true,
        count: roomCollectionCount(),
        roomTotal: roomCollectionCount(),
        phase: force ? '다시 이름 수집' : '이름 수집',
        current: completed,
        total: allTargets.length,
        note: progressNote(completed)
      };
      renderCollectionTools();

      if (completed % 5 === 0) saveStateNow();
    };

    roomCollectionProgress = {
      running: true,
      count: roomCollectionCount(),
      roomTotal: roomCollectionCount(),
      phase: force ? '다시 이름 수집' : '이름 수집',
      current: 0,
      total: allTargets.length,
      note: progressNote(0)
    };
    renderCollectionTools();

    const workerLimit = configuredWorkers(mobile);
    let memoryPauses = 0;
    suspendPassiveNativeCapture = true;
    try {
      const workers = [];
      for (let i = 0; i < Math.min(workerLimit, targets.length); i++) {
        workers.push(profileWorker(queue, onResult, {
          force,
          mobile,
          onPressure: () => {
            memoryPauses++;
            roomCollectionProgress = { ...roomCollectionProgress, note: '메모리 정리 중…' };
            renderCollectionTools();
          }
        }));
      }
      await Promise.all(workers);
    } finally {
      suspendPassiveNativeCapture = false;
      saveStateNow();
    }

    scheduleRefresh();
    lastProfileFailures = failures;

    const remainingTargets = hasExplicitTargets
      ? queuedRemainingTargets
      : (collectionAborted ? queuedRemainingTargets : profileCollectionTargets(false));
    const remainingAfter = remainingTargets.length;

    return {
      targets: allTargets.length,
      attempted: done + failed,
      done,
      failed,
      remaining: remainingAfter,
      limited: remainingAfter > 0 && !collectionAborted,
      failures,
      memoryPauses,
      remainingTargets: hasExplicitTargets ? remainingTargets : []
    };
  }

  async function collectAllRoomsByScrolling(options = {}) {
    const force = Boolean(options && options.force);
    if (currentSection() !== 'room') {
      alert('대화방 목록에서 실행해 주세요.');
      return false;
    }
    if (roomCollectionPromise) return roomCollectionPromise;

    roomCollectionPromise = (async () => {
      collectionAborted = false;
      harvestedItems.clear();
      void holdScreenAwake();

      // 일반 수집은 새 방/연결 변경/이름 누락만 열고,
      // 다시 전체 수집은 기존 데이터를 지우지 않은 채 모든 고유 플롯을 재검증한다.
      forceReconcileSeenRoomKeys = force ? new Set() : null;
      roomCollectionProgress = {
        running: true,
        count: roomCollectionCount(),
        phase: force ? '다시 목록 수집' : '목록 수집',
        force
      };
      renderCollectionTools();

      const mobileList = isMobileProfileDevice();
      let host = roomCollectionScrollHost();
      const originalTop = scrollMetrics(host).top;
      let listCompleted = false;
      let checkpointAt = Date.now();
      let checkpointCount = roomCollectionCount();

      // 수집기 자신의 UI MutationObserver가 같은 항목을 다시 무겁게 분석하지 않게 한다.
      suspendObserverRefresh = true;
      observer?.disconnect();

      if (originalTop > 1) {
        const moved = await moveAndWaitForCollection(
          'room', roomCollectionScrollHost, host, () => setScrollTop(host, 0)
        );
        host = moved.host;
      } else {
        setScrollTop(host, 0);
      }
      harvestRoomDocument(document);

      for (let round = 0; round < 2400; round++) {
        if (collectionAborted) break;

        // 제타가 가상 목록의 scroll host를 갈아끼우면 매 이동 전에 새 host로 이어간다.
        const liveHost = roomCollectionScrollHost();
        if (liveHost && liveHost !== host) {
          const oldTop = scrollMetrics(host).top;
          host = liveHost;
          const live = scrollMetrics(host);
          setScrollTop(host, Math.min(live.height, Math.max(live.top, oldTop)));
        }

        harvestRoomDocument(document);
        const before = collectionSnapshot('room', host);
        const count = roomCollectionCount();
        roomCollectionProgress.count = count;
        if (!mobileList || round % 4 === 0 || count !== checkpointCount) renderCollectionTools();

        if (count - checkpointCount >= 20 || Date.now() - checkpointAt >= 2000) {
          saveStateNow();
          checkpointAt = Date.now();
          checkpointCount = count;
        }

        const nearBottom = before.top + before.client >= before.height - Math.max(80, before.client * 0.15);
        if (nearBottom) {
          const waited = await moveAndWaitForCollection(
            'room', roomCollectionScrollHost, host,
            () => setScrollTop(host, before.height),
            COLLECTION_BOTTOM_TIMEOUT_MS
          );
          if (collectionAborted) break;
          host = waited.host;
          harvestRoomDocument(document);
          const after = collectionSnapshot('room', host);
          const stillBottom = after.top + after.client >= after.height - Math.max(80, after.client * 0.15);
          if (!waited.changed && stillBottom && sameCollectionWindow(before, after)) {
            listCompleted = true;
            break;
          }
        } else {
          const roomStepRatio = mobileList ? MOBILE_ROOM_COLLECTION_STEP_RATIO : COLLECTION_STEP_RATIO;
          const step = Math.max(320, Math.floor(before.client * roomStepRatio));
          const targetTop = Math.min(before.height, before.top + step);
          const waited = await moveAndWaitForCollection(
            'room', roomCollectionScrollHost, host,
            () => setScrollTop(host, targetTop)
          );
          if (collectionAborted) break;
          host = waited.host;
          harvestRoomDocument(document);
        }
      }

      harvestRoomDocument(document);
      saveStateNow();
      if (!collectionAborted && listCompleted) {
        localStorage.setItem(ROOM_COLLECTION_STAMP_KEY, String(Date.now()));
      }
      setScrollTop(host, originalTop);

      const seenRoomKeys = force && forceReconcileSeenRoomKeys
        ? new Set(forceReconcileSeenRoomKeys)
        : null;
      forceReconcileSeenRoomKeys = null;

      // 다시 전체 수집은 이번에 실제로 확인한 모든 고유 플롯을 대화방 경유로 재검증한다.
      const forceTargets = force ? profileCollectionTargets(true, seenRoomKeys) : null;
      const profiles = collectionAborted
        ? {
            targets: 0, attempted: 0, done: 0, failed: 0,
            remaining: 0, limited: false, failures: [], remainingTargets: []
          }
        : await collectProfilesForEmptyPlots(force, forceTargets);

      const total = roomCollectionCount();

      // 버튼으로 시작한 수집은 언제나 새 회차다.
      // 한 바퀴 돌았는데 하나도 처리하지 못했다면 다시 새로고침해도 같다.
      if (profiles.limited && !collectionAborted && profiles.attempted <= 0) {
        clearProfileResume();
      } else if (profiles.limited && !collectionAborted) {
        writeProfileResume({
          active: true,
          runId: newProfileRunId(),
          force,
          attempted: profiles.attempted,
          done: profiles.done,
          failed: profiles.failed,
          startedAt: Date.now(),
          stalls: 0,
          lastRemaining: profiles.remaining,
          targets: force ? profiles.remainingTargets : undefined
        });
        saveStateNow();

        roomCollectionProgress = {
          running: true,
          count: total,
          roomTotal: total,
          phase: '이름 수집',
          current: profiles.attempted,
          total: profiles.attempted + profiles.remaining,
          note: BOOKMARKLET_MODE && !bookmarkletControllerReady()
            ? '저장 완료 · 새로고침 후 북마클릿을 다시 실행하세요'
            : '메모리 정리 후 자동으로 계속합니다'
        };
        renderCollectionTools();

        if (BOOKMARKLET_MODE && !bookmarkletControllerReady()) {
          const turnOn = await requestBookmarkletAutoResume();
          if (turnOn) {
            // 기록은 위에서 이미 남겼다. 여기서 다시 쓰면 회차 번호가 지워진다.
            await sleep(250);
            location.reload();
          }
          return true;
        }

        await sleep(500);
        if (collectionAborted) {
          clearProfileResume();
          closeBookmarkletController();
          return true;
        }
        location.reload();
        return true;
      }

      clearProfileResume();
      roomCollectionProgress = { running: false, count: total };
      renderCollectionTools();
      const coverage = metadataCoverage('room');
      const aliases = Object.values(state.index).filter(entry =>
        entry && entry.type === 'room' && normalizeText(entry.alias)
      ).length;
      const resultTitle = collectionAborted
        ? (force ? '다시 전체 수집 중지됨' : '대화방 수집 중지됨')
        : (!listCompleted
            ? (force ? '다시 전체 수집 일부 완료' : '대화방 목록 끝 확인 실패')
            : (force ? '다시 전체 수집 완료' : '대화방 전체 수집 완료'));
      const shownFailures = profiles.failures.slice(0, 10);
      alert(
        resultTitle + ' · 저장된 방 ' + total + '개' +
        (force && seenRoomKeys ? ' · 이번 확인 ' + seenRoomKeys.size + '개' : '') +
        (!listCompleted && !collectionAborted ? ' (목록 끝 확인 실패)' : '') +
        '\n별명 ' + aliases + '개 · 캐릭터명 ' + coverage.character + '개 · 제작자명 ' + coverage.creator + '개' +
        '\n이름 수집: 이번 ' + profiles.attempted + '개 처리 · 성공 ' + profiles.done + '개' +
        (profiles.failed ? ' · 실패 ' + profiles.failed + '개' : '') +
        (profiles.memoryPauses ? ' · 메모리 정리 ' + profiles.memoryPauses + '회' : '') +
        (profiles.remaining ? '\n남은 플롯 약 ' + profiles.remaining + '개' : '') +
        (profiles.failed
          ? '\n\n실패 사유\n' + failureSummary(profiles.failures).map(line => '· ' + line).join('\n') +
            '\n\n실패한 대화방 (최대 10개 표시)\n' + shownFailures
              .map(item => '· ' + item.name + '\n  ' + item.url)
              .join('\n') +
            (profiles.failures.length > shownFailures.length
              ? '\n· 외 ' + (profiles.failures.length - shownFailures.length) + '개'
              : '')
          : '')
      );
      closeBookmarkletController();
      return true;
    })().finally(() => {
      forceReconcileSeenRoomKeys = null;
      roomCollectionPromise = null;
      roomCollectionProgress.running = false;
      suspendObserverRefresh = false;
      void releaseScreenAwake();
      renderCollectionTools();
      scheduleRefresh();
    });

    return roomCollectionPromise;
  }

  async function resumeProfileCollectionIfNeeded() {
    const resume = readProfileResume();
    if (!resume || !resume.active || currentSection() !== 'room' || roomCollectionPromise) return false;

    roomCollectionPromise = (async () => {
      collectionAborted = false;
      void holdScreenAwake();
      await sleep(700);

      const forceResume = Boolean(resume.force);
      const nameOnlyResume = resume.mode === 'names';
      const resumeTargets = forceResume
        ? (Array.isArray(resume.targets) ? resume.targets : profileCollectionTargets(true))
        : null;
      const profiles = await collectProfilesForEmptyPlots(forceResume, resumeTargets);
      const stalls = profileStallCount(resume, profiles.remaining, resume.runId);
      const next = {
        ...resume,
        active: true,
        attempted: Number(resume.attempted || 0) + profiles.attempted,
        done: Number(resume.done || 0) + profiles.done,
        failed: Number(resume.failed || 0) + profiles.failed,
        stalls,
        lastRemaining: profiles.remaining,
        targets: forceResume ? profiles.remainingTargets : undefined
      };

      if (profiles.limited && !collectionAborted &&
        (profiles.attempted <= 0 || stalls >= PROFILE_STALL_LIMIT)) {
        clearProfileResume();
      } else if (profiles.limited && !collectionAborted) {
        writeProfileResume(next);
        saveStateNow();
        roomCollectionProgress = {
          running: true,
          count: roomCollectionCount(),
          roomTotal: roomCollectionCount(),
          phase: '이름 수집',
          current: next.attempted,
          total: next.attempted + profiles.remaining,
          note: BOOKMARKLET_MODE && !bookmarkletControllerReady()
            ? '저장 완료 · 새로고침 후 북마클릿을 다시 실행하세요'
            : '메모리 정리 후 자동으로 계속합니다'
        };
        renderCollectionTools();

        if (BOOKMARKLET_MODE && !bookmarkletControllerReady()) {
          const turnOn = await requestBookmarkletAutoResume();
          if (turnOn) {
            writeProfileResume(next);
            saveStateNow();
            await sleep(250);
            location.reload();
          }
          return true;
        }

        await sleep(500);
        if (collectionAborted) {
          clearProfileResume();
          closeBookmarkletController();
          return true;
        }
        location.reload();
        return true;
      }

      clearProfileResume();
      const total = roomCollectionCount();
      const coverage = metadataCoverage('room');
      const aliases = Object.values(state.index).filter(entry =>
        entry && entry.type === 'room' && normalizeText(entry.alias)
      ).length;
      roomCollectionProgress = { running: false, count: total };
      renderCollectionTools();

      alert(
        (collectionAborted
          ? (nameOnlyResume ? '다시 이름 수집 중지됨' : (forceResume ? '다시 전체 수집 중지됨' : '대화방 수집 중지됨'))
          : (nameOnlyResume ? '다시 이름 수집 완료' : (forceResume ? '다시 전체 수집 완료' : '대화방 전체 수집 완료'))) +
        ' · 저장된 방 ' + total + '개' +
        '\n별명 ' + aliases + '개 · 캐릭터명 ' + coverage.character + '개 · 제작자명 ' + coverage.creator + '개' +
        '\n이름 수집: 총 ' + next.attempted + '개 처리 · 성공 ' + next.done + '개' +
        (next.failed ? ' · 실패 ' + next.failed + '개' : '') +
        (profiles.remaining ? '\n남은 플롯 약 ' + profiles.remaining + '개 (더 읽히지 않아 접어둠)' : '')
      );
      closeBookmarkletController();
      return true;
    })().finally(() => {
      roomCollectionPromise = null;
      roomCollectionProgress.running = false;
      void releaseScreenAwake();
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

  const COLLECTION_STEP_RATIO = 0.85;
  const MOBILE_ROOM_COLLECTION_STEP_RATIO = 0.85;
  const PLOT_COLLECTION_STEP_RATIO = 0.85;
  const PLOT_COLLECTION_SETTLE_MS = 80;
  const COLLECTION_CHANGE_TIMEOUT_MS = 380;
  const COLLECTION_BOTTOM_TIMEOUT_MS = 1300;

  // 무거운 React 분석 없이 현재 렌더링된 목록 창의 정체만 빠르게 읽는다.
  // 새 창이 그려졌는지 판단하는 용도라 ID가 없는 플롯은 href/텍스트를 대체 토큰으로 쓴다.
  function collectionWindowTokens(kind) {
    const items = kind === 'room'
      ? roomItemsFromDocument(document)
      : Array.from(document.querySelectorAll('[data-sentry-component="CreatorCenterMyPlotListItem"]'));
    const out = [];
    const seen = new Set();

    for (const item of items) {
      const link = item.querySelector(kind === 'room' ? 'a[href*="/rooms/"]' : 'a[href*="/plots/"]');
      const token = extractId(link && link.href, kind)
        || normalizeText(item.getAttribute('data-plot-id'))
        || normalizeText(link && link.getAttribute('href'))
        || normalizeText(item.textContent).slice(0, 120);
      if (!token || seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
    return out;
  }

  function collectionSnapshot(kind, host) {
    const metrics = scrollMetrics(host);
    const tokens = collectionWindowTokens(kind);
    return {
      host,
      ...metrics,
      tokens,
      last: tokens[tokens.length - 1] || '',
      signature: tokens.join('\u001f')
    };
  }

  function sameCollectionWindow(a, b) {
    return Boolean(a && b
      && Math.abs(a.height - b.height) <= 2
      && a.last === b.last
      && a.signature === b.signature);
  }

  // observer를 먼저 건 뒤 스크롤한다. 빠른 기기는 DOM 창이 바뀌는 즉시 반환하고,
  // 변화 신호를 놓친 경우에만 짧은 timeout을 fallback으로 사용한다.
  function moveAndWaitForCollection(kind, hostGetter, host, move, timeoutMs = COLLECTION_CHANGE_TIMEOUT_MS) {
    const before = collectionSnapshot(kind, host);

    return new Promise(resolve => {
      let done = false;
      let raf = 0;
      let resizeObserver = null;

      const finish = changed => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cancelAnimationFrame(raf);
        mutationObserver.disconnect();
        resizeObserver?.disconnect();
        const liveHost = hostGetter() || host;
        resolve({ changed, host: liveHost, snapshot: collectionSnapshot(kind, liveHost) });
      };

      const check = () => {
        if (done) return;
        const liveHost = hostGetter() || host;
        const after = collectionSnapshot(kind, liveHost);
        if (liveHost !== host || !sameCollectionWindow(before, after)) finish(true);
      };

      const scheduleCheck = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(check);
      };

      const mutationObserver = new MutationObserver(scheduleCheck);
      mutationObserver.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'data-plot-id', 'data-sentry-component']
      });

      if (window.ResizeObserver) {
        resizeObserver = new ResizeObserver(scheduleCheck);
        try { resizeObserver.observe(host); } catch (_) {}
        try {
          const content = host.querySelector?.('[data-sentry-component="RoomList"], :scope > div');
          if (content && content !== host) resizeObserver.observe(content);
        } catch (_) {}
      }

      const timer = setTimeout(() => finish(false), timeoutMs);
      try {
        move();
        requestAnimationFrame(() => requestAnimationFrame(check));
      } catch (_) {
        finish(false);
      }
    });
  }

  async function collectAllPlotsByScrolling() {
    const section = currentSection();
    if (section !== 'plot' && section !== 'plot-search') {
      alert('제작자센터의 플롯 목록에서 실행해 주세요.');
      return false;
    }
    if (plotCollectionPromise) return plotCollectionPromise;

    plotCollectionPromise = (async () => {
      collectionAborted = false;
      harvestedItems.clear();
      void holdScreenAwake();
      suspendObserverRefresh = true;
      observer?.disconnect();
      plotCollectionProgress = { running: true, count: plotCollectionCount(), phase: '플롯 목록 수집' };
      renderCollectionTools();

      let host = plotCollectionScrollHost();
      const originalTop = scrollMetrics(host).top;
      let listCompleted = false;
      let checkpointAt = Date.now();
      let checkpointCount = plotCollectionCount();

      // 처음부터 훑어야 가상 목록에서 빠지는 항목이 없다.
      if (originalTop > 1) {
        const moved = await moveAndWaitForCollection(
          'plot', plotCollectionScrollHost, host, () => setScrollTop(host, 0)
        );
        host = moved.host;
      } else {
        setScrollTop(host, 0);
      }
      if (!collectionAborted) collectRenderedPlots();

      for (let round = 0; round < 2400; round++) {
        if (collectionAborted) break;

        const liveHost = plotCollectionScrollHost();
        if (liveHost && liveHost !== host) {
          const oldTop = scrollMetrics(host).top;
          host = liveHost;
          const live = scrollMetrics(host);
          setScrollTop(host, Math.min(live.height, Math.max(live.top, oldTop)));
        }

        collectRenderedPlots();
        const before = collectionSnapshot('plot', host);
        const count = plotCollectionCount();

        plotCollectionProgress.count = count;
        renderCollectionTools();

        if (count - checkpointCount >= 20 || Date.now() - checkpointAt >= 2000) {
          saveStateNow();
          checkpointAt = Date.now();
          checkpointCount = count;
        }

        const nearBottom = before.top + before.client >= before.height - Math.max(80, before.client * 0.15);
        if (nearBottom) {
          const waited = await moveAndWaitForCollection(
            'plot', plotCollectionScrollHost, host,
            () => setScrollTop(host, before.height),
            COLLECTION_BOTTOM_TIMEOUT_MS
          );
          if (collectionAborted) break;
          host = waited.host;
          collectRenderedPlots();

          const after = collectionSnapshot('plot', host);
          const stillBottom = after.top + after.client >= after.height - Math.max(80, after.client * 0.15);
          if (!waited.changed && stillBottom && sameCollectionWindow(before, after)) {
            listCompleted = true;
            break;
          }
        } else {
          const step = Math.max(280, Math.floor(before.client * PLOT_COLLECTION_STEP_RATIO));
          const targetTop = Math.min(before.height, before.top + step);
          const waited = await moveAndWaitForCollection(
            'plot', plotCollectionScrollHost, host,
            () => setScrollTop(host, targetTop)
          );
          if (collectionAborted) break;
          host = waited.host;
          if (waited.changed) await sleep(PLOT_COLLECTION_SETTLE_MS);
          collectRenderedPlots();
        }
      }

      if (!collectionAborted) collectRenderedPlots();
      saveStateNow();
      if (!collectionAborted && listCompleted) {
        localStorage.setItem(PLOT_COLLECTION_STAMP_KEY, String(Date.now()));
      }

      // 사용자가 보던 위치로 돌아간다.
      setScrollTop(host, originalTop);

      const total = plotCollectionCount();
      plotCollectionProgress = { running: false, count: total };
      renderCollectionTools();
      const coverage = metadataCoverage('plot');
      const aliases = Object.values(state.index).filter(entry =>
        entry && entry.type === 'plot' && normalizeText(entry.alias)
      ).length;
      alert(
        (collectionAborted ? '전체 수집 중지됨' : (listCompleted ? '전체 수집 완료' : '목록 끝 확인 실패')) +
        ' · 저장된 플롯 ' + total + '개' +
        '\n별명 ' + aliases + '개 · 캐릭터명 ' + coverage.character + '개 · 제작자명 ' + coverage.creator + '개'
      );
      return true;
    })().finally(() => {
      plotCollectionPromise = null;
      plotCollectionProgress.running = false;
      suspendObserverRefresh = false;
      void releaseScreenAwake();
      renderCollectionTools();
      scheduleRefresh();
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
          (isRoom ? '<button type="button" data-zrm-action="force-collect">다시 전체 수집</button>' : '') +
          '<button type="button" data-zrm-action="export">내보내기</button>' +
          '<button type="button" data-zrm-action="import">불러오기</button>' +
          '<button type="button" data-zrm-action="delete">데이터 삭제</button>' +
        '</div>' +
      '</div>';

    modal.querySelector('.zrm-collection-count').textContent =
      (isRoom ? '저장된 대화방 ' : '저장된 플롯 ') + countValue + '개' +
      (progress.running && progress.phase ? ' · ' + progress.phase : '');

    const collect = modal.querySelector('[data-zrm-action="collect"]');
    const forceCollect = modal.querySelector('[data-zrm-action="force-collect"]');
    const deleteButton = modal.querySelector('[data-zrm-action="delete"]');
    collect.disabled = false;
    collect.textContent = progress.running ? '중지' : (isRoom ? '일반 전체 수집' : '전체 수집');
    if (forceCollect) forceCollect.disabled = progress.running;
    if (deleteButton) deleteButton.disabled = progress.running;

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
      if (isRoom) collectAllRoomsByScrolling({ force: false });
      else collectAllPlotsByScrolling();
    });
    forceCollect?.addEventListener('click', () => {
      closeCollectionPopup();
      if (progress.running) return;
      collectAllRoomsByScrolling({ force: true });
    });
    modal.querySelector('[data-zrm-action="export"]').addEventListener('click', () => {
      closeCollectionPopup();
      exportRoomManagerData();
    });
    modal.querySelector('[data-zrm-action="import"]').addEventListener('click', () => {
      closeCollectionPopup();
      importRoomManagerData();
    });
    deleteButton?.addEventListener('click', () => {
      closeCollectionPopup();
      deleteAllRoomManagerData();
    });

    document.body.appendChild(modal);
  }

  // 수집은 이 화면에서 돈다. 닫으면 멈추므로 진행 중에는 화면 가운데에 띄운다.
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
        '<div class="zrm-banner-card" role="status" aria-live="polite">' +
          '<div class="zrm-banner-title"></div>' +
          '<div class="zrm-banner-count"></div>' +
          '<div class="zrm-banner-note">이 화면을 닫거나 다른 곳으로 이동하면 멈춰요.<br>중간 저장되며 다시 실행해도 저장된 데이터는 유지됩니다.</div>' +
          '<button type="button" class="zrm-banner-stop">중지</button>' +
        '</div>';
      banner.querySelector('.zrm-banner-stop').addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        abortCollection();
        banner.querySelector('.zrm-banner-title').textContent = '중지하는 중…';
      });
      document.body.appendChild(banner);
    }

    if (banner.parentElement !== document.body) document.body.appendChild(banner);

    if (!collectionAborted) {
      banner.querySelector('.zrm-banner-title').textContent = (progress.phase || '수집') + ' 중';
    }
    banner.querySelector('.zrm-banner-count').textContent = progress.total
      ? (progress.roomTotal
          ? '방 ' + progress.roomTotal + '개 · 플롯 ' + progress.current + ' / ' + progress.total
          : progress.current + ' / ' + progress.total)
      : (progress.count || 0) + '개';

    const note = banner.querySelector('.zrm-banner-note');
    let eta = banner.querySelector('.zrm-banner-eta');
    if (progress.note) {
      if (!eta) {
        eta = document.createElement('div');
        eta.className = 'zrm-banner-eta';
        note.before(eta);
      }
      eta.textContent = progress.note;
    } else if (eta) {
      eta.remove();
    }

    let warn = banner.querySelector('.zrm-banner-warn');
    if (wakeStatus) {
      if (!warn) {
        warn = document.createElement('div');
        warn.className = 'zrm-banner-warn';
        banner.querySelector('.zrm-banner-note').after(warn);
      }
      warn.textContent = wakeStatus;
    } else if (warn) {
      warn.remove();
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
        inset: 0;
        z-index: 2147483645;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(0,0,0,.45);
        box-sizing: border-box;
      }
      #${COLLECTION_BANNER_ID} .zrm-banner-card {
        width: min(300px, 100%);
        padding: 22px 20px 18px;
        border-radius: 16px;
        background: #fff;
        color: #1b1b1f;
        text-align: center;
        font: 500 12px/1.5 system-ui, -apple-system, sans-serif;
        box-shadow: 0 20px 60px rgba(0,0,0,.4);
        box-sizing: border-box;
      }
      #${COLLECTION_BANNER_ID} .zrm-banner-title { font-size: 13px; font-weight: 700; }
      #${COLLECTION_BANNER_ID} .zrm-banner-count {
        margin: 10px 0 12px;
        font-size: 20px;
        font-weight: 800;
        letter-spacing: -.02em;
        color: #6d52ff;
      }
      #${COLLECTION_BANNER_ID} .zrm-banner-eta {
        margin: -6px 0 12px;
        color: #45454e;
        font-size: 11px;
        font-weight: 600;
      }
      #${COLLECTION_BANNER_ID} .zrm-banner-note { color: #6b6b74; font-size: 10px; }
      #${COLLECTION_BANNER_ID} .zrm-banner-warn {
        margin-top: 8px;
        padding: 7px 9px;
        border-radius: 8px;
        background: #fff1f1;
        color: #b4232a;
        font-size: 10px;
        line-height: 1.45;
      }
      #${COLLECTION_BANNER_ID} .zrm-banner-stop {
        width: 100%;
        height: 40px;
        margin-top: 16px;
        border: 0;
        border-radius: 10px;
        background: #f0f0f3;
        color: #45454e;
        font: 700 12px/1 system-ui, sans-serif;
        cursor: pointer;
      }
      #${COLLECTION_BANNER_ID} .zrm-banner-stop:hover { background: #e6e6ea; }
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
        font-size: 14px;
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
        font-size: 20px;
        line-height: 1;
      }
      #${COLLECTION_MODAL_ID} .zrm-collection-count {
        padding: 0 16px 12px;
        color: rgba(255,255,255,.5);
        font-size: 11px;
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
        font-size: 12px;
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
      #${MODAL_ID} h3 { margin: 0 0 6px; font-size: 15px; }
      #${MODAL_ID} p { margin: 0 0 13px; color: rgba(255,255,255,.55); font-size: 11px; line-height: 1.5; }
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
      @media (max-width: 600px) {
        #${COLLECTION_BANNER_ID} { padding: 14px; }
        #${COLLECTION_BANNER_ID} .zrm-banner-card {
          width: min(270px, 100%);
          padding: 18px 16px 15px;
          font-size: 11px;
        }
        #${COLLECTION_BANNER_ID} .zrm-banner-title { font-size: 12px; }
        #${COLLECTION_BANNER_ID} .zrm-banner-count {
          margin: 8px 0 10px;
          font-size: 18px;
        }
        #${COLLECTION_BANNER_ID} .zrm-banner-eta { font-size: 10px; }
        #${COLLECTION_BANNER_ID} .zrm-banner-note,
        #${COLLECTION_BANNER_ID} .zrm-banner-warn { font-size: 9px; }
        #${COLLECTION_BANNER_ID} .zrm-banner-stop {
          height: 36px;
          margin-top: 13px;
          font-size: 11px;
        }

        #${COLLECTION_MODAL_ID} { padding: 14px; }
        #${COLLECTION_MODAL_ID} .zrm-collection-dialog { width: min(300px, 100%); }
        #${COLLECTION_MODAL_ID} .zrm-collection-head { padding: 13px 14px 8px; }
        #${COLLECTION_MODAL_ID} .zrm-collection-title { font-size: 14px; }
        #${COLLECTION_MODAL_ID} .zrm-collection-close {
          width: 28px;
          height: 28px;
          font-size: 19px;
        }
        #${COLLECTION_MODAL_ID} .zrm-collection-count {
          padding: 0 14px 10px;
          font-size: 10px;
        }
        #${COLLECTION_MODAL_ID} .zrm-collection-actions {
          gap: 6px;
          padding: 0 14px 14px;
        }
        #${COLLECTION_MODAL_ID} .zrm-collection-actions button {
          height: 38px;
          font-size: 11px;
        }

        #${MODAL_ID} .zrm-dialog { width: min(320px, 100%); }
        #${MODAL_ID} .zrm-dialog-body { padding: 15px; }
        #${MODAL_ID} h3 { font-size: 15px; }
        #${MODAL_ID} p { font-size: 10px; }
        #${MODAL_ID} input { height: 38px; font-size: 12px; }
        #${MODAL_ID} .zrm-actions { padding: 0 15px 15px; }
        #${MODAL_ID} button { height: 36px; font-size: 11px; }
      }
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

  // 이번 세션에서 무거운 탐색을 마친 항목. 키 → 그때의 제목.
  // 스크롤을 내리면 같은 방이 몇 번이고 다시 화면에 들어오는데, 그때마다
  // 항목당 수천 노드를 재탐색하는 것이 첫 목록 수집이 느린 가장 큰 이유였다.
  const harvestedItems = new Map();
  // 무거운 분석이 실제로 돌았는지 세어, 바뀐 게 없으면 저장을 건너뛴다.
  let heavyParses = 0;
  let savedHeavyParses = 0;

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
    const previous = { ...(peekEntry(key) || {}) };
    const alias = normalizeText(state.aliases[key] || previous.alias);
    if (alias && state.aliases[key] !== alias) state.aliases[key] = alias;
    // 제타가 실제로 그려준 방이면 사라진 방이 아니다.
    delete previous.missingSince;

    // 각 수집 세션에서 방 하나당 한 번만 plot 연결을 얕게 확인한다.
    // 일반 전체 수집도 기존 방의 plot 연결이 바뀌었으면 정밀 분석/이름 재검증 대상으로 올린다.
    let quickPlot = null;
    let plotConnectionChanged = false;
    if (type === 'room' && harvestedItems.get(key) !== original) {
      quickPlot = reactRoomPlotMeta(item);
      const quickPlotId = normalizeText(quickPlot && (quickPlot.id || quickPlot.plotId));
      const quickOriginatedId = normalizeText(quickPlot && (quickPlot.originatedId || quickPlot.originalId));
      const previousPlotId = normalizeText(previous.plotId);
      const previousOriginatedId = normalizeText(previous.originatedId);

      plotConnectionChanged = Boolean(
        previous.type === 'room' && (
          (quickPlotId && quickPlotId !== previousPlotId) ||
          (quickOriginatedId && quickOriginatedId !== previousOriginatedId)
        )
      );
    }

    // 이번 세션에서 이미 훑은 항목은 즉시 통과한다.
    if (harvestedItems.get(key) === original) {
      previous.alias = alias;
      if (link && link.href) previous.href = link.href;
      if (image && normalizeText(previous.image) !== normalizeText(image)) previous.image = image;
      return {
        key, type, id, item, link, titleEl, original, alias
      };
    }

    // 이미 이름까지 수집됐고 plot 연결도 그대로면 무거운 React 전체 분석을 생략한다.
    if (previous.type === type
      && normalizeText(previous.original) === original
      && uniqueTexts(previous.characterNames).length
      && uniqueTexts(previous.creatorNames).length
      && !plotConnectionChanged) {
      harvestedItems.set(key, original);
      previous.alias = alias;
      if (link && link.href) previous.href = link.href;
      if (image && normalizeText(previous.image) !== normalizeText(image)) previous.image = image;
      return {
        key, type, id, item, link, titleEl, original, alias
      };
    }

    // 카드에 텍스트로 안 보여도 React props 안의 plot 데이터에서 이름을 보강한다.
    heavyParses++;
    harvestReactPlotData(item);
    harvestedItems.set(key, original);
    const searchMeta = collectSearchMeta(item, titleEl);
    // 플롯 목록 항목은 API 보강 대상이 아니라 화면 데이터가 유일한 출처다.
    const ownEntity = reactEntityForId(item, id);
    // 방 항목의 React 데이터는 조상 쪽에 room = {id, plot, ...} 형태로 있다.
    // reactEntityForId가 돌려주는 건 room 자체이므로 plot을 꺼내 써야 한다.
    // 그대로 쓰면 plotId 자리에 방 ID가 들어가 플롯 연결이 전부 어긋난다.
    const ownPlot = ownEntity && typeof ownEntity.plot === 'object' ? ownEntity.plot : null;
    const roomPlot = type === 'room' ? (quickPlot || reactRoomPlotMeta(item) || ownPlot) : null;
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
      : peekMeta(roomCanonicalId);

    const record = {
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

    // 저장본을 아직 안 읽었으면 '연결이 바뀌었다'고 단정할 수 없다.
    if (type === 'room' && plotConnectionChanged && dataLoaded) {
      record.needsProfileRefresh = true;
    }
    putEntry(key, record);

    return {
      key, type, id, item, link, titleEl, original, alias
    };
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
    const indexed = peekEntry(record.key) || {};
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
    putEntry(record.key, next);

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
    const previous = peekEntry(key) || {};

    putEntry(key, {
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
    });

    // 저장본을 안 읽었으면 퍼뜨릴 곳도 없다. 읽을 때 한꺼번에 퍼뜨린다.
    if (meta && dataLoaded) mergeMetaIntoIndex(meta);
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
    // 검색을 시작하려는 순간 읽어 둔다. 첫 글자에서 멈칫하지 않게.
    input.addEventListener('focus', ensureDataLoaded);
    input.addEventListener('pointerdown', ensureDataLoaded);
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
    if (heavyParses !== savedHeavyParses) {
      savedHeavyParses = heavyParses;
      saveState();
    }

    if (section === 'room') {
      bindNativeRoomSearch();
      renderNativeAliasResults(nativeRoomQuery());
    } else if (section === 'plot-search') {
      bindNativePlotSearch();
      renderNativePlotAliasResults(nativePlotSearchInput()?.value || '');
    }
    observer?.observe(document.documentElement, { childList: true, subtree: true });
  }

  // 목록을 스크롤하면 제타가 매 프레임 DOM을 바꾼다. 그때마다 전체 갱신을
  // 돌리면 스크롤이 끊긴다. 최소 간격을 두고 마지막 요청만 처리한다.
  const REFRESH_MIN_GAP = 200;
  let refreshTimer = null;
  let lastRefreshAt = 0;

  function scheduleRefresh() {
    if (suspendObserverRefresh) return;
    if (refreshTimer) return;

    const wait = Math.max(0, REFRESH_MIN_GAP - (Date.now() - lastRefreshAt));
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      lastRefreshAt = Date.now();
      refresh();
    }, wait);
  }

  function start() {
    installPassiveNativeDataCapture();
    injectStyle();

    window.addEventListener('pagehide', saveStateNow);
    window.addEventListener('beforeunload', saveStateNow);

    document.addEventListener('visibilitychange', () => {
      if (collectionRunning() && document.visibilityState === 'visible') void holdScreenAwake();
    });

    document.addEventListener('pointerdown', rememberRoomContextTarget, true);
    document.addEventListener('contextmenu', rememberRoomContextTarget, true);
    document.addEventListener('touchstart', rememberRoomContextTarget, { capture: true, passive: true });

    observer = new MutationObserver(scheduleRefresh);
    refresh();
    if (readProfileResume()?.active) setTimeout(() => { void resumeProfileCollectionIfNeeded(); }, 350);

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

