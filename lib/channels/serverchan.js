/**
 * Server酱 通道 —— 推到微信（走它自己的服务号）。
 *
 * ⚠️ 这是第三方服务，消息经过它的服务器。
 * 只想走官方路径的话用 wecom-app。
 *
 * 两代服务，端点完全不同（这点之前写错过，导致 sctp 格式一律 522）：
 *
 *   1. Server酱 Turbo（老）：SendKey 以 SCT 开头
 *        POST https://sctapi.ftqq.com/<sendKey>.send
 *
 *   2. Server酱³（新）：SendKey 以 sctp 开头，uid 藏在 key 里
 *        POST https://<uid>.push.ft07.com/send/<sendKey>.send
 *      uid 从 key 里提取，正则 /^sctp(\d+)t/
 *
 * 官方文档：https://doc.ft07.com/zh/serverchan3/server/api
 * 老版文档：https://sct.ftqq.com/
 */

/** 从 sctp 开头的 key 里取出 uid。取不到返回 null。 */
export function uidFromSctpKey(key) {
  const m = /^sctp(\d+)t/i.exec(String(key || '').trim());
  return m ? m[1] : null;
}

/**
 * 算出该用哪个推送地址。
 *
 * 导出这个函数是为了让测试能直接验证端点拼接，
 * 而不必真的发一次网络请求。
 */
export function buildUrl(sendKey) {
  const key = String(sendKey || '').trim();
  if (!key) throw new Error('Server酱 SendKey 没填');

  if (/^sctp/i.test(key)) {
    // 新版：https://<uid>.push.ft07.com/send/<key>.send
    const uid = uidFromSctpKey(key);
    if (!uid) {
      throw new Error(
        'SendKey 格式不认识：sctp 开头的 key 里应该包含数字 uid（形如 sctp1234tXXXX）。' +
          '请到 sc3.ft07.com/sendkey 页面复制完整 SendKey。',
      );
    }
    return `https://${uid}.push.ft07.com/send/${encodeURIComponent(key)}.send`;
  }

  // 老版 Turbo：https://sctapi.ftqq.com/<key>.send
  return `https://sctapi.ftqq.com/${encodeURIComponent(key)}.send`;
}

export const serverchan = {
  id: 'serverchan',
  label: 'Server酱（微信，第三方服务）',
  hint:
    '两代服务的 key 格式不同：SCT 开头是老版（sct.ftqq.com），' +
    'sctp 开头是新版 Server酱³（sc3.ft07.com）。消息会经过它的服务器。',
  fields: [
    {
      key: 'sendKey',
      label: 'SendKey',
      type: 'secret',
      default: '',
      placeholder: 'SCT... 或 sctp...',
      required: true,
      help: 'SCT 开头是老版（sct.ftqq.com），sctp 开头是新版（sc3.ft07.com）。整串复制，别截断。',
    },
  ],

  build(msg, cfg) {
    const url = buildUrl(cfg.sendKey);

    const body = new URLSearchParams({
      title: msg.title,
      desp: msg.url ? `${msg.body}\n\n[打开会话](${msg.url})` : msg.body,
    });

    return {
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: body.toString(),
    };
  },

  check(res, json) {
    // 服务端把原因放在 body 里（例如 {"message":"[AUTH]错误的Key"}），
    // 只报状态码会让排查规则匹配不到具体问题。
    const msg = json
      ? String(json.message ?? json.info ?? json.msg ?? '')
      : '';

    if (res.status < 200 || res.status >= 300) {
      // 522/520 通常意味着 uid 子域拼错了
      const cloudflare =
        res.status === 522 || res.status === 520
          ? '（Cloudflare 报错，多半是 SendKey 里取不出 uid，检查是不是 sctp 开头的完整串）'
          : '';
      const tail = msg ? `: ${msg}` : '';
      return { ok: false, detail: `HTTP ${res.status}${tail}${cloudflare}` };
    }
    if (!json) return { ok: false, detail: '响应不是 JSON' };
    if (typeof json.code === 'number' && json.code !== 0) {
      return { ok: false, detail: `code ${json.code}: ${json.message ?? json.info ?? ''}` };
    }
    return { ok: true, detail: 'ok' };
  },
};
