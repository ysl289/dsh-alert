/**
 * 联动层 —— 和用户已经装了的插件配合，而不是各干各的。
 *
 * 设计原则：
 *   1. **全部可选**：没装对应插件时这一条自动不生效，不报错、不提示
 *   2. **只读优先**：尽量只读别人的状态，不改别人的配置
 *   3. **失败静默**：联动出问题只写日志，绝不影响主流程
 *
 * 目前支持：
 *   - dsh-cost-meter：把本轮花了多少钱带进提醒（"任务完成，花了 ¥0.32"）
 *   - dsh-notify-windows：检测到它也在推桌面通知时，避免同一条消息响两次
 *   - dsh-claude-style：跟随它的皮肤，用 Claude 色卡
 *   - dsh-pocket：手机访问地址。它把 DSH 的 web 暴露到局域网/公网，
 *     有了它通知里的回链才是手机点得开的地址，而不是 127.0.0.1
 *   - @xmanrui/dsh-im：见 im-bridge.js
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, networkInterfaces } from 'node:os';

/**
 * 安全读 ctx 上的服务。
 *
 * Cordis 的 ctx 是个 Proxy：访问**没 inject 的服务会抛异常**，不是返回 undefined。
 * 所以每一处都要包起来，否则整个插件激活就炸了。
 */
function safeGet(ctx, key) {
  try {
    return ctx?.[key];
  } catch {
    return undefined;
  }
}

// ── dsh-cost-meter ──

/**
 * 读一次成本状态。返回 null 表示没装或读不到。
 *
 * 只取需要的字段，不把整个 ledger 结构耦合进来。
 */
export async function readCost(ctx) {
  try {
    const svc = safeGet(ctx, 'costMeter');
    if (!svc || typeof svc.getState !== 'function') return null;

    const state = await svc.getState();
    if (!state || typeof state !== 'object') return null;

    // 不同版本的字段可能不同，宽容地找
    const today = state.today ?? state.current ?? null;
    const amount =
      today?.cost ??
      today?.totalCost ??
      today?.apiCost ??
      state.todayCost ??
      null;

    if (typeof amount !== 'number') return null;

    return {
      amount,
      currency: state.currency ?? today?.currency ?? 'CNY',
      // 有余额就顺带带上
      balance: typeof state.balance?.remaining === 'number' ? state.balance.remaining : undefined,
    };
  } catch {
    return null;
  }
}

/** 把成本格式化成一句话，供提醒正文追加。 */
export function formatCost(cost) {
  if (!cost) return '';
  const symbol = cost.currency === 'CNY' ? '¥' : cost.currency === 'USD' ? '$' : '';
  const value = cost.amount < 0.01 ? '<0.01' : cost.amount.toFixed(2);
  return `本轮花费 ${symbol}${value}`;
}

// ── dsh-notify-windows ──

/**
 * 宿主是否装了桌面通知插件。
 *
 * 装了的话，用户其实已经在电脑前收到 toast 了；我们的手机提醒可以
 * 在「延迟提醒」之外再加一层判断：人明显在电脑前就别推手机。
 * 这里只做检测，具体策略在 index.js 里用。
 */
export function hasDesktopNotify(ctx) {
  try {
    // 它没有提供共享服务，只能看 loader 里有没有这个 entry
    const entries = ctx?.loader?.entries?.();
    if (Array.isArray(entries)) {
      return entries.some((e) => {
        const name = e?.options?.name ?? '';
        return name === 'dsh-notify-windows' || name === 'dsh-notify';
      });
    }
  } catch {
    /* 读不到就算了 */
  }
  return false;
}

// ── dsh-claude-style ──

/**
 * 宿主是否装了 Claude 换肤插件。
 *
 * 装了就用 Claude 色卡 —— 用户已经选了那个审美，我们的面板不该是唯一的异类。
 */
export function hasClaudeStyle(ctx) {
  try {
    const entries = ctx?.loader?.entries?.();
    if (Array.isArray(entries)) {
      return entries.some((e) => {
        const name = e?.options?.name ?? '';
        return name === 'dsh-claude-style' || name === 'ui-skin-claude-style';
      });
    }
  } catch {
    /* 读不到就算了 */
  }
  return false;
}

// ── dsh-pocket ──

/**
 * 宿主是否装了 dsh-pocket（把 DSH 暴露到局域网/公网的插件）。
 *
 * 它没有导出共享服务，只能看 loader 里的 entry 名。
 */
export function hasPocket(ctx) {
  try {
    const entries = ctx?.loader?.entries?.();
    if (Array.isArray(entries)) {
      return entries.some((e) => {
        const name = e?.options?.name ?? '';
        return name === 'dsh-pocket';
      });
    }
  } catch {
    /* 读不到就算了 */
  }
  return false;
}

/** dsh-pocket 的设置文件路径（它自己的目录，不归我们管，只读）。 */
function pocketSettingsPath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(home, 'dsh-pocket', 'settings.json');
}

/**
 * 读 dsh-pocket 的局域网开关与端口。只读，不改别人的配置。
 *
 * 注意它的默认值是「开」：文件里没有 lanEnabled 字段就是开着，
 * 只有显式 false 才算关。这个语义跟它自己的实现保持一致。
 */
export function readPocketConfig() {
  const path = pocketSettingsPath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;

    const port = Number(raw.proxyPort);
    return {
      lanEnabled: raw.lanEnabled !== false,
      lanAuthEnabled: raw.lanAuthEnabled !== false,
      proxyPort: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 3081,
      lanIpOverride: typeof raw.lanIpOverride === 'string' && raw.lanIpOverride ? raw.lanIpOverride : null,
    };
  } catch {
    return null;
  }
}

/**
 * 找本机局域网 IPv4。
 *
 * 优先用用户自己在 dsh-pocket 里指定的地址（他指定说明自动选的不好用），
 * 否则挑第一个非内部 IPv4。
 */
function lanIp(override) {
  if (override) return override;
  try {
    const nets = networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const net of list ?? []) {
        if (net.family === 'IPv4' && !net.internal) return net.address;
      }
    }
  } catch {
    /* 读不到网卡就算了 */
  }
  return null;
}

/**
 * 算出手机能打开的 DSH 地址。返回 null 表示算不出来（没装 / 关了 / 没网卡）。
 *
 * 为什么这件事重要：通知里的回链默认是 `http://127.0.0.1:<port>`，
 * 那在手机上是手机自己，点了必然打不开。装了 dsh-pocket 就能换成局域网地址。
 */
export function pocketBaseUrl() {
  const cfg = readPocketConfig();
  if (!cfg || !cfg.lanEnabled) return null;
  const ip = lanIp(cfg.lanIpOverride);
  if (!ip) return null;
  return `http://${ip}:${cfg.proxyPort}`;
}

// ── 汇总 ──

/**
 * 探测所有可联动项，返回一份快照给设置页显示。
 *
 * 设置页会用它来决定显示哪些"联动已启用"的徽标。
 */
export function detectIntegrations(ctx) {
  const pocketInstalled = hasPocket(ctx);
  const pocketUrl = pocketInstalled ? pocketBaseUrl() : null;
  return {
    costMeter: Boolean(safeGet(ctx, 'costMeter')),
    desktopNotify: hasDesktopNotify(ctx),
    claudeStyle: hasClaudeStyle(ctx),
    pocket: pocketInstalled,
    pocketUrl,
    im: Boolean(safeGet(ctx, 'dshIm')),
  };
}
