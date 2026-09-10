// ==UserScript==
// @name         Zeta Capture User Mask
// @namespace    zeta-capture-user-mask
// @version      0.2.5
// @description  Zeta 캡처 모드/캡처 미리보기에서 {{user}} 실제 이름과 한국식 이름의 이름 부분까지 검열 바 형태로 가립니다. (v0.2.1 동작으로 롤백)
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

  const userNames = new Set();
  let applying = false;
  let scheduled = false;

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

  function isCaptureActive() {
    return !!document.querySelector(
      '[data-sentry-component="CaptureModeHeader"], ' +
      '[data-sentry-component="CaptureModeBottom"], ' +
      '[data-sentry-component="CapturePreview"], ' +
      '[data-sentry-component="ChatMessageCaptureSelector"]'
    );
  }

  function addUserNameAliases(name) {
    const normalized = normalizeText(name);
    if (!normalized) return;

    userNames.add(normalized);

    if (/^[가-힣]{3}$/.test(normalized)) {
      userNames.add(normalized.slice(1));
    }

    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (last.length >= 2) userNames.add(last);
    }
  }

  function collectUserNames() {
    document
      .querySelectorAll('[data-sentry-component="RightTextContent"] .caption1')
      .forEach(el => {
        if (el.closest(`.${MASK_CLASS}`)) return;

        const name = normalizeText(el.textContent);
        if (!name) return;

        addUserNameAliases(name);
      });
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

  function start() {
    installStyle();
    collectUserNames();
    apply();

    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });

    window.addEventListener('pageshow', scheduleApply, true);
    document.addEventListener('visibilitychange', scheduleApply, true);

    document.addEventListener(
      'click',
      event => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        const captureUi = target.closest(
          '[data-sentry-component="CaptureModeHeader"], ' +
          '[data-sentry-component="CaptureModeBottom"], ' +
          '[data-sentry-component="CapturePreview"], ' +
          '[data-sentry-component="ChatMessageCaptureSelector"]'
        );

        if (captureUi || isCaptureActive()) apply();
      },
      true
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
