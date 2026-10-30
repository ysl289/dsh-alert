import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseQuietHours,
  inQuietHours,
  classifyEvent,
  isAskUserQuestion,
  DeferredQueue,
  DigestQueue,
  route,
} from '../lib/policy.js';

// ── 免打扰时段 ──

test('parseQuietHours 解析跨零点时段', () => {
  assert.deepEqual(parseQuietHours('23:00-08:00'), { start: 1380, end: 480, raw: '23:00-08:00' });
});

test('parseQuietHours 解析同一天时段', () => {
  assert.deepEqual(parseQuietHours('09:30-18:00'), { start: 570, end: 1080, raw: '09:30-18:00' });
});

test('parseQuietHours 空值/非法值返回 null', () => {
  assert.equal(parseQuietHours(''), null);
  assert.equal(parseQuietHours(undefined), null);
  assert.equal(parseQuietHours('随便写'), null);
  assert.equal(parseQuietHours('08:00-08:00'), null);
});

test('inQuietHours 跨零点：凌晨命中，中午不命中', () => {
  const q = parseQuietHours('23:00-08:00');
  assert.equal(inQuietHours(q, new Date('2026-10-29T02:00:00')), true);
  assert.equal(inQuietHours(q, new Date('2026-10-29T23:30:00')), true);
  assert.equal(inQuietHours(q, new Date('2026-10-29T12:00:00')), false);
  assert.equal(inQuietHours(q, new Date('2026-10-29T08:00:00')), false);
});

test('inQuietHours 未配置时永不命中', () => {
  assert.equal(inQuietHours(null, new Date('2026-10-29T02:00:00')), false);
});

// ── 触发分类 ──

const ALL_ON = { completed: true, error: true, approval: true, question: true, blocked: true, goal: true };
const ALL_OFF = { completed: false, error: false, approval: false, question: false, blocked: false, goal: false };

test('完成事件按开关决定', () => {
  const e = { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } };
  assert.equal(classifyEvent(e, ALL_ON).notify, true);
  assert.equal(classifyEvent(e, ALL_OFF).notify, false);
});

test('forked 永不提醒（不是一次完成）', () => {
  const e = { type: 'turn/end', data: { turn: 1, reason: { kind: 'forked' } } };
  assert.equal(classifyEvent(e, ALL_ON).notify, false);
});

test('用户自己按停止不提醒', () => {
  for (const kind of ['aborted', 'interrupted']) {
    const e = { type: 'turn/end', data: { turn: 1, reason: { kind } } };
    assert.equal(classifyEvent(e, ALL_ON).notify, false, kind);
  }
});

test('出错与输出超限归到 error 类', () => {
  for (const kind of ['error', 'max-tokens']) {
    const e = { type: 'turn/end', data: { turn: 1, reason: { kind } } };
    const hit = classifyEvent(e, ALL_ON);
    assert.equal(hit.notify, true, kind);
    assert.equal(hit.kind, 'error', kind);
  }
});

test('审批事件', () => {
  const e = { type: 'approval/asked', data: { id: 'a1', toolName: 'bash' } };
  assert.equal(classifyEvent(e, ALL_ON).kind, 'approval');
  assert.equal(classifyEvent(e, ALL_OFF).notify, false);
});

test('目标事件只在完成/受阻时提醒', () => {
  const complete = { type: 'goal/change', data: { operation: 'complete' } };
  const block = { type: 'goal/change', data: { operation: 'block' } };
  const create = { type: 'goal/change', data: { operation: 'create' } };
  assert.equal(classifyEvent(complete, ALL_ON).notify, true);
  assert.equal(classifyEvent(block, ALL_ON).notify, true);
  assert.equal(classifyEvent(create, ALL_ON).notify, false);
});

test('无关事件不提醒', () => {
  assert.equal(classifyEvent({ type: 'tool/result' }, ALL_ON).notify, false);
  assert.equal(classifyEvent(null, ALL_ON).notify, false);
});

test('ask_user_question 从 tool/call 里识别', () => {
  assert.equal(isAskUserQuestion({ type: 'tool/call', data: { name: 'ask_user_question' } }), true);
  assert.equal(isAskUserQuestion({ type: 'tool/call', data: { name: 'bash' } }), false);
  assert.equal(isAskUserQuestion({ type: 'turn/end' }), false);
});

