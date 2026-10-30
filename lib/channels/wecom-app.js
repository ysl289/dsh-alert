/**
 * 企业微信自建应用 → 个人微信。
 *
 * 这是「在微信里收到提醒」的官方免费路径：
 *   1. 注册企业微信（个人可注册，免费版上限 200 人）
 *   2. 管理后台建「自建应用」，拿 CorpID / Secret / AgentId
 *   3. 「我的企业 → 微信插件」扫码关注，之后企业应用消息直接进个人微信
 *
 * 发送是两步：
 *   GET /cgi-bin/gettoken?corpid=&corpsecret=   → access_token（有效期 7200s，要缓存）
 *   POST /cgi-bin/message/send?access_token=    → 发文本卡片消息
 *
 * 文档：https://developer.work.weixin.qq.com/document/path/90236
 */

import { readJson } from '../http.js';

const API = 'https://qyapi.weixin.qq.com/cgi-bin';

// access_token 缓存：按 corpId+secret 分桶，避免多套凭据互相顶掉。
const tokenCache = new Map();

async function getToken(corpId, secret, fetchImpl) {
  const cacheKey = `${corpId}\u0000${secret}`;
  const now = Date.now();
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.expiresAt > now + 60_000) return hit.token;

  const url = `${API}/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;
  const res = await fetchImpl(url, { method: 'GET' });
  const json = await readJson(res);
  if (!json || json.errcode !== 0 || !json.access_token) {
    throw new Error(`企业微信 gettoken 失败：${json ? `${json.errcode} ${json.errmsg ?? ''}` : `HTTP ${res.status}`}`);
  }
  // expires_in 单位是秒；留 5 分钟余量
  const ttl = Number(json.expires_in) > 0 ? Number(json.expires_in) * 1000 : 7_200_000;
  tokenCache.set(cacheKey, { token: json.access_token, expiresAt: now + ttl - 300_000 });
  return json.access_token;
}

/** 测试用：清掉 token 缓存。 */
export function clearWecomTokenCache() {
  tokenCache.clear();
}

export const wecomApp = {
  id: 'wecom-app',
  label: '企业微信自建应用 → 个人微信',
  hint: '企业微信管理后台建自建应用拿 CorpID/Secret/AgentId，再在「我的企业 → 微信插件」扫码关注，消息就进个人微信。免费，官方路径。',
  fields: [
    { key: 'corpId', label: '企业 ID（CorpID）', type: 'string', default: '', placeholder: 'ww开头的一串', required: true },
    { key: 'secret', label: '应用 Secret', type: 'secret', default: '', placeholder: '自建应用里的 Secret', required: true },
    { key: 'agentId', label: '应用 AgentId', type: 'string', default: '', placeholder: '数字，例如 1000002', required: true },
    { key: 'toUser', label: '发给谁', type: 'string', default: '@all', placeholder: '@all 或成员账号（多个用 | 分隔）' },
  ],

  /**
   * 这个通道要两次请求，所以 build 返回的不是单个请求。
   * 用 prepare() 拿 access_token，再 build 出真正的发送请求。
   */
  async prepare(cfg, fetchImpl) {
    const corpId = String(cfg.corpId || '').trim();
    const secret = String(cfg.secret || '').trim();
    if (!corpId || !secret) throw new Error('企业微信 CorpID / Secret 没填');
    return { token: await getToken(corpId, secret, fetchImpl) };
  },

  build(msg, cfg, prepared) {
    const agentId = String(cfg.agentId || '').trim();
    if (!agentId) throw new Error('企业微信 AgentId 没填');
    const token = prepared?.token;
    if (!token) throw new Error('企业微信 access_token 未就绪');

    // textcard 是唯一能带「点击跳转」的简单类型，适合通知。
    const description = escapeHtml(msg.body).replace(/\n/g, '<br/>');
    const payload = {
      touser: cfg.toUser || '@all',
      msgtype: 'textcard',
      agentid: Number(agentId),
      textcard: {
        title: truncate(msg.title, 128),
        description: truncate(description, 512),
        url: msg.url || 'https://work.weixin.qq.com/',
        btntxt: msg.url ? '查看' : '详情',
      },
      // 避免同一内容被企业微信当成重复消息静默丢弃
      enable_duplicate_check: 0,
    };

    return {
      url: `${API}/message/send?access_token=${encodeURIComponent(token)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    };
  },

  /** 企业微信永远返回 HTTP 200，真结果在 errcode。 */
  check(res, json) {
    if (res.status < 200 || res.status >= 300) return { ok: false, detail: `HTTP ${res.status}` };
    if (!json) return { ok: false, detail: '响应不是 JSON' };
    if (json.errcode !== 0) {
      return { ok: false, detail: `errcode ${json.errcode}: ${json.errmsg ?? ''}` };
    }
    // 收件人全无效时 errcode 仍是 0，但 invaliduser 有值
    if (json.invaliduser) return { ok: false, detail: `无效收件人：${json.invaliduser}` };
    return { ok: true, detail: 'ok' };
  },
};

function truncate(text, max) {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
