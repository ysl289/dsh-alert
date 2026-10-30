/**
 * dsh-alert —— 手机提醒插件。
 *
 * 干什么：AI 干活时人不在电脑前，把「跑完了 / 出错了 / 等你审批」推到手机。
 * 怎么干：订阅会话事件 → 策略判断 → 渲染文案 → 分发到各通道。
 *
 * 设计约束（都是刻意的）：
 *   - 纯提醒：手机上看不到操作按钮，点了也只是跳回电脑上的会话
 *   - 不依赖其它插件：只用 DSH 宿主自己的事件与设置接口
 *   - 绝不干扰会话：发送失败只写日志，任何异常都被吞掉
 */

import { homedir } from 'node:os';
import { classifyEvent, isAskUserQuestion, parseQuietHours, route, DeferredQueue, DigestQueue } from './policy.js';
import { render, renderDigest, extractContext } from './render.js';
import { deliver, Deduper } from './deliver.js';
import { CHANNELS, getChannel } from './channels/index.js';
import { loadSettings, saveSettings, defaultSettings, ensureQuickStart, configuredChannels } from './settings.js';
import { installRpc, createDispatcher, RPC_CHANNEL } from './rpc.js';
import { hasDshIm, send as imSend, listBots, listTargets } from './im-bridge.js';
import { readCost, formatCost, detectIntegrations, pocketBaseUrl } from './integrations.js';
import { resolveTheme } from './theme.js';

export const name = 'dsh-alert';

/**
 * 刻意 **不导出 Config**。
 *
 * 宿主用 resolveConfig() 做校验：
 *   if (!runtime.Config) return config;
 *   runtime.Config['~standard'].validate(config)
 * 也就是说 Config 必须是真正的 Standard Schema（schemastery / zod 实例）。
 * 导出一个普通对象会让上面这行抛 TypeError，插件在激活阶段就失败，
 * 然后被插件管理器写成 `disabled: true` —— 用户看到的现象是"设置页读不到路由"。
 *
 * 本插件的配置由自带的设置面板维护（存在 ~/.dsh/dsh-alert/settings.json），
 * 不依赖宿主配置表单，所以这里不声明 schema。
 */

/**
 * 静态不声明强依赖：保证插件在任何 profile（含 headless）都能加载、都能推送。
 * 设置页需要的 webServer 用运行时 ctx.inject 挂载，宿主没提供就只少一个设置页。
 */
export const inject = [];

/** 再把 RPC 通道名导出去，方便测试和外部引用。 */
export { RPC_CHANNEL };

/**
 * 插件入口。
 *
 * 配置来源有两个，优先级从高到低：
 *   1. cordis.patch.yml 里的 config（启动时定，改完要重启）
 *   2. 插件自己维护的 settings 文件（设置页改，即时生效）
 */
