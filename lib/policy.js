/**
 * 策略层 —— 决定「这一次到底要不要吵醒你」。
 *
 * 四道闸门，全部可配：
 *   1. 触发类型   哪些事件值得提醒（完成/出错/等审批/等回答/目标受阻）
 *   2. 短任务过滤 跑得快的活不提醒
 *   3. 延迟提醒   等 N 秒再发；这期间你回电脑操作了就取消
 *   4. 免打扰时段 某时段不响，可选「攒着早上发」或「丢弃」
 *
 * 这一层是纯函数 + 少量定时器，不 import DSH，方便单测。
 */

/** 解析 "23:00-08:00" 这样的时段，支持跨零点。返回 null 表示未配置。 */
export function parseQuietHours(spec) {
  const s = String(spec ?? '').trim();
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (start === end) return null;
  return { start, end, raw: s };
}

/** 当前时刻（按给定 Date 的本地时间）是否落在免打扰时段内。 */
export function inQuietHours(quiet, now = new Date()) {
  if (!quiet) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  // 跨零点：23:00-08:00 → start=1380, end=480，命中条件是 cur>=start || cur<end
  return quiet.start > quiet.end ? cur >= quiet.start || cur < quiet.end : cur >= quiet.start && cur < quiet.end;
}

/**
 * 触发类型判定：这个事件该不该进提醒队列。
 * 返回 { notify: boolean, kind: string, reason?: string }
 */
export function classifyEvent(event, triggers) {
  const type = event?.type;

  if (type === 'turn/end') {
    const kind = event.data?.reason?.kind;
    if (kind === 'forked') return { notify: false };
    if (kind === 'completed') {
      return triggers.completed ? { notify: true, kind: 'completed' } : { notify: false };
    }
    if (kind === 'error' || kind === 'max-tokens') {
      return triggers.error ? { notify: true, kind: 'error', detail: kind } : { notify: false };
    }
    if (kind === 'blocked') {
      return triggers.blocked ? { notify: true, kind: 'blocked' } : { notify: false };
    }
    // aborted / interrupted：用户自己按了停止，不吵
    return { notify: false };
  }

  if (type === 'approval/asked') {
    return triggers.approval ? { notify: true, kind: 'approval' } : { notify: false };
  }

  if (type === 'goal/change') {
    const op = event.data?.operation;
    if (op === 'complete' || op === 'block') {
      return triggers.goal ? { notify: true, kind: 'goal', detail: op } : { notify: false };
    }
    return { notify: false };
  }

  return { notify: false };
}

/** ask_user_question 是通过 tool/call 触发的，需要单独识别。 */
export function isAskUserQuestion(event) {
  return event?.type === 'tool/call' && event.data?.name === 'ask_user_question';
}

/**
 * 延迟调度器：登记一批待发提醒，到点前可取消。
 *
 * 这是「你回电脑操作了就自动取消」的实现基础：
 * 用户一动（发消息 / 点审批 / 回答提问），就 cancelFor(sessionId)。
 */
export class DeferredQueue {
  /**
   * @param {object} opts
   * @param {number} opts.delayMs     延迟毫秒数，0 表示立即
   * @param {(item)=>void} opts.onFire 到点回调
   * @param {()=>number} [opts.now]   可注入时钟，测试用
   */
  constructor({ delayMs, onFire, now = () => Date.now() }) {
    this.delayMs = delayMs;
    this.onFire = onFire;
    this.now = now;
    /** @type {Map<string, {timer: any, item: any, dueAt: number}>} */
    this.pending = new Map();
  }

  /** 登记一条；同一 key 已有待发项时用新的覆盖（后到的更准确）。 */
  push(key, item) {
    this.cancel(key);
    if (this.delayMs <= 0) {
      this.onFire(item);
      return;
    }
    const timer = setTimeout(() => {
      this.pending.delete(key);
      this.onFire(item);
    }, this.delayMs);
    // 不要因为待发提醒把 Node 进程吊住
    if (typeof timer.unref === 'function') timer.unref();
    this.pending.set(key, { timer, item, dueAt: this.now() + this.delayMs });
  }

  /** 取消某会话的待发提醒；返回是否真的取消了。 */
  cancel(key) {
    const hit = this.pending.get(key);
    if (!hit) return false;
    clearTimeout(hit.timer);
    this.pending.delete(key);
    return true;
  }

  /** 取消所有以 prefix 开头的待发项（例如整个会话的所有提醒）。 */
  cancelByPrefix(prefix) {
    let n = 0;
    for (const key of [...this.pending.keys()]) {
      if (key.startsWith(prefix)) {
        this.cancel(key);
        n += 1;
      }
    }
    return n;
  }

  /** 取消全部。 */
  clear() {
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  size() {
    return this.pending.size;
  }
}

/**
 * 汇总队列：把一批提醒攒起来，到点合并成一条发。
 * 用于「定时汇总：一晚上跑了十轮，早上只发一条」。
 */
export class DigestQueue {
  /**
   * @param {object} opts
   * @param {number} opts.windowMs  汇总窗口
   * @param {(items:any[])=>void} opts.onFlush
   */
  constructor({ windowMs, onFlush }) {
    this.windowMs = windowMs;
    this.onFlush = onFlush;
    this.items = [];
    this.timer = null;
  }

  push(item) {
    this.items.push(item);
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.windowMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.items.length === 0) return;
    const batch = this.items;
    this.items = [];
    this.onFlush(batch);
  }

  size() {
    return this.items.length;
  }
}

/**
 * 判断一次提醒该走哪条路：
 *   'send'    立即（或延迟后）发
 *   'digest'  进汇总队列
 *   'drop'    丢弃
 *
 * @returns {{action:'send'|'digest'|'drop', why:string}}
 */
export function route({ now, quiet, quietMode, digestEnabled, forced }) {
  if (forced) return { action: 'send', why: '手动测试' };

  if (quiet && inQuietHours(quiet, now)) {
    if (quietMode === 'digest') return { action: 'digest', why: '免打扰时段，攒到之后发' };
    if (quietMode === 'drop') return { action: 'drop', why: '免打扰时段，直接丢弃' };
    // 'send' 模式：免打扰时段照发
    return { action: 'send', why: '免打扰时段但配置为照发' };
  }

  if (digestEnabled) return { action: 'digest', why: '开启定时汇总' };
  return { action: 'send', why: '正常发送' };
}
