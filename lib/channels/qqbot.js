/**
 * QQ 官方机器人通道。
 *
 * QQ 开放平台（https://q.qq.com）个人认证即可创建 5 个机器人，
 * 单聊主动消息配额：20 条/分钟、1000 条/天（个人认证，够用）。
 *
 * 发送两步：
 *   POST https://bots.qq.com/app/getAppAccessToken   {appId, clientSecret} → access_token（7200s）
 *   POST https://api.sgroup.qq.com/v2/users/{openid}/messages
 *
 * ⚠️ 用户可以在 QQ 客户端关掉「允许机器人主动发消息」，关了会返回 40034105。
 *
 * 文档：https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html
 */

import { readJson } from '../http.js';

const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const API_BASE = 'https://api.sgroup.qq.com';

const tokenCache = new Map();

async function getToken(appId, clientSecret, fetchImpl) {
  const cacheKey = `${appId}\u0000${clientSecret}`;
  const now = Date.now();
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.expiresAt > now + 60_000) return hit.token;

  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ appId, clientSecret }),
  });
  const json = await readJson(res);
  if (!json || !json.access_token) {
    throw new Error(`QQ getAppAccessToken 失败：${json ? JSON.stringify(json).slice(0, 200) : `HTTP ${res.status}`}`);
  }
  const ttl = Number(json.expires_in) > 0 ? Number(json.expires_in) * 1000 : 7_200_000;
  tokenCache.set(cacheKey, { token: json.access_token, expiresAt: now + ttl - 300_000 });
  return json.access_token;
}

/** 测试用：清掉 token 缓存。 */
export function clearQQTokenCache() {
  tokenCache.clear();
}

export const qqbot = {
  id: 'qqbot',
  label: 'QQ 官方机器人',
  hint: 'QQ开放平台(q.qq.com)个人认证→创建机器人→拿 AppID/AppSecret，并把你自己加为「开发体验用户」。注意：你在QQ客户端关掉「允许机器人主动发消息」会发不出去。',
  fields: [
    { key: 'appId', label: 'AppID', type: 'string', default: '', placeholder: '机器人 AppID', required: true ,
      help: '开放平台 → 你的机器人 →「开发设置」→ AppID，是一串纯数字。',
    },
    { key: 'appSecret', label: 'AppSecret', type: 'secret', default: '', placeholder: '机器人 AppSecret', required: true ,
      help: '同一个「开发设置」页 → AppSecret → 点「重置」才显示，且只显示一次。',
    },
    { key: 'openId', label: '你的 OpenID', type: 'string', default: '', placeholder: '单聊收件人 openid，在机器人收到的消息里能看到', required: true ,
      help: '不是 QQ 号。从单聊消息事件（C2C_MESSAGE_CREATE）里的 author.user_openid 取。',
    },
    { key: 'msgType', label: '消息类型', type: 'select', default: 'text', options: ['text', 'markdown'] ,
      help: '纯文本最稳，各平台都认。Markdown 需要平台给你开权限，没开会被拒。',
    },
  ],

  async prepare(cfg, fetchImpl) {
    const appId = String(cfg.appId || '').trim();
    const appSecret = String(cfg.appSecret || '').trim();
    if (!appId || !appSecret) throw new Error('QQ AppID / AppSecret 没填');
    return { token: await getToken(appId, appSecret, fetchImpl) };
  },

  build(msg, cfg, prepared) {
    const openId = String(cfg.openId || '').trim();
    if (!openId) throw new Error('QQ OpenID 没填');
    const token = prepared?.token;
    if (!token) throw new Error('QQ access_token 未就绪');

    const useMarkdown = cfg.msgType === 'markdown';
    const payload = useMarkdown
      ? { msg_type: 2, markdown: { content: `${msg.title}\n${msg.body}` }, msg_seq: nextSeq() }
      : { msg_type: 0, content: `${msg.title}\n${msg.body}`, msg_seq: nextSeq() };

    return {
      url: `${API_BASE}/v2/users/${encodeURIComponent(openId)}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `QQBot ${token}`,
        // 主动消息没有 msg_id 可引用，带上标记让 QQ 知道这是主动推送
        'X-Union-Appid': String(cfg.appId || ''),
      },
      body: JSON.stringify(payload),
    };
  },

  check(res, json) {
    if (res.status >= 200 && res.status < 300) return { ok: true, detail: 'ok' };
    // 40034105 = 用户关了主动消息；40034100 = 超频控
    const code = json?.code ?? json?.err_code;
    const hint =
      code === 40034105
        ? '（用户在 QQ 里关闭了「允许机器人主动发消息」）'
        : code === 40034100
          ? '（超出主动消息频控，20条/分钟）'
          : '';
    return { ok: false, detail: `HTTP ${res.status}${code ? ` code ${code}` : ''}${hint}` };
  },
};

// msg_seq 只是防重复的递增序号，进程内单调递增即可。
let seq = 0;
function nextSeq() {
  seq = (seq + 1) % 1000;
  return seq || 1;
}
