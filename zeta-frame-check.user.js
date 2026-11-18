// ==UserScript==
// @name         ZETA Stay iframe check
// @namespace    zeta-stay-frame-diagnostic
// @version      1.0.0
// @description  Stay가 제타 채팅 iframe 내부에 스크립트를 주입하는지 확인하는 임시 진단 도구
// @match        https://frame.pingpong.ai/v1/*
// @include      https://frame.pingpong.ai/v1/index.html*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  if (location.origin !== 'https://frame.pingpong.ai' || !location.pathname.startsWith('/v1/')) return;

  const attach = () => {
    if (document.getElementById('zeta-stay-frame-check')) return;
    const badge = document.createElement('div');
    badge.id = 'zeta-stay-frame-check';
    badge.textContent = 'Stay iframe 실행 확인 ✓';
    Object.assign(badge.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      zIndex: '2147483647',
      padding: '8px 12px',
      color: '#111111',
      background: '#FEE500',
      border: '2px solid #111111',
      borderRadius: '9px',
      font: 'bold 13px/1.4 -apple-system, BlinkMacSystemFont, sans-serif',
      pointerEvents: 'none',
      boxShadow: '0 2px 10px rgba(0,0,0,.3)'
    });
    (document.body || document.documentElement).appendChild(badge);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach, { once: true });
  else attach();
})();
