/**
 * Bark 通道 —— iOS 上体验最好，装 App 拿一个 key 就行。
 *
 * 请求：GET/POST {server}/{key}，JSON body 带 title/body。
 * 文档：https://bark.day.app/#/tutorial
 */

export const bark = {
  id: 'bark',
  label: 'Bark（iPhone）',
  hint: 'App Store 装 Bark，打开后首页会显示一个形如 https://api.day.app/XXXXXXXX 的地址，把最后那段 key 填这里。',
  fields: [
    { key: 'server', label: '服务器', type: 'string', default: 'https://api.day.app', placeholder: 'https://api.day.app' },
    { key: 'key', label: '设备 Key', type: 'secret', default: '', placeholder: 'App 首页地址的最后一段', required: true },
    { key: 'sound', label: '提示音', type: 'string', default: '', placeholder: '留空用默认，可填 alarm / bell 等' },
    { key: 'group', label: '分组', type: 'string', default: 'DSH', placeholder: 'DSH' },
  ],

  build(msg, cfg) {
    const server = String(cfg.server || 'https://api.day.app').replace(/\/+$/, '');
    const key = String(cfg.key || '').trim();
    if (!key) throw new Error('Bark 设备 Key 没填');

    const payload = {
      title: msg.title,
      body: msg.body,
      group: cfg.group || 'DSH',
    };
    if (msg.url) payload.url = msg.url;
    if (cfg.sound) payload.sound = cfg.sound;

    return {
      url: `${server}/${encodeURIComponent(key)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    };
  },

  /**
   * Bark 成功时 code === 200。
   *
   * 注意：失败信息主要在 **body** 里，不在状态码里。
   * 例如 key 填错时返回 HTTP 400 + {"message":"failed to get device token: ..."}。
   * 只报 "HTTP 400" 会让排查规则匹配不上（它们要读 message 内容）。
   */
  check(res, json) {
    const msg = json && typeof json.message === 'string' ? json.message : '';
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, detail: msg ? `HTTP ${res.status}: ${msg}` : `HTTP ${res.status}` };
    }
    if (json && typeof json.code === 'number' && json.code !== 200) {
      return { ok: false, detail: `Bark code ${json.code}: ${msg}` };
    }
    return { ok: true, detail: 'ok' };
  },
};
