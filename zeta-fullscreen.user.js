// ==UserScript==
// @name         Zeta Fullscreen
// @namespace    zeta-fullscreen
// @version      0.1.21
// @description  스냅샷 버튼이 있으면 바로 위에, 없으면 실제 액션 버튼 자리와 같은 채팅 영역 왼쪽 아래에 전체화면 버튼을 표시합니다.
// @match        https://zeta-ai.io/*
// @updateURL    https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-fullscreen.user.js
// @downloadURL  https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-fullscreen.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const BUTTON_ID = 'zeta-fullscreen-native-button';
  const PANEL_SELECTOR = '[data-sentry-component="ActionPanelButton"]';
  const COMPOSER_SELECTOR = '[data-sentry-component="ChatComposer"]';
  const isChatRoom = () => /(?:^|\/)rooms\/[^/?#]+(?:\/|$)/.test(location.pathname);

  let retryTimer = 0;
  let anchorObserver = null;
  let observedParent = null;
  let panelSeenInRoom = false;

  const fullscreenIcon = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="size-4" style="color:inherit">
      <path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3"
        stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  async function toggleFullscreen() {
    try {
      const active = document.fullscreenElement || document.webkitFullscreenElement;
      if (active) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
        return;
      }

      const enter = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
      if (enter) await enter.call(document.documentElement);
    } catch (err) {
      console.warn('[Zeta Fullscreen]', err);
    }
  }

  function createButton(className = '') {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = className || 'relative flex size-8 shrink-0 flex-row items-center justify-center rounded-full outline-hidden';
    button.setAttribute('aria-label', '전체화면 전환');
    button.setAttribute('title', '전체화면 전환');
    button.style.position = 'absolute';
    button.style.margin = '0';
    button.style.width = '32px';
    button.style.height = '32px';
    button.style.minWidth = '32px';
    button.style.minHeight = '32px';
    button.style.borderRadius = '999px';
    button.style.background = '#EEF1F3';
    button.style.color = '#53636C';
    button.style.border = '1px solid #E0E6E9';
    button.style.boxShadow = '0 1px 3px rgba(45,61,71,.08)';
    button.style.zIndex = '20';
    button.innerHTML = fullscreenIcon;

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleFullscreen();
    }, true);

    return button;
  }

  function mountOnPanel(panel) {
    if (!panel) return false;

    const existing = document.getElementById(BUTTON_ID);
    if (existing && panel.contains(existing)) return true;
    existing?.remove();

    const nativeButton = panel.querySelector('button');
    if (!nativeButton) return false;

    const button = createButton(nativeButton.className);
    button.dataset.zetaFullscreenMount = 'panel';
    button.style.left = '0';
    button.style.top = 'auto';
    button.style.bottom = 'calc(100% + 6px)';
    panel.appendChild(button);
    return true;
  }

  function getNativePanelSlot(composer) {
    const slot = composer?.previousElementSibling;
    if (!(slot instanceof HTMLElement)) return null;
    return slot;
  }

  function mountInEmptyPanelSlot(composer) {
    const slot = getNativePanelSlot(composer);
    if (!slot) return false;

    const existing = document.getElementById(BUTTON_ID);
    if (existing && existing.parentElement === slot && existing.dataset.zetaFullscreenMount === 'empty-panel-slot') {
      return true;
    }
    existing?.remove();

    const button = createButton();
    button.dataset.zetaFullscreenMount = 'empty-panel-slot';
    button.style.left = '8px';
    button.style.top = 'auto';
    button.style.bottom = '12px';
    button.style.zIndex = '10';
    slot.appendChild(button);
    return true;
  }

  function mountBestAvailable() {
    if (!isChatRoom()) return false;

    const panel = document.querySelector(PANEL_SELECTOR);
    if (panel) {
      panelSeenInRoom = true;
      if (mountOnPanel(panel)) {
        watchAnchorParent(panel.parentElement);
        return true;
      }
    }

    // 이 방에서 실제 액션 패널을 한 번이라도 본 적이 있으면,
    // 생성 중 잠깐 사라진 것으로 보고 fallback 버튼을 띄우지 않는다.
    if (panelSeenInRoom) {
      document.getElementById(BUTTON_ID)?.remove();
      return false;
    }

    const composer = document.querySelector(COMPOSER_SELECTOR);
    if (composer && mountInEmptyPanelSlot(composer)) {
      watchAnchorParent(getNativePanelSlot(composer));
      return true;
    }

    return false;
  }

  function watchAnchorParent(parent) {
    if (!parent || parent === observedParent) return;

    anchorObserver?.disconnect();
    observedParent = parent;

    anchorObserver = new MutationObserver(() => {
      if (!isChatRoom()) return;
      mountBestAvailable();
    });

    // 문서 전체/하위 트리는 보지 않는다.
    // 실제 ActionPanelButton이 들어가는 채팅 영역의 직계 자식 변화만 감지한다.
    anchorObserver.observe(parent, { childList: true });
  }

  function setupWhenReady(attempt = 0) {
    clearTimeout(retryTimer);
    if (!isChatRoom()) return;

    const mounted = mountBestAvailable();

    // 스냅샷 액션이 늦게 생기는 방은 잠깐 더 확인해서
    // 빈 액션 자리 fallback에서 실제 액션 패널 위쪽으로 옮긴다.
    if (attempt < 19 && (!mounted || !document.querySelector(PANEL_SELECTOR))) {
      retryTimer = setTimeout(() => setupWhenReady(attempt + 1), 150);
    }
  }

  function syncRoute() {
    clearTimeout(retryTimer);
    anchorObserver?.disconnect();
    anchorObserver = null;
    observedParent = null;
    panelSeenInRoom = false;
    document.getElementById(BUTTON_ID)?.remove();

    if (isChatRoom()) setupWhenReady();
  }

  function hookHistory(name) {
    const original = history[name];
    if (typeof original !== 'function') return;

    history[name] = function (...args) {
      const result = original.apply(this, args);
      queueMicrotask(syncRoute);
      return result;
    };
  }

  hookHistory('pushState');
  hookHistory('replaceState');
  window.addEventListener('popstate', syncRoute);

  if (isChatRoom()) setupWhenReady();
})();
