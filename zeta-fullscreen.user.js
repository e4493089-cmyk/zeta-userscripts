// ==UserScript==
// @name         Zeta Fullscreen
// @namespace    zeta-fullscreen
// @version      0.1.17
// @description  채팅 하단 기본 액션 버튼과 같은 위치/표시 흐름으로 전체화면 버튼을 추가하고 연한 회색 배경의 액션 아이콘 스타일을 맞춥니다.
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
  const isChatRoom = () => /(?:^|\/)rooms\/[^/?#]+(?:\/|$)/.test(location.pathname);

  let retryTimer = 0;
  let panelParentObserver = null;
  let observedParent = null;

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

  function mountButton(panel) {
    if (!panel || panel.querySelector(`#${BUTTON_ID}`)) return;

    const nativeButton = panel.querySelector('button');
    if (!nativeButton) return;

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = nativeButton.className;
    button.setAttribute('aria-label', '전체화면 전환');
    button.setAttribute('title', '전체화면 전환');
    button.style.position = 'absolute';
    button.style.left = 'calc(100% + 6px)';
    button.style.top = '0';
    button.style.margin = '0';
    button.style.background = '#EEF1F3';
    button.style.color = '#53636C';
    button.style.border = '1px solid #E0E6E9';
    button.style.boxShadow = '0 1px 3px rgba(45,61,71,.08)';
    button.innerHTML = fullscreenIcon;

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleFullscreen();
    }, true);

    panel.appendChild(button);
  }

  function watchPanelParent(panel) {
    const parent = panel?.parentElement;
    if (!parent || parent === observedParent) return;

    panelParentObserver?.disconnect();
    observedParent = parent;

    panelParentObserver = new MutationObserver(() => {
      if (!isChatRoom()) return;
      const currentPanel = document.querySelector(PANEL_SELECTOR);
      if (currentPanel) mountButton(currentPanel);
    });

    // 문서 전체/하위 트리는 보지 않는다.
    // ActionPanelButton이 직계 자식으로 없어졌다 다시 생기는지만 감지한다.
    panelParentObserver.observe(parent, { childList: true });
  }

  function setupWhenReady(attempt = 0) {
    clearTimeout(retryTimer);
    if (!isChatRoom()) return;

    const panel = document.querySelector(PANEL_SELECTOR);
    if (panel) {
      mountButton(panel);
      watchPanelParent(panel);
      return;
    }

    if (attempt < 19) {
      retryTimer = setTimeout(() => setupWhenReady(attempt + 1), 150);
    }
  }

  function syncRoute() {
    clearTimeout(retryTimer);
    panelParentObserver?.disconnect();
    panelParentObserver = null;
    observedParent = null;

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