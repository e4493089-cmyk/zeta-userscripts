// ==UserScript==
// @name         Zeta Auto Chat (OpenRouter)
// @namespace    zeta-auto-chat-openrouter
// @version      0.1.2
// @description  OpenRouter로 다음 사용자 답장을 만들고 Zeta 채팅에 자동 전송합니다.
// @match        https://zeta-ai.io/*
// @run-at       document-idle
// @connect      openrouter.ai
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(() => {
  'use strict';

  const APP_ID = 'zeta-auto-chat';
  const PANEL_ID = APP_ID + '-panel';
  const WIDGET_ID = APP_ID + '-widget';
  const STYLE_ID = APP_ID + '-style';
  const SETTINGS_KEY = APP_ID + ':settings:v1';
  const DAILY_KEY = APP_ID + ':daily:v1';
  const DEFAULT_PROMPT = [
    '너는 역할극 채팅에서 사용자 역할을 맡는다.',
    '주어진 대화의 흐름, 사용자 말투, 관계와 감정선을 자연스럽게 이어서 다음 사용자 답장 하나만 작성한다.',
    '상대 캐릭터의 행동이나 대사를 대신 결정하지 않는다.',
    '해설, 분석, 따옴표, 답변 머리말 없이 실제로 전송할 내용만 출력한다.',
    '기본 언어는 한국어다.'
  ].join('\n');
  const DEFAULTS = {
    apiKey: '',
    model: 'google/gemini-2.5-flash-lite',
    profile: '',
    prompt: DEFAULT_PROMPT,
    historyItems: 14,
    maxInputChars: 30000,
    maxOutputTokens: 500,
    temperature: 0.9,
    minDelay: 2,
    maxDelay: 5,
    settleSeconds: 3,
    sessionLimit: 0
  };

  let settings = loadSettings();
  let enabled = false;
  let busy = false;
  let sessionTurns = 0;
  let lastHandledFingerprint = '';
  let lastConversationFingerprint = '';
  let lastConversationChangeAt = Date.now();
  let checkTimer = 0;
  let abortController = null;
  let observer = null;

  function storageGet(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
    } catch (_) {}
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return;
      }
    } catch (_) {}
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function loadSettings() {
    const saved = storageGet(SETTINGS_KEY, {});
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
  }

  function saveSettings(next) {
    settings = { ...DEFAULTS, ...next };
    storageSet(SETTINGS_KEY, settings);
  }

  function todayKey() {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }

  function getDailyUsage() {
    const saved = storageGet(DAILY_KEY, {});
    if (!saved || saved.date !== todayKey()) return { date: todayKey(), count: 0 };
    return { date: saved.date, count: Number(saved.count) || 0 };
  }

  function incrementDailyUsage() {
    const usage = getDailyUsage();
    usage.count += 1;
    storageSet(DAILY_KEY, usage);
    return usage.count;
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u200b/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function isChatPage() {
    return !!document.querySelector('textarea[aria-label="내용 입력하기"]');
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function messageRole(el) {
    const component = el.getAttribute('data-sentry-component');
    if (component === 'RightTextContent') return 'user';
    return 'assistant';
  }

  function extractElementText(el) {
    const preferred = el.querySelector('.chat');
    const text = normalizeText((preferred || el).innerText || (preferred || el).textContent);
    return text
      .replace(/^\d{1,2}:\d{2}\s*(AM|PM)?\s*/i, '')
      .trim();
  }

  function collectConversation() {
    const selector = [
      '[data-sentry-component="LeftTextContent"]',
      '[data-sentry-component="RightTextContent"]',
      '[data-sentry-component="NarratorBubble"]'
    ].join(',');

    const raw = Array.from(document.querySelectorAll(selector))
      .filter(isVisible)
      .map(el => ({ role: messageRole(el), text: extractElementText(el) }))
      .filter(item => item.text);

    const grouped = [];
    raw.forEach(item => {
      const prev = grouped[grouped.length - 1];
      if (prev && prev.role === item.role) {
        prev.text += '\n\n' + item.text;
      } else {
        grouped.push({ ...item });
      }
    });

    return grouped;
  }

  function trimConversation(items) {
    const count = clampNumber(settings.historyItems, 2, 50, DEFAULTS.historyItems);
    const budget = clampNumber(settings.maxInputChars, 2000, 100000, DEFAULTS.maxInputChars);
    const selected = items.slice(-count);
    let used = 0;
    const out = [];

    for (let i = selected.length - 1; i >= 0; i -= 1) {
      let text = selected[i].text;
      const remaining = budget - used;
      if (remaining <= 0) break;
      if (text.length > remaining) text = text.slice(text.length - remaining);
      out.unshift({ role: selected[i].role, content: text });
      used += text.length;
    }

    return out;
  }

  function conversationFingerprint(items) {
    const tail = items.slice(-4).map(x => x.role + ':' + x.text).join('\n');
    let hash = 2166136261;
    for (let i = 0; i < tail.length; i += 1) {
      hash ^= tail.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36) + ':' + tail.length;
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  function hasPendingGeneration() {
    const textarea = document.querySelector('textarea[aria-label="내용 입력하기"]');
    if (!textarea || textarea.disabled) return true;

    const loading = Array.from(document.querySelectorAll(
      '[data-sentry-component="MessageLoadingIndicator"], [aria-label*="Stop"], [aria-label*="중지"]'
    )).some(isVisible);

    const send = document.querySelector('button[data-testid="chat-send-button"]');
    const stopLike = send && /stop|중지/i.test(
      [send.getAttribute('aria-label'), send.getAttribute('title'), send.textContent].filter(Boolean).join(' ')
    );

    return loading || !!stopLike;
  }

  function scheduleCheck(delay = 350) {
    clearTimeout(checkTimer);
    checkTimer = window.setTimeout(checkLoop, delay);
  }

  function noteConversationChange() {
    const items = collectConversation();
    const fp = conversationFingerprint(items);
    if (fp !== lastConversationFingerprint) {
      lastConversationFingerprint = fp;
      lastConversationChangeAt = Date.now();
    }
    return items;
  }

  async function checkLoop() {
    renderWidget();
    if (!enabled || busy || !isChatPage()) return;

    const items = noteConversationChange();
    const last = items[items.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (hasPendingGeneration()) {
      scheduleCheck(800);
      return;
    }

    const stableMs = clampNumber(settings.settleSeconds, 1, 15, DEFAULTS.settleSeconds) * 1000;
    const elapsed = Date.now() - lastConversationChangeAt;
    if (elapsed < stableMs) {
      scheduleCheck(stableMs - elapsed + 150);
      return;
    }

    const fp = conversationFingerprint(items);
    if (fp === lastHandledFingerprint) return;

    const sessionLimit = clampNumber(settings.sessionLimit, 0, 100000, DEFAULTS.sessionLimit);
    if (sessionLimit > 0 && sessionTurns >= sessionLimit) {
      stopAuto('세션 한도 도달');
      return;
    }

    await handleTurn(items, fp);
  }

  async function handleTurn(items, fingerprint) {
    busy = true;
    setStatus('답변 생성 중…', 'busy');
    abortController = new AbortController();

    try {
      const reply = await generateReply(trimConversation(items), abortController.signal);
      if (!enabled) return;
      if (!reply) throw new Error('빈 답변이 반환됐어요.');

      setStatus('전송 대기 중…', 'busy');
      const min = clampNumber(settings.minDelay, 0, 60, DEFAULTS.minDelay);
      const max = clampNumber(settings.maxDelay, min, 120, DEFAULTS.maxDelay);
      await wait((min + Math.random() * (max - min)) * 1000, abortController.signal);
      if (!enabled) return;

      const sent = await fillAndSend(reply);
      if (!sent) throw new Error('입력창 또는 전송 버튼을 찾지 못했어요.');

      lastHandledFingerprint = fingerprint;
      sessionTurns += 1;
      incrementDailyUsage();
      setStatus('AI 답변 대기 중', 'on');
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      console.error('[Zeta Auto Chat]', error);
      stopAuto('오류로 정지');
      showToast(error && error.message ? error.message : String(error), true);
    } finally {
      busy = false;
      abortController = null;
      renderWidget();
      scheduleCheck(1000);
    }
  }

  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      const id = setTimeout(resolve, ms);
      if (!signal) return;
      signal.addEventListener('abort', () => {
        clearTimeout(id);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  }

  function openRouterRequest(payload, signal) {
    const body = JSON.stringify(payload);
    const headers = {
      'Authorization': 'Bearer ' + settings.apiKey.trim(),
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://zeta-ai.io/',
      'X-Title': 'Zeta Auto Chat'
    };

    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        const request = GM_xmlhttpRequest({
          method: 'POST',
          url: 'https://openrouter.ai/api/v1/chat/completions',
          headers,
          data: body,
          timeout: 90000,
          onload: response => {
            let data;
            try { data = JSON.parse(response.responseText || '{}'); }
            catch (_) { return reject(new Error('OpenRouter 응답을 읽지 못했어요.')); }
            if (response.status < 200 || response.status >= 300) {
              return reject(new Error(data?.error?.message || 'OpenRouter HTTP ' + response.status));
            }
            resolve(data);
          },
          onerror: () => reject(new Error('OpenRouter 네트워크 오류가 발생했어요.')),
          ontimeout: () => reject(new Error('OpenRouter 요청 시간이 초과됐어요.'))
        });

        signal?.addEventListener('abort', () => {
          try { request.abort(); } catch (_) {}
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    }

    return fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers, body, signal
    }).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'OpenRouter HTTP ' + response.status);
      return data;
    });
  }

  async function generateReply(history, signal) {
    if (!settings.apiKey.trim()) throw new Error('먼저 OpenRouter API 키를 입력해줘.');

    const profile = normalizeText(settings.profile).slice(0, 20000);
    const systemPrompt = [
      settings.prompt.trim() || DEFAULT_PROMPT,
      profile ? '\n[사용자 프로필]\n' + profile : ''
    ].filter(Boolean).join('\n');

    const payload = {
      model: settings.model.trim() || DEFAULTS.model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history
      ],
      temperature: clampNumber(settings.temperature, 0, 2, DEFAULTS.temperature),
      max_tokens: clampNumber(settings.maxOutputTokens, 50, 4000, DEFAULTS.maxOutputTokens)
    };

    const data = await openRouterRequest(payload, signal);
    const content = data?.choices?.[0]?.message?.content;
    let text = '';
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) {
      text = content.map(x => typeof x === 'string' ? x : x?.text || '').join('');
    }

    return normalizeGeneratedReply(text);
  }

  function normalizeGeneratedReply(text) {
    let out = normalizeText(text);
    out = out.replace(/^(다음\s*(사용자\s*)?답장|사용자|답장)\s*:\s*/i, '');
    if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith('“') && out.endsWith('”'))) {
      out = out.slice(1, -1).trim();
    }
    return out;
  }

  function setNativeTextareaValue(textarea, value) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (descriptor?.set) descriptor.set.call(textarea, value);
    else textarea.value = value;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function fillAndSend(reply) {
    const textarea = document.querySelector('textarea[aria-label="내용 입력하기"]');
    if (!textarea || textarea.disabled) return false;
    textarea.focus();
    setNativeTextareaValue(textarea, reply);

    await wait(250);
    const send = document.querySelector('button[data-testid="chat-send-button"]');
    if (!send || send.disabled || send.getAttribute('aria-disabled') === 'true') return false;
    send.click();
    return true;
  }

  function startAuto() {
    settings = loadSettings();
    if (!settings.apiKey.trim()) {
      openPanel();
      showToast('OpenRouter API 키를 먼저 입력해줘.', true);
      return;
    }
    if (!isChatPage()) {
      showToast('제타 채팅방 안에서 켜줘.', true);
      return;
    }
    enabled = true;
    busy = false;
    sessionTurns = 0;
    lastHandledFingerprint = '';
    lastConversationFingerprint = '';
    lastConversationChangeAt = Date.now();
    setStatus('대화 확인 중', 'on');
    renderWidget();
    scheduleCheck(300);
  }

  function stopAuto(reason = '정지됨') {
    enabled = false;
    busy = false;
    clearTimeout(checkTimer);
    abortController?.abort();
    abortController = null;
    setStatus(reason, 'off');
    renderWidget();
  }

  function toggleAuto() {
    if (enabled) stopAuto();
    else startAuto();
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${WIDGET_ID}{position:fixed;right:12px;bottom:92px;z-index:2147483644;display:flex;gap:6px;align-items:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #${WIDGET_ID} button{border:1px solid rgba(0,0,0,.12);box-shadow:0 4px 14px rgba(0,0,0,.18);cursor:pointer}
      #${WIDGET_ID} .zac-toggle{height:36px;padding:0 12px;border-radius:18px;background:#fff;color:#333;font-size:12px;font-weight:700}
      #${WIDGET_ID}.is-on .zac-toggle{background:#FEE500;color:#191919;border-color:#D9C500}
      #${WIDGET_ID}.is-busy .zac-toggle{background:#FFF3A0;color:#4C4300}
      #${WIDGET_ID} .zac-settings{width:36px;height:36px;border-radius:50%;background:#fff;color:#444;font-size:17px}
      #${PANEL_ID}{position:fixed;inset:0;z-index:2147483646;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.58);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-sizing:border-box}
      #${PANEL_ID}.open{display:flex}
      #${PANEL_ID} *{box-sizing:border-box}
      #${PANEL_ID} .zac-card{width:min(440px,100%);max-height:min(760px,92dvh);overflow:auto;border-radius:18px;background:#fff;color:#222;padding:18px;box-shadow:0 18px 50px rgba(0,0,0,.3)}
      #${PANEL_ID} .zac-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
      #${PANEL_ID} h2{font-size:18px;margin:0}
      #${PANEL_ID} .zac-close{border:0;background:#eee;width:32px;height:32px;border-radius:50%;font-size:18px}
      #${PANEL_ID} label{display:block;margin:12px 0 5px;font-size:12px;font-weight:700;color:#555}
      #${PANEL_ID} input,#${PANEL_ID} textarea{width:100%;border:1px solid #d8dde0;border-radius:9px;background:#f7f8f9;color:#222;padding:10px;font:inherit;outline:none}
      #${PANEL_ID} input:focus,#${PANEL_ID} textarea:focus{border-color:#c9b600;box-shadow:0 0 0 3px rgba(254,229,0,.2)}
      #${PANEL_ID} textarea{min-height:120px;resize:vertical;font-size:12px;line-height:1.45}
      #${PANEL_ID} .zac-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      #${PANEL_ID} .zac-note{margin:8px 0 0;color:#777;font-size:11px;line-height:1.45}
      #${PANEL_ID} .zac-actions{display:flex;gap:8px;margin-top:18px}
      #${PANEL_ID} .zac-actions button{flex:1;height:42px;border:0;border-radius:9px;font-weight:700;cursor:pointer}
      #${PANEL_ID} .zac-save{background:#FEE500;color:#191919}
      #${PANEL_ID} .zac-stop{background:#eceff1;color:#46545e}
      #${APP_ID}-toast{position:fixed;left:50%;bottom:34px;z-index:2147483647;transform:translateX(-50%);max-width:calc(100vw - 32px);padding:10px 14px;border-radius:10px;background:#263238;color:#fff;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);opacity:0;pointer-events:none;transition:opacity .2s}
      #${APP_ID}-toast.show{opacity:1}
      #${APP_ID}-toast.error{background:#a63838}
    `;
    document.head.appendChild(style);
  }

  function installUi() {
    if (!document.getElementById(WIDGET_ID)) {
      const widget = document.createElement('div');
      widget.id = WIDGET_ID;
      widget.innerHTML = '<button class="zac-toggle" type="button">AUTO OFF</button><button class="zac-settings" type="button" aria-label="자동대화 설정">⚙</button>';
      widget.querySelector('.zac-toggle').addEventListener('click', toggleAuto);
      widget.querySelector('.zac-settings').addEventListener('click', openPanel);
      document.body.appendChild(widget);
    }

    if (!document.getElementById(PANEL_ID)) {
      const panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.innerHTML = `
        <div class="zac-card" role="dialog" aria-modal="true" aria-label="Zeta 자동대화 설정">
          <div class="zac-head"><h2>Zeta 자동대화</h2><button class="zac-close" type="button">×</button></div>
          <label>OpenRouter API 키</label>
          <input name="apiKey" type="password" autocomplete="off" placeholder="sk-or-v1-…">
          <p class="zac-note">키는 이 기기의 유저스크립트 저장소에만 보관되며 GitHub로 전송되지 않습니다.</p>
          <label>모델</label>
          <input name="model" type="text">
          <label>내 프로필</label>
          <textarea name="profile" placeholder="성격, 말투, 상대와의 관계, 답장할 때 지켜야 할 설정 등을 적어주세요."></textarea>
          <p class="zac-note">최근 대화와 함께 OpenRouter에 전달됩니다. 비워두면 최근 대화만 참고합니다.</p>
          <label>사용자 역할 프롬프트</label>
          <textarea name="prompt"></textarea>
          <div class="zac-grid">
            <div><label>최근 발화 수</label><input name="historyItems" type="number" min="2" max="50"></div>
            <div><label>최대 출력 토큰</label><input name="maxOutputTokens" type="number" min="50" max="4000"></div>
            <div><label>최소 전송 대기(초)</label><input name="minDelay" type="number" min="0" max="60" step="0.5"></div>
            <div><label>최대 전송 대기(초)</label><input name="maxDelay" type="number" min="0" max="120" step="0.5"></div>
            <div><label>세션 전송 한도 (0=무제한)</label><input name="sessionLimit" type="number" min="0" max="100000"></div>
          </div>
          <div class="zac-actions"><button class="zac-stop" type="button">자동대화 정지</button><button class="zac-save" type="button">저장</button></div>
        </div>`;
      panel.addEventListener('click', event => { if (event.target === panel) closePanel(); });
      panel.querySelector('.zac-close').addEventListener('click', closePanel);
      panel.querySelector('.zac-stop').addEventListener('click', () => { stopAuto(); closePanel(); });
      panel.querySelector('.zac-save').addEventListener('click', savePanel);
      document.body.appendChild(panel);
    }

    renderWidget();
  }

  function formValue(panel, name) {
    return panel.querySelector(`[name="${name}"]`)?.value ?? '';
  }

  function openPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    settings = loadSettings();
    Object.entries(settings).forEach(([key, value]) => {
      const input = panel.querySelector(`[name="${key}"]`);
      if (input) input.value = value;
    });
    panel.classList.add('open');
  }

  function closePanel() {
    document.getElementById(PANEL_ID)?.classList.remove('open');
  }

  function savePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    saveSettings({
      ...settings,
      apiKey: formValue(panel, 'apiKey').trim(),
      model: formValue(panel, 'model').trim() || DEFAULTS.model,
      profile: formValue(panel, 'profile').trim(),
      prompt: formValue(panel, 'prompt').trim() || DEFAULT_PROMPT,
      historyItems: clampNumber(formValue(panel, 'historyItems'), 2, 50, DEFAULTS.historyItems),
      maxOutputTokens: clampNumber(formValue(panel, 'maxOutputTokens'), 50, 4000, DEFAULTS.maxOutputTokens),
      minDelay: clampNumber(formValue(panel, 'minDelay'), 0, 60, DEFAULTS.minDelay),
      maxDelay: clampNumber(formValue(panel, 'maxDelay'), 0, 120, DEFAULTS.maxDelay),
      sessionLimit: clampNumber(formValue(panel, 'sessionLimit'), 0, 100000, DEFAULTS.sessionLimit)
    });
    closePanel();
    showToast('설정을 저장했어요.');
  }

  function setStatus(text, state) {
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;
    widget.dataset.status = text;
    widget.dataset.state = state;
  }

  function renderWidget() {
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;
    widget.classList.toggle('is-on', enabled && !busy);
    widget.classList.toggle('is-busy', enabled && busy);
    const button = widget.querySelector('.zac-toggle');
    if (!button) return;
    const usage = getDailyUsage();
    button.textContent = enabled ? (busy ? 'AUTO 처리 중' : `AUTO ON · ${sessionTurns}`) : 'AUTO OFF';
    button.title = `${widget.dataset.status || '정지됨'} · 오늘 ${usage.count}회`;
  }

  let toastTimer = 0;
  function showToast(message, error = false) {
    let toast = document.getElementById(APP_ID + '-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = APP_ID + '-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle('error', error);
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function start() {
    installStyle();
    installUi();
    setStatus('정지됨', 'off');

    observer = new MutationObserver(() => {
      installUi();
      if (!enabled || busy) return;
      noteConversationChange();
      scheduleCheck();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
