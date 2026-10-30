/**
 * 设置层 —— 默认值、持久化、schema。
 *
 * 设置分两部分：
 *   1. 全局策略（什么时候提醒、延迟多久、免打扰时段）
 *   2. 通道列表（启用了哪几个、各自的凭据）
 *
 * 存成 JSON 文件，放在 DSH 的 home 下，权限 0600（里面有密钥）。
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';

/** 全部默认值。改这里等于改新用户的初始体验。 */
export function defaultSettings() {
  return {
    enabled: true,

    // ── 触发：哪些事值得吵醒你 ──
    triggers: {
      completed: true, // 任务完成
      error: true, // 出错 / 输出超限
      approval: true, // 等你审批
      question: true, // 等你回答
      blocked: true, // 任务受阻
      goal: true, // 目标完成/受阻
    },

    // ── 什么时候提醒 ──
    delaySeconds: 20, // 延迟 N 秒再发；这期间你回来操作了就取消
    minTurnDurationSeconds: 30, // 跑得比这快的不提醒
    quietHours: '', // 例如 "23:00-08:00"，留空表示不设
    quietMode: 'digest', // 免打扰时段怎么办：digest 攒着 / drop 丢弃 / send 照发

    // ── 汇总 ──
    digestEnabled: false, // 开启后所有提醒攒成一条
    digestMinutes: 30, // 汇总窗口

    // ── 内容 ──
    includeExcerpt: true, // 带上 AI 最后一段回复
    excerptMaxChars: 160,
    includeCwd: false, // 带上工作目录（可能含项目名，介意就关）
    includeSubagents: false, // 子代理会话也提醒
    openOnClick: true, // 通知里带一个跳回会话的链接
    includeCost: false, // 装了 dsh-cost-meter 时带上本轮花费

    // ── 外观 ──
    theme: 'auto', // auto 跟随宿主换肤 / claude / deepseek

    // ── 投递 ──
    timeoutMs: 10_000,
    retries: 2,
    log: true,

    // ── 通道：默认全空，等用户配 ──
    channels: [],
  };
}

/** 从文件读设置；文件不存在或损坏都返回空对象（走默认值）。 */
export function loadSettings(path) {
  try {
    const text = readFileSync(path, 'utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 生成一个随机 ntfy 主题名。
 *
 * 权衡（改过一次，记下来免得又纠结）：
 *   - 4 位十六进制 = 65536 种。ntfy.sh 上同一天活跃的 DSH 用户远小于这个量级，
 *     碰撞概率极低；即使真撞上，别人也只能看到通知内容，改个名即可。
 *   - 为什么不用 8 位：手机上要手打 `dsh-35e5c3f3` 是 12 个字符，
 *     4 位是 8 个字符 —— 少一半，打字痛苦显著下降。
 *   - 前缀固定 `dsh-`，一眼能认出是自己配的。
 */
export function randomTopic() {
  return `dsh-${randomBytes(2).toString('hex')}`;
}

/** ntfy 订阅地址（手机上打开这个链接就能订阅，不用手打主题名）。 */
export function ntfySubscribeUrl(server, topic) {
  const base = String(server || 'https://ntfy.sh').replace(/\/+$/, '');
  const t = String(topic || '').trim();
  if (!t) return '';
  return `${base}/${encodeURIComponent(t)}`;
}

/**
 * 首次运行时把「零输入」该有的东西补上。
 *
 * 现在只做一件事：给 ntfy 预生成一个主题名。
 * 这样用户打开设置页看到的是一条可复制的订阅地址，而不是一个空输入框。
 *
 * @param {object} settings 已合并的当前设置
 * @returns {{ settings: object, changed: boolean }}
 */
export function ensureQuickStart(settings) {
  const next = { ...settings, channels: Array.isArray(settings.channels) ? settings.channels.slice() : [] };
  let changed = false;

  const ntfy = next.channels.find((c) => c && c.id === 'ntfy');
  if (!ntfy) {
    next.channels.push({
      id: 'ntfy',
      enabled: false, // 先不启用，等用户真的订阅了再开
      config: { server: 'https://ntfy.sh', topic: randomTopic(), priority: 'default' },
    });
    changed = true;
  } else if (!ntfy.config || !String(ntfy.config.topic || '').trim()) {
    ntfy.config = { ...(ntfy.config ?? {}), topic: randomTopic() };
    changed = true;
  }

  return { settings: next, changed };
}

/**
 * 找出「当前真正能收消息」的通道。
 * 一个通道算已配置，要求 enabled 且必填字段都有值。
 *
 * `im` 是特殊通道：不在 HTTP 通道注册表里，判据是「选了机器人和目标」，
 * 且调用方要确认宿主确实装了 dsh-im（imAvailable）。
 *
 * @param {object} settings
 * @param {(id:string)=>object|undefined} getChannel 通道定义查询
 * @param {{ imAvailable?: boolean }} [opts]
 * @returns {string[]} 已配置的通道 id
 */
export function configuredChannels(settings, getChannel, opts = {}) {
  const out = [];
  for (const entry of settings.channels ?? []) {
    if (!entry || entry.enabled === false) continue;

    if (entry.id === 'im') {
      if (!opts.imAvailable) continue;
      const cfg = entry.config ?? {};
      if (String(cfg.botId ?? '').trim() && String(cfg.targetId ?? '').trim()) out.push('im');
      continue;
    }

    const def = getChannel(entry.id);
    if (!def) continue;
    const cfg = entry.config ?? {};
    const missing = (def.fields ?? []).some((f) => f.required && !String(cfg[f.key] ?? '').trim());
    if (!missing) out.push(entry.id);
  }
  return out;
}

/** 原子写：先写临时文件再 rename，避免写一半崩了留下坏文件。 */
export function saveSettings(path, value) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, path);
    try {
      chmodSync(path, 0o600);
    } catch {
      /* Windows 上 chmod 基本无效，忽略 */
    }
    return true;
  } catch {
    return false;
  }
}