export function apply(ctx, config = {}) {
  const log = (entry) => {
    if (!settings.enabled && entry.event !== 'init') return;
    if (!settings.log) return;
    try {
      ctx?.logger?.info?.('[dsh-alert]', JSON.stringify({ time: Date.now(), ...entry }));
    } catch {
      /* 日志失败不能影响主流程 */
    }
  };

  // ── 设置：文件优先，没有就用 patch 里的 config，再没有就用默认值 ──
  let settings = { ...defaultSettings(), ...readSettingsFile(ctx), ...stripUndefined(config) };

  // 首次运行补上「零输入」该有的东西：预生成 ntfy 主题，让用户不用自己想名字。
  {
    const quick = ensureQuickStart(settings);
    if (quick.changed) {
      settings = quick.settings;
      saveSettingsFile(ctx, settings);
    }
  }

  const quiet = () => parseQuietHours(settings.quietHours);
  const deduper = new Deduper();

  // ── 联动探测：装了哪些可配合的插件（一次性，不轮询）──
  const integrations = detectIntegrations(ctx);

  /**
   * 当前手机能打开的 DSH 地址。
   *
   * 不能缓存启动时的快照：用户可能在我们加载之后才去 pocket 里打开局域网开关，
   * 那时候地址才出现。读一个本地 json 很便宜，只在真要发提醒时才读。
   */
  const mobileBase = () => (integrations.pocket ? pocketBaseUrl() : null);

  // ── 延迟队列：到点前用户回来操作就取消 ──
  let deferred = makeDeferred(settings);

  // ── 汇总队列 ──
  let digest = makeDigest(settings);

  function makeDeferred(current) {
    return new DeferredQueue({
      delayMs: current.delaySeconds > 0 ? current.delaySeconds * 1000 : 0,
      onFire: (item) => {
        void sendNow(item);
      },
    });
  }

  function makeDigest(current) {
    return new DigestQueue({
      windowMs: Math.max(1, current.digestMinutes) * 60_000,
      onFlush: (items) => {
        const merged = renderDigest(items);
        if (merged) void sendNow({ message: merged, kind: 'digest' });
      },
    });
  }

  /** 真正发出去（已经过了所有闸门）。 */
  async function sendNow(item) {
    if (!settings.enabled) return;
    try {
      const targets = resolveChannels(settings);
      if (targets.length === 0) {
        log({ event: 'no-target', message: '没有可用的通道配置' });
        return;
      }
      const res = await deliver(item.message, targets, {
        timeoutMs: settings.timeoutMs,
        retries: settings.retries,
        log,
        // IM 通道：宿主装了 dsh-im 才有；没有就传 null，发送层会忽略它
        imSend: hasDshIm(ctx) ? (cfg, msg) => imSend(ctx, cfg, msg) : null,
      });
      if (!res.ok) log({ event: 'all-failed', results: res.results });
    } catch (error) {
      // 发送层任何异常都不许冒到会话里
      log({ event: 'send-crash', message: String(error?.message ?? error) });
    }
  }

  /**
   * 把设置里的通道列表变成发送层要的形状。
   *
   * 注意 `im` 是个特殊通道：它不在 CHANNELS 注册表里（那是 HTTP 通道），
   * 只有当宿主提供 dshIm 服务时才有效。
   */
  function resolveChannels(current) {
    const list = Array.isArray(current.channels) ? current.channels : [];
    const imAvailable = hasDshIm(ctx);
    return list
      .filter((c) => {
        if (!c || c.enabled === false) return false;
        if (c.id === 'im') return imAvailable;
        return Boolean(getChannel(c.id));
      })
      .map((c) => ({ id: c.id, enabled: true, config: c.config ?? {} }));
  }

  /** 一条提醒进入调度。 */
  function enqueue({ key, message, kind, sessionTitle, url }) {
    const r = route({
      now: new Date(),
      quiet: quiet(),
      quietMode: settings.quietMode,
      digestEnabled: settings.digestEnabled,
      forced: false,
    });

    if (r.action === 'drop') {
      log({ event: 'dropped', why: r.why, kind });
      return;
    }

    if (r.action === 'digest') {
      digest.push({ message, kind, title: sessionTitle, url });
      log({ event: 'digested', why: r.why, kind });
      return;
    }

    // 免打扰时段照发，或正常时段：走延迟队列
    deferred.push(key, { message, kind });
  }

  // ── 会话事件订阅 ──
  const onSessionEvent = (session, event) => {
    try {
      if (!settings.enabled) return;
      if (!event) return;

      // 子代理默认不提醒（否则一个团队任务会响几十次）
      if (!settings.includeSubagents && isSubagentSession(session)) return;

      // 用户动了 → 取消这个会话所有待发提醒
      if (isUserActivity(event)) {
        const cancelled = deferred.cancelByPrefix(`${session?.id ?? ''}\u0000`);
        if (cancelled > 0) log({ event: 'cancelled-by-user', sessionId: session?.id, count: cancelled });
        return;
      }

      // 审批：有人批了就把这条待发提醒撤掉
      if (event.type === 'approval/decided') {
        deferred.cancel(`${session?.id ?? ''}\u0000approval`);
        return;
      }

      const hit = classifyEvent(event, settings.triggers);
      if (!hit.notify) return;

      const sessionId = session?.id ?? 'unknown';
      const turn = event.data?.turn;
      const dedupeKey = `${sessionId}\u0000${hit.kind}\u0000${turn ?? event.data?.id ?? event.seq ?? ''}`;
      if (!deduper.firstTime(dedupeKey)) return;

      const events = readEvents(session);
      const context = extractContext(events, event.type === 'turn/end' ? event : undefined);

      // 短任务过滤：只有 turn/end 且知道耗时才筛
      if (
        hit.kind === 'completed' &&
        settings.minTurnDurationSeconds > 0 &&
        context.durationMs !== undefined &&
        context.durationMs < settings.minTurnDurationSeconds * 1000
      ) {
        log({ event: 'skipped-short', sessionId, durationMs: context.durationMs });
        return;
      }

      const message = render({
        kind: hit.kind,
        detail: hit.detail,
        title: context.title,
        excerpt: context.lastAssistantText,
        durationMs: context.durationMs,
        toolName: event.data?.toolName,
        reason: event.data?.reason,
        cwd: session?.header?.cwd,
        url: settings.openOnClick ? sessionUrl(session, mobileBase()) : undefined,
        excerptMaxChars: settings.excerptMaxChars,
        includeExcerpt: settings.includeExcerpt,
        includeCwd: settings.includeCwd,
      });

      // 联动：装了 dsh-cost-meter 就带上本轮花费（异步补，不阻塞推送）
      if (settings.includeCost && integrations.costMeter) {
        void readCost(ctx)
          .then((cost) => {
            const line = formatCost(cost);
            if (!line) return;
            enqueue({
              key: `${sessionId}\u0000${hit.kind}`,
              message: { ...message, body: `${message.body}\n${line}` },
              kind: hit.kind,
              sessionTitle: context.title,
              url: message.url,
            });
          })
          .catch(() => {
            /* 读不到成本就按原样发 */
          });
        return;
      }

      enqueue({
        key: `${sessionId}\u0000${hit.kind}`,
        message,
        kind: hit.kind,
        sessionTitle: context.title,
        url: message.url,
      });
    } catch (error) {
      log({ event: 'handler-crash', message: String(error?.message ?? error) });
    }
  };

  // 提问：走 tool/call，单独挂
  const onToolCall = (session, event) => {
    try {
      if (!settings.enabled || !settings.triggers.question) return;
      if (!isAskUserQuestion(event)) return;
      if (!settings.includeSubagents && isSubagentSession(session)) return;

      const sessionId = session?.id ?? 'unknown';
      const key = `${sessionId}\u0000question\u0000${event.data?.callId ?? event.seq ?? ''}`;
      if (!deduper.firstTime(key)) return;

      const parsed = safeParseQuestion(event.data?.arguments);
      const events = readEvents(session);
      const context = extractContext(events);

      const message = render({
        kind: 'question',
        title: context.title,
        question: parsed.question,
        choices: parsed.choices,
        url: settings.openOnClick ? sessionUrl(session, mobileBase()) : undefined,
        includeExcerpt: false,
      });

      enqueue({ key: `${sessionId}\u0000question`, message, kind: 'question', sessionTitle: context.title });
    } catch (error) {
      log({ event: 'question-crash', message: String(error?.message ?? error) });
    }
  };

  ctx.on('session/event', onSessionEvent);
  ctx.on('session/event', onToolCall);

  // 设置变更时热更新（设置页保存后调用）
  const api = {
    /** 读当前设置（设置页用）。 */
    getSettings: () => ({ ...settings, channels: settings.channels?.map((c) => ({ ...c, config: { ...c.config } })) }),
    /** 保存设置并热应用。 */
    saveSettings: (next) => {
      settings = { ...settings, ...stripUndefined(next) };
      saveSettingsFile(ctx, settings);
      // 重建队列以应用新的延迟/汇总参数
      deferred.clear();
      digest.flush();
      deferred = makeDeferred(settings);
      digest = makeDigest(settings);
      log({ event: 'settings-saved' });
      return api.getSettings();
    },
    /** 可用通道目录（设置页渲染用）。 */
    listChannels: () => CHANNELS.map(({ id, label, hint, fields }) => ({ id, label, hint, fields })),
    /** 已经配好、真的能收消息的通道 id 列表。 */
    readyChannels: () => configuredChannels(settings, getChannel, { imAvailable: hasDshIm(ctx) }),
    /**
     * IM 渠道的可用性。
     *
     * 关键：**不管装没装 dsh-im 都要报告**，让没装的人知道有这条路。
     *   installed=false 时设置页会显示「装了就能用微信/飞书/Telegram 直接收」+ 装法。
     */
    imStatus: async () => {
      const installed = hasDshIm(ctx);
      if (!installed) return { installed: false, bots: [], targets: {} };

      const bots = await listBots(ctx);
      const targets = {};
      for (const bot of bots) {
        targets[bot.botId] = await listTargets(ctx, bot.botId);
      }
      return { installed: true, bots, targets };
    },
    /** 发一条测试提醒。可以只测某个通道。 */
    sendTest: async (onlyChannelId) => {
      const message = {
        title: '🔔 手机提醒 · 测试',
        body: '这条能收到，就说明通道配好了。\n之后 AI 跑完任务、出错、等你审批时，都会从这里通知你。',
      };
      let targets = resolveChannels(settings);
      if (onlyChannelId) targets = targets.filter((t) => t.id === onlyChannelId);
      const res = await deliver(message, targets, {
        timeoutMs: settings.timeoutMs,
        retries: 0,
        log,
        imSend: hasDshIm(ctx) ? (cfg, msg) => imSend(ctx, cfg, msg) : null,
      });
      return res;
    },
    /** 可联动插件的探测结果（设置页显示徽标用）。 */
    integrations: () => ({ ...integrations, pocketUrl: mobileBase() }),
    /** 面板主题：设置里指定的优先，否则跟随宿主换肤。 */
    theme: () => resolveTheme(settings.theme, integrations.claudeStyle),
  };

  // 暴露给宿主的设置页（老宿主没有 ctx.set，忽略）
  try {
    ctx.set?.('dshAlert', api);
  } catch {
    /* 忽略 */
  }

  // 设置页走 RPC：浏览器端 ctx.connection.rpc.call('/dsh-alert', endpoint, payload)
  //
  // 用运行时 ctx.inject 而不是静态 inject：
  //   - 静态声明会让插件在没这些服务的 profile 里根本不加载，连推送都没了
  //   - 运行时注入只在服务就绪时回调，插件本体不受影响
  // 同时注入 connection：设置页的信任栅栏要用它的 requestRejection（Host/Origin/cookie），
  // 只有 webServer 时只能退回最小 loopback 校验，用局域网 IP 打开就会被挡。
  let disposeRpc;
  let rpcInjectDisposer;
  try {
    rpcInjectDisposer = ctx.inject?.(['webServer', 'connection'], (scoped) => {
      disposeRpc = installRpc(scoped, createDispatcher(api, log), log);
      return () => {
        try {
          disposeRpc?.();
        } catch {
          /* 忽略 */
        }
        disposeRpc = undefined;
      };
    });
  } catch (error) {
    log({ event: 'rpc-inject-failed', message: String(error?.message ?? error) });
  }

  // 宿主完全不支持运行时注入时，退回直接尝试（服务在就挂，不在就安静降级）
  if (typeof ctx.inject !== 'function') {
    disposeRpc = installRpc(ctx, createDispatcher(api, log), log);
  }

  log({ event: 'init', channels: resolveChannels(settings).map((c) => c.id) });

  // 返回 dispose，宿主卸载插件时清理定时器
  return () => {
    deferred.clear();
    digest.flush();
    deduper.clear();
    try {
      disposeRpc?.();
    } catch {
      /* 忽略 */
    }
    try {
      rpcInjectDisposer?.();
    } catch {
      /* 忽略 */
    }
  };
}

