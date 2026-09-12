// ==UserScript==
// @name         Zeta Fullscreen
// @namespace    zeta-fullscreen
// @version      0.1.15
// @description  채팅방에서만 하단 액션 버튼 오른쪽에 가볍게 떠 있는 전체화면 버튼을 표시합니다.
// @match        https://zeta-ai.io/*
// @updateURL    https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-fullscreen.user.js
// @downloadURL  https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-fullscreen.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const HOST_ID = 'zeta-fullscreen-toggle-host';
  const isChatRoom = () => /(?:^|\/)rooms\/[^/?#]+(?:\/|$)/.test(location.pathname);
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;left:0;bottom:0;z-index:2147483000;display:none;pointer-events:auto;';
  document.documentElement.appendChild(host);

  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      button {
        width: var(--zfs-size, 32px);
        height: var(--zfs-size, 32px);
        padding: 0;
        border: var(--zfs-border, 1px solid rgba(255,255,255,.12));
        border-radius: var(--zfs-radius, 999px);
        background: var(--zfs-background, rgba(40,40,41,.8));
        color: var(--zfs-color, rgba(255,255,255,.88));
        box-shadow: var(--zfs-shadow, none);
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
      }
      button:active { transform: scale(.94); }
      svg { width: 16px; height: 16px; display: block; }
      .toast {
        position: absolute;
        left: 0;
        bottom: calc(var(--zfs-size, 32px) + 8px);
        width: max-content;
        max-width: 220px;
        padding: 7px 9px;
        border-radius: 8px;
        background: rgba(24,24,26,.9);
        color: #fff;
        font: 12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        opacity: 0;
        pointer-events: none;
        transition: opacity .15s ease;
      }
      .toast.show { opacity: 1; }
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
  let retryTimer = 0;
  let exitTimer = 0;
  let placed = false;

  const showToast = (message) => {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
  };

  const getActionButton = () => {
    if (!isChatRoom()) return null;
    return document.querySelector('[data-sentry-component="ActionPanelButton"] button');
  };

  const placeButton = () => {
    if (!isChatRoom()) {
      placed = false;
      host.style.display = 'none';
      return false;
    }

    const anchor = getActionButton();
    if (!anchor) return false;

    const rect = anchor.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const style = getComputedStyle(anchor);
    const size = Math.round(Math.min(rect.width, rect.height));
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;

    host.style.left = `${Math.round(rect.right + 6)}px`;
    host.style.bottom = `${Math.max(0, Math.round(viewportHeight - rect.bottom))}px`;
    host.style.setProperty('--zfs-size', `${size}px`);
    host.style.setProperty('--zfs-background', style.backgroundColor);
    host.style.setProperty('--zfs-color', style.color);
    host.style.setProperty('--zfs-border', `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`);
    host.style.setProperty('--zfs-radius', style.borderRadius);
    host.style.setProperty('--zfs-shadow', style.boxShadow === 'none' ? 'none' : style.boxShadow);

    placed = true;
    updateVisibility();
    return true;
  };

  const placeWhenReady = (attempt = 0) => {
    clearTimeout(retryTimer);
    if (!isChatRoom()) {
      placed = false;
      updateVisibility();
      return;
    }
    if (placeButton()) return;
    if (attempt < 19) retryTimer = setTimeout(() => placeWhenReady(attempt + 1), 150);
  };

  function updateVisibility() {
    const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
    host.style.display = (isChatRoom() && placed && !active) ? 'block' : 'none';
  }

  async function toggleFullscreen() {
    if (!isChatRoom()) return;
    const active = document.fullscreenElement || document.webkitFullscreenElement;

    try {
      if (active) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
      } else {
        const enter = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
        if (!enter) {
          showToast('이 브라우저는 전체화면 API를 지원하지 않음');
          return;
        }
        await enter.call(document.documentElement);
      }
    } catch (err) {
      console.warn('[Zeta Fullscreen]', err);
      showToast('전체화면 전환이 차단됨');
    }
  }

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleFullscreen();
  }, true);

  const onFullscreenChange = () => {
    updateVisibility();
    clearTimeout(exitTimer);
    if (!(document.fullscreenElement || document.webkitFullscreenElement)) {
      exitTimer = setTimeout(placeButton, 450);
    }
  };

  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    if (!isChatRoom() || !placed) return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(placeButton);
  }, { passive: true });

  const syncRoute = () => {
    clearTimeout(retryTimer);
    placed = false;
    updateVisibility();
    if (isChatRoom()) placeWhenReady();
  };

  const hookHistory = (name) => {
    const original = history[name];
    history[name] = function (...args) {
      const result = original.apply(this, args);
      queueMicrotask(syncRoute);
      return result;
    };
  };

  hookHistory('pushState');
  hookHistory('replaceState');
  window.addEventListener('popstate', syncRoute);

  if (isChatRoom()) placeWhenReady();
})();
