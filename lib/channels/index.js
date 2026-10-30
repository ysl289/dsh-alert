/**
 * 通道注册表。
 *
 * 每个通道是一个纯对象：
 *   id      配置里的稳定标识（不要随便改，用户配置里存的就是它）
 *   label   设置页显示的名字
 *   hint    一句话说明怎么拿到凭据
 *   fields  设置页要渲染的输入项
 *   build() 把配置渲染成一次 HTTP 请求 { url, method?, headers?, body? }
 *   check() 判定响应是否成功（默认 2xx）
 *
 * 刻意不 import 任何 DSH 包：这一层可以在普通 Node 里跑测试。
 */

import { ntfy } from './ntfy.js';
import { bark } from './bark.js';
import { wecomApp } from './wecom-app.js';
import { qqbot } from './qqbot.js';
import { webhook } from './webhook.js';
import { serverchan } from './serverchan.js';
import { custom } from './custom.js';

/**
 * 全部通道，顺序即设置页顺序。
 *
 * 只保留**免费可用**的通道：
 *   - PushPlus 已移除：它的免费额度各渠道都是 0，必须付费
 *   - Server酱 保留但排在后面，并在设置页标注「免费版每天 5 条」
 */
export const CHANNELS = [ntfy, wecomApp, bark, qqbot, webhook, serverchan, custom];

const byId = new Map(CHANNELS.map((c) => [c.id, c]));

/** 按 id 取通道；未知 id 返回 undefined（配置里写了错名字时不崩，只报错）。 */
export function getChannel(id) {
  return byId.get(id);
}

/** 所有通道 id，用于配置校验和错误提示。 */
export function channelIds() {
  return CHANNELS.map((c) => c.id);
}

/**
 * 默认成功判定：HTTP 2xx 即成功。
 * 各通道可以覆盖（例如钉钉要额外看 errcode === 0）。
 */
export function defaultCheck(res) {
  return { ok: res.status >= 200 && res.status < 300, detail: `HTTP ${res.status}` };
}

/**
 * 把「字段定义」补齐默认值，得到一份可直接用于 build 的配置。
 * 设置页未填的项不会变成 undefined 传给通道。
 */
export function normalizeConfig(channel, raw) {
  const out = {};
  for (const f of channel.fields ?? []) {
    const value = raw?.[f.key];
    out[f.key] = value === undefined || value === null || value === '' ? f.default ?? '' : value;
  }
  // 允许通道自己兜一层（例如 webhook 的默认模板）
  return channel.normalize ? channel.normalize(out) : out;
}
