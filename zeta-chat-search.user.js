// ==UserScript==
// @name         Zeta Chat Search
// @namespace    zeta-chat-search
// @version      0.2.1
// @description  현재 열어둔 Zeta 채팅방의 이전 메시지를 끝까지 불러와 내용을 검색하고 이전/다음 결과로 이동합니다.
// @match        https://zeta-ai.io/*
// @updateURL    https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-chat-search.user.js
// @downloadURL  https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-chat-search.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const HOST_ID = 'zeta-chat-search-host';
  const STYLE_ID = 'zeta-chat-search-style';
  const HIT_CLASS = 'zeta-chat-search-hit';
  const ACTIVE_CLASS = 'zeta-chat-search-current';

  let hits = [];
  let current = -1;
  let refreshTimer = 0;
  let lastUrl = location.href;
  let loading = false;
  let loadToken = 0;
  let historyReadyFor = '';

  function chatRoot() {
    return document.querySelector(
      '[role="log"][aria-label="Chat messages"], [data-sentry-component="ChatRoom"]'
    );
  }

  function isChatOpen() {
    return !!chatRoot();
  }

  function messageNodes() {
    const root = chatRoot();
    if (!root) return [];
    const selector = [
      '[data-sentry-component="ChatBubbleContainer"]',
      '[data-sentry-component="NarratorBubble"]'
    ].join(',');
    return [...root.querySelectorAll(selector)].filter((node, index, list) =>
      !list.some((other, otherIndex) => otherIndex !== index && other.contains(node))
    );
  }

  function scrollContainer() {
    const root = chatRoot();
    if (!root) return null;

    const candidates = [root, ...root.querySelectorAll('*')];
    let parent = root.parentElement;
    while (parent && parent !== document.body) {
      candidates.push(parent);
      parent = parent.parentElement;
    }
    candidates.push(document.scrollingElement);

    return candidates
      .filter(Boolean)
      .map(node => ({ node, range: Math.max(0, node.scrollHeight - node.clientHeight) }))
      .filter(item => item.range > 24)
      .sort((a, b) => b.range - a.range)[0]?.node || root;
  }

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function pushOlderEdge(scroller, mode) {
    const nodes = messageNodes();
    const visualTop = nodes
      .map(node => ({ node, top: node.getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top)[0]?.node;
    visualTop?.scrollIntoView({ block: 'start', behavior: 'auto' });

    const distance = Math.max(scroller.scrollHeight, 1);
    if (mode === 0) scroller.scrollTop = 0;
    else if (mode === 1) scroller.scrollTop = distance;
    else scroller.scrollTop = -distance;

    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    window.dispatchEvent(new Event('scroll'));
  }

  async function loadAllHistory(token) {
    let stableRounds = 0;
    let knownCount = messageNodes().length;
    let knownHeight = scrollContainer()?.scrollHeight || 0;
    let preferredMode = null;

    for (let attempt = 0; attempt < 120 && token === loadToken; attempt += 1) {
      const modes = preferredMode === null ? [0, 1, 2] : [preferredMode];
      let grew = false;

      for (const mode of modes) {
        if (token !== loadToken) return;
        const scroller = scrollContainer();
        if (!scroller) return;
        pushOlderEdge(scroller, mode);
        await wait(500);

        const count = messageNodes().length;
        const height = scrollContainer()?.scrollHeight || 0;
        if (count > knownCount || height > knownHeight + 8) {
          knownCount = Math.max(knownCount, count);
          knownHeight = Math.max(knownHeight, height);
          preferredMode = mode;
          stableRounds = 0;
          grew = true;
          break;
        }
      }

      const count = messageNodes().length;
      updateMeta(`이전 메시지 불러오는 중… ${count}개 확인`);
      if (!grew) stableRounds += 1;
      if (stableRounds >= 3) break;
    }
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${HOST_ID}{position:fixed;right:max(12px,env(safe-area-inset-right));top:max(68px,calc(env(safe-area-inset-top) + 52px));z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#191919}
      #${HOST_ID}[hidden]{display:none!important}
      #${HOST_ID} *{box-sizing:border-box}
      #${HOST_ID} .zcs-open{width:44px;height:44px;border:0;border-radius:50%;background:#191919;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.24);font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer}
      #${HOST_ID} .zcs-panel{width:min(360px,calc(100vw - 24px));padding:12px;border:1px solid rgba(0,0,0,.12);border-radius:16px;background:rgba(255,255,255,.97);box-shadow:0 8px 28px rgba(0,0,0,.25);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
      #${HOST_ID} .zcs-row{display:flex;align-items:center;gap:7px}
      #${HOST_ID} input{min-width:0;flex:1;height:40px;padding:0 12px;border:1px solid #d6d6d6;border-radius:10px;background:#fff;color:#191919;font-size:15px;outline:none}
      #${HOST_ID} input:focus{border-color:#8066e9;box-shadow:0 0 0 3px rgba(128,102,233,.14)}
      #${HOST_ID} button{font:inherit}
      #${HOST_ID} .zcs-nav,#${HOST_ID} .zcs-close{height:40px;min-width:38px;padding:0 10px;border:0;border-radius:10px;background:#f0f0f2;color:#222;font-size:17px;cursor:pointer}
      #${HOST_ID} .zcs-close{font-size:22px}
      #${HOST_ID} .zcs-meta{display:flex;justify-content:space-between;gap:12px;padding:9px 3px 1px;color:#686868;font-size:12px}
      #${HOST_ID} .zcs-note{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .${HIT_CLASS}{outline:3px solid rgba(255,174,0,.78)!important;outline-offset:3px!important;border-radius:8px}
      .${ACTIVE_CLASS}{outline:4px solid #8b5cf6!important;outline-offset:4px!important;animation:zcs-pulse .8s ease}
      @keyframes zcs-pulse{0%{filter:brightness(1)}45%{filter:brightness(1.14)}100%{filter:brightness(1)}}
      @media(max-width:520px){#${HOST_ID}{top:auto;right:12px;bottom:max(86px,calc(env(safe-area-inset-bottom) + 70px))}#${HOST_ID} .zcs-panel{width:calc(100vw - 24px)}}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function clearMarks() {
    document.querySelectorAll('.' + HIT_CLASS + ',.' + ACTIVE_CLASS).forEach(node => {
      node.classList.remove(HIT_CLASS, ACTIVE_CLASS);
    });
  }

  function ui() {
    return document.getElementById(HOST_ID);
  }

  function updateMeta(note) {
    const host = ui();
    if (!host) return;
    const count = host.querySelector('.zcs-count');
    const info = host.querySelector('.zcs-note');
    count.textContent = hits.length ? `${current + 1} / ${hits.length}` : '0개';
    info.textContent = note || (hits.length ? '현재 불러온 메시지에서 검색됨' : '일치하는 메시지 없음');
  }

  function goTo(index) {
    if (!hits.length) {
      current = -1;
      updateMeta();
      return;
    }
    current = (index + hits.length) % hits.length;
    hits.forEach((node, i) => node.classList.toggle(ACTIVE_CLASS, i === current));
    const target = hits[current];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    updateMeta();
  }

  function scanMessages(query, jumpToFirst = true) {
    clearMarks();
    hits = messageNodes().filter(node =>
      normalized(node.innerText || node.textContent).includes(query)
    );
    current = -1;
    hits.forEach(node => node.classList.add(HIT_CLASS));
    if (hits.length && jumpToFirst) goTo(0);
    else updateMeta();
  }

  async function search() {
    const host = ui();
    const input = host?.querySelector('input');
    if (!input) return;
    const query = normalized(input.value);

    if (!query) {
      loadToken += 1;
      loading = false;
      clearMarks();
      hits = [];
      current = -1;
      updateMeta('검색어를 입력하세요');
      return;
    }

    scanMessages(query);
    const roomKey = location.href;
    if (historyReadyFor === roomKey || loading) return;

    const token = ++loadToken;
    loading = true;
    updateMeta(`이전 메시지 불러오는 중… ${messageNodes().length}개 확인`);
    await loadAllHistory(token);
    if (token !== loadToken) return;

    loading = false;
    historyReadyFor = roomKey;
    const latestQuery = normalized(input.value);
    if (!latestQuery) {
      updateMeta('검색어를 입력하세요');
      return;
    }
    scanMessages(latestQuery);
  }

  function scheduleSearch() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(search, 180);
  }

  function setPanel(open) {
    const host = ui();
    if (!host) return;
    host.querySelector('.zcs-open').hidden = open;
    host.querySelector('.zcs-panel').hidden = !open;
    if (open) {
      const input = host.querySelector('input');
      input.focus();
      if (input.value) search();
      else updateMeta('현재 불러온 메시지를 검색합니다');
    } else {
      loadToken += 1;
      loading = false;
      clearMarks();
      hits = [];
      current = -1;
    }
  }

  function mount() {
    installStyle();
    let host = ui();
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      host.innerHTML = `
        <button class="zcs-open" type="button" aria-label="채팅 내용 검색" title="채팅 내용 검색">⌕</button>
        <section class="zcs-panel" role="search" aria-label="채팅 내용 검색" hidden>
          <div class="zcs-row">
            <input type="search" inputmode="search" autocomplete="off" placeholder="이 채팅에서 검색">
            <button class="zcs-nav zcs-prev" type="button" aria-label="이전 결과">↑</button>
            <button class="zcs-nav zcs-next" type="button" aria-label="다음 결과">↓</button>
            <button class="zcs-close" type="button" aria-label="검색 닫기">×</button>
          </div>
          <div class="zcs-meta"><span class="zcs-note">검색어를 입력하세요</span><b class="zcs-count">0개</b></div>
        </section>
      `;
      document.body.appendChild(host);

      const input = host.querySelector('input');
      host.querySelector('.zcs-open').addEventListener('click', () => setPanel(true));
      host.querySelector('.zcs-close').addEventListener('click', () => setPanel(false));
      host.querySelector('.zcs-prev').addEventListener('click', () => goTo(current - 1));
      host.querySelector('.zcs-next').addEventListener('click', () => goTo(current + 1));
      input.addEventListener('input', () => {
        if (loading) {
          loadToken += 1;
          loading = false;
        }
        scheduleSearch();
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          goTo(current + (event.shiftKey ? -1 : 1));
        } else if (event.key === 'Escape') {
          setPanel(false);
        }
      });
    }
    host.hidden = !isChatOpen();
    if (host.hidden) {
      clearMarks();
      hits = [];
      current = -1;
    }
  }

  function refresh() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      loadToken += 1;
      loading = false;
      historyReadyFor = '';
      const host = ui();
      if (host) {
        host.querySelector('input').value = '';
        setPanel(false);
      }
    }
    mount();
    const host = ui();
    if (host && !host.querySelector('.zcs-panel').hidden && host.querySelector('input').value) {
      scheduleSearch();
    }
  }

  function start() {
    mount();
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', refresh, true);
    window.addEventListener('pageshow', refresh, true);
    setInterval(refresh, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();