// ── 延迟队列 ──

test('DeferredQueue 延迟为 0 时立即触发', () => {
  const fired = [];
  const q = new DeferredQueue({ delayMs: 0, onFire: (i) => fired.push(i) });
  q.push('k1', { id: 1 });
  assert.deepEqual(fired, [{ id: 1 }]);
  assert.equal(q.size(), 0);
});

test('DeferredQueue 到点前可以取消', async () => {
  const fired = [];
  const q = new DeferredQueue({ delayMs: 30, onFire: (i) => fired.push(i) });
  q.push('k1', { id: 1 });
  assert.equal(q.size(), 1);
  assert.equal(q.cancel('k1'), true);
  assert.equal(q.cancel('k1'), false, '重复取消返回 false');
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(fired, [], '取消后不应该触发');
});

test('DeferredQueue 到点会触发', async () => {
  const fired = [];
  const q = new DeferredQueue({ delayMs: 20, onFire: (i) => fired.push(i) });
  q.push('k1', { id: 1 });
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(fired, [{ id: 1 }]);
});

test('DeferredQueue 同 key 后来者覆盖先到者', async () => {
  const fired = [];
  const q = new DeferredQueue({ delayMs: 30, onFire: (i) => fired.push(i) });
  q.push('k1', { id: 1 });
  q.push('k1', { id: 2 });
  await new Promise((r) => setTimeout(r, 70));
  assert.deepEqual(fired, [{ id: 2 }]);
});

test('DeferredQueue 按前缀批量取消', () => {
  const fired = [];
  const q = new DeferredQueue({ delayMs: 1000, onFire: (i) => fired.push(i) });
  q.push('s1\u0000completed', {});
  q.push('s1\u0000approval', {});
  q.push('s2\u0000completed', {});
  assert.equal(q.cancelByPrefix('s1\u0000'), 2);
  assert.equal(q.size(), 1);
  q.clear();
});

// ── 汇总队列 ──

test('DigestQueue 攒批后一次 flush', async () => {
  const batches = [];
  const q = new DigestQueue({ windowMs: 30, onFlush: (b) => batches.push(b) });
  q.push({ id: 1 });
  q.push({ id: 2 });
  assert.equal(q.size(), 2);
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0], [{ id: 1 }, { id: 2 }]);
  assert.equal(q.size(), 0);
});

test('DigestQueue 空批不触发回调', () => {
  let called = 0;
  const q = new DigestQueue({ windowMs: 10, onFlush: () => { called += 1; } });
  q.flush();
  assert.equal(called, 0);
});

// ── 路由决策 ──

test('正常时段直接发', () => {
  const r = route({ now: new Date('2026-10-29T14:00:00'), quiet: null, quietMode: 'digest', digestEnabled: false });
  assert.equal(r.action, 'send');
});

test('免打扰时段 + digest 模式 → 攒着', () => {
  const r = route({
    now: new Date('2026-10-29T02:00:00'),
    quiet: parseQuietHours('23:00-08:00'),
    quietMode: 'digest',
    digestEnabled: false,
  });
  assert.equal(r.action, 'digest');
});

test('免打扰时段 + drop 模式 → 丢弃', () => {
  const r = route({
    now: new Date('2026-10-29T02:00:00'),
    quiet: parseQuietHours('23:00-08:00'),
    quietMode: 'drop',
    digestEnabled: false,
  });
  assert.equal(r.action, 'drop');
});

test('免打扰时段 + send 模式 → 照发', () => {
  const r = route({
    now: new Date('2026-10-29T02:00:00'),
    quiet: parseQuietHours('23:00-08:00'),
    quietMode: 'send',
    digestEnabled: false,
  });
  assert.equal(r.action, 'send');
});

test('开了汇总 → 进汇总队列', () => {
  const r = route({ now: new Date('2026-10-29T14:00:00'), quiet: null, quietMode: 'digest', digestEnabled: true });
  assert.equal(r.action, 'digest');
});

test('手动测试无视一切闸门', () => {
  const r = route({
    now: new Date('2026-10-29T02:00:00'),
    quiet: parseQuietHours('23:00-08:00'),
    quietMode: 'drop',
    digestEnabled: true,
    forced: true,
  });
  assert.equal(r.action, 'send');
});
