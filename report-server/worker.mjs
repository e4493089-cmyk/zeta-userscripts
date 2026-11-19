// Diagnostic relay: no chat text, URLs, cookies or account identifiers accepted.
const origins = new Set(['https://zeta-ai.io', 'https://frame.pingpong.ai']);
const fields = {
  themeVersion: 40, themeKind: 30, browserFamily: 30, browserVersion: 40,
  osFamily: 30, osVersion: 40, frameStatus: 60, styleStatus: 60,
  backgroundStatus: 60, textStatus: 60, inputStatus: 60
};
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
    if (origins.has(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'Content-Type';
    }
    const reply = (status, data) => new Response(JSON.stringify(data), {status, headers});
    if (request.method === 'GET' && url.pathname === '/') {
      return reply(200, {service:'zeta-reports', ready: Boolean(env.RESEND_API_KEY && env.REPORT_TO && env.REPORT_FROM && env.REPORT_LIMITER)});
    }
    if (url.pathname !== '/report') return reply(404, {error:'not_found'});
    if (!origins.has(origin)) return reply(403, {error:'origin_not_allowed'});
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers});
    if (request.method !== 'POST') return reply(405, {error:'method_not_allowed'});
    if (!env.RESEND_API_KEY || !env.REPORT_TO || !env.REPORT_FROM || !env.REPORT_LIMITER) {
      return reply(503, {error:'mail_not_configured'});
    }
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return reply(415, {error:'json_required'});
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rate = await env.REPORT_LIMITER.limit({key:ip});
    if (!rate.success) return reply(429, {error:'try_later'});
    let data;
    try {
      const reader = request.body?.getReader();
      if (!reader) return reply(400, {error:'invalid_report'});
      const chunks = []; let length = 0;
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 4096) { await reader.cancel(); return reply(413, {error:'report_too_large'}); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      data = JSON.parse(new TextDecoder().decode(bytes));
    } catch { return reply(400, {error:'invalid_report'}); }
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        Object.keys(data).some(key => !Object.hasOwn(fields, key)) ||
        !data.themeVersion || !data.frameStatus) return reply(400, {error:'invalid_report'});
    const lines = [];
    for (const [key, max] of Object.entries(fields)) {
      if (data[key] === undefined) continue;
      if (typeof data[key] !== 'string' || data[key].length > max ||
          !/^[a-zA-Z0-9 ._:+()/-]+$/.test(data[key])) return reply(400, {error:'invalid_report'});
      lines.push(key + ': ' + data[key]);
    }
    try {
      const result = await fetch('https://api.resend.com/emails', {
        method:'POST',
        headers:{Authorization:'Bearer ' + env.RESEND_API_KEY, 'Content-Type':'application/json'},
        body:JSON.stringify({
          from:env.REPORT_FROM, to:[env.REPORT_TO], subject:'[ZETA] Theme diagnostic report',
          text:'Received: ' + new Date().toISOString() + '\n\n' + lines.join('\n')
        }),
        signal:AbortSignal.timeout(15000)
      });
      if (!result.ok) return reply(502, {error:'mail_send_failed'});
      return reply(200, {ok:true, status:'accepted'});
    } catch { return reply(502, {error:'mail_send_failed'}); }
  }
};
