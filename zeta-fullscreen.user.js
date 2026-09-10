// ==UserScript==
// @name         Zeta Fullscreen
// @namespace    zeta-fullscreen
// @version      0.1.0
// @description  제타를 한 번의 탭으로 전체화면 전환합니다. (브라우저가 허용하는 범위에서 주소창/하단 UI 숨김)
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
  host.style.cssText = 'position:fixed;right:12px;bottom:82px;z-index:2147483647;';
  document.documentElement.appendChild(host);

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
        right: 0;
        bottom: 42px;
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

  const updateState = () => {
    const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
    button.setAttribute('aria-label', active ? '전체화면 종료' : '전체화면 전환');
    button.setAttribute('title', active ? '전체화면 종료' : '전체화면 전환');
  };

  document.addEventListener('fullscreenchange', updateState);
  document.addEventListener('webkitfullscreenchange', updateState);
  updateState();
})();
