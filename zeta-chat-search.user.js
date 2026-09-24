// ==UserScript==
// @name         Zeta Chat Search
// @namespace    zeta-chat-search
// @version      0.2.2
// @description  대화창 안에서 지난 대화를 검색합니다. 읽은 대화는 브라우저에 색인해 두고 다음부터는 다시 훑지 않습니다.
// @match        https://zeta-ai.io/*
// @updateURL    https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-chat-search.user.js
// @downloadURL  https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-chat-search.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_VERSION = '0.2.2';
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
  const JUMP_REQUEST_KEY = 'zcs-pending-api-jump';
  const JUMP_HIGHLIGHT_KEY = 'zcs-pending-highlight';

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value || '').replace(/​/g, '').replace(/\s+/g, ' ').trim();
  const fold = value => clean(value).toLocaleLowerCase('ko-KR');

  // 책갈피 이동과 동일하게 첫 메시지 요청에 roomId:MESSAGE-ID 커서를 넣는다.
  // document-start에서 설치해야 제타의 초기 XHR보다 먼저 가로챌 수 있다.
  function installJumpRequestInterceptor() {
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(JUMP_REQUEST_KEY) || 'null'); } catch (_) {}
    if (!pending?.roomId || !pending?.cursor || pending.roomId !== currentRoomId()) return;

    const proto = window.XMLHttpRequest?.prototype;
    if (!proto || proto.open.__zcsJumpPatched) return;
    const originalOpen = proto.open;

    function wrappedOpen(method, value, ...rest) {
      let nextValue = value;
      try {
        const url = new URL(String(value), location.href);
        const expectedPath = '/v1/rooms/' + pending.roomId + '/messages';
        const isInitialMessagesRequest =
          String(method || 'GET').toUpperCase() === 'GET' &&
          url.pathname === expectedPath &&
          !url.searchParams.has('cursor') &&
          !url.searchParams.has('prevCursor');

        if (isInitialMessagesRequest) {
          url.searchParams.set('limit', '10');
          url.searchParams.set('cursor', pending.roomId + ':' + pending.cursor);
          nextValue = url.href;
          sessionStorage.removeItem(JUMP_REQUEST_KEY);
          sessionStorage.setItem(JUMP_HIGHLIGHT_KEY, 'message-' + pending.cursor);
          pending = null;
        }
      } catch (_) {}
      return originalOpen.call(this, method, nextValue, ...rest);
    }

    Object.defineProperty(wrappedOpen, '__zcsJumpPatched', { value: true });
    proto.open = wrappedOpen;
  }

  installJumpRequestInterceptor();

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

  // 전체 색인이 끝까지 정상 완료된 경우에만, 이번 순회에서 실제로 확인하지 못한
  // 예전 색인 행을 제거한다. 가상 스크롤로 DOM에서 잠깐 사라진 것만 보고 지우지는 않는다.
  async function pruneMissingRoomMessages(roomId, seenKeys) {
    if (!roomId || !(seenKeys instanceof Set)) return 0;
    const stored = await loadRoomMessages(roomId);
    const stale = stored.filter(row => row?.key && !seenKeys.has(row.key));
    if (!stale.length) return 0;

    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const row of stale) store.delete(row.key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('색인 정리 중단'));
    });

    // 현재 방 메모리 캐시에도 남아 있으면 같이 비운다.
    for (const row of stale) knownKeys.delete(row.key);
    return stale.length;
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

  async function captureRendered(seenKeys = null) {
    const roomId = currentRoomId();
    if (!roomId) return 0;
    if (roomId !== knownRoomId) {
      knownRoomId = roomId;
      knownKeys.clear();
    }

    const rendered = readRenderedMessages(roomId);
    if (seenKeys instanceof Set) {
      for (const row of rendered) seenKeys.add(row.key);
    }

    const fresh = rendered.filter(row => !knownKeys.has(row.key));
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

  function logIsReverse(log) {
    try {
      return getComputedStyle(log).flexDirection.includes('reverse');
    } catch (_) {
      return false;
    }
  }

  // 대화 전체 저장이 쓰는 방식이다. 먼저 끝까지 빠르게 올라가 제타가 옛
  // 대화를 붙이게 하고, 그다음 내려오며 꼼꼼히 읽는다. 가상 스크롤은 화면에
  // 든 것만 그리므로, 올라가며 읽는 것만으로는 중간이 빈다.
  async function deepIndex(onProgress) {
    const log = chatLog();
    const roomId = currentRoomId();
    if (!log || !roomId || deepLoadRunning) return { added: 0, removed: 0, completed: false };

    deepLoadRunning = true;
    deepLoadAborted = false;
    const reverse = logIsReverse(log);
    const seenKeys = new Set();
    let added = 0;
    let removed = 0;
    let reachedOldest = false;
    let reachedNewest = false;

    try {
      // 1단계 — 끝까지 올라가기. 높이가 더 늘지 않으면 과거 대화를 전부 붙였다고 본다.
      let stable = 0;
      while (!deepLoadAborted && stable < 4) {
        const beforeHeight = log.scrollHeight;
        log.scrollTo({
          top: reverse ? -(log.scrollHeight + log.clientHeight) : 0,
          behavior: 'auto'
        });
        await sleep(320);
        added += await captureRendered(seenKeys);
        stable = Math.abs(log.scrollHeight - beforeHeight) > 2 ? 0 : stable + 1;
        onProgress?.(added, 'up');
      }
      reachedOldest = !deepLoadAborted && stable >= 4;

      // 2단계 — 내려오며 읽기. 한 화면보다 좁게 움직여 가상 스크롤 누락을 줄인다.
      let guard = 0;
      while (!deepLoadAborted && guard++ < 3000) {
        const beforeTop = log.scrollTop;
        log.scrollBy({ top: Math.max(240, log.clientHeight * 0.6), behavior: 'auto' });
        await sleep(110);
        added += await captureRendered(seenKeys);
        onProgress?.(added, 'down');

        const moved = Math.abs(log.scrollTop - beforeTop) > 2;
        const atBottom = reverse
          ? Math.abs(log.scrollTop) < 3
          : log.scrollTop + log.clientHeight >= log.scrollHeight - 3;
        if (atBottom) {
          reachedNewest = true;
          break;
        }
        if (!moved) {
          // 더 움직이지 않는 지점이 실제 최신 끝인지 한 번 더 확인한다.
          reachedNewest = reverse
            ? Math.abs(log.scrollTop) < 3
            : log.scrollTop + log.clientHeight >= log.scrollHeight - 3;
          break;
        }
      }

      const completed = !deepLoadAborted && reachedOldest && reachedNewest;
      if (completed) {
        removed = await pruneMissingRoomMessages(roomId, seenKeys);
      }
      return { added, removed, completed };
    } finally {
      deepLoadRunning = false;
    }
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

  function messageCursor(messageId) {
    const match = String(messageId || '').match(/^message-(MESSAGE-\d+-[A-Za-z0-9_-]+)/);
    return match ? match[1] : '';
  }

  async function tryNativeCursor(row, status) {
    const roomId = currentRoomId();
    const cursor = messageCursor(row.id);
    if (!roomId || !cursor) return false;

    status('이동 중');
    try {
      sessionStorage.setItem(JUMP_REQUEST_KEY, JSON.stringify({ roomId, cursor }));
      sessionStorage.setItem(JUMP_HIGHLIGHT_KEY, row.id);
    } catch (_) {
      return false;
    }
    location.reload();
    return true;
  }

  function revealPendingJump() {
    let id = '';
    try { id = sessionStorage.getItem(JUMP_HIGHLIGHT_KEY) || ''; } catch (_) {}
    if (!id) return false;

    const target = document.getElementById(id);
    if (!target) return false;
    target.scrollIntoView({ block: 'center', behavior: 'auto' });
    target.classList.add(HIGHLIGHT_CLASS);
    setTimeout(() => target.classList.remove(HIGHLIGHT_CLASS), 2600);
    try { sessionStorage.removeItem(JUMP_HIGHLIGHT_KEY); } catch (_) {}
    return true;
  }

  async function jumpToMessage(row, status) {
    // openPanel()은 기존 패널/작업을 정리하면서 중지 플래그를 켠다.
    // 새 결과를 누른 시점에는 이동 작업을 새로 시작해야 한다.
    deepLoadAborted = false;

    const existing = document.getElementById(row.id);
    if (existing) {
      existing.scrollIntoView({ block: 'center', behavior: 'smooth' });
      existing.classList.add(HIGHLIGHT_CLASS);
      setTimeout(() => existing.classList.remove(HIGHLIGHT_CLASS), 2200);
      return true;
    }

    // 제타 책갈피와 같은 cursor 이동을 먼저 쓴다. 전체 대화를 한 칸씩
    // 훑는 것보다 빠르고, 가상 스크롤에서 메시지가 빠지는 문제도 피한다.
    if (await tryNativeCursor(row, status)) return true;

    // cursor 이동을 지원하지 않는 화면에서는 기존 스크롤 탐색으로 대체한다.
    status('이동 중');
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
  function emptyView(title, detail) {
    const box = document.createElement('div');
    box.className = 'zcs-empty';
    const heading = document.createElement('div');
    heading.className = 'zcs-empty-title';
    heading.textContent = title;
    const body = document.createElement('div');
    body.className = 'zcs-empty-text';
    body.textContent = detail;
    box.append(heading, body);
    return box;
  }


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
        '<div class="zcs-grip"></div>' +
        '<div class="zcs-head">' +
          '<h2 class="zcs-title">대화 검색</h2>' +
          '<button type="button" class="zcs-close" aria-label="닫기">' +
            '<svg viewBox="0 0 20 20" aria-hidden="true">' +
              '<path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" ' +
                'stroke-linecap="round" fill="none"></path>' +
            '</svg>' +
          '</button>' +
        '</div>' +
        '<div class="zcs-field">' +
          '<svg class="zcs-field-icon" viewBox="0 0 20 20" aria-hidden="true">' +
            '<circle cx="9" cy="9" r="5.4" stroke="currentColor" stroke-width="1.7" fill="none"></circle>' +
            '<path d="M13.2 13.2L17 17" stroke="currentColor" stroke-width="1.7" ' +
              'stroke-linecap="round" fill="none"></path>' +
          '</svg>' +
          '<input type="search" class="zcs-input" placeholder="이 대화방에서 찾기" autocomplete="off">' +
        '</div>' +
        '<div class="zcs-status"></div>' +
        '<div class="zcs-list"></div>' +
        '<div class="zcs-foot">' +
          '<button type="button" class="zcs-more">이 방 전체 색인하기</button>' +
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
        // 색인이 도는 동안에는 창을 닫으면 멈춘다는 것부터 알려야 한다.
        if (deepLoadRunning) {
          list.dataset.zcsView = 'indexing';
          list.appendChild(emptyView(
            '대화를 색인하는 중이에요',
            '끝날 때까지 이 창을 닫지 말아 주세요. 멈추려면 아래 중지를 누르세요.'
          ));
          return;
        }
        list.dataset.zcsView = 'idle';
        status('이 대화방에 색인된 메시지 ' + rows.length.toLocaleString() + '개');
        list.appendChild(emptyView('찾을 말을 입력해 주세요', '지금까지 읽은 대화에서 바로 찾습니다.'));
        return;
      }
      list.dataset.zcsView = 'hits';

      const hits = matchRows(rows, query);
      status(hits.length
        ? '찾은 메시지 ' + hits.length.toLocaleString() + '개 · 색인 ' + rows.length.toLocaleString() + '개'
        : '색인 ' + rows.length.toLocaleString() + '개');

      if (!hits.length) {
        list.appendChild(emptyView(
          '찾은 대화가 없어요',
          '아래에서 전체 색인을 한 번 돌리면 옛 대화까지 찾습니다.'
        ));
        return;
      }

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
          // 이동 중에는 긴 결과 목록을 접고 상태만 보이는 작은 창으로 만든다.
          const card = panel.querySelector('.zcs-card');
          panel.classList.add('zcs-jumping-overlay');
          card.classList.add('zcs-jumping');
          const found = await jumpToMessage(row, status);
          if (found) {
            closePanel();
          } else {
            panel.classList.remove('zcs-jumping-overlay');
            card.classList.remove('zcs-jumping');
            status('그 대화까지 가지 못했어요. 전체 색인을 돌린 뒤 다시 눌러 주세요.');
          }
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
      render();
      const result = await deepIndex((count, phase) => {
        status((phase === 'up' ? '옛 대화를 불러오는 중' : '내려오며 꼼꼼히 읽는 중') +
          ' · 새로 색인 ' + count.toLocaleString() + '개');
        // 색인 안내는 한 번만 그린다. 진행할 때마다 다시 그리면 화면이 떤다.
        if (!clean(input.value) && list.dataset.zcsView !== 'indexing') render();
      });
      moreButton.textContent = '이 방 전체 색인하기';
      await reload();
      // render가 상태줄을 다시 쓰므로 결과 요약은 그 뒤에 적는다.
      render();
      const cleanupText = result.removed
        ? ' · 삭제된 대화 색인 정리 ' + result.removed.toLocaleString() + '개'
        : '';
      status((deepLoadAborted ? '색인 중지됨 · ' : (result.completed ? '색인 완료 · ' : '색인 일부 완료 · ')) +
        '새로 색인 ' + result.added.toLocaleString() + '개' + cleanupText +
        ' · 전체 ' + rows.length.toLocaleString() + '개');
    });

    status('색인을 읽는 중…');
    await reload();
    render();
    input.focus();
  }

  // ── 제타 사이드바 메뉴에 끼워 넣기 ───────────────────────────────────
  function menuAnchor() {
    const scope = document.querySelector('[data-sentry-component="ChatSidebar"]') || document.body;

    // '대화 캡처' 바로 아래가 제자리다. Room Manager의 별명 항목이 그 아래에
    // 서기로 했으므로 서로 밀어내지 않는다.
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
        padding: 24px;
        background: rgba(12,16,20,.55);
        backdrop-filter: blur(6px);
        box-sizing: border-box;
        font: 500 13px/1.55 -apple-system, BlinkMacSystemFont, "Noto Sans KR", system-ui, sans-serif;
      }
      #${PANEL_ID} .zcs-card {
        display: flex;
        flex-direction: column;
        width: min(440px, 100%);
        max-height: min(78vh, 640px);
        border-radius: 20px;
        background: var(--kt-white, #1c1c20);
        color: var(--kt-text, #f2f2f4);
        box-shadow: 0 24px 70px rgba(0,0,0,.45);
        overflow: hidden;
      }
      #${PANEL_ID} .zcs-grip { display: none; }
      #${PANEL_ID} .zcs-head {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: space-between;
        padding: 18px 18px 10px;
      }
      #${PANEL_ID} .zcs-title {
        margin: 0;
        font-size: 16px;
        font-weight: 800;
        letter-spacing: -.01em;
      }
      #${PANEL_ID} .zcs-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border: 0;
        border-radius: 9px;
        background: transparent;
        color: var(--kt-sub, rgba(255,255,255,.55));
        cursor: pointer;
      }
      #${PANEL_ID} .zcs-close svg { width: 16px; height: 16px; }
      #${PANEL_ID} .zcs-close:hover { background: transparent; }
      #${PANEL_ID} .zcs-field {
        display: flex;
        flex: 0 0 44px;
        align-items: center;
        gap: 8px;
        margin: 0 18px;
        padding: 0 12px;
        height: 44px;
        border-radius: 12px;
        background: var(--kt-soft, rgba(255,255,255,.07));
      }
      #${PANEL_ID} .zcs-field-icon {
        width: 17px;
        height: 17px;
        flex: 0 0 auto;
        color: var(--kt-muted, rgba(255,255,255,.4));
      }
      #${PANEL_ID} .zcs-input {
        flex: 1 1 auto;
        min-width: 0;
        height: 100%;
        border: 0;
        outline: none;
        background: transparent;
        color: inherit;
        font: 600 14px/1 inherit;
        -webkit-appearance: none;
        appearance: none;
      }
      #${PANEL_ID} .zcs-input::placeholder { color: var(--kt-muted, rgba(255,255,255,.35)); font-weight: 500; }
      #${PANEL_ID} .zcs-input::-webkit-search-cancel-button { display: none; }
      #${PANEL_ID} .zcs-status {
        flex: 0 0 auto;
        padding: 10px 20px 6px;
        color: var(--kt-sub, rgba(255,255,255,.45));
        font-size: 11px;
        font-weight: 600;
        letter-spacing: .01em;
      }
      #${PANEL_ID} .zcs-list {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        padding: 2px 12px 8px;
      }
      #${PANEL_ID} .zcs-item {
        display: block;
        width: 100%;
        margin-bottom: 6px;
        padding: 11px 13px;
        border: 0;
        border-radius: 14px;
        background: var(--kt-soft2, rgba(255,255,255,.045));
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition: background .15s ease;
      }
      #${PANEL_ID} .zcs-item:hover { background: var(--kt-soft, rgba(255,255,255,.1)); }
      #${PANEL_ID} .zcs-who {
        margin-bottom: 4px;
        color: var(--kt-sub, rgba(255,255,255,.5));
        font-size: 11px;
        font-weight: 700;
      }
      #${PANEL_ID} .zcs-text {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        font-size: 12.5px;
        line-height: 1.5;
        word-break: break-word;
      }
      #${PANEL_ID} mark {
        padding: 0 2px;
        border-radius: 4px;
        background: var(--kt-yellow, #6d52ff);
        color: var(--kt-text, #fff);
        font-weight: 700;
      }
      #${PANEL_ID} .zcs-empty {
        padding: 34px 18px 38px;
        text-align: center;
      }
      #${PANEL_ID} .zcs-empty-title {
        font-size: 13px;
        font-weight: 700;
      }
      #${PANEL_ID} .zcs-empty-text {
        margin-top: 5px;
        color: var(--kt-sub, rgba(255,255,255,.45));
        font-size: 11.5px;
      }
      #${PANEL_ID} .zcs-foot {
        flex: 0 0 auto;
        padding: 14px 16px;
        border-top: 1px solid var(--kt-line, rgba(255,255,255,.07));
      }
      #${PANEL_ID} .zcs-more {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 44px;
        padding: 0;
        border: 0;
        border-radius: 12px;
        background: var(--kt-yellow, #6d52ff);
        color: var(--kt-text, #fff);
        font-family: inherit;
        font-size: 13px;
        font-weight: 800;
        line-height: 1;
        cursor: pointer;
      }
      #${PANEL_ID} .zcs-more:hover { filter: brightness(.96); }
      #${PANEL_ID}.zcs-jumping-overlay {
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      #${PANEL_ID} .zcs-card.zcs-jumping {
        width: min(280px, calc(100% - 48px));
        height: auto;
        max-height: none;
        border-radius: 16px;
      }
      #${PANEL_ID} .zcs-card.zcs-jumping .zcs-grip,
      #${PANEL_ID} .zcs-card.zcs-jumping .zcs-head,
      #${PANEL_ID} .zcs-card.zcs-jumping .zcs-field,
      #${PANEL_ID} .zcs-card.zcs-jumping .zcs-list,
      #${PANEL_ID} .zcs-card.zcs-jumping .zcs-foot {
        display: none;
      }
      #${PANEL_ID} .zcs-card.zcs-jumping .zcs-status {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 22px 18px;
        color: var(--kt-text, #fff);
        font-size: 13px;
        text-align: center;
      }
      #${PANEL_ID} .zcs-card.zcs-jumping .zcs-status::before {
        content: '';
        width: 16px;
        height: 16px;
        flex: 0 0 auto;
        border: 2px solid var(--kt-line, rgba(255,255,255,.2));
        border-top-color: var(--kt-yellow, #6d52ff);
        border-radius: 50%;
        animation: zcs-spin .75s linear infinite;
      }
      @keyframes zcs-spin { to { transform: rotate(360deg); } }

      /* 좁은 화면에서는 제타처럼 아래에서 올라오는 시트로 */
      @media (max-width: 600px) {
        #${PANEL_ID} { align-items: flex-end; padding: 0; }
        #${PANEL_ID} .zcs-card {
          width: 100%;
          max-height: 86vh;
          border-radius: 20px 20px 0 0;
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }
        #${PANEL_ID} .zcs-grip {
          display: block;
          width: 36px;
          height: 4px;
          margin: 9px auto 0;
          border-radius: 2px;
          background: var(--kt-line, rgba(255,255,255,.18));
        }
        #${PANEL_ID} .zcs-head { padding: 12px 16px 8px; }
        #${PANEL_ID} .zcs-field { margin: 0 16px; }
      }

      .${HIGHLIGHT_CLASS} {
        outline: 2px solid var(--kt-yellow, #6d52ff);
        outline-offset: 3px;
        border-radius: 10px;
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
      if (deepLoadRunning || captureTimer) return;
      captureTimer = setTimeout(() => {
        captureTimer = null;
        // 전체 색인 중에는 deepIndex가 직접 읽고 카운트한다.
        // 여기서 먼저 읽어 버리면 진행 숫자는 늘지 않는데 DB에는 저장되는
        // 경합이 생길 수 있으므로 자동 색인은 잠시 쉰다.
        if (deepLoadRunning) return;
        void captureRendered();
      }, 700);
    };

    new MutationObserver(() => {
      scheduleMenu();
      revealPendingJump();
      if (!deepLoadRunning) scheduleCapture();
    }).observe(document.documentElement, { childList: true, subtree: true });

    renderMenuRow();
    revealPendingJump();
    scheduleCapture();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
