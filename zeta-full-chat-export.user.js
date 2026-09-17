// ==UserScript==
// @name         Zeta Full Chat Export
// @namespace    zeta-personal-tools
// @version      0.2.2
// @description  Zeta 대화 전체 또는 책갈피 사이 구간을 Markdown/TXT로 저장합니다.
// @match        https://zeta-ai.io/*
// @updateURL    https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-full-chat-export.user.js
// @downloadURL  https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-full-chat-export.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const APP = 'zeta-full-chat-export';
  const BUTTON_ID = APP + '-button';
  const MENU_ID = APP + '-menu';
  const PANEL_ID = APP + '-panel';
  const RANGE_ID = APP + '-range';
  const STYLE_ID = APP + '-style';
  const MESSAGE_SELECTOR = '[data-sentry-component="BodyView"][id^="message-"]';
  const CHAT_SELECTOR = '[role="log"][aria-label="Chat messages"]';

  let running = false;
  let cancelled = false;

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value || '')
    .replace(/\u200b/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function safeFileName(value) {
    return clean(value || 'zeta-chat')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .slice(0, 80) || 'zeta-chat';
  }

  function findChatLog() {
    return document.querySelector(CHAT_SELECTOR);
  }

  function visibleChatPage() {
    const log = findChatLog();
    return !!(log && log.getBoundingClientRect().height > 0);
  }

  function roleOf(body) {
    if (body.querySelector('[data-sentry-component="RightTextContent"]')) return 'user';
    if (body.querySelector('[data-sentry-component="LeftTextContent"]')) return 'assistant';
    return 'narrator';
  }

  function speakerNameOf(body, role) {
    const selector = role === 'user'
      ? '[data-sentry-component="RightTextContent"] .caption1'
      : '[data-sentry-component="LeftTextContent"] .caption1';
    return clean(body.querySelector(selector)?.innerText || '')
      .replace(/^@+/, '')
      .replace(/:+$/, '')
      .trim();
  }

  function pushPart(parts, type, text) {
    const value = clean(text);
    if (!value) return;

    const previous = parts[parts.length - 1];
    if (previous?.type === type) {
      previous.text = clean(previous.text + '\n\n' + value);
    } else {
      parts.push({ type, text: value });
    }
  }

  function extractParts(body) {
    const parts = [];
    const sections = body.querySelectorAll([
      '[data-sentry-component="NarratorBubble"]',
      '[data-sentry-component="LeftTextContent"]',
      '[data-sentry-component="RightTextContent"]'
    ].join(','));

    sections.forEach(section => {
      const forcedNarration = section.matches('[data-sentry-component="NarratorBubble"]');
      const paragraphs = Array.from(section.querySelectorAll('.chat p'));

      if (paragraphs.length) {
        paragraphs.forEach(paragraph => {
          const text = paragraph.innerText || paragraph.textContent || '';
          const meaningfulNodes = Array.from(paragraph.childNodes).filter(node =>
            node.nodeType === Node.ELEMENT_NODE ||
            (node.nodeType === Node.TEXT_NODE && clean(node.textContent))
          );
          const narration = forcedNarration || (
            meaningfulNodes.length > 0 &&
            meaningfulNodes.every(node =>
              node.nodeType === Node.ELEMENT_NODE &&
              node.matches('em, i')
            )
          );
          pushPart(parts, narration ? 'narration' : 'message', text);
        });
        return;
      }

      const chats = Array.from(section.querySelectorAll('.chat'));
      let text = clean(chats.length
        ? chats.map(node => node.innerText || node.textContent || '').join('\n\n')
        : section.innerText || section.textContent || '');

      const label = clean(section.querySelector('.caption1')?.innerText || '');
      if (label && text.startsWith(label)) text = clean(text.slice(label.length));
      pushPart(parts, forcedNarration ? 'narration' : 'message', text);
    });

    if (!parts.length) {
      const text = clean(body.innerText || body.textContent || '');
      pushPart(parts, 'message', text);
    }
    return parts;
  }

  function extractImages(body) {
    const ignored = [
      '/profile-image/',
      '/user-plot-chat-profile-image/',
      '/icon/',
      'zeta_watermark'
    ];

    return Array.from(body.querySelectorAll('img[src]'))
      .map(img => ({ src: img.currentSrc || img.src, alt: clean(img.alt) }))
      .filter(item => item.src && !ignored.some(token => item.src.includes(token)))
      .filter((item, index, all) => all.findIndex(x => x.src === item.src) === index);
  }

  function readMessage(body) {
    const role = roleOf(body);
    return {
      id: body.id,
      role,
      speaker: speakerNameOf(body, role),
      parts: extractParts(body),
      images: extractImages(body)
    };
  }

  function messageNumber(id) {
    const match = String(id || '').match(/^message-MESSAGE-(\d+)-/);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  }

  function comparableText(value) {
    return clean(value)
      .replace(/^@[^:\n]{1,80}:\s*/, '')
      .replace(/[＊*`_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function bookmarkUrl() {
    return location.pathname.replace(/\/bookmarks\/?$/, '').replace(/\/$/, '') + '/bookmarks';
  }

  function readBookmarkButtons(root) {
    return Array.from(root.querySelectorAll('[data-testid^="bookmark-item-"]')).map(button => ({
      id: button.dataset.testid.replace('bookmark-item-', ''),
      date: clean(button.querySelector('.body14')?.textContent || ''),
      preview: clean(button.querySelector('.body12')?.textContent || '')
    })).filter(item => item.preview);
  }

  async function loadBookmarksFromPage() {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:420px;height:720px;border:0;opacity:.01;pointer-events:none;';
    document.body.appendChild(frame);

    try {
      const loaded = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('책갈피 화면 로딩 시간이 초과됐어요.')), 15000);
        frame.addEventListener('load', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      frame.src = bookmarkUrl();
      await loaded;

      const found = new Map();
      let stable = 0;
      let previousSize = -1;
      for (let attempt = 0; attempt < 30 && stable < 4; attempt += 1) {
        await wait(attempt ? 350 : 900);
        const page = frame.contentDocument;
        if (!page) continue;
        readBookmarkButtons(page).forEach(item => found.set(item.id, item));

        const scroller = page.querySelector(
          '[data-sentry-component="BookmarkList"] [data-sentry-component="WrappedDiv"]'
        );
        if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });

        stable = found.size === previousSize ? stable + 1 : 0;
        previousSize = found.size;
      }
      return Array.from(found.values());
    } finally {
      frame.remove();
    }
  }

  async function loadBookmarks() {
    const response = await fetch(bookmarkUrl(), {
      credentials: 'include',
      headers: { Accept: 'text/html' }
    });
    if (!response.ok) throw new Error('책갈피 목록을 불러오지 못했어요.');

    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    let bookmarks = readBookmarkButtons(page);
    /* 제타는 첫 HTML에 일부만 넣고 나머지는 클라이언트에서 가상 스크롤로 불러온다. */
    if (bookmarks.length < 2) bookmarks = await loadBookmarksFromPage();

    if (bookmarks.length < 2) {
      throw new Error('구간을 고르려면 책갈피가 2개 이상 필요해요.');
    }
    return bookmarks;
  }

  function messageIdFromCursor(value) {
    let text = String(value || '');
    for (let i = 0; i < 3; i += 1) {
      try { text = decodeURIComponent(text); } catch (_) { break; }
    }
    const match = text.match(/(?:^|[:?=&])(MESSAGE-\d+-[A-Za-z0-9_-]+)/);
    return match ? 'message-' + match[1] : '';
  }

  async function resolveBookmarkMessageId(bookmark) {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:420px;height:720px;border:0;opacity:.01;pointer-events:none;';
    document.body.appendChild(frame);

    try {
      const loaded = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('책갈피 위치 확인 시간이 초과됐어요.')), 15000);
        frame.addEventListener('load', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      frame.src = bookmarkUrl();
      await loaded;

      let button = null;
      for (let attempt = 0; attempt < 35 && !button; attempt += 1) {
        await wait(attempt ? 300 : 800);
        const page = frame.contentDocument;
        button = page?.querySelector(`[data-testid="bookmark-item-${CSS.escape(bookmark.id)}"]`) || null;
        const scroller = page?.querySelector(
          '[data-sentry-component="BookmarkList"] [data-sentry-component="WrappedDiv"]'
        );
        if (!button && scroller) scroller.scrollBy({ top: scroller.clientHeight * .9, behavior: 'auto' });
      }
      if (!button) throw new Error('선택한 책갈피 항목을 다시 찾지 못했어요.');

      let navigatedUrl = '';
      const frameWindow = frame.contentWindow;
      ['pushState', 'replaceState'].forEach(name => {
        const original = frameWindow.history[name].bind(frameWindow.history);
        frameWindow.history[name] = (...args) => {
          navigatedUrl = String(args[2] || navigatedUrl);
          return original(...args);
        };
      });
      button.click();

      for (let attempt = 0; attempt < 100; attempt += 1) {
        await wait(80);
        let currentUrl = '';
        let html = '';
        try {
          currentUrl = frame.contentWindow.location.href;
          html = frame.contentDocument?.documentElement?.innerHTML || '';
        } catch (_) {}
        const id = messageIdFromCursor(navigatedUrl) ||
          messageIdFromCursor(currentUrl) ||
          messageIdFromCursor(html);
        if (id) return id;
      }
      throw new Error('책갈피의 정확한 메시지 위치를 읽지 못했어요.');
    } finally {
      frame.remove();
    }
  }

  function bookmarkIndex(items, bookmark) {
    const needle = comparableText(bookmark.preview);
    if (!needle) return -1;

    let bestIndex = -1;
    let bestScore = 0;
    items.forEach((item, index) => {
      const haystack = comparableText(item.parts.map(part => part.text).join(' '));
      if (!haystack) return;
      const score = haystack.includes(needle)
        ? needle.length + 10000
        : needle.includes(haystack)
          ? haystack.length + 5000
          : 0;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  function mergeOrder(existing, incoming) {
    const fresh = incoming.filter(Boolean);
    if (!existing.length) return fresh.slice();
    if (!fresh.length) return existing;

    const max = Math.min(existing.length, fresh.length);
    for (let size = max; size > 0; size -= 1) {
      const incomingSuffix = fresh.slice(fresh.length - size).join('\n');
      const existingPrefix = existing.slice(0, size).join('\n');
      if (incomingSuffix === existingPrefix) {
        return [...fresh.slice(0, fresh.length - size), ...existing];
      }
      const existingSuffix = existing.slice(existing.length - size).join('\n');
      const incomingPrefix = fresh.slice(0, size).join('\n');
      if (existingSuffix === incomingPrefix) {
        return [...existing, ...fresh.slice(size)];
      }
    }

    const firstShared = fresh.findIndex(id => existing.includes(id));
    if (firstShared >= 0) {
      const anchor = existing.indexOf(fresh[firstShared]);
      const before = fresh.slice(0, firstShared).filter(id => !existing.includes(id));
      const after = fresh.slice(firstShared + 1).filter(id => !existing.includes(id));
      return [
        ...existing.slice(0, anchor),
        ...before,
        ...existing.slice(anchor),
        ...after
      ];
    }

    return [...fresh, ...existing];
  }

  function capture(messages, order) {
    const bodies = Array.from(document.querySelectorAll(MESSAGE_SELECTOR));
    const log = findChatLog();

    /* Zeta 채팅은 column-reverse라 DOM 순서가 최신→과거다. 저장 순서는 과거→최신으로 맞춘다. */
    if (log && getComputedStyle(log).flexDirection.includes('reverse')) {
      bodies.reverse();
    }

    const ids = [];
    bodies.forEach(body => {
      if (!body.id) return;
      ids.push(body.id);
      messages.set(body.id, readMessage(body));
    });
    return mergeOrder(order, ids);
  }

  function titleFromPage() {
    const candidates = [
      '[data-testid="chat-header-profile"]',
      'header h1',
      'main h1'
    ];
    for (const selector of candidates) {
      const text = clean(document.querySelector(selector)?.innerText || '');
      if (text) return text;
    }
    return clean(document.title.replace(/\s*[-–|]\s*제타.*$/i, '')) || 'Zeta 대화';
  }

  function updatePanel(status, detail = '') {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.querySelector('.zfce-status').textContent = status;
    panel.querySelector('.zfce-detail').textContent = detail;
  }

  function download(name, content, type = 'text/markdown;charset=utf-8') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function markdownText(value) {
    return clean(value)
      .replace(/^---+$/gm, '\\---')
      .replace(/^#{1,6}\\s/gm, match => '\\' + match);
  }

  function buildMarkdown(meta, items) {
    const lines = [
      '# ' + markdownText(meta.title),
      '',
      '- 메시지 수: ' + items.length,
      '- 저장 시각: ' + meta.exportedAt,
      '- 원본 주소: ' + meta.url,
      '',
      '---',
      ''
    ];

    items.forEach((item, index) => {
      const label = item.role === 'user' ? '나' : item.role === 'assistant' ? '캐릭터' : '서술';
      lines.push('## ' + (index + 1) + '. ' + label, '');

      item.parts.forEach(part => {
        lines.push(part.type === 'narration' ? '[지문]' : '[대사]');
        lines.push(markdownText(part.text), '');
      });

      item.images.forEach((image, imageIndex) => {
        lines.push('[이미지 ' + (imageIndex + 1) + '] ' + image.src, '');
      });

      lines.push('---', '');
    });

    return lines.join('\n').trim() + '\n';
  }

  function cleanSpeakerName(value, fallback) {
    return clean(value || fallback)
      .replace(/^@+/, '')
      .replace(/:+$/, '')
      .trim() || fallback;
  }

  function buildText(meta, items) {
    const characterName = cleanSpeakerName(
      items.find(item => item.role === 'assistant' && item.speaker)?.speaker,
      meta.title
    );
    const userName = cleanSpeakerName(
      items.find(item => item.role === 'user' && item.speaker)?.speaker,
      '나'
    );
    const messages = [];

    items.forEach(item => {
      const fallback = item.role === 'user' ? userName : characterName;
      const speaker = cleanSpeakerName(item.speaker, fallback);
      const blocks = ['@' + speaker + ':'];

      item.parts.forEach(part => {
        if (part.type === 'narration') {
          clean(part.text).split(/\n\s*\n/).forEach(paragraph => {
            const text = clean(paragraph);
            if (text) blocks.push('*' + text + '*');
          });
        } else {
          const text = clean(part.text);
          if (text) blocks.push(text);
        }
      });

      if (blocks.length > 1) messages.push(blocks.join('\n\n'));
    });

    return messages.join('\n\n\n').trim() + '\n';
  }

  async function exportAll(format = 'markdown', range = null) {
    if (running) return;
    const log = findChatLog();
    if (!log) {
      alert('Zeta 채팅방 안에서 실행해줘.');
      return;
    }

    running = true;
    cancelled = false;
    document.getElementById(PANEL_ID).hidden = false;
    const messages = new Map();
    let order = [];
    let stableAtEdge = 0;
    let previousCount = 0;

    try {
      if (range) {
        updatePanel('책갈피 위치를 확인하는 중…', '시작 책갈피 확인');
        range.startMessageId = await resolveBookmarkMessageId(range.start);
        updatePanel('책갈피 위치를 확인하는 중…', '끝 책갈피 확인');
        range.endMessageId = await resolveBookmarkMessageId(range.end);
        if (range.startMessageId === range.endMessageId) {
          throw new Error('서로 다른 두 책갈피를 선택해줘.');
        }
      }
      const reverse = getComputedStyle(log).flexDirection.includes('reverse');

      /* 실행 위치와 관계없이 최신 메시지를 먼저 기준점으로 잡는다. */
      log.scrollTo({
        top: reverse ? 0 : log.scrollHeight,
        behavior: 'auto'
      });
      await wait(180);
      order = capture(messages, order);
      const latestAnchorId = order[order.length - 1] || '';
      updatePanel('이전 대화를 불러오는 중…', `${messages.size}개 수집`);

      previousCount = messages.size;

      while (!cancelled) {
        const beforeHeight = log.scrollHeight;
        const target = reverse ? -(log.scrollHeight + log.clientHeight) : 0;
        log.scrollTo({ top: target, behavior: 'auto' });

        /* 끝으로 바로 점프한 뒤 새 과거 묶음이 붙을 최소 시간만 기다린다. */
        await wait(320);
        order = capture(messages, order);

        const resized = Math.abs(log.scrollHeight - beforeHeight) > 2;
        const grew = messages.size > previousCount;
        previousCount = messages.size;
        stableAtEdge = (!resized && !grew) ? stableAtEdge + 1 : 0;

        updatePanel('이전 대화를 빠르게 불러오는 중…', `${messages.size}개 수집 · 맨 처음 확인 ${stableAtEdge}/8`);
        if (stableAtEdge >= 8) break;

        /* 네트워크 응답이 아직 안 왔을 때만 조금 더 양보한다. */
        await wait(grew || resized ? 60 : 380);
      }

      if (cancelled) throw new DOMException('Cancelled', 'AbortError');

      /*
       * 맨 처음 대화에서 최신 대화까지 다시 훑는다.
       * 한 화면보다 조금 작게 이동해 가상 스크롤 사이의 메시지도 빠뜨리지 않는다.
       */
      let chronologicalOrder = [];
      let stableAtBottom = 0;
      let stalledAwayFromLatest = 0;
      chronologicalOrder = capture(messages, chronologicalOrder);
      updatePanel('처음부터 순서대로 확인 중…', `${messages.size}개 수집`);

      while (!cancelled) {
        const beforeTop = log.scrollTop;
        const beforeCount = messages.size;
        const step = Math.max(320, log.clientHeight * 0.82);

        log.scrollBy({ top: step, behavior: 'auto' });
        await wait(90);
        chronologicalOrder = capture(messages, chronologicalOrder);

        const moved = Math.abs(log.scrollTop - beforeTop) > 2;
        const grew = messages.size > beforeCount;
        const atBottom = reverse
          ? Math.abs(log.scrollTop) < 3
          : log.scrollTop + log.clientHeight >= log.scrollHeight - 3;
        const latestVisible = !latestAnchorId || !!document.getElementById(latestAnchorId);

        /*
         * 가상 스크롤이 중간에서 scrollTop을 0으로 재설정할 수 있다.
         * 실제 최신 메시지 기준점까지 다시 보였을 때만 완료로 판정한다.
         */
        stableAtBottom = atBottom && latestVisible && !moved && !grew
          ? stableAtBottom + 1
          : 0;
        stalledAwayFromLatest = atBottom && !latestVisible && !moved
          ? stalledAwayFromLatest + 1
          : 0;

        updatePanel(
          '처음부터 순서대로 확인 중…',
          latestVisible
            ? `${messages.size}개 수집 · 끝 확인 ${stableAtBottom}/3`
            : `${messages.size}개 수집 · 최신 대화까지 계속 이동 중…`
        );

        if (stableAtBottom >= 3) break;

        if (stalledAwayFromLatest >= 3) {
          /* 경계에서 로딩이 멎으면 살짝 되짚었다가 다시 내려가 로딩을 재촉한다. */
          log.scrollBy({ top: reverse ? -160 : -160, behavior: 'auto' });
          await wait(100);
          log.scrollBy({ top: step + 160, behavior: 'auto' });
          await wait(420);
          chronologicalOrder = capture(messages, chronologicalOrder);
          stalledAwayFromLatest = 0;
        } else if (!moved) {
          await wait(atBottom ? 420 : 220);
        }
      }

      if (cancelled) throw new DOMException('Cancelled', 'AbortError');
      order = chronologicalOrder.length ? chronologicalOrder : capture(messages, order);
      /*
       * Zeta의 MESSAGE 번호는 오래된 메시지일수록 크다.
       * 가상 스크롤의 DOM 배치와 무관하게 번호 내림차순으로 과거→최신을 강제한다.
       */
      const orderIndex = new Map(order.map((id, index) => [id, index]));
      let items = Array.from(messages.values()).sort((a, b) => {
        const difference = messageNumber(b.id) - messageNumber(a.id);
        return difference || (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0);
      });
      let fileScope = '전체대화';
      if (range) {
        const first = items.findIndex(item => item.id === range.startMessageId);
        const second = items.findIndex(item => item.id === range.endMessageId);
        if (first < 0 || second < 0) {
          throw new Error('선택한 책갈피 메시지를 불러온 대화에서 찾지 못했어요.');
        }
        const from = Math.min(first, second);
        const to = Math.max(first, second);
        items = items.slice(from, to + 1);
        fileScope = '책갈피구간';
      }
      const meta = {
        title: titleFromPage(),
        url: location.href,
        exportedAt: new Date().toLocaleString('ko-KR'),
        count: items.length
      };
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      if (format === 'text') {
        download(
          `${safeFileName(meta.title)}-${fileScope}-${stamp}.txt`,
          buildText(meta, items),
          'text/plain;charset=utf-8'
        );
      } else {
        download(`${safeFileName(meta.title)}-${fileScope}-${stamp}.md`, buildMarkdown(meta, items));
      }
      updatePanel('저장 완료', `${items.length}개 메시지를 ${format === 'text' ? 'TXT' : 'MD'}로 저장했어요.`);
      await wait(1200);
      document.getElementById(PANEL_ID).hidden = true;
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.error('[Zeta Full Chat Export]', error);
        updatePanel('저장 실패', error?.message || String(error));
        await wait(2200);
      }
      document.getElementById(PANEL_ID).hidden = true;
    } finally {
      running = false;
      cancelled = false;
      document.querySelector('[data-testid="chat-scroll-to-bottom"]')?.click();
    }
  }

  async function openRangePicker() {
    const dialog = document.getElementById(RANGE_ID);
    if (!dialog) return;
    dialog.hidden = false;
    dialog.querySelector('.zfce-range-state').textContent = '책갈피를 불러오는 중…';
    dialog.querySelector('.zfce-range-form').hidden = true;

    try {
      const bookmarks = await loadBookmarks();
      dialog.bookmarks = bookmarks;
      const options = bookmarks.map((bookmark, index) =>
        `<option value="${index}">${escapeHtml(bookmark.date)} · ${escapeHtml(bookmark.preview.slice(0, 54))}</option>`
      ).join('');
      const start = dialog.querySelector('[name="start"]');
      const end = dialog.querySelector('[name="end"]');
      start.innerHTML = options;
      end.innerHTML = options;
      /* 목록은 보통 최신→과거다. 기본값은 가장 오래된 것부터 가장 최신 것까지. */
      start.value = String(bookmarks.length - 1);
      end.value = '0';
      dialog.querySelector('.zfce-range-state').textContent = '시작과 끝 책갈피를 골라줘.';
      dialog.querySelector('.zfce-range-form').hidden = false;
    } catch (error) {
      dialog.querySelector('.zfce-range-state').textContent = error?.message || String(error);
    }
  }

  function installUi() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `#${BUTTON_ID}{position:fixed;right:14px;bottom:142px;z-index:2147483643;border:0;border-radius:999px;padding:11px 15px;background:#6d48ff;color:#fff;font:800 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 5px 18px rgba(0,0,0,.24)}#${BUTTON_ID}[hidden],#${MENU_ID}[hidden],#${PANEL_ID}[hidden],#${RANGE_ID}[hidden],#${RANGE_ID} [hidden]{display:none!important}#${MENU_ID}{position:fixed;right:14px;bottom:186px;z-index:2147483644;display:grid;min-width:190px;padding:7px;border:1px solid rgba(0,0,0,.08);border-radius:14px;background:#fff;box-shadow:0 9px 28px rgba(0,0,0,.24);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#${MENU_ID} button{border:0;border-radius:9px;padding:11px 13px;background:transparent;color:#263238;font-size:13px;font-weight:800;text-align:left}#${MENU_ID} button:active{background:#f0edff}#${MENU_ID} .zfce-range-open{margin-top:4px;border-top:1px solid #eceff1;border-radius:0 0 9px 9px;padding-top:13px;color:#6d48ff}#${PANEL_ID},#${RANGE_ID}{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.58);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#${PANEL_ID} .zfce-card,#${RANGE_ID} .zfce-card{width:min(390px,100%);padding:20px;border-radius:17px;background:#fff;color:#263238;box-shadow:0 18px 50px rgba(0,0,0,.35)}#${PANEL_ID} .zfce-card{text-align:center}#${PANEL_ID} .zfce-status{font-weight:850;font-size:16px}#${PANEL_ID} .zfce-detail{margin:8px 0 15px;color:#78858c;font-size:12px}#${PANEL_ID} .zfce-card>button,#${RANGE_ID} button{border:0;border-radius:10px;background:#eceff1;color:#45545c;padding:10px 14px;font-weight:800}#${RANGE_ID} h3{margin:0 0 6px;font-size:17px}#${RANGE_ID} .zfce-range-state{margin-bottom:15px;color:#78858c;font-size:12px}#${RANGE_ID} label{display:block;margin:11px 0 6px;font-size:12px;font-weight:800}#${RANGE_ID} select{display:block;width:100%;height:43px;border:1px solid #dfe4e7;border-radius:10px;background:#f7f9fa;color:#263238;padding:0 10px}#${RANGE_ID} .zfce-range-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px}#${RANGE_ID} .zfce-range-actions button{background:#6d48ff;color:#fff}#${RANGE_ID} .zfce-range-close{float:right;margin:-6px -6px 0 8px;background:transparent;padding:7px}`;
      document.head.appendChild(style);
    }

    if (!document.getElementById(BUTTON_ID)) {
      const button = document.createElement('button');
      button.id = BUTTON_ID;
      button.type = 'button';
      button.textContent = '대화 내보내기';
      button.addEventListener('click', event => {
        event.stopPropagation();
        const menu = document.getElementById(MENU_ID);
        menu.hidden = !menu.hidden;
      });
      document.body.appendChild(button);
    }

    if (!document.getElementById(MENU_ID)) {
      const menu = document.createElement('div');
      menu.id = MENU_ID;
      menu.hidden = true;
      menu.innerHTML = '<button type="button" data-format="markdown">전체 · Markdown (.md)</button><button type="button" data-format="text">전체 · 텍스트 (.txt)</button><button type="button" class="zfce-range-open">책갈피 구간…</button>';
      menu.addEventListener('click', event => {
        event.stopPropagation();
        if (event.target.closest('.zfce-range-open')) {
          menu.hidden = true;
          openRangePicker();
          return;
        }
        const format = event.target.closest('button[data-format]')?.dataset.format;
        if (!format) return;
        menu.hidden = true;
        exportAll(format);
      });
      document.body.appendChild(menu);
    }

    if (!document.getElementById(PANEL_ID)) {
      const panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.hidden = true;
      panel.innerHTML = '<div class="zfce-card"><div class="zfce-status">준비 중…</div><div class="zfce-detail"></div><button type="button">취소</button></div>';
      panel.querySelector('button').addEventListener('click', () => { cancelled = true; });
      document.body.appendChild(panel);
    }

    if (!document.getElementById(RANGE_ID)) {
      const range = document.createElement('div');
      range.id = RANGE_ID;
      range.hidden = true;
      range.innerHTML = '<div class="zfce-card"><button type="button" class="zfce-range-close" aria-label="닫기">✕</button><h3>책갈피 구간 내보내기</h3><div class="zfce-range-state"></div><div class="zfce-range-form" hidden><label>시작 책갈피</label><select name="start"></select><label>끝 책갈피</label><select name="end"></select><div class="zfce-range-actions"><button type="button" data-format="markdown">MD로 저장</button><button type="button" data-format="text">TXT로 저장</button></div></div></div>';
      range.querySelector('.zfce-range-close').addEventListener('click', () => { range.hidden = true; });
      range.querySelector('.zfce-range-actions').addEventListener('click', event => {
        const format = event.target.closest('button[data-format]')?.dataset.format;
        if (!format) return;
        const bookmarks = range.bookmarks || [];
        const start = bookmarks[Number(range.querySelector('[name="start"]').value)];
        const end = bookmarks[Number(range.querySelector('[name="end"]').value)];
        if (!start || !end) return;
        range.hidden = true;
        exportAll(format, { start, end });
      });
      document.body.appendChild(range);
    }

    const hidden = !visibleChatPage();
    document.getElementById(BUTTON_ID).hidden = hidden;
    if (hidden) document.getElementById(MENU_ID).hidden = true;
  }

  document.addEventListener('click', () => {
    const menu = document.getElementById(MENU_ID);
    if (menu) menu.hidden = true;
  });

  const observer = new MutationObserver(() => {
    clearTimeout(observer.timer);
    observer.timer = setTimeout(installUi, 250);
  });

  installUi();
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
