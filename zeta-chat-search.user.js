// ==UserScript==
// @name         Zeta Chat Search
// @namespace    zeta-chat-search
// @version      0.1.3
// @description  대화창 안에서 지난 대화를 검색합니다. 읽은 대화는 브라우저에 색인해 두고 다음부터는 다시 훑지 않습니다.
// @match        https://zeta-ai.io/*
// @updateURL    https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-chat-search.user.js
// @downloadURL  https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-chat-search.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_VERSION = '0.1.3';
  window.__zetaChatSearchVersion = SCRIPT_VERSION;

  const MENU_ROW_ID = 'zeta-chat-search-menu';
  const PANEL_ID = 'zeta-chat-search-panel';
  const STYLE_ID = 'zeta-chat-search-style';
  const HIGHLIGHT_CLASS = 'zcs-hit';

  const CHAT_SELECTOR = '[role="log"][aria-label="Chat messages"]';
  const MESSAGE_SELECTOR = '[data-sentry-component="BodyView"][id^="message-"]';

  const DB_NAME = 'zeta-chat-search';
  const DB_VERSION = 1;
  const STORE = 'messages';

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value || '').replace(/​/g, '').replace(/\s+/g, ' ').trim();
  const fold = value => clean(value).toLocaleLowerCase('ko-KR');

  // ── 색인 저장소 ──────────────────────────────────────────────────────
  // 대화 본문은 이름 몇 글자와 덩치가 다르다. localStorage로는 금방 넘친다.
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('room', 'roomId', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => {
      dbPromise = null;
      throw error;
    });
    return dbPromise;
  }

  async function saveMessages(rows) {
    if (!rows.length) return;
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const row of rows) store.put(row);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadRoomMessages(roomId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).index('room').getAll(roomId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function clearRoom(roomId) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.index('room').openKeyCursor(IDBKeyRange.only(roomId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  // ── 화면에 그려진 대화 읽기 ──────────────────────────────────────────
  // 요청은 보내지 않는다. 제타가 이미 그린 것만 읽는다.
  function currentRoomId() {
    const match = location.pathname.match(/\/rooms\/([^/?#]+)/i);
    return match ? match[1] : null;
  }

  function chatLog() {
    return document.querySelector(CHAT_SELECTOR);
  }

  function roleOf(body) {
    if (body.querySelector('[data-sentry-component="RightTextContent"]')) return 'user';
    if (body.querySelector('[data-sentry-component="LeftTextContent"]')) return 'assistant';
    return 'narrator';
  }

  function speakerOf(body, role) {
    const selector = role === 'user'
      ? '[data-sentry-component="RightTextContent"] .caption1'
      : '[data-sentry-component="LeftTextContent"] .caption1';
    return clean(body.querySelector(selector)?.textContent || '')
      .replace(/^@+/, '')
      .replace(/:+$/, '');
  }

  function messageNumber(id) {
    const match = String(id || '').match(/^message-MESSAGE-(\d+)-/);
    return match ? Number(match[1]) : 0;
  }

  function readRenderedMessages(roomId) {
    const rows = [];
    for (const body of document.querySelectorAll(MESSAGE_SELECTOR)) {
      if (!body.id) continue;
      const role = roleOf(body);
      const text = clean(body.textContent);
      if (!text) continue;
      rows.push({
        key: roomId + '|' + body.id,
        roomId,
        id: body.id,
        num: messageNumber(body.id),
        role,
        speaker: speakerOf(body, role),
        text
      });
    }
    return rows;
  }

  // 같은 메시지를 매번 다시 쓰면 저장소가 쉴 새 없이 돈다.
  let knownRoomId = '';
  const knownKeys = new Set();

  async function captureRendered() {
    const roomId = currentRoomId();
    if (!roomId) return 0;
    if (roomId !== knownRoomId) {
      knownRoomId = roomId;
      knownKeys.clear();
    }

    const fresh = readRenderedMessages(roomId).filter(row => !knownKeys.has(row.key));
    if (!fresh.length) return 0;
    for (const row of fresh) knownKeys.add(row.key);

    try {
      await saveMessages(fresh);
    } catch (_) {
      return 0;
    }
    return fresh.length;
  }

  // ── 지난 대화 더 불러오기 ────────────────────────────────────────────
  // 제타는 스크롤해야 옛 대화를 내준다. 우리가 요청을 만들지는 않는다.
  let deepLoadRunning = false;
  let deepLoadAborted = false;

  async function loadOlder(onProgress) {
    const log = chatLog();
    if (!log || deepLoadRunning) return 0;

    deepLoadRunning = true;
    deepLoadAborted = false;
    let added = 0;
    let stable = 0;

    try {
      while (!deepLoadAborted && stable < 4) {
        const beforeTop = log.scrollTop;
        const beforeHeight = log.scrollHeight;
        const step = Math.max(320, log.clientHeight * 0.82);

        log.scrollBy({ top: -step, behavior: 'auto' });
        await sleep(140);
        added += await captureRendered();
        await sleep(60);
        added += await captureRendered();

        const moved = Math.abs(log.scrollTop - beforeTop) > 2;
        const resized = Math.abs(log.scrollHeight - beforeHeight) > 2;
        stable = moved || resized ? 0 : stable + 1;
        onProgress?.(added);
      }
    } finally {
      deepLoadRunning = false;
    }
    return added;
  }

  // ── 검색 ─────────────────────────────────────────────────────────────
  function matchRows(rows, query) {
    const needle = fold(query);
    if (!needle) return [];
    return rows
      .filter(row => fold(row.text).includes(needle))
      .sort((a, b) => b.num - a.num);
  }

  function snippetOf(text, query) {
    const source = clean(text);
    const at = fold(source).indexOf(fold(query));
    if (at < 0) return source.slice(0, 120);
    const from = Math.max(0, at - 40);
    return (from ? '…' : '') + source.slice(from, at + query.length + 80);
  }

  function highlightInto(element, text, query) {
    const at = fold(text).indexOf(fold(query));
    if (at < 0) {
      element.textContent = text;
      return;
    }
    const mark = document.createElement('mark');
    mark.textContent = text.slice(at, at + query.length);
    element.append(text.slice(0, at), mark, text.slice(at + query.length));
  }

  async function jumpToMessage(row, status) {
    const existing = document.getElementById(row.id);
    if (existing) {
      existing.scrollIntoView({ block: 'center', behavior: 'smooth' });
      existing.classList.add(HIGHLIGHT_CLASS);
      setTimeout(() => existing.classList.remove(HIGHLIGHT_CLASS), 2200);
      return true;
    }

    // 아직 화면에 없는 옛 메시지면 거기까지 거슬러 올라간다.
    status('그 대화까지 거슬러 올라가는 중…');
    const log = chatLog();
    if (!log) return false;

    for (let round = 0; round < 400 && !deepLoadAborted; round++) {
      if (document.getElementById(row.id)) return jumpToMessage(row, status);
      const beforeTop = log.scrollTop;
      log.scrollBy({ top: -Math.max(320, log.clientHeight * 0.82), behavior: 'auto' });
      await sleep(120);
      await captureRendered();
      if (Math.abs(log.scrollTop - beforeTop) <= 2 && !document.getElementById(row.id)) {
        await sleep(160);
        if (Math.abs(log.scrollTop - beforeTop) <= 2) break;
      }
    }
    return Boolean(document.getElementById(row.id));
  }

  // ── 검색 패널 ────────────────────────────────────────────────────────
  function closePanel() {
    deepLoadAborted = true;
    document.getElementById(PANEL_ID)?.remove();
  }

  async function openPanel() {
    const roomId = currentRoomId();
    if (!roomId) return;

    closePanel();
    injectStyle();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML =
      '<div class="zcs-card" role="dialog" aria-modal="true" aria-label="대화 검색">' +
        '<div class="zcs-head">' +
          '<input type="search" class="zcs-input" placeholder="대화 내용 검색" autocomplete="off">' +
          '<button type="button" class="zcs-close" aria-label="닫기">×</button>' +
        '</div>' +
        '<div class="zcs-status"></div>' +
        '<div class="zcs-list"></div>' +
        '<div class="zcs-foot">' +
          '<button type="button" class="zcs-more">지난 대화 더 불러오기</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(panel);

    const input = panel.querySelector('.zcs-input');
    const list = panel.querySelector('.zcs-list');
    const statusEl = panel.querySelector('.zcs-status');
    const moreButton = panel.querySelector('.zcs-more');
    const status = text => { statusEl.textContent = text; };

    let rows = [];
    const reload = async () => {
      await captureRendered();
      rows = await loadRoomMessages(roomId);
      return rows;
    };

    const render = () => {
      const query = clean(input.value);
      list.textContent = '';

      if (!query) {
        status('이 대화방에 색인된 메시지 ' + rows.length + '개');
        return;
      }

      const hits = matchRows(rows, query);
      status(hits.length
        ? '찾은 메시지 ' + hits.length + '개 · 색인 ' + rows.length + '개'
        : '색인된 ' + rows.length + '개 중에는 없어요. 지난 대화를 더 불러와 보세요.');

      for (const row of hits.slice(0, 100)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'zcs-item';

        const who = document.createElement('div');
        who.className = 'zcs-who';
        who.textContent = row.speaker || (row.role === 'user' ? '나' : '상대');

        const body = document.createElement('div');
        body.className = 'zcs-text';
        highlightInto(body, snippetOf(row.text, query), query);

        item.append(who, body);
        item.addEventListener('click', async () => {
          // 옛 메시지는 거기까지 거슬러 올라가야 한다. 그동안 패널을 열어 둔 채
          // 진행 상황을 보여 주고, 찾으면 그때 닫는다.
          const found = await jumpToMessage(row, status);
          if (found) closePanel();
          else status('그 대화까지 가지 못했어요. 지난 대화를 더 불러온 뒤 다시 시도해 주세요.');
        });
        list.appendChild(item);
      }
    };

    panel.querySelector('.zcs-close').addEventListener('click', closePanel);
    panel.addEventListener('click', event => { if (event.target === panel) closePanel(); });
    input.addEventListener('input', render);
    input.addEventListener('keydown', event => { if (event.key === 'Escape') closePanel(); });

    moreButton.addEventListener('click', async () => {
      if (deepLoadRunning) {
        deepLoadAborted = true;
        return;
      }
      moreButton.textContent = '중지';
      const added = await loadOlder(count => status('불러오는 중 · 새로 색인 ' + count + '개'));
      moreButton.textContent = '지난 대화 더 불러오기';
      await reload();
      status('새로 색인 ' + added + '개 · 전체 ' + rows.length + '개');
      render();
    });

    status('색인을 읽는 중…');
    await reload();
    render();
    input.focus();
  }

  // ── 제타 사이드바 메뉴에 끼워 넣기 ───────────────────────────────────
  function menuAnchor() {
    const scope = document.querySelector('[data-sentry-component="ChatSidebar"]') || document.body;

    // Room Manager도 '대화 캡처' 아래를 자기 자리로 삼는다. 둘 다 그 자리를
    // 고집하면 서로 밀어내며 순서가 계속 바뀐다. 그쪽이 있으면 그 아래에 선다.
    const roomManagerRow = scope.querySelector('#zeta-room-manager-chat-rename');
    if (roomManagerRow) return roomManagerRow;

    const buttons = Array.from(scope.querySelectorAll('button'));
    return buttons.find(button => clean(button.textContent) === '대화 캡처')
      || buttons.find(button => clean(button.textContent) === '책갈피 목록')
      || null;
  }

  function renderMenuRow() {
    if (!currentRoomId()) {
      document.getElementById(MENU_ROW_ID)?.remove();
      return;
    }

    const anchor = menuAnchor();
    if (!anchor) {
      document.getElementById(MENU_ROW_ID)?.remove();
      return;
    }

    let row = document.getElementById(MENU_ROW_ID);
    if (!row) {
      row = document.createElement('button');
      row.id = MENU_ROW_ID;
      row.type = 'button';
      row.textContent = '대화 검색';
      row.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        void openPanel();
      }, true);
    }

    // 제타가 메뉴 항목에 쓰는 모양을 그대로 따른다.
    row.className = anchor.className + ' zcs-menu-row';
    if (anchor.nextElementSibling !== row) anchor.after(row);
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483600;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(0,0,0,.45);
        box-sizing: border-box;
      }
      #${PANEL_ID} .zcs-card {
        display: flex;
        flex-direction: column;
        width: min(420px, 100%);
        max-height: min(80vh, 620px);
        border-radius: 16px;
        background: var(--kt-white, #202023);
        color: var(--kt-text, #fff);
        box-shadow: 0 20px 60px rgba(0,0,0,.45);
        overflow: hidden;
        font: 500 13px/1.5 system-ui, -apple-system, sans-serif;
      }
      #${PANEL_ID} .zcs-head { display: flex; gap: 8px; padding: 14px 14px 10px; }
      #${PANEL_ID} .zcs-input {
        flex: 1 1 auto;
        height: 40px;
        min-width: 0;
        padding: 0 12px;
        box-sizing: border-box;
        border: 1px solid var(--kt-line, rgba(255,255,255,.12));
        border-radius: 10px;
        background: var(--kt-soft, #2a2a2e);
        color: inherit;
        font: inherit;
      }
      #${PANEL_ID} .zcs-close {
        flex: 0 0 auto;
        width: 40px;
        height: 40px;
        border: 0;
        border-radius: 10px;
        background: transparent;
        color: var(--kt-sub, rgba(255,255,255,.6));
        font-size: 22px;
        cursor: pointer;
      }
      #${PANEL_ID} .zcs-status {
        padding: 0 16px 8px;
        color: var(--kt-sub, rgba(255,255,255,.55));
        font-size: 11px;
      }
      #${PANEL_ID} .zcs-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 10px 6px; }
      #${PANEL_ID} .zcs-item {
        display: block;
        width: 100%;
        margin-bottom: 6px;
        padding: 10px 12px;
        border: 0;
        border-radius: 12px;
        background: var(--kt-soft2, rgba(255,255,255,.05));
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      #${PANEL_ID} .zcs-item:hover { background: var(--kt-soft, rgba(255,255,255,.1)); }
      #${PANEL_ID} .zcs-who {
        margin-bottom: 3px;
        color: var(--kt-sub, rgba(255,255,255,.5));
        font-size: 11px;
        font-weight: 700;
      }
      #${PANEL_ID} .zcs-text { font-size: 12px; line-height: 1.5; word-break: break-word; }
      #${PANEL_ID} mark {
        padding: 0 2px;
        border-radius: 4px;
        background: var(--kt-yellow, #6d52ff);
        color: var(--kt-text, #fff);
      }
      #${PANEL_ID} .zcs-foot { padding: 8px 14px 14px; }
      #${PANEL_ID} .zcs-more {
        width: 100%;
        height: 40px;
        border: 0;
        border-radius: 10px;
        background: var(--kt-yellow, #6d52ff);
        color: var(--kt-text, #fff);
        font: 700 12px/1 system-ui, sans-serif;
        cursor: pointer;
      }
      .${HIGHLIGHT_CLASS} {
        outline: 2px solid var(--kt-yellow, #6d52ff);
        outline-offset: 3px;
        border-radius: 10px;
        transition: outline-color .3s ease;
      }
    `;
    document.documentElement.appendChild(style);
  }

  // ── 시작 ─────────────────────────────────────────────────────────────
  function start() {
    document.getElementById(MENU_ROW_ID)?.remove();
    injectStyle();

    // 메뉴 항목 붙이기는 가볍다. 색인 쌓기에 딸려 늦어지면 메뉴를 열었을 때
    // '대화 검색'만 한 박자 늦게 튀어나온다. 둘을 따로 돌린다.
    let menuTimer = null;
    const scheduleMenu = () => {
      if (menuTimer) return;
      menuTimer = setTimeout(() => {
        menuTimer = null;
        renderMenuRow();
      }, 120);
    };

    let captureTimer = null;
    const scheduleCapture = () => {
      if (captureTimer) return;
      captureTimer = setTimeout(() => {
        captureTimer = null;
        void captureRendered();
      }, 700);
    };

    new MutationObserver(() => {
      scheduleMenu();
      scheduleCapture();
    }).observe(document.documentElement, { childList: true, subtree: true });

    renderMenuRow();
    scheduleCapture();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
