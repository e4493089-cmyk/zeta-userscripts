// ==UserScript==
// @name         Zeta Fullscreen
// @namespace    zeta-fullscreen
// @version      0.1.7
// @description  제타 채팅방에서만 전체화면 전환 버튼을 표시합니다. 모바일 키보드 호출 시 화면 깜빡임을 완화합니다.
// @match        https://zeta-ai.io/*
// @updateURL    https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-fullscreen.user.js
// @downloadURL  https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-fullscreen.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const HOST_ID = 'zeta-fullscreen-toggle-host';
  const isChatRoom = () => /^\/ko\/rooms\/[^/]+\/?$/.test(location.pathname);
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;right:12px;bottom:82px;z-index:2147483647;display:none;align-items:center;flex:0 0 auto;';
  document.documentElement.appendChild(host);

  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      button {
        width: 30px;
        height: 30px;
        padding: 0;
        border: 1px solid var(--zfs-border, rgba(255,255,255,.16));
        border-radius: 999px;
        background: var(--zfs-background, #27272a);
        color: var(--zfs-color, rgba(255,255,255,.88));
        box-shadow: var(--zfs-shadow, 0 1px 3px rgba(0,0,0,.16));
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
      }
      button:hover { filter: brightness(.96); }
      button:active { transform: scale(.94); filter: brightness(.90); }
      svg { width: 17px; height: 17px; display:block; }
      .toast {
        position: absolute;
        left: 0;
        top: 38px;
        width: max-content;
        max-width: 220px;
        padding: 8px 10px;
        border-radius: 9px;
        background: rgba(24,24,26,.90);
        color: #fff;
        font: 12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        box-shadow: 0 4px 18px rgba(0,0,0,.24);
        opacity: 0;
        transform: translateY(4px);
        pointer-events: none;
        transition: opacity .15s ease, transform .15s ease;
      }
      .toast.show { opacity: 1; transform: translateY(0); }
    </style>
    <button type="button" aria-label="전체화면 전환" title="전체화면 전환">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <div class="toast" role="status"></div>
  `;

  const button = root.querySelector('button');
  const toast = root.querySelector('.toast');
  let toastTimer = 0;

  const placeBesideModelButton = () => {
    if (!isChatRoom()) {
      host.style.display = 'none';
      return;
    }

    const modelButton = document.querySelector('[data-testid="chat-header-model"], button[aria-label="Select AI model"]');
    const modelWrapper = modelButton?.parentElement;
    const actionRow = modelWrapper?.parentElement;
    if (actionRow) {
      if (host.parentElement !== actionRow || host.nextElementSibling !== modelWrapper) {
        actionRow.insertBefore(host, modelWrapper);
      }
      host.style.position = 'relative';
      host.style.right = 'auto';
      host.style.bottom = 'auto';
      host.style.zIndex = '2';
      const modelStyle = getComputedStyle(modelButton);
      host.style.setProperty('--zfs-background', modelStyle.backgroundColor);
      host.style.setProperty('--zfs-border', `${modelStyle.borderTopWidth} ${modelStyle.borderTopStyle} ${modelStyle.borderTopColor}`);
      host.style.setProperty('--zfs-color', modelStyle.color);
      host.style.setProperty('--zfs-shadow', modelStyle.boxShadow === 'none' ? '0 1px 3px rgba(0,0,0,.16)' : modelStyle.boxShadow);
      return;
    }
    if (host.parentElement !== document.documentElement) document.documentElement.appendChild(host);
    host.style.position = 'fixed';
    host.style.right = '12px';
    host.style.bottom = '82px';
    host.style.zIndex = '2147483647';
  };

  // 모바일 Edge의 Fullscreen + 소프트키보드 조합은 viewport를 여러 번 재계산한다.
  // 그 순간 루트 배경이 비거나 플로팅 버튼이 잠깐 다시 나타나는 현상을 최대한 줄인다.
  let keyboardFocus = false;
  let keyboardSettleTimer = 0;
  const keyboardStyle = document.createElement('style');
  keyboardStyle.id = 'zeta-fullscreen-keyboard-stabilizer';
  document.documentElement.appendChild(keyboardStyle);

  const isEditableTarget = (target) => {
    if (!(target instanceof Element)) return false;
    return !!target.closest('textarea, input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), [contenteditable=true]');
  };

  const pickPageBackground = () => {
    const candidates = [
      document.querySelector('main#contents'),
      document.body,
      document.documentElement
    ].filter(Boolean);

    for (const el of candidates) {
      const color = getComputedStyle(el).backgroundColor;
      if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
    }
    return '#151516';
  };

  const beginKeyboardStabilizer = () => {
    if (!isChatRoom()) return;
    clearTimeout(keyboardSettleTimer);
    keyboardFocus = true;

    if (!(document.fullscreenElement || document.webkitFullscreenElement)) return;

    host.style.display = 'none';

    const bg = pickPageBackground();
    keyboardStyle.textContent = `
      html.zfs-keyboard-active,
      html.zfs-keyboard-active body {
        background: ${bg} !important;
      }
      html.zfs-keyboard-active {
        scroll-behavior: auto !important;
        overscroll-behavior: none !important;
      }
    `;
    document.documentElement.classList.add('zfs-keyboard-active');
  };

  const endKeyboardStabilizer = () => {
    clearTimeout(keyboardSettleTimer);
    keyboardSettleTimer = setTimeout(() => {
      keyboardFocus = false;
      document.documentElement.classList.remove('zfs-keyboard-active');
      keyboardStyle.textContent = '';
      updateState();
    }, 420);
  };

  const showToast = (message) => {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  };

  async function enterFullscreen() {
    if (!isChatRoom()) return;
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) {
      showToast('이 브라우저는 전체화면 API를 지원하지 않음');
      return;
    }

    try {
      try {
        await fn.call(el, { navigationUI: 'hide' });
      } catch (_) {
        await fn.call(el);
      }
    } catch (err) {
      console.warn('[Zeta Fullscreen]', err);
      showToast('전체화면 전환이 차단됨');
    }
  }

  async function exitFullscreen() {
    try {
      const fn = document.exitFullscreen || document.webkitExitFullscreen;
      if (fn) await fn.call(document);
    } catch (err) {
      console.warn('[Zeta Fullscreen]', err);
    }
  }

  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isChatRoom()) return;

    const active = document.fullscreenElement || document.webkitFullscreenElement;
    if (active) await exitFullscreen();
    else await enterFullscreen();
  }, true);

  function updateState() {
    const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
    host.style.display = (isChatRoom() && !active && !keyboardFocus) ? 'inline-flex' : 'none';
    button.setAttribute('aria-label', '전체화면 전환');
    button.setAttribute('title', '전체화면 전환');
  }

  function syncRouteState() {
    if (!isChatRoom()) {
      keyboardFocus = false;
      document.documentElement.classList.remove('zfs-keyboard-active');
      keyboardStyle.textContent = '';
      host.style.display = 'none';
      return;
    }
    placeBesideModelButton();
    updateState();
  }

  document.addEventListener('focusin', (event) => {
    if (isChatRoom() && isEditableTarget(event.target)) beginKeyboardStabilizer();
  }, true);

  document.addEventListener('focusout', (event) => {
    if (isEditableTarget(event.target)) endKeyboardStabilizer();
  }, true);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (keyboardFocus) host.style.display = 'none';
    }, { passive: true });
  }

  document.addEventListener('fullscreenchange', updateState);
  document.addEventListener('webkitfullscreenchange', updateState);
  window.addEventListener('popstate', syncRouteState);
  window.addEventListener('hashchange', syncRouteState);

  let placementTimer = 0;
  new MutationObserver(() => {
    clearTimeout(placementTimer);
    placementTimer = setTimeout(syncRouteState, 80);
  }).observe(document.documentElement, { childList: true, subtree: true });
  new MutationObserver(syncRouteState).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    syncRouteState();
  }, 400);

  syncRouteState();
})();
