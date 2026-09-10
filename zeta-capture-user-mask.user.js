// ==UserScript==
// @name         Zeta Capture User Mask
// @namespace    zeta-capture-user-mask
// @version      0.2.2
// @description  Zeta 캡처 모드/캡처 미리보기에서 사용자 이름을 자동으로 찾아 검열 바 형태로 가립니다. Safari/Stay 렌더 타이밍을 보강했습니다.
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
  const CACHE_KEY = 'zeta-capture-user-mask:names:v2';
  const MAX_CACHE_ROOMS = 40;

  const userNames = new Set();
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

  function loadCachedNames() {
    const roomId = getRoomId();
    if (!roomId || roomId === lastRoomId) return;

    lastRoomId = roomId;
    userNames.clear();

    const cached = readCache()[roomId];
    if (!cached || !Array.isArray(cached.names)) return;
    cached.names.forEach(addUserNameAliases);
  }

  function saveCachedNames() {
    const roomId = getRoomId();
    if (!roomId || !userNames.size) return;

    try {
      const cache = readCache();
      cache[roomId] = {
        names: [...userNames].slice(0, 12),
        updatedAt: Date.now()
      };

      const ids = Object.keys(cache).sort(
        (a, b) => Number(cache[b]?.updatedAt || 0) - Number(cache[a]?.updatedAt || 0)
      );
      ids.slice(MAX_CACHE_ROOMS).forEach(id => delete cache[id]);
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // 저장 실패는 캡처 동작을 막지 않는다.
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

  function looksLikeDisplayName(value) {
    const name = normalizeText(value);
    if (!name || name.length > 32) return false;
    if (/\n|\r/.test(value || '')) return false;
    if (/^\d{1,2}:\d{2}$/.test(name)) return false;
    if (/^[·•….,!?~\-–—_/\\]+$/.test(name)) return false;
    return true;
  }

  function addUserNameAliases(name) {
    const normalized = normalizeText(name);
    if (!looksLikeDisplayName(normalized)) return false;

    const before = userNames.size;
    userNames.add(normalized);

    // 한국식 3글자 이름은 성 1글자를 뺀 2글자 이름도 함께 가린다.
    // 예: 김제콩 -> 제콩, 제콩아 / 제콩은 같은 조사 결합도 자연스럽게 잡힌다.
    if (/^[가-힣]{3}$/.test(normalized)) {
      userNames.add(normalized.slice(1));
    }

    // 공백형 표시 이름은 마지막 토큰도 후보로 저장한다.
    // 예: 김 제콩 -> 제콩
    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (last.length >= 2 && last.length <= 12) userNames.add(last);
    }

    return userNames.size !== before;
  }

  function collectUserNames() {
    loadCachedNames();
    let changed = false;

    // Zeta 일반 채팅의 내 이름표. Safari/Stay에서 class 렌더가 달라지는 경우를 대비해
    // caption1 하나에만 의존하지 않고 RightTextContent 내부의 짧은 이름 후보도 확인한다.
    const selectors = [
      '[data-sentry-component="RightTextContent"] .caption1',
      '[data-sentry-component="RightTextContent"] [class*="caption"]',
      '[data-sentry-component="RightTextContent"] > div > span:first-child',
      '[data-sentry-component="RightTextContent"] > span:first-child'
    ];

    document.querySelectorAll(selectors.join(',')).forEach(el => {
      if (el.closest(`.${MASK_CLASS}`)) return;
      const name = normalizeText(el.textContent);
      if (addUserNameAliases(name)) changed = true;
    });

    // 이미 이름을 알아낸 상태라면 캡처 복제 DOM의 오른쪽 메타에서도 갱신한다.
    if (isCaptureActive()) {
      document
        .querySelectorAll('[data-sentry-component="CapturePreview"] [data-sentry-component="RightTextContent"] .caption1')
        .forEach(el => {
          if (addUserNameAliases(el.textContent)) changed = true;
        });
    }

    if (changed) saveCachedNames();
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
      .forEach(el => roots.add(el));

    const chatLog = document.querySelector('[role="log"][aria-label="Chat messages"]');
    if (chatLog) roots.add(chatLog);

    document
      .querySelectorAll('[data-sentry-component="ChatMessageCaptureSelector"]')
      .forEach(el => roots.add(el));

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
    loadCachedNames();
    collectUserNames();

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
    // Safari/Stay는 캡처 UI 복제/렌더가 Chromium보다 늦게 끝나는 경우가 있어
    // 짧은 구간 동안 몇 번 더 확인한다. 이름을 못 찾은 첫 프레임만 보고 포기하지 않는다.
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
    loadCachedNames();
    collectUserNames();
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

    // Safari에서 click보다 먼저 이름을 확보하도록 pointer/touch 단계에서도 수집한다.
    ['pointerdown', 'touchstart', 'click'].forEach(type => {
      document.addEventListener(type, event => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        collectUserNames();
        if (isCaptureRelatedTarget(target) || isCaptureActive()) burstApply();
      }, true);
    });

    // SPA로 다른 방에 이동했을 때 이전 방 이름이 섞이지 않게 방 ID 변화를 감시한다.
    setInterval(() => {
      const roomId = getRoomId();
      if (roomId !== lastRoomId) {
        loadCachedNames();
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
