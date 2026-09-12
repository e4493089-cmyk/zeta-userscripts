// ==UserScript==
// @name         Zeta Fullscreen
// @namespace    zeta-fullscreen
// @version      0.1.12
// @description  가벼운 기존 전체화면 로직을 유지하고 하단 액션 버튼 오른쪽에 표시합니다. React DOM에는 삽입하지 않습니다.
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
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483000;display:none;align-items:center;pointer-events:auto;';
  document.documentElement.appendChild(host);

  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      button {
        width: var(--zfs-size, 32px);
        height: var(--zfs-size, 32px);
        padding: 0;
        border: var(--zfs-border, 1px solid rgba(255,255,255,.08));
        border-radius: var(--zfs-radius, 999px);
        background: var(--zfs-background, rgba(40,40,41,.80));
        color: var(--zfs-color, rgba(255,255,255,.88));
        box-shadow: var(--zfs-shadow, none);
        backdrop-filter: var(--zfs-backdrop, none);
        -webkit-backdrop-filter: var(--zfs-backdrop, none);
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
      }
      button:active { transform: scale(.94); }
      svg { width: 16px; height: 16px; display:block; }
      .toast {
        position: absolute;
        left: 0;
        bottom: 40px;
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
  let keyboardFocus = false;
  let keyboardSettleTimer = 0;
  let placed = false;
  let placementAttempts = 0;

  const keyboardStyle = document.createElement('style');
  keyboardStyle.id = 'zeta-fullscreen-keyboard-stabilizer';
  document.documentElement.appendChild(keyboardStyle);

  const getActionButton = () => {
    const wrap = document.querySelector('[data-sentry-component="ActionPanelButton"]');
    return wrap?.querySelector('button') || document.querySelector('[data-testid="snapshot-action-button"]');
  };

  const positionNextToActionButton = () => {
    const anchor = getActionButton();
    if (!anchor) return false;

    const rect = anchor.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const style = getComputedStyle(anchor);
    const size = Math.round(Math.min(rect.width, rect.height));

    host.style.left = `${Math.round(rect.right + 6)}px`;
    host.style.top = `${Math.round(rect.top)}px`;
    host.style.setProperty('--zfs-size', `${size}px`);
    host.style.setProperty('--zfs-background', style.backgroundColor || 'rgba(40,40,41,.80)');
    host.style.setProperty('--zfs-color', style.color || 'rgba(255,255,255,.88)');
    host.style.setProperty('--zfs-border', `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`);
    host.style.setProperty('--zfs-radius', style.borderRadius || '999px');
    host.style.setProperty('--zfs-shadow', style.boxShadow === 'none' ? 'none' : style.boxShadow);
    host.style.setProperty('--zfs-backdrop', style.backdropFilter || style.webkitBackdropFilter || 'none');
    placed = true;
    return true;
  };

  const tryPlacement = () => {
    if (positionNextToActionButton()) {
      updateState();
      return;
    }
    placementAttempts += 1;
    if (placementAttempts < 15) setTimeout(tryPlacement, 200);
  };

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
      positionNextToActionButton();
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
    host.style.display = (placed && !active && !keyboardFocus) ? 'inline-flex' : 'none';
  }

  document.addEventListener('focusin', (event) => {
    if (isEditableTarget(event.target)) beginKeyboardStabilizer();
  }, true);

  document.addEventListener('focusout', (event) => {
    if (isEditableTarget(event.target)) endKeyboardStabilizer();
  }, true);

  const reposition = () => {
    if (placed && !keyboardFocus) positionNextToActionButton();
  };

  window.addEventListener('resize', reposition, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (keyboardFocus) host.style.display = 'none';
      else reposition();
    }, { passive: true });
  }

  document.addEventListener('fullscreenchange', () => {
    positionNextToActionButton();
    updateState();
  });
  document.addEventListener('webkitfullscreenchange', () => {
    positionNextToActionButton();
    updateState();
  });

  setTimeout(tryPlacement, 300);
})();
