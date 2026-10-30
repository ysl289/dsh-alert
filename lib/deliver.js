/**
 * 发送层 —— 把一条消息发给所有启用的通道。
 *
 * 要点：
 *   - 并发发，任何一条成功就算「送达过」，不会因为一个通道挂了就整个失败
 *   - 失败按指数退避重试（默认 2 次）
 *   - 全部失败才记一条错误日志；绝不抛异常影响会话
 *   - 网络请求带超时，避免挂死
 */

import { getChannel, normalizeConfig, defaultCheck } from './channels/index.js';

/**
 * @param {object} msg  { title, body, url? }
 * @param {Array} channelConfigs  [{ id, enabled, config }]
 * @param {object} opts
 * @param {typeof fetch} [opts.fetch]  可注入，测试用
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.retries]
 * @param {(e:object)=>void} [opts.log]
 * @returns {Promise<{ok:boolean, results:Array}>}
 */
export async function deliver(msg, channelConfigs, opts = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    timeoutMs = 10_000,
    retries = 2,
    log = () => {},
    imSend = null,
    // 退避基数可注入：生产用默认 500ms，测试可以传 1 让用例秒过。
    // 注意这是「基数」，实际等待是指数增长，不改变生产行为。
    backoffMs = 500,
  } = opts;

  // IM 通道走宿主共享服务，不走 HTTP，所以单独分流
  const wanted = (channelConfigs ?? []).filter((c) => c.enabled);
  const targets = wanted.filter((c) => getChannel(c.id));
  const imTargets = imSend ? wanted.filter((c) => c.id === 'im') : [];

  if (targets.length === 0 && imTargets.length === 0) {
    log({ event: 'no-channel', message: '没有启用任何推送通道' });
    return { ok: false, results: [] };
  }

  const results = await Promise.all([
    ...targets.map((target) =>
      sendOne(msg, target, { fetchImpl, timeoutMs, retries, log, backoffMs }),
    ),
    ...imTargets.map((target) => sendViaIm(msg, target, { imSend, log })),
  ]);

  const ok = results.some((r) => r.ok);
  return { ok, results };
}

/** IM 通道：直接调宿主共享服务，失败也只记日志。 */
async function sendViaIm(msg, target, { imSend, log }) {
  try {
    const res = await imSend(target.config ?? {}, msg);
    if (res?.ok) {
      log({ event: 'sent', channel: 'im', detail: 'ok' });
      return { channel: 'im', ok: true, attempts: 1 };
    }
    log({ event: 'send-failed', channel: 'im', detail: res?.detail ?? '' });
    return { channel: 'im', ok: false, attempts: 1, error: res?.detail ?? '投递失败' };
  } catch (error) {
    const detail = String(error?.message ?? error);
    log({ event: 'send-error', channel: 'im', detail });
    return { channel: 'im', ok: false, attempts: 1, error: detail };
  }
}

async function sendOne(msg, target, { fetchImpl, timeoutMs, retries, log, backoffMs = 500 }) {
  const channel = getChannel(target.id);
  const cfg = normalizeConfig(channel, target.config ?? {});

  let attempt = 0;
  let lastError = '';

  while (attempt <= retries) {
    if (attempt > 0) {
      // 指数退避：500ms, 1000ms, 2000ms…（上限 4s）
      const wait = Math.min(backoffMs * 2 ** (attempt - 1), Math.max(backoffMs, 4000));
      await sleep(wait);
    }
    attempt += 1;

    try {
      // 有些通道（企业微信 / QQ）需要先换 token
      const prepared = channel.prepare ? await channel.prepare(cfg, fetchImpl, { timeoutMs }) : undefined;
      const req = channel.build(msg, cfg, prepared);

      const res = await fetchWithTimeout(fetchImpl, req, timeoutMs);
      const json = await safeJson(res);
      const check = (channel.check ?? defaultCheck)(res, json, cfg);

      if (check.ok) {
        log({ event: 'sent', channel: channel.id, attempt, detail: check.detail });
        return { channel: channel.id, ok: true, attempts: attempt };
      }

      lastError = check.detail;
      log({ event: 'send-failed', channel: channel.id, attempt, detail: check.detail });
    } catch (error) {
      lastError = String(error?.message ?? error);
      log({ event: 'send-error', channel: channel.id, attempt, detail: lastError });
    }
  }

  return { channel: channel.id, ok: false, attempts: attempt, error: lastError };
}

async function fetchWithTimeout(fetchImpl, req, timeoutMs) {
  const controller = new AbortController();
  // 同理不 unref：这个定时器在 finally 里会被清掉，不会泄漏；
  // 而 unref 会让「正在等待超时」这段时间被 Node 当成空闲。
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(req.url, {
      method: req.method ?? 'POST',
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function safeJson(res) {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * 等待一段时间。
 *
 * 注意：这里**不能** unref 定时器。
 * unref 会让 Node 认为「没有待处理的工作」，从而在重试还在进行时
 * 提前结束事件循环 —— 表现就是测试里出现
 * "Promise resolution is still pending but the event loop has already resolved"，
 * 生产环境里则是重试途中进程直接退出。
 *
 * 这个坑在 Windows 上不显形、在 Linux/macOS 上必现，靠跨平台 CI 才抓得到。
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 去重：同一个会话的同一个事件不要重复发。
 * 用「会话 + 回合 + 类型」做键，内存里保留最近 N 条。
 */
export class Deduper {
  constructor(max = 200) {
    this.max = max;
    this.seen = new Set();
    this.order = [];
  }

  /** 首次见到返回 true，重复返回 false。 */
  firstTime(key) {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.order.push(key);
    while (this.order.length > this.max) {
      const old = this.order.shift();
      this.seen.delete(old);
    }
    return true;
  }

  clear() {
    this.seen.clear();
    this.order = [];
  }
}
