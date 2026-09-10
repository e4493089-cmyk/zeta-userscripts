// ==UserScript==
// @name         Zeta Capture User Mask
// @namespace    zeta-capture-user-mask
// @version      0.2.4
// @description  Zeta 캡처 모드/캡처 미리보기에서 현재 대화방에서 지금 선택된 사용자 프로필 이름만 검열 바 형태로 가립니다. 헤더/선택 상태를 우선 사용해 다른 프로필 간섭을 막습니다.
// @match        https://zeta-ai.io/*
// @updateURL    https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-capture-user-mask.user.js
// @downloadURL  https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-capture-user-mask.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const MASK_CLASS = 'zeta-capture-user-mask';
  const STYLE_ID = 'zeta-capture-user-mask-style';
  const MASK_COLOR = '#58666E';
  // v0.2.2까지의 캐시는 여러 프로필 이름이 섞여 있을 수 있어 새 키를 사용한다.
  const CACHE_KEY = 'zeta-capture-user-mask:active-profile:v4';
  const MAX_CACHE_ROOMS = 40;

  const userNames = new Set();
  let activeUserName = '';
  let applying = false;
  let scheduled = false;
  let lastRoomId = '';
  let delayedTimers = [];

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${MASK_CLASS} {
        color: transparent !important;
        -webkit-text-fill-color: transparent !important;
        background: ${MASK_COLOR} !important;
        border-radius: 3px !important;
        box-shadow: none !important;
        text-shadow: none !important;
        text-decoration: none !important;
        -webkit-box-decoration-break: clone !important;
        box-decoration-break: clone !important;
        user-select: none !important;
        -webkit-user-select: none !important;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getRoomId() {
    const match = location.pathname.match(/\/rooms\/([0-9a-f-]{8,})/i);
    return match?.[1] || '';
  }

  function readCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function looksLikeDisplayName(value) {
    const name = normalizeText(value);
    if (!name || name.length > 32) return false;
    if (/\n|\r/.test(value || '')) return false;
    if (/^\d{1,2}:\d{2}$/.test(name)) return false;
    if (/^[·•….,!?~\-–—_/\\]+$/.test(name)) return false;
    return true;
  }

  function fillAliases(name) {
    userNames.clear();
    const normalized = normalizeText(name);
    if (!looksLikeDisplayName(normalized)) return;

    userNames.add(normalized);

    // 한국식 3글자 이름: 김제콩 -> 제콩
    if (/^[가-힣]{3}$/.test(normalized)) {
      userNames.add(normalized.slice(1));
    }

    // 공백형 표시 이름: 김 제콩 -> 제콩
    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (last.length >= 2 && last.length <= 12) userNames.add(last);
    }
  }

  function setActiveUserName(name, save = true) {
    const normalized = normalizeText(name);
    if (!looksLikeDisplayName(normalized)) return false;
    if (normalized === activeUserName) return false;

    activeUserName = normalized;
    fillAliases(normalized);
    if (save) saveCachedProfile();
    return true;
  }

  function loadCachedProfile() {
    const roomId = getRoomId();
    if (roomId === lastRoomId) return;

    lastRoomId = roomId;
    activeUserName = '';
    userNames.clear();

    if (!roomId) return;
    const cached = readCache()[roomId];
    if (cached?.name) setActiveUserName(cached.name, false);
  }

  function saveCachedProfile() {
    const roomId = getRoomId();
    if (!roomId || !activeUserName) return;

    try {
      const cache = readCache();
      cache[roomId] = {
        name: activeUserName,
        updatedAt: Date.now()
      };

      const ids = Object.keys(cache).sort(
        (a, b) => Number(cache[b]?.updatedAt || 0) - Number(cache[a]?.updatedAt || 0)
      );
      ids.slice(MAX_CACHE_ROOMS).forEach(id => delete cache[id]);
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // 저장 실패가 캡처 기능을 막지는 않게 둔다.
    }
  }

  function isCaptureActive() {
    return !!document.querySelector(
      '[data-sentry-component="CaptureModeHeader"], ' +
      '[data-sentry-component="CaptureModeBottom"], ' +
      '[data-sentry-component="CapturePreview"], ' +
      '[data-sentry-component="ChatMessageCaptureSelector"]'
    );
  }

  function isElementVisible(el) {
    if (!(el instanceof Element) || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getCurrentChatLog() {
    const logs = [...document.querySelectorAll('[role="log"][aria-label="Chat messages"]')];
    if (!logs.length) return null;

    const visible = logs.filter(isElementVisible);
    if (visible.length === 1) return visible[0];
    if (visible.length > 1) {
      return visible.sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (br.width * br.height) - (ar.width * ar.height);
      })[0];
    }

    // Safari에서 레이아웃 계산 직전 0x0으로 잡힐 때는 가장 마지막 로그를 현재 로그로 본다.
    return logs[logs.length - 1];
  }

  function getNameElements(root) {
    if (!root) return [];
    const selectors = [
      '[data-sentry-component="RightTextContent"] .caption1',
      '[data-sentry-component="RightTextContent"] [class*="caption"]',
      '[data-sentry-component="RightTextContent"] > div > span:first-child',
      '[data-sentry-component="RightTextContent"] > span:first-child'
    ];

    const found = [...root.querySelectorAll(selectors.join(','))];
    return [...new Set(found)].filter(el => {
      if (el.closest('[data-sentry-component="CapturePreview"]')) return false;
      if (el.closest(`.${MASK_CLASS}`)) return false;
      return looksLikeDisplayName(el.textContent);
    });
  }

  function cleanProfileLabel(value) {
    let text = normalizeText(value);
    if (!text) return '';
    text = text
      .replace(/^(?:내\s*)?프로필\s*[:：]?\s*/i, '')
      .replace(/\s*(?:프로필|profile)\s*$/i, '')
      .trim();
    return text;
  }

  function isProfileUiLabel(value) {
    const text = normalizeText(value).toLowerCase();
    return !text || [
      '프로필', '내 프로필', '대화 프로필', '프로필 변경', '프로필 선택',
      '수정', '편집', '선택', '현재', 'profile', 'chat profile', 'edit'
    ].includes(text);
  }

  function nameFromProfileContainer(root) {
    if (!(root instanceof Element)) return '';

    const preferred = [
      '.body1',
      '[class~="body1"]',
      'h4',
      'h3',
      'span'
    ];

    for (const selector of preferred) {
      for (const el of root.querySelectorAll(selector)) {
        if (!isElementVisible(el)) continue;
        const text = cleanProfileLabel(el.textContent);
        if (!looksLikeDisplayName(text) || isProfileUiLabel(text)) continue;
        return text;
      }
    }

    const text = cleanProfileLabel(root.textContent);
    if (looksLikeDisplayName(text) && !isProfileUiLabel(text)) return text;
    return '';
  }

  function pickExplicitActiveProfileName() {
    // 1순위: 채팅 헤더의 현재 프로필 버튼. 과거 메시지 이름과 달리 '지금 선택된 프로필'을 가리킨다.
    const header = document.querySelector('[data-testid="chat-header-profile"]');
    if (header && isElementVisible(header)) {
      const name = nameFromProfileContainer(header);
      if (name) return name;
    }

    // 프로필 선택 바텀시트가 열려 있다면 체크된 항목을 현재 프로필로 사용한다.
    const dialog = document.querySelector('#portal-container [role="dialog"][aria-label="대화 프로필"]');
    if (dialog) {
      const items = [...dialog.querySelectorAll('[data-sentry-component="ChatProfileListItem"]')];
      const selected = items.find(item =>
        item.matches('[aria-current="true"], [aria-selected="true"]') ||
        item.querySelector('.kt-profile-hub-selected, [aria-current="true"], [aria-selected="true"], div[class*="bg-primary-400"] svg')
      );
      const name = nameFromProfileContainer(selected);
      if (name) return name;
    }

    // 프로필 선택 화면의 현재/미리보기 카드.
    const card = document.querySelector('[data-sentry-component="PlotProfileCard"]');
    if (card && isElementVisible(card)) {
      const name = nameFromProfileContainer(card);
      if (name) return name;
    }

    return '';
  }

  function pickCurrentUserName() {
    const currentLog = getCurrentChatLog();
    let candidates = getNameElements(currentLog);

    // aria-label이 Safari/Stay에서 달라져 로그를 못 찾은 경우에만 문서 전체의 '보이는' 오른쪽 이름표를 본다.
    if (!candidates.length) {
      const fallbackRoot = document.body || document.documentElement;
      candidates = getNameElements(fallbackRoot).filter(isElementVisible);
    }

    if (!candidates.length) return '';

    // 핵심: 모든 오른쪽 이름을 저장하지 않는다.
    // 현재 대화 화면에서 가장 아래/최근에 보이는 사용자 이름 하나만 현재 프로필로 취급한다.
    const visible = candidates.filter(isElementVisible);
    const pool = visible.length ? visible : candidates;

    const ranked = pool.map((el, index) => {
      const rect = el.getBoundingClientRect();
      return { el, index, bottom: Number.isFinite(rect.bottom) ? rect.bottom : -Infinity };
    }).sort((a, b) => (b.bottom - a.bottom) || (b.index - a.index));

    return normalizeText(ranked[0]?.el.textContent || pool[pool.length - 1]?.textContent || '');
  }

  function collectCurrentUserName() {
    loadCachedProfile();

    // 과거 메시지의 이름보다 현재 프로필 UI를 반드시 우선한다.
    const explicitName = pickExplicitActiveProfileName();
    if (explicitName) return setActiveUserName(explicitName, true);

    // 이미 이 방의 현재 프로필을 확정해 둔 상태라면 과거 RightTextContent로 덮어쓰지 않는다.
    if (activeUserName) return false;

    // 정말 현재 프로필 UI가 전혀 없고 캐시도 비어 있을 때만 최초 1회 메시지 이름을 보조 수단으로 쓴다.
    const fallbackName = pickCurrentUserName();
    if (!fallbackName) return false;
    return setActiveUserName(fallbackName, true);
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function sortedNames() {
    return [...userNames]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
  }

  function textNodeShouldBeIgnored(node) {
    const parent = node.parentElement;
    if (!parent) return true;

    return !!parent.closest(
      `.${MASK_CLASS}, script, style, noscript, textarea, input, select, option, [contenteditable="true"]`
    );
  }

  function wrapMatchesInRoot(root) {
    if (!root || !root.isConnected) return;

    const names = sortedNames();
    if (!names.length) return;

    const pattern = new RegExp(names.map(escapeRegExp).join('|'), 'g');
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (textNodeShouldBeIgnored(node)) return NodeFilter.FILTER_REJECT;

          const value = node.nodeValue || '';
          pattern.lastIndex = 0;
          return pattern.test(value)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    const targets = [];
    while (walker.nextNode()) targets.push(walker.currentNode);

    for (const node of targets) {
      const text = node.nodeValue || '';
      pattern.lastIndex = 0;

      let match;
      let lastIndex = 0;
      let changed = false;
      const frag = document.createDocumentFragment();

      while ((match = pattern.exec(text))) {
        const matched = match[0];
        if (!matched) {
          pattern.lastIndex += 1;
          continue;
        }

        if (match.index > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }

        const mask = document.createElement('span');
        mask.className = MASK_CLASS;
        mask.dataset.zetaCaptureOriginal = matched;
        mask.textContent = matched;
        frag.appendChild(mask);

        lastIndex = match.index + matched.length;
        changed = true;
      }

      if (!changed) continue;

      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      node.parentNode?.replaceChild(frag, node);
    }
  }

  function getCaptureRoots() {
    const roots = new Set();

    document
      .querySelectorAll('[data-sentry-component="CapturePreview"]')
      .forEach(el => {
        if (isElementVisible(el)) roots.add(el);
      });

    const currentLog = getCurrentChatLog();
    if (currentLog) roots.add(currentLog);

    document
      .querySelectorAll('[data-sentry-component="ChatMessageCaptureSelector"]')
      .forEach(el => {
        if (isElementVisible(el) || el.closest('[data-sentry-component="CapturePreview"]')) roots.add(el);
      });

    return [...roots];
  }

  function restoreMasks() {
    const masks = document.querySelectorAll(`.${MASK_CLASS}`);
    if (!masks.length) return;

    applying = true;
    try {
      masks.forEach(mask => {
        const text = mask.dataset.zetaCaptureOriginal ?? mask.textContent ?? '';
        mask.replaceWith(document.createTextNode(text));
      });
    } finally {
      applying = false;
    }
  }

  function apply() {
    scheduled = false;
    if (applying) return;

    installStyle();
    loadCachedProfile();
    const profileChanged = collectCurrentUserName();

    // 프로필이 바뀌면 이전 프로필에 씌워둔 검열을 먼저 풀고 새 프로필 이름만 다시 가린다.
    if (profileChanged) restoreMasks();

    if (!isCaptureActive()) {
      restoreMasks();
      return;
    }

    if (!userNames.size) return;

    applying = true;
    try {
      getCaptureRoots().forEach(wrapMatchesInRoot);
    } finally {
      applying = false;
    }
  }

  function scheduleApply() {
    if (applying || scheduled) return;
    scheduled = true;
    requestAnimationFrame(apply);
  }

  function clearDelayedApplies() {
    delayedTimers.forEach(clearTimeout);
    delayedTimers = [];
  }

  function burstApply() {
    // Safari/Stay는 캡처 복제/렌더가 늦게 끝나는 경우가 있어 짧게 여러 번 재확인한다.
    clearDelayedApplies();
    apply();
    [40, 120, 280, 600, 1100].forEach(delay => {
      delayedTimers.push(setTimeout(apply, delay));
    });
  }

  function isCaptureRelatedTarget(target) {
    if (!(target instanceof Element)) return false;

    if (target.closest(
      '[data-sentry-component="CaptureModeHeader"], ' +
      '[data-sentry-component="CaptureModeBottom"], ' +
      '[data-sentry-component="CapturePreview"], ' +
      '[data-sentry-component="ChatMessageCaptureSelector"], ' +
      '[data-testid="snapshot-action-button"]'
    )) return true;

    const text = normalizeText(target.closest('button')?.textContent || target.textContent);
    return /캡처|스냅샷|capture|snapshot/i.test(text);
  }

  function start() {
    installStyle();
    loadCachedProfile();
    collectCurrentUserName();
    apply();

    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });

    window.addEventListener('pageshow', burstApply, true);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) burstApply();
    }, true);

    ['pointerdown', 'touchstart', 'click'].forEach(type => {
      document.addEventListener(type, event => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        collectCurrentUserName();
        if (isCaptureRelatedTarget(target) || isCaptureActive()) burstApply();
      }, true);
    });

    // SPA로 방이 바뀌면 이름 세트를 즉시 비운 뒤 그 방의 현재 프로필만 다시 잡는다.
    setInterval(() => {
      const roomId = getRoomId();
      if (roomId !== lastRoomId) {
        loadCachedProfile();
        burstApply();
      }
    }, 700);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
