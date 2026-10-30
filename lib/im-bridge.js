/**
 * IM 通道（可选）—— 复用用户已经装好的 @xmanrui/dsh-im。
 *
 * 为什么要单独做一层：
 *   - 用户可能已经配好微信 / 飞书 / Telegram 机器人，再让他配一遍 ntfy 很蠢
 *   - dsh-im 暴露了同 Host 共享服务 `ctx.dshIm`，直接调就行，不用碰它的内部实现
 *
 * 设计原则：**完全可选**。
 *   - 没装 dsh-im 时这个通道根本不出现在设置页
 *   - dsh-im 报错不影响其它通道，只记一条日志
 *
 * 参考：@xmanrui/dsh-im 的 PROACTIVE_DELIVERY.md「在同一 Host 的插件中发送」。
 */

/**
 * 安全读 ctx 上的 dshIm 服务。
 *
 * Cordis 的 ctx 是 Proxy：访问没 inject 的服务会抛异常。
 * 所以「检测有没有装」这件事本身也必须包起来。
 */
function getIm(ctx) {
  try {
    return ctx?.dshIm;
  } catch {
    return undefined;
  }
}

/** 检测宿主是否提供了 dshIm 服务。 */
export function hasDshIm(ctx) {
  const svc = getIm(ctx);
  return Boolean(svc && typeof svc.send === 'function');
}

/**
 * 列出可用的机器人。返回 [{ botId, channel }]。
 * 失败时返回空数组——调用方据此隐藏界面，而不是报错。
 */
export async function listBots(ctx) {
  try {
    const svc = getIm(ctx);
    if (!svc || typeof svc.listBots !== 'function') return [];
    const bots = await svc.listBots();
    return Array.isArray(bots) ? bots : [];
  } catch {
    return [];
  }
}

/**
 * 列出某个机器人已保存的投递目标。返回 [{ targetId, name, kind }]。
 * 失败时返回空数组。
 */
export async function listTargets(ctx, botId) {
  try {
    const svc = getIm(ctx);
    if (!svc || !botId || typeof svc.listTargets !== 'function') return [];
    const targets = await svc.listTargets(botId);
    return Array.isArray(targets) ? targets : [];
  } catch {
    return [];
  }
}

/**
 * 发一条消息。返回 { ok, detail }，不抛异常。
 *
 * @param {object} ctx
 * @param {{ botId: string, targetId: string }} cfg
 * @param {{ title: string, body: string }} msg
 */
export async function send(ctx, cfg, msg) {
  const botId = String(cfg?.botId ?? '').trim();
  const targetId = String(cfg?.targetId ?? '').trim();

  const svc = getIm(ctx);
  if (!svc || typeof svc.send !== 'function') return { ok: false, detail: '没装 IM 插件（@xmanrui/dsh-im）' };
  if (!botId) return { ok: false, detail: '没选机器人' };
  if (!targetId) return { ok: false, detail: '没选投递目标' };

  // dsh-im 只支持纯文本和 markdown，这里用纯文本最稳（标题当第一行）
  const text = `${msg.title}\n${msg.body}`;

  try {
    const result = await svc.send(botId, targetId, text, { format: 'plain' });
    if (result?.sent === true) return { ok: true, detail: 'ok' };
    return { ok: false, detail: String(result?.reason ?? result?.code ?? '投递未成功') };
  } catch (error) {
    return { ok: false, detail: String(error?.message ?? error) };
  }
}
