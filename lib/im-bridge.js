/**
 * IM 桥接层 —— 可选复用 @xmanrui/dsh-im。
 *
 * 为什么要单独做一层：
 *   - 用户可能已经配好微信 / 飞书 / Telegram 机器人，再让他配一遍 ntfy 很蠢
 *   - dsh-im 暴露了同 Host 共享服务 `dshIm`，直接调就行
 *
 * ⚠️ 关键约束（这个坑踩过，别再踩）：
 *
 * Cordis 里「兄弟插件直接读 ctx.dshIm」是**不行**的：
 *
 *     ctx.dshIm                       // ❌ throws: cannot get property "dshIm" without inject
 *     ctx.inject(['dshIm'], scoped => {
 *       scoped.dshIm                  // ✅ 只有这条路能拿到
 *     })
 *
 * 之前用 try/catch 包住直接访问，异常被吞掉 → 永远认为「没装 dsh-im」，
 * 于是用户明明装好了，界面还一直让他去装，点了「发送测试」也必然失败。
 *
 * 所以这里的函数**不接收 ctx**，只接收「已经解析好的服务」或「取服务的函数」。
 * 服务由调用方（lib/index.js）通过运行时 inject 捕获后传进来。
 *
 * 参考：@xmanrui/dsh-im 的 PROACTIVE_DELIVERY.md（v5.7.0）。
 */

/** dsh-im 服务的最小接口约定。 */
const REQUIRED_METHODS = ['send'];

/**
 * 判断传入的对象是不是可用的 dshIm 服务。
 *
 * @param {unknown} service
 * @returns {boolean}
 */
export function isImService(service) {
  if (!service || typeof service !== 'object') return false;
  return REQUIRED_METHODS.every((m) => typeof service[m] === 'function');
}

/** 把「服务或取服务的函数」统一解成服务对象；拿不到返回 null。 */
function resolve(source) {
  try {
    const svc = typeof source === 'function' ? source() : source;
    return isImService(svc) ? svc : null;
  } catch {
    return null;
  }
}

/** 宿主是否提供了可用的 dshIm 服务。 */
export function hasIm(source) {
  return resolve(source) !== null;
}

/**
 * 列出可用的机器人。返回 [{ botId, channel }]。
 *
 * dsh-im 的 listBots() 返回的就是这个形状（已从其打包产物核实）：
 *     for (const e of await adapter.listBots()) out.push({ botId, channel })
 */
export async function listBots(source) {
  const svc = resolve(source);
  if (!svc || typeof svc.listBots !== 'function') return [];
  try {
    const bots = await svc.listBots();
    if (!Array.isArray(bots)) return [];
    // 容错：万一某版本返回字符串数组，也归一化成对象
    return bots
      .map((b) => {
        if (typeof b === 'string') return { botId: b, channel: '' };
        if (!b || typeof b !== 'object') return null;
        const botId = String(b.botId ?? b.id ?? '').trim();
        if (!botId) return null;
        return { ...b, botId };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 列出某个机器人已保存的目标。
 * 返回 [{ targetId, name?, kind, route? }]，kind 是 'user' | 'group'。
 */
export async function listTargets(source, botId) {
  const svc = resolve(source);
  const id = String(botId ?? '').trim();
  if (!svc || !id || typeof svc.listTargets !== 'function') return [];
  try {
    const raw = await svc.listTargets(id);
    // 服务层已 unwrap 成数组；若拿到 { targets: [...] } 也兼容
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.targets) ? raw.targets : [];
    return list
      .map((t) => {
        if (!t || typeof t !== 'object') return null;
        const targetId = String(t.targetId ?? '').trim();
        if (!targetId) return null;
        return { ...t, targetId };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 发一条消息。返回 { ok, detail }，不抛异常。
 *
 * dsh-im 的 send 签名（已核实）：
 *     async send(botId, targetId, text, { signal, format })
 * 成功返回 { sent: true }。
 *
 * @param {unknown} source 服务对象，或 () => 服务
 * @param {{ botId: string, targetId: string }} cfg
 * @param {{ title: string, body: string, url?: string }} msg
 */
export async function send(source, cfg, msg) {
  const svc = resolve(source);
  const botId = String(cfg?.botId ?? '').trim();
  const targetId = String(cfg?.targetId ?? '').trim();

  if (!svc) return { ok: false, detail: '没检测到 dsh-im 服务（确认装好了，并重启过 DSH）' };
  if (!botId) return { ok: false, detail: '没选机器人' };
  if (!targetId) return { ok: false, detail: '没选目标' };

  const text = msg.url
    ? `${msg.title}\n\n${msg.body}\n\n[打开会话](${msg.url})`
    : `${msg.title}\n\n${msg.body}`;

  try {
    // 用 plain：微信 / QQ / 短信类渠道不一定认 markdown，
    // 纯文本在各平台都能原样显示，最不容易出问题。
    const result = await svc.send(botId, targetId, text, { format: 'plain' });
    if (result?.sent === true) return { ok: true, detail: 'ok' };
    return { ok: false, detail: String(result?.reason ?? result?.code ?? '投递未成功') };
  } catch (error) {
    const code = String(error?.code ?? '').trim();
    const message = String(error?.message ?? error);
    return { ok: false, detail: code ? `${code}: ${message}` : message };
  }
}
