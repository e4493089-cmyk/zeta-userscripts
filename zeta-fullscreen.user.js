// ==UserScript==
// @name         Zeta Fullscreen
// @namespace    zeta-fullscreen
// @version      0.1.11
// @description  가벼운 기존 전체화면 버전을 유지하고 버튼 위치만 채팅 상단 모델 선택 옆으로 옮깁니다.
// @match        https://zeta-ai.io/*
// @updateURL    https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-fullscreen.user.js
// @downloadURL  https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-fullscreen.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const HOST_ID = 'zeta-fullscreen-toggle-host';
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:relative;z-index:2;display:none;align-items:center;flex:0 0 auto;margin-right:6px;';

  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      button {
        width: 34px;
        height: 34px;
        padding: 0;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 10px;
        background: rgba(24,24,26,.66);
        color: rgba(255,255,255,.88);
        box-shadow: 0 2px 10px rgba(0,0,0,.20);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
      }
      button:active { transform: scale(.94); }
      svg { width: 17px; height: 17px; display:block; }
      .toast {
        position: absolute;
        left: 0;
        top: 42px;
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

  // 0.1.2의 가벼운 구조는 그대로 두고, 위치만 상단 모델 선택 버튼 옆으로 옮긴다.
  // 문서 전체 MutationObserver/주기적 감시는 사용하지 않는다.
  let placementAttempt = 0;
  const placeInHeader = () => {
    const modelButton = document.querySelector('[data-testid="chat-header-model"], button[aria-label="Select AI model"]');
    const modelWrapper = modelButton?.parentElement;
    const actionRow = modelWrapper?.parentElement;

    if (actionRow) {
      if (host.parentElement !== actionRow || host.nextElementSibling !== modelWrapper) {
        actionRow.insertBefore(host, modelWrapper);
      }
      updateState();
      return;
    }

    placementAttempt += 1;
    if (placementAttempt < 20) setTimeout(placeInHeader, 250);
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

    const active = document.fullscreenElement || document.webkitFullscreenElement;
    if (active) await exitFullscreen();
    else await enterFullscreen();
  }, true);

  function updateState() {
    const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
    host.style.display = (host.isConnected && !active && !keyboardFocus) ? 'inline-flex' : 'none';
    button.setAttribute('aria-label', '전체화면 전환');
    button.setAttribute('title', '전체화면 전환');
  }

  document.addEventListener('focusin', (event) => {
    if (isEditableTarget(event.target)) beginKeyboardStabilizer();
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

  placeInHeader();
})();
