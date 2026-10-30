/**
 * 渲染层 —— 把会话事件变成手机上能一眼看懂的一段话。
 *
 * 设计原则：
 *   - 标题说「哪个会话 + 什么类型」，正文说「发生了什么 + 最后说了什么」
 *   - 默认带一段 AI 最后回复的摘要，但会截断，避免锁屏上刷屏
 *   - 一切来自会话的内容都当作不可信文本，只做展示，不执行
 */

const ICONS = {
  completed: '✅',
  error: '❌',
  approval: '✋',
  question: '❓',
  blocked: '⛔',
  goal: '🎯',
};

const LABELS = {
  completed: '任务完成',
  error: '任务出错',
  approval: '等你审批',
  question: '等你回答',
  blocked: '任务受阻',
  goal: '目标完成',
};

/** 从会话事件里抠出标题、最后一段回复、耗时。 */
export function extractContext(events, turnEndEvent) {
  let title;
  let lastAssistantText;
  let turnStartAt;
  const turn = turnEndEvent?.data?.turn;

  // 倒着扫，越靠后越新。
  // 注意：不能找到 turn/start 就 break —— 标题事件通常在它更前面。
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (!e) continue;

    if (title === undefined && e.type === 'session/title' && typeof e.data?.title === 'string') {
      title = e.data.title;
    }

    if (lastAssistantText === undefined && e.type === 'assistant/message') {
      const text = textOfMessage(e.data?.message);
      if (text) lastAssistantText = text;
    }

    // 倒扫时第一次命中的就是本回合最近的那个 turn/start
    if (turnStartAt === undefined && Number.isInteger(turn) && e.type === 'turn/start' && e.data?.turn === turn) {
      turnStartAt = e.timestamp ?? e.at ?? e.time;
    }
  }

  const endAt = turnEndEvent?.timestamp ?? turnEndEvent?.at ?? turnEndEvent?.time;
  const durationMs = Number.isFinite(turnStartAt) && Number.isFinite(endAt) ? Math.max(0, endAt - turnStartAt) : undefined;

  return { title, lastAssistantText, durationMs };
}

/** AssistantMessage → 纯文本。 */
export function textOfMessage(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const parts = [];
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.length ? parts.join('\n') : undefined;
}

export function truncate(text, max) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, Math.max(1, max - 1)) + '…';
}

/** 毫秒 → "2 分 13 秒" */
export function humanDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

/**
 * 渲染一条提醒。
 *
 * @param {object} opts
 * @param {string} opts.kind          completed / error / approval / question / blocked / goal
 * @param {string} [opts.detail]      细分原因
 * @param {string} [opts.title]       会话标题
 * @param {string} [opts.excerpt]     AI 最后一段回复
 * @param {number} [opts.durationMs]  本轮耗时
 * @param {string} [opts.toolName]    审批/提问相关的工具名
 * @param {string} [opts.reason]      审批原因
 * @param {string} [opts.question]    提问正文
 * @param {string[]} [opts.choices]   提问选项
 * @param {string} [opts.cwd]         工作目录
 * @param {string} [opts.url]         点通知跳回的地址
 * @param {number} [opts.excerptMaxChars]
 * @param {boolean} [opts.includeExcerpt]
 * @param {boolean} [opts.includeCwd]
 * @returns {{title:string, body:string, url?:string}}
 */
export function render(opts) {
  const {
    kind,
    detail,
    title,
    excerpt,
    durationMs,
    toolName,
    reason,
    question,
    choices,
    cwd,
    url,
    excerptMaxChars = 160,
    includeExcerpt = true,
    includeCwd = false,
  } = opts;

  const icon = ICONS[kind] ?? '🔔';
  const label = LABELS[kind] ?? '提醒';

  // 标题：图标 + 会话名 + 类型。会话名可能很长，截短。
  const sessionName = title ? truncate(title, 40) : 'DeepSeek Harness';
  const head = `${icon} ${sessionName} · ${label}`;

  const lines = [];

  if (kind === 'approval') {
    lines.push(toolName ? `工具：${toolName}` : '有一项操作等你批准');
    if (reason) lines.push(`原因：${truncate(reason, 100)}`);
  } else if (kind === 'question') {
    if (question) lines.push(truncate(question, 200));
    if (Array.isArray(choices) && choices.length) {
      lines.push('选项：' + choices.slice(0, 6).map((c) => String(c)).join(' / '));
    }
  } else if (kind === 'error') {
    lines.push(detail === 'max-tokens' ? '输出达到长度上限被截断' : '任务出错中断');
  } else if (kind === 'blocked') {
    lines.push('目标受阻，需要你介入');
  } else if (kind === 'goal') {
    lines.push(detail === 'block' ? '目标受阻' : '目标已完成');
  } else {
    lines.push('任务已完成');
  }

  if (includeCwd && cwd) lines.push(`目录：${truncate(cwd, 80)}`);
  if (durationMs !== undefined) {
    const d = humanDuration(durationMs);
    if (d) lines.push(`耗时：${d}`);
  }
  if (includeExcerpt && excerpt) lines.push(truncate(excerpt, excerptMaxChars));

  const body = lines.join('\n');
  const out = { title: head, body };
  if (url) out.url = url;
  return out;
}

/**
 * 汇总渲染：把一批提醒合成一条。
 * 例：
 *   🌙 夜间汇总（3 条）
 *   ✅ 重构 runner · 完成
 *   ❌ 修复登录 · 出错
 *   ✅ 跑测试 · 完成
 */
export function renderDigest(items, { label = '汇总' } = {}) {
  if (!items || items.length === 0) return null;
  if (items.length === 1) return items[0].message;

  const title = `🌙 ${label}（${items.length} 条）`;
  const lines = items.map((it) => {
    const icon = ICONS[it.kind] ?? '🔔';
    const name = it.title ? truncate(it.title, 28) : '未命名会话';
    const what = LABELS[it.kind] ?? '提醒';
    return `${icon} ${name} · ${what}`;
  });

  return { title, body: lines.join('\n') };
}