// ── 小工具 ──

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function isSubagentSession(session) {
  return session?.header?.origin === 'subagent' || (session?.header?.delegationDepth ?? 0) > 0;
}

/** 用户有没有在动：发消息、批审批、答提问。 */
function isUserActivity(event) {
  const t = event?.type;
  return t === 'user/message' || t === 'approval/decided';
}

/** 读会话事件，兼容新旧宿主。 */
function readEvents(session) {
  try {
    if (typeof session?.snapshotEvents === 'function') return session.snapshotEvents() ?? [];
    if (Array.isArray(session?.events)) return session.events;
  } catch {
    /* 读不到就当空 */
  }
  return [];
}

/**
 * 点通知跳回的地址。
 *
 * 这里是全插件最容易踩空的一处：宿主给的 `session.host.webUrl` 是
 * `http://127.0.0.1:<port>` —— 那在手机上是**手机自己**，点了必然打不开。
 * 所以优先用 dsh-pocket 暴露出来的局域网地址，它才是手机上真能访问的入口。
 */
function sessionUrl(session, mobileBase) {
  const base =
    (typeof mobileBase === 'string' && mobileBase) ||
    session?.host?.webUrl;
  if (typeof base !== 'string' || !base) return undefined;
  return `${base.replace(/\/+$/, '')}/#/session/${encodeURIComponent(session.id ?? '')}`;
}

function safeParseQuestion(raw) {
  try {
    const parsed = JSON.parse(raw);
    const first = Array.isArray(parsed?.questions) ? parsed.questions[0] : undefined;
    return {
      question: typeof first?.question === 'string' ? first.question : undefined,
      choices: Array.isArray(first?.options)
        ? first.options.map((o) => (typeof o === 'string' ? o : o?.label)).filter(Boolean)
        : undefined,
    };
  } catch {
    return {};
  }
}

// ── 设置持久化 ──

function settingsPath(ctx) {
  try {
    const home = ctx?.dshHome ?? process.env.DSH_HOME;
    if (home) return `${home}/dsh-alert/settings.json`;
  } catch {
    /* 忽略 */
  }
  return `${homedir()}/.dsh/dsh-alert/settings.json`;
}

function readSettingsFile(ctx) {
  return loadSettings(settingsPath(ctx));
}

function saveSettingsFile(ctx, value) {
  saveSettings(settingsPath(ctx), value);
}
