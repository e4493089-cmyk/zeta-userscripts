// ==UserScript==
// @name         Zeta Unlimited Badge Restorer
// @namespace    zeta-unlimited-badge
// @version      0.2.0
// @description  제타 서버가 언리밋으로 판정한 플롯의 프로필에 언리밋 마크를 다시 표시합니다.
// @match        https://zeta-ai.io/*
// @updateURL    https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-unlimited-badge.user.js
// @downloadURL  https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-unlimited-badge.user.js
// @run-at       document-start
// @connect      api.zeta-ai.io
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(() => {
  'use strict';

  const BADGE_ID = 'zub-unlimited-badge';
  const STYLE_ID = 'zub-unlimited-style';
  const cache = new Map();
  let lastUrl = location.href;
  let scanTimer = 0;

  function currentPlotId() {
    return location.pathname.match(/\/plots\/([0-9a-f-]+)(?:\/profile)?\/?$/i)?.[1] || null;
  }

  function remember(plotId, allowed, source) {
    if (!plotId || typeof allowed !== 'boolean') return;
    cache.set(plotId, { allowed, source, at: Date.now() });
    if (plotId === currentPlotId()) scheduleRender();
  }

  function inspectPayload(root, source) {
    if (!root || typeof root !== 'object') return;
    const seen = new WeakSet();
    const queue = [root];
    let visited = 0;

    const maxVisited = source === 'react' ? 800 : 12000;
    while (queue.length && visited < maxVisited) {
      const value = queue.shift();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      visited++;

      const id = typeof value.plotId === 'string' ? value.plotId
        : (typeof value.id === 'string' ? value.id : null);
      if (id && typeof value.unlimitedAllowed === 'boolean') {
        remember(id, value.unlimitedAllowed, source);
      }

      const allowedMap = value.unlimitedAllowedByPlotId;
      if (allowedMap && typeof allowedMap === 'object') {
        for (const [plotId, allowed] of Object.entries(allowedMap)) {
          if (typeof allowed === 'boolean') remember(plotId, allowed, source);
        }
      }

      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child === 'object') queue.push(child);
      } else {
        for (const child of Object.values(value)) {
          if (child && typeof child === 'object') queue.push(child);
        }
      }
    }
  }

  function inspectInfinitePayload(root, source) {
    const target = currentPlotId();
    if (!target || !root || typeof root !== 'object') return;
    const seen = new WeakSet();
    const queue = [root];
    let visited = 0;
    while (queue.length && visited < 12000) {
      const value = queue.shift();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      visited++;
      if (value.id === target || value.plotId === target) remember(target, true, source);
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') queue.push(child);
      }
    }
  }

  function inspectResponse(response, url) {
    try {
      const clone = response.clone();
      clone.json().then(data => {
        inspectPayload(data, url);
        if (/infinite-plots|unlimited/i.test(url)) inspectInfinitePayload(data, url);
      }).catch(() => {});
    } catch (_) {}
  }

  async function probeCurrentPlot() {
    const plotId = currentPlotId();
    if (!plotId) return;
    try {
      const response = await window.fetch(`https://api.zeta-ai.io/v1/plots/${plotId}`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return;
      const data = await response.clone().json();
      inspectPayload(data, 'plot-api');
    } catch (_) {}
  }

  function probeCurrentPlotWithGM() {
    const plotId = currentPlotId();
    if (!plotId || typeof GM_xmlhttpRequest !== 'function') return;
    GM_xmlhttpRequest({
      method: 'GET',
      url: `https://api.zeta-ai.io/v1/plots/${plotId}`,
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      },
      anonymous: false,
      timeout: 15000,
      onload(response) {
        try {
          const data = JSON.parse(response.responseText || '{}');
          inspectPayload(data, 'plot-api-gm');
          const plot = data?.plot || data?.data || data;
          if ((plot?.id === plotId || plot?.plotId === plotId)
            && typeof plot?.unlimitedAllowed === 'boolean') {
            remember(plotId, plot.unlimitedAllowed, 'plot-api-gm-direct');
          }
        } catch (_) {}
      }
    });
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      const url = String(args[0]?.url || args[0] || response.url || '');
      inspectResponse(response, url);
      return response;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__zubUrl = String(url || '');
    this.addEventListener('load', () => {
      try {
        const data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
        inspectPayload(data, this.__zubUrl);
        if (/infinite-plots|unlimited/i.test(this.__zubUrl)) inspectInfinitePayload(data, this.__zubUrl);
      } catch (_) {}
    }, { once: true });
    return originalOpen.call(this, method, url, ...rest);
  };

  function inspectReactState() {
    const plotId = currentPlotId();
    if (!plotId) return;
    const roots = document.querySelectorAll(
      '[data-sentry-component="PlotProfile"], [data-sentry-component="PlotBasic"], main'
    );
    for (const element of roots) {
      const fiberKey = Object.keys(element).find(key => key.startsWith('__reactFiber$'));
      let fiber = fiberKey ? element[fiberKey] : null;
      for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) {
        inspectPayload(fiber.memoizedProps, 'react');
        inspectPayload(fiber.memoizedState, 'react');
      }
    }
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BADGE_ID} {
        display: inline-flex;
        align-items: center;
        width: max-content;
        height: 22px;
        margin-left: 7px;
        padding: 0 8px;
        border: 1px solid rgba(170,139,255,.55);
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(124,82,255,.95), rgba(193,91,255,.92));
        color: #fff;
        box-shadow: 0 2px 10px rgba(124,82,255,.28);
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
        vertical-align: middle;
        white-space: nowrap;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function render() {
    const plotId = currentPlotId();
    const status = plotId ? cache.get(plotId) : null;
    if (!plotId || status?.allowed !== true) {
      document.getElementById(BADGE_ID)?.remove();
      return;
    }

    injectStyle();
    if (document.getElementById(BADGE_ID)) return;
    const basic = document.querySelector('[data-sentry-component="PlotBasic"]');
    const title = basic?.querySelector(':scope > span.title1, :scope > span')
      || document.querySelector('[data-sentry-source-file="PlotProfileHeader.tsx"] h3 span');
    if (!title) return;

    const badge = document.createElement('span');
    badge.id = BADGE_ID;
    badge.textContent = '∞ 언리밋';
    badge.title = '제타 서버의 언리밋 판정값으로 표시됨';
    title.insertAdjacentElement('afterend', badge);
  }

  function scheduleRender() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      inspectReactState();
      render();
    }, 80);
  }

  function start() {
    scheduleRender();
    probeCurrentPlot();
    probeCurrentPlotWithGM();
    new MutationObserver(scheduleRender).observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        document.getElementById(BADGE_ID)?.remove();
        scheduleRender();
        probeCurrentPlot();
        probeCurrentPlotWithGM();
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
