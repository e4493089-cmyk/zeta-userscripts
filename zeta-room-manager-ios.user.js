// ==UserScript==
// @name         Zeta Room Manager (iOS)
// @namespace    zeta-room-manager-ios
// @version      0.2.2
// @description  iPhone/iPad용. 대화방을 밀어 별명을 바꾸고 기본 검색창에서 별명도 검색합니다.
// @match        https://zeta-ai.io/*
// @updateURL    https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-room-manager-ios.user.js
// @downloadURL  https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-room-manager-ios.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const STORAGE_KEY = 'zeta-room-manager:v1';
  const STYLE_ID = 'zeta-room-manager-style';
  const PANEL_ID = 'zeta-room-manager-panel';
  const MODAL_ID = 'zeta-room-manager-modal';
  const NATIVE_RESULTS_ID = 'zeta-room-manager-native-results';
  const PLOT_NATIVE_RESULTS_ID = 'zeta-room-manager-plot-native-results';
  const IOS_MANAGER_ID = 'zeta-room-manager-ios-panel';
  const IOS_ENTRY_CLASS = 'zrm-ios-settings-entry';

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

  function stableLocalId(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `local-${(hash >>> 0).toString(36)}`;
  }

  function reactPlotId(item) {
    const fiberKey = Object.keys(item || {}).find(key => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? item[fiberKey] : null;
    const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
    for (let depth = 0; fiber && depth < 18; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps || fiber.pendingProps;
      for (const candidate of [props?.plotId, props?.plot_id, props?.id, props?.plot?.id, props?.plot?.plotId]) {
        if (typeof candidate === 'string' && uuid.test(candidate)) return candidate;
      }
    }
    return null;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${NATIVE_RESULTS_ID} {
        flex: 0 0 auto;
      }
      #${NATIVE_RESULTS_ID}:empty { display: none; }
      #${NATIVE_RESULTS_ID} .zrm-native-avatar {
        width: 42px;
        height: 56px;
        object-fit: cover;
        border-radius: 7px;
        background: #2a2a2e;
      }
      #${NATIVE_RESULTS_ID} .zrm-native-avatar-placeholder {
        width: 42px;
        height: 56px;
        border-radius: 7px;
        background: #2a2a2e;
      }
      #${PLOT_NATIVE_RESULTS_ID} { flex: 0 0 auto; padding: 0 16px; }
      #${PLOT_NATIVE_RESULTS_ID}:empty { display: none; }
      #${PLOT_NATIVE_RESULTS_ID} .zrm-plot-avatar,
      #${PLOT_NATIVE_RESULTS_ID} .zrm-plot-avatar-placeholder {
        width: 39px;
        height: 52px;
        flex: 0 0 auto;
        border-radius: 6px;
        object-fit: cover;
        background: #2a2a2e;
      }

      /* 제타 기본 스와이프 폭(144px)을 유지해 스프링 모션이 튀지 않게 한다. */
      .zrm-room-item > a[href*="/rooms/"] { padding-right: 16px !important; }
      .zrm-room-actions > button {
        width: 48px !important;
        min-width: 48px !important;
        gap: 6px !important;
      }
      .zrm-room-actions > button > span {
        font-size: 10px !important;
        white-space: nowrap;
      }
      .zrm-room-rename {
        display: flex !important;
        width: 52px !important;
        min-width: 52px !important;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        border: 0;
        background: #6957d9;
        color: #fff;
      }
      .zrm-room-actions > button:nth-child(2) {
        width: 52px !important;
        min-width: 52px !important;
      }
      .zrm-room-actions > button:last-child {
        width: 40px !important;
        min-width: 40px !important;
      }
      .zrm-room-rename svg { width: 16px; height: 16px; flex: 0 0 auto; }
      .zrm-room-rename span { font-size: 10px; white-space: nowrap; }
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

      .${IOS_ENTRY_CLASS} {
        width: 100%;
        min-height: 44px;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
      }
      #${IOS_MANAGER_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483645;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        background: rgba(0,0,0,.58);
      }
      #${IOS_MANAGER_ID} .zrm-ios-sheet {
        width: min(560px,100%);
        max-height: min(82vh,760px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border-radius: 20px 20px 0 0;
        background: #19191c;
        color: #fff;
        box-shadow: 0 -10px 32px rgba(0,0,0,.3);
        padding-bottom: env(safe-area-inset-bottom);
      }
      #${IOS_MANAGER_ID} .zrm-ios-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px;
        border-bottom: 1px solid rgba(255,255,255,.1);
      }
      #${IOS_MANAGER_ID} .zrm-ios-head h3 { margin: 0; font-size: 18px; }
      #${IOS_MANAGER_ID} .zrm-ios-close {
        width: 36px;
        height: 36px;
        border: 0;
        border-radius: 50%;
        background: rgba(255,255,255,.1);
        color: #fff;
        font-size: 24px;
      }
      #${IOS_MANAGER_ID} .zrm-ios-search {
        height: 42px;
        margin: 12px 16px 8px;
        padding: 0 13px;
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 11px;
        background: #29292d;
        color: #fff;
        font: inherit;
        font-size: 15px;
      }
      #${IOS_MANAGER_ID} .zrm-ios-list { overflow-y: auto; padding: 4px 12px 16px; }
      #${IOS_MANAGER_ID} .zrm-ios-row {
        display: flex;
        align-items: center;
        gap: 11px;
        min-height: 66px;
        padding: 9px 4px;
        border-bottom: 1px solid rgba(255,255,255,.08);
      }
      #${IOS_MANAGER_ID} .zrm-ios-avatar {
        width: 42px;
        height: 52px;
        flex: 0 0 auto;
        border-radius: 7px;
        object-fit: cover;
        background: #303036;
      }
      #${IOS_MANAGER_ID} .zrm-ios-copy { min-width: 0; flex: 1; }
      #${IOS_MANAGER_ID} .zrm-ios-copy b,
      #${IOS_MANAGER_ID} .zrm-ios-copy span {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${IOS_MANAGER_ID} .zrm-ios-copy span { margin-top: 3px; color: rgba(255,255,255,.5); font-size: 12px; }
      #${IOS_MANAGER_ID} .zrm-ios-edit {
        height: 34px;
        padding: 0 12px;
        border: 0;
        border-radius: 9px;
        background: #6d52ff;
        color: #fff;
        font-weight: 700;
      }
      #${IOS_MANAGER_ID} .zrm-ios-empty { padding: 36px 18px; color: rgba(255,255,255,.55); text-align: center; line-height: 1.55; }
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
    if (item.closest?.(`#${NATIVE_RESULTS_ID}, #${PLOT_NATIVE_RESULTS_ID}`)) return null;
    const link = type === 'room'
      ? item.querySelector('a[href*="/rooms/"]')
      : item.querySelector('a[href*="/plots/"]');
    if (type === 'room' && !link) return null;

    const titleEl = type === 'room'
      ? titleElementForRoom(item, link)
      : titleElementForPlot(item, link || item);
    if (!titleEl) return null;

    if (!titleEl.dataset.zrmOriginalTitle) {
      titleEl.dataset.zrmOriginalTitle = normalizeText(titleEl.textContent);
    }

    const original = titleEl.dataset.zrmOriginalTitle;
    const image = (link || item).querySelector('img')?.src || '';
    const id = extractId(link?.href, type)
      || item.getAttribute('data-plot-id')
      || (type === 'plot' ? reactPlotId(item) : null)
      || stableLocalId(`${original}\n${image.split('?')[0]}`);
    if (!id) return null;

    const key = keyOf(type, id);
    const alias = normalizeText(state.aliases[key]);

    state.index[key] = {
      type,
      id,
      href: link?.href || state.index[key]?.href
        || (type === 'plot' && !id.startsWith('local-') ? `/ko/plots/${id}/edit` : ''),
      original,
      alias,
      image: image || state.index[key]?.image || ''
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
      href: record.link?.href || indexed.href || '',
      original: record.original,
      alias,
      image: (record.link || record.item).querySelector('img')?.src || indexed.image || ''
    };
  }

  function makeRenameButton(record) {
    if (record.type === 'room') {
      record.item.classList.add('zrm-room-item');
      const actions = record.item.querySelector(
        '[data-sentry-element="RoomListItemRightActions"], ' +
        '[data-sentry-source-file="SwipeableRoomListItem.tsx"].absolute.translate-x-full'
      );
      if (!actions) return;
      actions.classList.add('zrm-room-actions');
      if (actions.querySelector('.zrm-room-rename')) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'zrm-room-rename';
      btn.setAttribute('aria-label', `${record.original} 별명 편집`);
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M21.675 7.905c.433-.433.433-1.155 0-1.566l-4.014-4.014c-.41-.433-1.133-.433-1.566 0L14.05 4.358l5.58 5.58M2.293 16.127a1 1 0 0 0-.293.707V21a1 1 0 0 0 1 1h4.166a1 1 0 0 0 .707-.293l10.58-10.591-5.58-5.58z"/>
        </svg>
        <span>별명</span>
      `;
      btn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openRenameModal(snapshotRecord(record));
      }, true);
      actions.prepend(btn);
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

    const row = record.link?.parentElement
      || record.item.querySelector(':scope > div.flex.flex-row.items-center')
      || record.item.firstElementChild;
    const actions = row?.lastElementChild;
    if (actions && actions !== record.link && actions !== row) actions.insertBefore(btn, actions.firstChild);
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

  function roomEntries() {
    return Object.entries(state.index)
      .filter(([, entry]) => entry?.type === 'room' && entry.original)
      .map(([key, entry]) => ({ key, ...entry }))
      .sort((a, b) => normalizeText(a.alias || a.original).localeCompare(normalizeText(b.alias || b.original), 'ko'));
  }

  function openIosManager() {
    document.getElementById(IOS_MANAGER_ID)?.remove();
    const overlay = document.createElement('div');
    overlay.id = IOS_MANAGER_ID;
    overlay.innerHTML = `
      <section class="zrm-ios-sheet" role="dialog" aria-modal="true" aria-label="대화방 별명 관리">
        <div class="zrm-ios-head"><h3>대화방 별명 관리</h3><button class="zrm-ios-close" type="button" aria-label="닫기">×</button></div>
        <input class="zrm-ios-search" type="search" placeholder="대화방 이름 또는 별명 검색">
        <div class="zrm-ios-list"></div>
      </section>
    `;

    const list = overlay.querySelector('.zrm-ios-list');
    const search = overlay.querySelector('.zrm-ios-search');
    const render = () => {
      const query = normalizeText(search.value).toLocaleLowerCase('ko-KR');
      const entries = roomEntries().filter(entry =>
        !query || normalizeText(entry.alias + ' ' + entry.original).toLocaleLowerCase('ko-KR').includes(query)
      );
      list.textContent = '';

      if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'zrm-ios-empty';
        empty.textContent = roomEntries().length
          ? '일치하는 대화방이 없어요.'
          : '저장된 대화방 정보가 없어요.\n대화 목록을 한 번 스크롤한 뒤 다시 열어주세요.';
        list.appendChild(empty);
        return;
      }

      for (const entry of entries) {
        const row = document.createElement('div');
        row.className = 'zrm-ios-row';

        if (entry.image) {
          const image = document.createElement('img');
          image.className = 'zrm-ios-avatar';
          image.src = entry.image;
          image.alt = '';
          row.appendChild(image);
        } else {
          const placeholder = document.createElement('span');
          placeholder.className = 'zrm-ios-avatar';
          row.appendChild(placeholder);
        }

        const copy = document.createElement('div');
        copy.className = 'zrm-ios-copy';
        const title = document.createElement('b');
        title.textContent = entry.alias || entry.original;
        const original = document.createElement('span');
        original.textContent = entry.alias ? `원래 이름: ${entry.original}` : '별명 없음';
        copy.append(title, original);

        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'zrm-ios-edit';
        edit.textContent = entry.alias ? '수정' : '별명';
        edit.addEventListener('click', () => {
          overlay.remove();
          openRenameModal({ key: entry.key, original: entry.original });
        });

        row.append(copy, edit);
        list.appendChild(row);
      }
    };

    search.addEventListener('input', render);
    overlay.querySelector('.zrm-ios-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    render();
    setTimeout(() => search.focus(), 80);
  }

  function visibleElement(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function roomSettingsMenu() {
    return document.querySelector(
      'ul[data-sentry-source-file="DropdownMenu.tsx"], ' +
      '[data-sentry-source-file="DropdownMenu.tsx"] ul'
    );
  }

  function injectIosSettingsEntry() {
    const menu = roomSettingsMenu();
    if (!menu || menu.querySelector('.' + IOS_ENTRY_CLASS)) return;

    const item = document.createElement('li');
    item.className = 'border-r border-b border-l border-white/5 transition-colors hover:bg-gray-700';
    item.setAttribute('data-zrm-ios-menu-item', '1');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'flex h-[44px] w-full cursor-pointer flex-row items-center gap-2 bg-transparent px-4 ' + IOS_ENTRY_CLASS;
    button.setAttribute('aria-label', '대화방 별명 관리');

    const label = document.createElement('span');
    label.className = 'body2 text-gray-200';
    label.textContent = '대화방 별명 관리';
    button.appendChild(label);

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openIosManager();
    }, true);

    item.appendChild(button);
    const editRoom = menu.querySelector('#delete-room')?.closest('li');
    menu.insertBefore(item, editRoom || null);
  }

  function currentSection() {
    if (/^\/(?:[^/]+\/)?rooms\/?$/i.test(location.pathname)) return 'room';
    if (/^\/(?:[^/]+\/)?creator-center\/search\/?$/i.test(location.pathname)) return 'plot-search';
    if (/^\/(?:[^/]+\/)?creator-center(?:\/|$)/i.test(location.pathname)) return 'plot';
    return null;
  }

  function removeLegacyPanel() {
    // 이전 버전에서 삽입했던 별도 검색 패널이 남아 있으면 제거한다.
    document.getElementById(PANEL_ID)?.remove();
  }

  function nativeRoomSearchInput() {
    return document.querySelector('input[name="room-list-search-input"]');
  }

  function nativeRoomQuery() {
    const input = nativeRoomSearchInput();
    if (input) return input.value;
    try {
      return new URL(location.href).searchParams.get('query') || '';
    } catch (_) {
      return '';
    }
  }

  function nativeRoomListHost() {
    const roomList = document.querySelector('[data-sentry-component="RoomList"]');
    if (!roomList) return null;
    const input = nativeRoomSearchInput();
    return input?.closest('.flex.flex-col.grow')
      || roomList.querySelector('[data-sentry-component="WrappedDiv"][data-sentry-source-file="index.tsx"]')
      || roomList.querySelector('.overflow-y-auto')
      || null;
  }

  function renderNativeAliasResults(query) {
    const q = normalizeText(query).toLocaleLowerCase('ko-KR');
    let box = document.getElementById(NATIVE_RESULTS_ID);

    if (!q || currentSection() !== 'room') {
      box?.remove();
      return;
    }

    const nativeIds = new Set(
      Array.from(document.querySelectorAll('a[href*="/rooms/"]'))
        .filter(link => !link.closest(`#${NATIVE_RESULTS_ID}`))
        .map(link => extractId(link.href, 'room'))
        .filter(Boolean)
    );
    const matches = Object.values(state.index)
      .filter(entry => entry?.type === 'room' && entry.href && normalizeText(entry.alias))
      .filter(entry => normalizeText(entry.alias).toLocaleLowerCase('ko-KR').includes(q))
      .filter(entry => !nativeIds.has(entry.id))
      .slice(0, 20);

    if (!matches.length) {
      box?.remove();
      return;
    }

    const host = nativeRoomListHost();
    if (!host) return;

    if (!box) {
      box = document.createElement('div');
      box.id = NATIVE_RESULTS_ID;
    }
    box.textContent = '';

    for (const entry of matches) {
      const row = document.createElement('div');
      row.className = 'flex w-full min-w-0 flex-col';
      row.dataset.zrmAliasResult = entry.id;

      const item = document.createElement('div');
      item.className = 'relative flex flex-col';

      const link = document.createElement('a');
      link.className = 'group flex min-w-[215px] flex-row items-center justify-between gap-3 px-4 py-2.5';
      link.href = entry.href;
      link.setAttribute('testid', `room-list-item-${entry.id}`);

      const content = document.createElement('div');
      content.className = 'flex flex-1 flex-row items-center gap-3';

      const avatarWrap = document.createElement('div');
      avatarWrap.className = 'relative shrink-0';
      if (entry.image) {
        const image = document.createElement('img');
        image.className = 'zrm-native-avatar';
        image.src = entry.image;
        image.alt = '';
        image.width = 42;
        image.height = 56;
        image.loading = 'lazy';
        avatarWrap.appendChild(image);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'zrm-native-avatar-placeholder';
        avatarWrap.appendChild(placeholder);
      }

      const text = document.createElement('div');
      text.className = 'flex min-w-0 flex-1 flex-col';
      const title = document.createElement('div');
      title.className = 'body1 font-medium text-white line-clamp-1';
      title.textContent = entry.alias;
      const original = document.createElement('div');
      original.className = 'body12 text-white/50 line-clamp-1';
      original.textContent = entry.original && entry.original !== entry.alias
        ? entry.original
        : '별명으로 찾은 대화방';
      text.append(title, original);
      content.append(avatarWrap, text);
      link.appendChild(content);
      item.appendChild(link);
      row.appendChild(item);
      box.appendChild(row);
    }

    const input = nativeRoomSearchInput();
    const searchRow = input?.closest('.p-4');
    const searchBlock = searchRow?.parentElement;
    if (searchBlock?.parentElement === host) {
      if (box.parentElement !== host || box.previousElementSibling !== searchBlock) {
        searchBlock.after(box);
      }
    } else if (box.parentElement !== host) {
      host.prepend(box);
    }
  }

  function bindNativeRoomSearch() {
    const input = nativeRoomSearchInput();
    if (!input || input.dataset.zrmAliasSearchBound === '1') return;
    input.dataset.zrmAliasSearchBound = '1';
    const update = () => scheduleRefresh();
    input.addEventListener('input', update);
    input.addEventListener('search', update);
    input.addEventListener('change', update);
  }

  function nativePlotSearchInput() {
    if (currentSection() !== 'plot-search') return null;
    return document.querySelector('input[type="search"], input[placeholder*="검색"], input');
  }

  function nativePlotResultsHost() {
    const main = document.querySelector('main#contents, main, [role="main"]');
    return main?.querySelector('[data-sentry-element="FlatList"], .overflow-y-auto') || main;
  }

  function renderNativePlotAliasResults(query) {
    const q = normalizeText(query).toLocaleLowerCase('ko-KR');
    let box = document.getElementById(PLOT_NATIVE_RESULTS_ID);
    if (!q || currentSection() !== 'plot-search') {
      box?.remove();
      return;
    }

    const nativeIds = new Set(
      Array.from(document.querySelectorAll('a[href*="/plots/"]'))
        .filter(link => !link.closest(`#${PLOT_NATIVE_RESULTS_ID}`))
        .map(link => extractId(link.href, 'plot'))
        .filter(Boolean)
    );
    const matches = Object.values(state.index)
      .filter(entry => entry?.type === 'plot' && entry.href && normalizeText(entry.alias))
      .filter(entry => normalizeText(entry.alias).toLocaleLowerCase('ko-KR').includes(q))
      .filter(entry => !nativeIds.has(entry.id))
      .slice(0, 20);

    if (!matches.length) {
      box?.remove();
      return;
    }
    const host = nativePlotResultsHost();
    if (!host) return;
    if (!box) {
      box = document.createElement('div');
      box.id = PLOT_NATIVE_RESULTS_ID;
    }
    box.textContent = '';

    for (const entry of matches) {
      const row = document.createElement('div');
      row.className = 'flex flex-col gap-2 border-b border-b-white/[3%] py-3';
      const line = document.createElement('div');
      line.className = 'flex flex-row items-center';
      const link = document.createElement('a');
      link.className = 'flex flex-1 flex-row items-center gap-3 pr-2';
      link.href = entry.href;

      if (entry.image) {
        const image = document.createElement('img');
        image.className = 'zrm-plot-avatar';
        image.src = entry.image;
        image.alt = '';
        image.width = 39;
        image.height = 52;
        link.appendChild(image);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'zrm-plot-avatar-placeholder';
        link.appendChild(placeholder);
      }

      const text = document.createElement('div');
      text.className = 'flex shrink flex-col';
      const title = document.createElement('div');
      title.className = 'line-clamp-1 shrink body1 font-medium text-ellipsis';
      title.textContent = entry.alias;
      const original = document.createElement('div');
      original.className = 'caption1 text-white/50';
      original.textContent = entry.original && entry.original !== entry.alias
        ? entry.original
        : '별명으로 찾은 플롯';
      text.append(title, original);
      link.appendChild(text);
      line.appendChild(link);
      row.appendChild(line);
      box.appendChild(row);
    }
    if (box.parentElement !== host) host.prepend(box);
  }

  function bindNativePlotSearch() {
    const input = nativePlotSearchInput();
    if (!input || input.dataset.zrmAliasSearchBound === '1') return;
    input.dataset.zrmAliasSearchBound = '1';
    const update = () => scheduleRefresh();
    input.addEventListener('input', update);
    input.addEventListener('search', update);
    input.addEventListener('change', update);
  }

  function refresh() {
    observer?.disconnect();
    const section = currentSection();
    removeLegacyPanel();

    if (!section) {
      document.getElementById(NATIVE_RESULTS_ID)?.remove();
      document.getElementById(PLOT_NATIVE_RESULTS_ID)?.remove();
      return;
    }

    injectStyle();
    const records = renderedItems();

    for (const record of records) {
      applyAlias(record);
      makeRenameButton(record);
    }

    injectRoomContextMenu();
    saveState();

    if (section === 'room') {
      bindNativeRoomSearch();
      renderNativeAliasResults(nativeRoomQuery());
    } else if (section === 'plot-search') {
      bindNativePlotSearch();
      renderNativePlotAliasResults(nativePlotSearchInput()?.value || '');
    }
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

    observer = new MutationObserver(scheduleRefresh);
    refresh();

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

