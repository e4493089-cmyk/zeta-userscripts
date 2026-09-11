// ==UserScript==
// @name         Zeta Capture OOC Hide
// @namespace    zeta-capture-ooc-hide
// @version      0.1.7
// @description  Zeta 캡처 미리보기에서 내 말풍선과 내레이터의 OOC: 구문을 인식해 골라 제거합니다.
// @match        https://zeta-ai.io/*
// @updateURL    https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-capture-ooc-hide.user.js
// @downloadURL  https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-capture-ooc-hide.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const STYLE_ID = 'zeta-capture-ooc-hide-style';
  const CONTROL_ID = 'zeta-capture-ooc-hide-control';
  const ROOT_CLASS = 'zeta-ooc-hide-preview-active';
  const EDITING_CLASS = 'zeta-ooc-hide-editing';
  const CANDIDATE_CLASS = 'zeta-ooc-candidate';
  const SELECTED_CLASS = 'zeta-ooc-selected';
  const WRAPPED_CLASS = 'zeta-ooc-range';
  const COMPACT_CLASS = 'zeta-ooc-compacted';
  const NARRATOR_WHOLE = 'zeta-ooc-narrator-whole';

  let previewRoot = null;
  let editing = false;
  let scheduled = false;
  let applying = false;
  const selectedKeys = new Set();
  const detached = [];

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function shortHash(value) {
    let h = 2166136261;
    const s = String(value || '');
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function getPreview() {
    return document.querySelector('[data-sentry-component="CapturePreview"]');
  }

  function inCurrentPreview(node) {
    return !!(previewRoot && node && previewRoot.contains(node));
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${CONTROL_ID} {
        appearance: none !important;
        -webkit-appearance: none !important;
        position: relative !important;
        z-index: 20 !important;
        pointer-events: auto !important;
        flex: 0 0 auto !important;
        height: 28px !important;
        min-width: 38px !important;
        margin: 0 !important;
        padding: 0 8px !important;
        border: 1px solid rgba(38,52,60,.10) !important;
        border-radius: 9px !important;
        background: #F1F3F4 !important;
        color: #53636C !important;
        box-shadow: none !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        font-size: 11px !important;
        font-weight: 800 !important;
        line-height: 1 !important;
        letter-spacing: -.02em !important;
        white-space: nowrap !important;
        cursor: pointer !important;
        user-select: none !important;
        -webkit-user-select: none !important;
      }
      #${CONTROL_ID}:hover { background: #E9EDF0 !important; }
      #${CONTROL_ID}[data-editing="1"] {
        background: #26343C !important;
        border-color: #26343C !important;
        color: #FFFFFF !important;
      }
      #${CONTROL_ID}[data-applied="1"]:not([data-editing="1"]) {
        background: #EEF1F3 !important;
        color: #394A54 !important;
      }

      html.${EDITING_CLASS} .${CANDIDATE_CLASS} {
        position: relative !important;
        outline: 2px dashed rgba(83,99,108,.72) !important;
        outline-offset: 3px !important;
        border-radius: 5px !important;
        cursor: pointer !important;
        touch-action: manipulation !important;
      }
      html.${EDITING_CLASS} .${CANDIDATE_CLASS}.${SELECTED_CLASS} {
        opacity: .78 !important;
        outline: 2px solid #FF5D73 !important;
        outline-offset: 3px !important;
        background-color: rgba(255,93,115,.09) !important;
      }
      .${COMPACT_CLASS} > p:last-child,
      .${COMPACT_CLASS} > div:last-child,
      .${COMPACT_CLASS} > blockquote:last-child,
      .${COMPACT_CLASS} > li:last-child {
        margin-bottom: 0 !important;
        padding-bottom: 0 !important;
      }
      .${COMPACT_CLASS} > p:first-child,
      .${COMPACT_CLASS} > div:first-child,
      .${COMPACT_CLASS} > blockquote:first-child,
      .${COMPACT_CLASS} > li:first-child {
        margin-top: 0 !important;
        padding-top: 0 !important;
      }

      @media (max-width: 640px) {
        #${CONTROL_ID} {
          height: 28px !important;
          min-width: 36px !important;
          padding: 0 7px !important;
          margin: 0 !important;
          border-radius: 8px !important;
          font-size: 10px !important;
        }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function findHeader(preview) {
    if (!(preview instanceof Element)) return null;
    return preview.querySelector(':scope > header') || preview.querySelector('header');
  }

  function ensureControl() {
    if (!previewRoot) return null;
    let control = document.getElementById(CONTROL_ID);
    if (!control) {
      control = document.createElement('button');
      control.id = CONTROL_ID;
      control.type = 'button';
      control.setAttribute('aria-label', '캡처에서 OOC 정리');
      control.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (editing) applySelection();
        else enterEditing();
      }, true);
    }

    const header = findHeader(previewRoot);
    if (header) {
      // 원래 좌측 X(Go back)는 절대 이동/대체하지 않는다.
      // 캡처 미리보기 우측의 다운로드/공유 버튼 그룹 안에 OOC 버튼을 넣는다.
      const nav = header.querySelector(':scope > nav') || header.querySelector('nav');
      const saveButton = nav?.querySelector('button[aria-label="Save captured image"]');
      const shareButton = nav?.querySelector('button[aria-label="Share captured image"]');
      const rightGroup = saveButton?.parentElement || shareButton?.parentElement || null;

      if (rightGroup instanceof Element) {
        if (control.parentElement !== rightGroup || control.nextElementSibling !== (saveButton || shareButton)) {
          rightGroup.insertBefore(control, saveButton || shareButton || rightGroup.firstChild);
        }
      } else if (nav instanceof Element) {
        // 구조가 바뀌어도 X 앞에는 넣지 않고 우측 끝에만 추가한다.
        if (control.parentElement !== nav) nav.appendChild(control);
      }
    }
    updateControl();
    return control;
  }

  function updateControl() {
    const control = document.getElementById(CONTROL_ID);
    if (!control) return;
    const count = selectedKeys.size;
    control.dataset.editing = editing ? '1' : '0';
    control.dataset.applied = !editing && count ? '1' : '0';
    if (editing) {
      control.textContent = count ? `완료 ${count}` : '완료';
      control.title = '선택한 OOC를 캡처에서 제거';
    } else {
      control.textContent = count ? `OOC ${count}` : 'OOC';
      control.title = count ? `OOC ${count}개 제거됨 · 눌러서 수정` : '캡처에서 지울 OOC 고르기';
    }
  }

  function candidateKey(root, text) {
    const bubble = root.closest('[data-sentry-component="ChatBubbleContainer"]') || root;
    return `${shortHash(normalizeText(bubble.textContent))}:${shortHash(normalizeText(text))}`;
  }

  function findOocRanges(text) {
    const out = [];
    const source = String(text || '');
    // 두 형식 모두 인식:
    //   [OOC: ...] / [OOC ...]
    //   OOC: ... / ooc : ... / OOC：...
    const re = /\[\s*OOC\b|\bOOC\s*[:：]/ig;
    let match;
    while ((match = re.exec(source))) {
      const start = match.index;
      const bracketed = source[start] === '[';
      let end = -1;

      if (bracketed) {
        let depth = 0;
        for (let i = start; i < source.length; i += 1) {
          if (source[i] === '[') depth += 1;
          else if (source[i] === ']') {
            depth -= 1;
            if (depth === 0) {
              end = i + 1;
              break;
            }
          }
        }
        if (end < 0) end = source.length;
      } else {
        // 괄호 없는 OOC:는 해당 줄 끝까지만 OOC로 본다.
        // 별도 문단이면 문단 전체가 후보가 되므로 말풍선 높이도 같이 줄어든다.
        const lineBreak = source.indexOf('\n', start);
        end = lineBreak < 0 ? source.length : lineBreak;
      }

      out.push([start, end]);
      re.lastIndex = Math.max(end, match.index + match[0].length);
    }
    return out;
  }

  function isPureOocText(text) {
    const source = normalizeText(text);
    if (!source) return false;

    // 간단형: ooc:3000자 이상 출력 같은 문단도 통째로 OOC 후보로 잡는다.
    if (/^OOC\s*[:：]/i.test(source)) return true;

    if (!/^\[\s*OOC\b/i.test(source)) return false;
    const ranges = findOocRanges(source);
    return ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] === source.length;
  }

  function rightChatRoots() {
    if (!previewRoot) return [];
    const found = new Set();
    previewRoot.querySelectorAll(
      '[data-sentry-component="RightTextContent"] [data-sentry-component="ChatBubbleContainer"] .chat, ' +
      '[data-sentry-component="ChatBubbleContainer"].kt-me .chat'
    ).forEach(el => found.add(el));
    return [...found];
  }

  function narratorChatRoots() {
    if (!previewRoot) return [];
    return [...previewRoot.querySelectorAll('[data-sentry-component="NarratorBubble"] .chat')];
  }

  function allChatRoots() {
    return [...new Set([...rightChatRoots(), ...narratorChatRoots()])];
  }

  function markPureNarrators() {
    if (!previewRoot) return;
    previewRoot.querySelectorAll('[data-sentry-component="NarratorBubble"]').forEach(narrator => {
      if (!(narrator instanceof Element)) return;
      const chat = narrator.querySelector('.chat');
      if (!(chat instanceof Element)) return;
      const text = normalizeText(chat.textContent);
      if (!text || !isPureOocText(text)) return;

      narrator.classList.add(CANDIDATE_CLASS, NARRATOR_WHOLE);
      narrator.dataset.zetaOocKey = candidateKey(narrator, text);
      narrator.dataset.zetaOocWhole = 'narrator';
      if (selectedKeys.has(narrator.dataset.zetaOocKey)) narrator.classList.add(SELECTED_CLASS);
    });
  }

  function markWholeBlocks(chat) {
    [...chat.children].forEach(block => {
      if (!(block instanceof Element)) return;
      if (!block.matches('p, li, blockquote, div')) return;
      if (block.classList.contains(CANDIDATE_CLASS)) return;
      const text = normalizeText(block.textContent);
      if (!text || !isPureOocText(text)) return;
      block.classList.add(CANDIDATE_CLASS);
      block.dataset.zetaOocKey = candidateKey(chat, text);
      block.dataset.zetaOocWhole = '1';
      if (selectedKeys.has(block.dataset.zetaOocKey)) block.classList.add(SELECTED_CLASS);
    });
  }

  function textMapFor(root) {
    const nodes = [];
    let text = '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest(`.${CANDIDATE_CLASS}, script, style, textarea, input, select, option`)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const start = text.length;
      text += node.nodeValue || '';
      nodes.push({ node, start, end: text.length });
    }
    return { text, nodes };
  }

  function locate(nodes, index, preferEnd = false) {
    for (const item of nodes) {
      if ((!preferEnd && index >= item.start && index < item.end) ||
          (preferEnd && index > item.start && index <= item.end)) {
        return { node: item.node, offset: index - item.start };
      }
    }
    if (preferEnd && nodes.length && index === nodes[nodes.length - 1].end) {
      const item = nodes[nodes.length - 1];
      return { node: item.node, offset: (item.node.nodeValue || '').length };
    }
    return null;
  }

  function wrapInlineOoc(chat) {
    const map = textMapFor(chat);
    if (!map.text) return;
    [...findOocRanges(map.text)].reverse().forEach(([rangeStart, end]) => {
      let start = rangeStart;

      // 괄호 없는 OOC가 채팅의 마지막 줄이라면, OOC 앞에 사용자가 넣은
      // 개행도 OOC와 함께 묶는다. plain text는 <p>/<em>과 달리 개행이
      // 같은 텍스트 노드 안에 남아서, OOC만 떼면 말풍선 아래 빈 줄이 생긴다.
      if (!normalizeText(map.text.slice(end))) {
        while (start > 0 && /\s/.test(map.text[start - 1])) start -= 1;
      }

      const raw = map.text.slice(start, end);
      if (!normalizeText(raw)) return;
      const startPos = locate(map.nodes, start, false);
      const endPos = locate(map.nodes, end, true);
      if (!startPos || !endPos) return;
      try {
        const range = document.createRange();
        range.setStart(startPos.node, startPos.offset);
        range.setEnd(endPos.node, endPos.offset);
        const frag = range.extractContents();
        const span = document.createElement('span');
        span.className = `${CANDIDATE_CLASS} ${WRAPPED_CLASS}`;
        span.dataset.zetaOocKey = candidateKey(chat, raw);
        if (selectedKeys.has(span.dataset.zetaOocKey)) span.classList.add(SELECTED_CLASS);
        span.appendChild(frag);
        range.insertNode(span);
      } catch (_) {}
    });
  }

  function scanCandidates() {
    if (applying || !previewRoot) return;
    applying = true;
    try {
      markPureNarrators();
      allChatRoots().forEach(chat => {
        // 순수 OOC 내레이터는 바깥 NarratorBubble 전체를 후보로 잡았으므로
        // 안쪽 텍스트를 다시 쪼개지 않는다.
        if (chat.closest(`[data-sentry-component="NarratorBubble"].${NARRATOR_WHOLE}`)) return;
        markWholeBlocks(chat);
        wrapInlineOoc(chat);
      });
      syncSelectedClasses();
    } finally {
      applying = false;
    }
  }

  function syncSelectedClasses() {
    if (!previewRoot) return;
    previewRoot.querySelectorAll(`.${CANDIDATE_CLASS}[data-zeta-ooc-key]`).forEach(el => {
      el.classList.toggle(SELECTED_CLASS, selectedKeys.has(el.dataset.zetaOocKey));
    });
  }

  function onCandidateClick(event) {
    if (!editing || !previewRoot) return;
    const target = event.target instanceof Element
      ? event.target.closest(`.${CANDIDATE_CLASS}`)
      : null;
    if (!target || !inCurrentPreview(target) || !target.dataset.zetaOocKey) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const key = target.dataset.zetaOocKey;
    if (selectedKeys.has(key)) selectedKeys.delete(key);
    else selectedKeys.add(key);
    syncSelectedClasses();
    updateControl();
  }

  function isWhitespaceText(node) {
    return node?.nodeType === Node.TEXT_NODE && !normalizeText(node.nodeValue);
  }

  function collectWholeRemoval(node) {
    const nodes = [node];
    let before = node.previousSibling;
    while (isWhitespaceText(before)) {
      nodes.unshift(before);
      before = before.previousSibling;
    }
    let after = node.nextSibling;
    while (isWhitespaceText(after)) {
      nodes.push(after);
      after = after.nextSibling;
    }
    return nodes;
  }

  function collectInlineRemoval(node) {
    const nodes = [node];
    let before = node.previousSibling;
    let after = node.nextSibling;

    // OOC 앞뒤가 줄바꿈뿐이면 그 개행까지 같이 떼어 빈 줄이 남지 않게 한다.
    while (isWhitespaceText(before) || (before?.nodeType === Node.ELEMENT_NODE && before.nodeName === 'BR')) {
      nodes.unshift(before);
      before = before.previousSibling;
    }
    while (isWhitespaceText(after) || (after?.nodeType === Node.ELEMENT_NODE && after.nodeName === 'BR')) {
      nodes.push(after);
      after = after.nextSibling;
    }
    return nodes;
  }

  function detachCandidate(candidate) {
    if (!(candidate instanceof Element) || !candidate.parentNode) return;
    const parent = candidate.parentNode;
    const wholeKind = candidate.dataset.zetaOocWhole;
    const nodes = wholeKind === '1' || wholeKind === 'narrator'
      ? collectWholeRemoval(candidate)
      : collectInlineRemoval(candidate);
    const connectedNodes = nodes.filter(node => node?.parentNode === parent);
    if (!connectedNodes.length) return;

    const marker = document.createComment('zeta-ooc-hidden');
    parent.insertBefore(marker, connectedNodes[0]);
    connectedNodes.forEach(node => node.remove());
    detached.push({ marker, nodes: connectedNodes, parent });

    const chat = parent.closest?.('.chat') || (parent instanceof Element && parent.classList.contains('chat') ? parent : null);
    if (chat instanceof Element) chat.classList.add(COMPACT_CLASS);

    // NarratorBubble 전체를 뗀 뒤 BodyView가 비었으면 자체 여백도 남지 않게 접는다.
    if (wholeKind === 'narrator' && parent instanceof Element && parent.matches('[data-sentry-component="BodyView"]')) {
      if (!normalizeText(parent.textContent) && !parent.querySelector('img,video,canvas,[data-sentry-component="RightTextContent"],[data-sentry-component="LeftTextContent"]')) {
        parent.classList.add(COMPACT_CLASS);
      }
    }
  }

  function restoreDetached() {
    while (detached.length) {
      const record = detached.pop();
      if (!record.marker?.parentNode) continue;
      for (const node of record.nodes) record.marker.parentNode.insertBefore(node, record.marker);
      record.marker.remove();
    }
    if (previewRoot) previewRoot.querySelectorAll(`.${COMPACT_CLASS}`).forEach(el => el.classList.remove(COMPACT_CLASS));
  }

  function compactAfterRemoval() {
    if (!previewRoot) return;
    allChatRoots().forEach(chat => {
      // 숨긴 OOC가 끝에 있었을 때 React/markdown이 남긴 " " 텍스트 노드가
      // whitespace-pre-wrap에서 한 줄처럼 남는 것을 제거한다.
      while (isWhitespaceText(chat.lastChild)) chat.lastChild.remove();
      while (isWhitespaceText(chat.firstChild)) chat.firstChild.remove();

      // 끝에 빈 문단/BR이 남아 있으면 같이 접는다.
      let changed = true;
      while (changed && chat.lastChild) {
        changed = false;
        const last = chat.lastChild;
        if (last.nodeType === Node.ELEMENT_NODE && last.nodeName === 'BR') {
          last.remove();
          changed = true;
        } else if (last instanceof Element && ['P', 'DIV'].includes(last.nodeName) && !normalizeText(last.textContent) && !last.querySelector('img,video,svg,canvas')) {
          last.remove();
          changed = true;
        }
      }
      chat.classList.add(COMPACT_CLASS);
    });
  }

  function enterEditing() {
    if (!previewRoot) return;
    restoreDetached();
    editing = true;
    document.documentElement.classList.add(EDITING_CLASS);
    scanCandidates();
    syncSelectedClasses();
    updateControl();
  }

  function applySelection() {
    if (!previewRoot) return;
    editing = false;
    document.documentElement.classList.remove(EDITING_CLASS);
    restoreDetached();
    scanCandidates();
    syncSelectedClasses();
    previewRoot.querySelectorAll(`.${CANDIDATE_CLASS}.${SELECTED_CLASS}`).forEach(detachCandidate);
    compactAfterRemoval();
    updateControl();
  }

  function unwrapRanges(root = document) {
    root.querySelectorAll?.(`.${WRAPPED_CLASS}`).forEach(span => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      span.remove();
      parent.normalize?.();
    });
  }

  function clearCandidateMarks(root = document) {
    root.querySelectorAll?.(`.${CANDIDATE_CLASS}`).forEach(el => {
      el.classList.remove(CANDIDATE_CLASS, SELECTED_CLASS, NARRATOR_WHOLE);
      delete el.dataset.zetaOocKey;
      delete el.dataset.zetaOocWhole;
    });
    unwrapRanges(root);
    root.querySelectorAll?.(`.${COMPACT_CLASS}`).forEach(el => el.classList.remove(COMPACT_CLASS));
  }

  function beginPreview(preview) {
    previewRoot = preview;
    selectedKeys.clear();
    detached.length = 0;
    editing = false;
    document.documentElement.classList.add(ROOT_CLASS);
    document.documentElement.classList.remove(EDITING_CLASS);
    scanCandidates();
    ensureControl();
    updateControl();
  }

  function endPreview() {
    restoreDetached();
    if (previewRoot) clearCandidateMarks(previewRoot);
    const control = document.getElementById(CONTROL_ID);
    if (control) control.remove();
    selectedKeys.clear();
    editing = false;
    document.documentElement.classList.remove(ROOT_CLASS, EDITING_CLASS);
    previewRoot = null;
  }

  function reconcile() {
    scheduled = false;
    if (applying) return;
    const current = getPreview();

    if (current && current !== previewRoot) {
      if (previewRoot) endPreview();
      beginPreview(current);
      return;
    }

    if (!current && previewRoot) {
      endPreview();
      return;
    }

    if (current && previewRoot) {
      ensureControl();
      if (editing) {
        scanCandidates();
        syncSelectedClasses();
      }
      updateControl();
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(reconcile);
  }

  function start() {
    installStyle();
    document.addEventListener('click', onCandidateClick, true);
    reconcile();

    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });

    window.addEventListener('pageshow', schedule, true);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) schedule();
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();