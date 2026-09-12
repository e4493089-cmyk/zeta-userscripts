// ==UserScript==
// @name         Zeta Room Manager
// @namespace    zeta-room-manager
// @version      0.2.1
// @description  제타 대화방/플롯에 로컬 별명을 붙이고 별명/원래 이름으로 검색합니다.
// @match        https://zeta-ai.io/*
// @updateURL    https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-room-manager.user.js
// @downloadURL  https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-room-manager.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const STORAGE_KEY = 'zeta-room-manager:v1';
  const STYLE_ID = 'zeta-room-manager-style';
  const PANEL_ID = 'zeta-room-manager-panel';
  const MODAL_ID = 'zeta-room-manager-modal';

  const state = loadState();
  let observer = null;
  let rafPending = false;
  let lastRoomContextRecord = null;

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        aliases: parsed.aliases && typeof parsed.aliases === 'object' ? parsed.aliases : {},
        index: parsed.index && typeof parsed.index === 'object' ? parsed.index : {}
      };
    } catch (_) {
      return { aliases: {}, index: {} };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function keyOf(type, id) {
    return `${type}:${id}`;
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function extractId(href, type) {
    if (!href) return null;
    const re = type === 'room'
      ? /\/rooms\/([^/?#]+)/i
      : /\/plots\/([^/?#]+)(?:\/|$)/i;
    return href.match(re)?.[1] || null;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: sticky;
        top: 0;
        z-index: 30;
        padding: 10px 12px;
        background: rgba(21,21,22,.96);
        backdrop-filter: blur(10px);
        border-bottom: 1px solid rgba(255,255,255,.07);
        box-sizing: border-box;
      }
      #${PANEL_ID} .zrm-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #${PANEL_ID} .zrm-search-wrap {
        position: relative;
        flex: 1;
        min-width: 0;
      }
      #${PANEL_ID} input {
        width: 100%;
        height: 38px;
        box-sizing: border-box;
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 10px;
        background: #252528;
        color: #fff;
        outline: none;
        padding: 0 12px;
        font: inherit;
      }
      #${PANEL_ID} input:focus {
        border-color: #7c67ff;
        background: #2a2a2e;
      }
      #${PANEL_ID} input::placeholder { color: rgba(255,255,255,.45); }
      #${PANEL_ID} .zrm-search-status { min-height: 0; padding-top: 0; color: rgba(255,255,255,.48); font-size: 11px; }
      #${PANEL_ID} .zrm-search-status:not(:empty) { padding-top: 7px; }
      #${PANEL_ID} .zrm-results {
        display: none;
        margin-top: 8px;
        max-height: min(62vh, 520px);
        overflow: auto;
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 10px;
        background: #202023;
      }
      #${PANEL_ID} .zrm-results.zrm-open { display: block; }
      #${PANEL_ID} .zrm-result {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
        box-sizing: border-box;
        padding: 13px 14px;
        border: 0;
        border-bottom: 1px solid rgba(255,255,255,.06);
        background: transparent;
        color: #fff;
        text-align: left;
        cursor: pointer;
      }
      #${PANEL_ID} .zrm-result:last-child { border-bottom: 0; }
      #${PANEL_ID} .zrm-result:hover { background: rgba(255,255,255,.05); }
      #${PANEL_ID} .zrm-result-title { font-size: 14px; font-weight: 600; }
      #${PANEL_ID} .zrm-result-sub { margin-top: 2px; color: rgba(255,255,255,.48); font-size: 11px; }
      #${PANEL_ID} .zrm-result-go { flex: 0 0 auto; color: #9e91ff; font-size: 12px; font-weight: 700; }
      body.zrm-searching [data-sentry-component="SwipeableRoomListItem"] { display: none !important; }

      /* 대화방 목록에는 별명 버튼을 상시 표시하지 않음.
         별명 편집은 제타의 길게 누르기 메뉴에 주입한다. */
      .zrm-room-item > a[href*="/rooms/"] { padding-right: 16px !important; }
      .zrm-room-rename { display: none !important; }
      .zrm-context-rename svg { flex: 0 0 auto; }
      .zrm-plot-rename {
        height: 30px;
        padding: 0 8px;
        border: 0;
        border-radius: 7px;
        background: rgba(255,255,255,.07);
        color: rgba(255,255,255,.64);
        cursor: pointer;
        font-size: 11px;
        white-space: nowrap;
      }
      .zrm-plot-rename:hover { background: rgba(255,255,255,.12); color: #fff; }
      .zrm-filter-hidden { display: none !important; }

      #${MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px;
        background: rgba(0,0,0,.58);
        box-sizing: border-box;
      }
      #${MODAL_ID} .zrm-dialog {
        width: min(360px, 100%);
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 16px;
        background: #202023;
        color: #fff;
        box-shadow: 0 20px 60px rgba(0,0,0,.35);
        overflow: hidden;
      }
      #${MODAL_ID} .zrm-dialog-body { padding: 18px; }
      #${MODAL_ID} h3 { margin: 0 0 6px; font-size: 17px; }
      #${MODAL_ID} p { margin: 0 0 13px; color: rgba(255,255,255,.55); font-size: 12px; line-height: 1.5; }
      #${MODAL_ID} input {
        width: 100%;
        height: 42px;
        box-sizing: border-box;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 10px;
        background: #2a2a2e;
        color: #fff;
        padding: 0 12px;
        outline: none;
        font: inherit;
      }
      #${MODAL_ID} input:focus { border-color: #7c67ff; }
      #${MODAL_ID} .zrm-actions {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 8px;
        padding: 0 18px 18px;
      }
      #${MODAL_ID} button {
        height: 38px;
        border: 0;
        border-radius: 9px;
        cursor: pointer;
        font: inherit;
      }
      #${MODAL_ID} .zrm-cancel { background: #343438; color: #ddd; }
      #${MODAL_ID} .zrm-reset { background: #3a3030; color: #ffaaaa; }
      #${MODAL_ID} .zrm-save { background: #6d52ff; color: #fff; font-weight: 700; }
    `;
    document.documentElement.appendChild(style);
  }

  function titleElementForRoom(item, link) {
    return link?.querySelector('span.body1.font-medium')
      || link?.querySelector('.body1.font-medium')
      || link?.querySelector('[class*="line-clamp"]')
      || Array.from(link?.querySelectorAll('span, div') || []).find(el => !el.children.length && normalizeText(el.textContent))
      || null;
  }

  function titleElementForPlot(item, link) {
    const candidates = Array.from(link?.querySelectorAll('div.body1.font-medium') || []);
    return candidates.find(el => !el.querySelector('*'))
      || link?.querySelector('.line-clamp-1.body1.font-medium')
      || null;
  }

  function parseItem(item, type) {
    const link = type === 'room'
      ? item.querySelector('a[href*="/rooms/"]')
      : item.querySelector('a[href*="/plots/"][href*="/profile"]');
    if (!link) return null;

    const id = extractId(link.href, type);
    if (!id) return null;

    const titleEl = type === 'room'
      ? titleElementForRoom(item, link)
      : titleElementForPlot(item, link);
    if (!titleEl) return null;

    if (!titleEl.dataset.zrmOriginalTitle) {
      titleEl.dataset.zrmOriginalTitle = normalizeText(titleEl.textContent);
    }

    const original = titleEl.dataset.zrmOriginalTitle;
    const key = keyOf(type, id);
    const alias = normalizeText(state.aliases[key]);

    state.index[key] = {
      type,
      id,
      href: link.href,
      original,
      alias
    };

    return { key, type, id, item, link, titleEl, original, alias };
  }

  function renderedItems() {
    const out = [];
    const roomItems = new Set(document.querySelectorAll('[data-sentry-component="SwipeableRoomListItem"]'));
    document.querySelectorAll('a[href*="/rooms/"]').forEach(link => {
      const item = link.closest('[data-sentry-component="SwipeableRoomListItem"], li, [role="listitem"]') || link.parentElement?.parentElement;
      if (item) roomItems.add(item);
    });
    roomItems.forEach(el => {
      const x = parseItem(el, 'room');
      if (x) out.push(x);
    });
    document.querySelectorAll('[data-sentry-component="CreatorCenterMyPlotListItem"]').forEach(el => {
      const x = parseItem(el, 'plot');
      if (x) out.push(x);
    });
    return out;
  }

  function applyAlias(record) {
    const alias = normalizeText(state.aliases[record.key]);
    record.alias = alias;
    const nextTitle = alias || record.original;
    if (normalizeText(record.titleEl.textContent) !== nextTitle) record.titleEl.textContent = nextTitle;
    record.titleEl.classList.toggle('zrm-has-alias', !!alias);

    const indexed = state.index[record.key] || {};
    state.index[record.key] = {
      ...indexed,
      type: record.type,
      id: record.id,
      href: record.link.href,
      original: record.original,
      alias
    };
  }

  function makeRenameButton(record) {
    if (record.type === 'room') {
      record.item.querySelector('.zrm-room-rename')?.remove();
      record.item.classList.add('zrm-room-item');
      return;
    }

    if (record.item.querySelector(`.zrm-${record.type}-rename`)) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `zrm-${record.type}-rename`;
    btn.textContent = '별명';
    btn.setAttribute('aria-label', `${record.original} 별명 편집`);

    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openRenameModal(record);
    }, true);

    const row = record.link.parentElement;
    const actions = row?.lastElementChild;
    if (actions && actions !== record.link) actions.insertBefore(btn, actions.firstChild);
    else record.item.appendChild(btn);
  }

  function snapshotRecord(record) {
    if (!record) return null;
    return {
      key: record.key,
      type: record.type,
      id: record.id,
      item: record.item,
      link: record.link,
      titleEl: record.titleEl,
      original: record.original,
      alias: normalizeText(state.aliases[record.key])
    };
  }

  function rememberRoomContextTarget(event) {
    const link = event.target?.closest?.('a[href*="/rooms/"]');
    const target = event.target?.closest?.('[data-sentry-component="SwipeableRoomListItem"], li, [role="listitem"]') || link?.parentElement?.parentElement;
    if (!target) return;
    const record = parseItem(target, 'room');
    if (record) lastRoomContextRecord = snapshotRecord(record);
  }

  function closeNativeRoomContextMenu(menu) {
    const layer = menu?.closest?.('[data-sentry-component="KeyboardAvoidingView"]');
    const backdrop = layer?.querySelector?.('[role="presentation"]');
    if (backdrop) {
      try { backdrop.click(); } catch (_) {}
    }
  }

  function injectRoomContextMenu() {
    const menus = new Set(document.querySelectorAll('[data-sentry-source-file="RoomListItemContextMenu.tsx"]'));
    document.querySelectorAll('[role="dialog"], [role="menu"]').forEach(menu => {
      if (Array.from(menu.querySelectorAll('button')).some(btn => normalizeText(btn.textContent) === '나가기')) menus.add(menu);
    });
    for (const menu of menus) {
      if (menu.querySelector('.zrm-context-rename')) continue;
      if (!lastRoomContextRecord) continue;

      const nativeButtons = Array.from(menu.querySelectorAll(':scope > button'));
      const template = nativeButtons[0];

      const button = document.createElement('button');
      button.type = 'button';
      button.className = template?.className
        || 'group flex flex-row gap-2.5 bg-gray-sub2 p-[18px] active:bg-gray-900 disabled:bg-gray-900 rounded-t-lg rounded-b-lg';
      button.classList.add('zrm-context-rename');
      button.setAttribute('aria-label', '별명 변경');
      button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
             class="size-4 text-white group-disabled:text-white/20" aria-hidden="true">
          <path fill="currentColor"
                d="M21.675 7.905c.433-.433.433-1.155 0-1.566l-4.014-4.014c-.41-.433-1.133-.433-1.566 0L14.05 4.358l5.58 5.58M2.293 16.127a1 1 0 0 0-.293.707V21a1 1 0 0 0 1 1h4.166a1 1 0 0 0 .707-.293l10.58-10.591-5.58-5.58z"/>
        </svg>
        <span class="body14 font-medium text-white group-disabled:text-white/20">별명 변경</span>
      `;

      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const record = lastRoomContextRecord;
        if (!record) return;
        closeNativeRoomContextMenu(menu);
        setTimeout(() => openRenameModal(record), 30);
      }, true);

      const leaveButton = nativeButtons.find(btn => normalizeText(btn.textContent) === '나가기');
      menu.insertBefore(button, leaveButton || null);
    }
  }

  function openRenameModal(record) {
    document.getElementById(MODAL_ID)?.remove();

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.innerHTML = `
      <div class="zrm-dialog" role="dialog" aria-modal="true" aria-label="별명 편집">
        <div class="zrm-dialog-body">
          <h3>별명 바꾸기</h3>
          <p>원래 이름: <strong></strong><br>제타 서버의 실제 이름은 바뀌지 않고 이 브라우저에서만 보여요.</p>
          <input type="text" maxlength="80" placeholder="별명을 입력하세요">
        </div>
        <div class="zrm-actions">
          <button type="button" class="zrm-cancel">취소</button>
          <button type="button" class="zrm-reset">원래 이름</button>
          <button type="button" class="zrm-save">저장</button>
        </div>
      </div>
    `;

    const input = overlay.querySelector('input');
    overlay.querySelector('strong').textContent = record.original;
    input.value = normalizeText(state.aliases[record.key]);

    const close = () => overlay.remove();
    const commit = value => {
      const alias = normalizeText(value);
      if (alias) state.aliases[record.key] = alias;
      else delete state.aliases[record.key];
      saveState();
      close();
      refresh();
    };

    overlay.querySelector('.zrm-cancel').addEventListener('click', close);
    overlay.querySelector('.zrm-reset').addEventListener('click', () => commit(''));
    overlay.querySelector('.zrm-save').addEventListener('click', () => commit(input.value));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') commit(input.value);
      if (e.key === 'Escape') close();
    });

    document.body.appendChild(overlay);
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  function currentSection() {
    if (/^\/(?:[^/]+\/)?rooms\/?$/i.test(location.pathname)) return 'room';
    if (/^\/(?:[^/]+\/)?creator-center(?:\/|$)/i.test(location.pathname)) return 'plot';
    return null;
  }

  function panelHost(type) {
    if (type === 'room') {
      return document.querySelector('[data-sentry-component="RoomList"]')
        || document.querySelector('a[href*="/rooms/"]')?.closest('main, [role="main"]')
        || null;
    }

    const header = document.querySelector('[data-sentry-component="CreatorCenterMyPlotListHeader"]');
    return header?.parentElement || null;
  }

  function ensurePanel() {
    const type = currentSection();
    if (!type) {
      document.getElementById(PANEL_ID)?.remove();
      return null;
    }

    const host = panelHost(type);
    if (!host) return null;

    let panel = document.getElementById(PANEL_ID);
    if (panel && panel.dataset.zrmType !== type) {
      panel.remove();
      panel = null;
    }

    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.dataset.zrmType = type;
      panel.innerHTML = `
        <div class="zrm-row">
          <div class="zrm-search-wrap">
            <input type="search" inputmode="search" autocomplete="off" spellcheck="false" placeholder="${type === 'room' ? '대화방' : '플롯'} 이름 또는 별명 검색">
          </div>
        </div>
        <div class="zrm-search-status" aria-live="polite"></div>
        <div class="zrm-results"></div>
      `;

      const input = panel.querySelector('input');
      input.addEventListener('input', () => {
        applySearch(input.value);
      });
      input.addEventListener('search', () => {
        applySearch(input.value);
      });

      if (type === 'room') host.prepend(panel);
      else host.insertBefore(panel, host.firstChild);
    }

    return panel;
  }

  function matchRecord(entry, q) {
    const hay = `${entry.alias || ''}\n${entry.original || ''}`.toLocaleLowerCase('ko-KR');
    return hay.includes(q);
  }

  function renderQuickResults(type, query) {
    const panel = document.getElementById(PANEL_ID);
    const box = panel?.querySelector('.zrm-results');
    if (!box) return;

    const q = normalizeText(query).toLocaleLowerCase('ko-KR');
    box.textContent = '';

    if (!q) {
      box.classList.remove('zrm-open');
      return;
    }

    const results = Object.values(state.index)
      .filter(entry => entry?.type === type && entry.href && matchRecord(entry, q))
      .slice(0, 20);

    if (!results.length) {
      box.classList.remove('zrm-open');
      return;
    }

    for (const entry of results) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'zrm-result';

      const title = document.createElement('div');
      title.className = 'zrm-result-title';
      title.textContent = entry.alias || entry.original || '(이름 없음)';

      const sub = document.createElement('div');
      sub.className = 'zrm-result-sub';
      sub.textContent = entry.alias && entry.original !== entry.alias
        ? `원래 이름: ${entry.original}`
        : (entry.type === 'room' ? '대화방' : '플롯');

      const text = document.createElement('div');
      text.append(title, sub);
      const go = document.createElement('span');
      go.className = 'zrm-result-go';
      go.textContent = '열기 ›';
      button.append(text, go);
      button.addEventListener('click', () => { location.href = entry.href; });
      box.appendChild(button);
    }

    box.classList.add('zrm-open');
  }

  function applySearch(query) {
    const type = currentSection();
    if (!type) return;

    const q = normalizeText(query).toLocaleLowerCase('ko-KR');
    const records = renderedItems().filter(x => x.type === type);
    document.body.classList.toggle('zrm-searching', Boolean(q) && type === 'room');
    let shown = 0;

    for (const record of records) {
      const entry = state.index[record.key] || record;
      const yes = !q || matchRecord(entry, q);
      record.item.classList.toggle('zrm-filter-hidden', Boolean(q));
      if (yes) shown++;
    }

    renderQuickResults(type, q);
    const indexedShown = q ? Object.values(state.index).filter(entry => entry?.type === type && entry.href && matchRecord(entry, q)).length : 0;
    const status = document.querySelector(`#${PANEL_ID} .zrm-search-status`);
    if (status) status.textContent = q ? `${indexedShown}개 ${type === 'room' ? '대화방' : '플롯'} 검색됨` : '';
  }

  function refresh() {
    observer?.disconnect();
    injectStyle();
    const panel = ensurePanel();
    const records = renderedItems();

    for (const record of records) {
      applyAlias(record);
      makeRenameButton(record);
    }

    injectRoomContextMenu();
    saveState();

    const input = panel?.querySelector('input');
    applySearch(input?.value || '');
    observer?.observe(document.documentElement, { childList: true, subtree: true });
  }

  function scheduleRefresh() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      refresh();
    });
  }

  function start() {
    injectStyle();

    document.addEventListener('pointerdown', rememberRoomContextTarget, true);
    document.addEventListener('contextmenu', rememberRoomContextTarget, true);
    document.addEventListener('touchstart', rememberRoomContextTarget, { capture: true, passive: true });

    refresh();

    observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        scheduleRefresh();
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

