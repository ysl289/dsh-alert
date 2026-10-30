/**
 * 自定义 HTTP 通道 —— 给「我有自己的服务」的人用。
 *
 * 完全自由：URL、方法、头、体都自己写。
 * 体和 webhook 一样支持 {{title}} {{body}} {{url}} 占位。
 */

export const custom = {
  id: 'custom',
  label: '自定义 HTTP',
  hint: '自己写 URL、方法、请求头和请求体。体里用 {{title}} {{body}} {{url}} 占位。适合接到自己的服务器或任何没列出来的服务。',
  fields: [
    { key: 'url', label: 'URL', type: 'string', default: '', placeholder: 'https://your-server/notify', required: true },
    { key: 'method', label: '方法', type: 'select', default: 'POST', options: ['POST', 'GET', 'PUT'] },
    { key: 'headers', label: '请求头（JSON）', type: 'text', default: '', placeholder: '{"Authorization":"Bearer xxx"}' },
    { key: 'body', label: '请求体', type: 'text', default: '{"title":"{{title}}","body":"{{body}}"}', placeholder: 'GET 方法可留空' },
    { key: 'successCodes', label: '视为成功的状态码', type: 'string', default: '200-299', placeholder: '200-299 或 200,201,204' },
  ],

  build(msg, cfg) {
    const url = String(cfg.url || '').trim();
    if (!url) throw new Error('自定义 HTTP 的 URL 没填');

    const method = String(cfg.method || 'POST').toUpperCase();
    const headers = {};
    if (method !== 'GET') headers['Content-Type'] = 'application/json; charset=utf-8';
    if (String(cfg.headers || '').trim()) {
      try {
        Object.assign(headers, JSON.parse(cfg.headers));
      } catch {
        throw new Error('请求头不是合法 JSON');
      }
    }

    const values = { title: msg.title, body: msg.body, url: msg.url ?? '' };
    const fill = (tpl) => String(tpl).replace(/\{\{(\w+)\}\}/g, (_, k) => JSON.stringify(String(values[k] ?? '')).slice(1, -1));

    const req = { url, method, headers };
    if (method !== 'GET') {
      const body = String(cfg.body || '').trim();
      if (body) req.body = fill(body);
    }
    return req;
  },

  check(res, _json, cfg) {
    const spec = String(cfg?.successCodes || '200-299').trim();
    const ok = matchesStatus(res.status, spec);
    return { ok, detail: ok ? 'ok' : `HTTP ${res.status} 不在 ${spec} 内` };
  },
};

/** 解析 "200-299" / "200,201,204" 这类状态码规格。 */
function matchesStatus(status, spec) {
  for (const part of spec.split(',')) {
    const s = part.trim();
    if (!s) continue;
    const m = /^(\d{3})\s*-\s*(\d{3})$/.exec(s);
    if (m) {
      if (status >= Number(m[1]) && status <= Number(m[2])) return true;
    } else if (/^\d{3}$/.test(s) && Number(s) === status) {
      return true;
    }
  }
  return false;
}
