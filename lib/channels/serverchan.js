/**
 * Server酱 通道 —— 推到微信（走它自己的服务号）。
 *
 * 注意：这是第三方服务，消息经过它的服务器。
 * 只想走官方路径的话用 wecom-app。
 *
 * 文档：https://sct.ftqq.com/
 */

export const serverchan = {
  id: 'serverchan',
  label: 'Server酱（微信，第三方服务）',
  hint: 'sct.ftqq.com 微信扫码登录，拿到 SendKey（SCT 开头）。消息会经过它的服务器，介意的话用企业微信自建应用。',
  fields: [
    { key: 'sendKey', label: 'SendKey', type: 'secret', default: '', placeholder: 'SCT...', required: true },
  ],

  build(msg, cfg) {
    const key = String(cfg.sendKey || '').trim();
    if (!key) throw new Error('Server酱 SendKey 没填');

    // Turbo 版：SCT 开头走 sctapi.ftqq.com
    const host = key.startsWith('sctp') ? 'https://push.ft07.com' : 'https://sctapi.ftqq.com';
    const body = new URLSearchParams({
      title: msg.title,
      desp: msg.url ? `${msg.body}\n\n[打开会话](${msg.url})` : msg.body,
    });

    return {
      url: `${host}/${encodeURIComponent(key)}.send`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: body.toString(),
    };
  },

  check(res, json) {
    if (res.status < 200 || res.status >= 300) return { ok: false, detail: `HTTP ${res.status}` };
    if (!json) return { ok: false, detail: '响应不是 JSON' };
    if (typeof json.code === 'number' && json.code !== 0) {
      return { ok: false, detail: `code ${json.code}: ${json.message ?? json.info ?? ''}` };
    }
    return { ok: true, detail: 'ok' };
  },
};
