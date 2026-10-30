/**
 * 事件循环与定时器行为回归测试。
 *
 * 背景（这是靠跨平台 CI 才抓到的真 bug）：
 *   deliver.js 的重试退避用了 `setTimeout(...).unref()`。
 *   unref 会让 Node 认为「没有待处理工作」，于是在重试还挂着的时候
 *   事件循环就被判定空闲 —— Linux/macOS 上直接报
 *   "Promise resolution is still pending but the event loop has already resolved"，
 *   Windows 上因为调度差异不显形。
 *
 * 生产后果：重试途中宿主进程退出，提醒静默丢失。
 *
 * 这些断言不依赖平台，用行为而不是实现来验证。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { deliver } from '../lib/deliver.js';
import { DeferredQueue, DigestQueue } from '../lib/policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const DELIVER_SRC = readFileSync(join(here, '..', 'lib', 'deliver.js'), 'utf8');
const POLICY_SRC = readFileSync(join(here, '..', 'lib', 'policy.js'), 'utf8');

const MSG = { title: 't', body: 'b' };
const okRes = () => ({ status: 200, text: async () => '{}' });
const errRes = () => ({ status: 500, text: async () => '{}' });

test('重试退避的定时器不能被 unref（否则进程提前退出）', () => {
  // 找到 sleep 函数体，确认里面没有 unref
  const sleepBody = DELIVER_SRC.match(/function sleep\([\s\S]*?\n\}/);
  assert.ok(sleepBody, '应能找到 sleep 函数');
  assert.ok(
    !sleepBody[0].includes('unref'),
    'sleep 里不能 unref：重试途中事件循环会被判定空闲，导致提醒丢失',
  );
});

test('请求超时定时器不能被 unref（它在 finally 里会清掉，不会泄漏）', () => {
  const fn = DELIVER_SRC.match(/async function fetchWithTimeout[\s\S]*?\n\}/);
  assert.ok(fn, '应能找到 fetchWithTimeout');

  // 去掉注释再判断，否则会把说明文字里的 unref 当成真实调用
  const code = fn[0]
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');

  assert.ok(
    !/\.unref\(/.test(code),
    'fetchWithTimeout 里不能调用 unref：等待超时的这段时间会被当成空闲',
  );
});

test('重试次数确实按配置执行（跨平台稳定）', async () => {
  let calls = 0;
  await deliver(MSG, [{ id: 'ntfy', enabled: true, config: { topic: 't' } }], {
    fetch: async () => {
      calls += 1;
      return errRes();
    },
    retries: 2,
    // 退避基数调到 1ms：只验证「重试了几次」，不验证真实退避时长
    backoffMs: 1,
  });
  assert.equal(calls, 3, '首次 + 2 次重试 = 3 次调用');
});

test('重试后成功时不继续重试', async () => {
  let calls = 0;
  const res = await deliver(MSG, [{ id: 'ntfy', enabled: true, config: { topic: 't' } }], {
    fetch: async () => {
      calls += 1;
      return calls >= 2 ? okRes() : errRes();
    },
    retries: 2,
    backoffMs: 1,
  });
  assert.equal(res.ok, true);
  assert.equal(calls, 2, '第 2 次成功就该停');
});

test('生产默认退避是 500ms 起（不传 backoffMs 时）', () => {
  // 通过源码断言保护默认值，避免有人把默认改成 0 导致打爆对方接口
  const m = DELIVER_SRC.match(/backoffMs\s*=\s*(\d+)/);
  assert.ok(m, '应有 backoffMs 默认值');
  assert.equal(Number(m[1]), 500, '默认退避基数应是 500ms');
});

test('延迟队列的定时器应当 unref（不能阻止进程退出）', () => {
  const body = POLICY_SRC.match(/push\(key, item\)[\s\S]*?this\.pending\.set/);
  assert.ok(body, '应能找到 DeferredQueue.push');
  assert.ok(
    body[0].includes('unref'),
    '延迟队列要 unref：待发提醒不该把进程吊住（DSH 有 webServer 持循环，照常触发）',
  );
});

test('延迟队列到点确实触发（有持久 handle 时 unref 不影响）', async () => {
  const fired = [];
  const q = new DeferredQueue({ delayMs: 30, onFire: (item) => fired.push(item) });

  // 模拟 DSH 进程：有一个持续持有事件循环的 handle
  const keepAlive = setInterval(() => {}, 1000);
  try {
    q.push('k1', { id: 1 });
    await new Promise((r) => setTimeout(r, 120));
  } finally {
    clearInterval(keepAlive);
  }

  assert.equal(fired.length, 1, '延迟队列应触发一次');
  assert.deepEqual(fired[0], { id: 1 });
});

test('延迟队列被取消后不触发', async () => {
  const fired = [];
  const q = new DeferredQueue({ delayMs: 30, onFire: (item) => fired.push(item) });
  const keepAlive = setInterval(() => {}, 1000);
  try {
    q.push('k1', { id: 1 });
    q.cancel('k1');
    await new Promise((r) => setTimeout(r, 100));
  } finally {
    clearInterval(keepAlive);
  }
  assert.equal(fired.length, 0, '取消后不该触发');
});

test('汇总队列到点确实合并发出', async () => {
  const flushed = [];
  const q = new DigestQueue({ windowMs: 40, onFlush: (items) => flushed.push(items) });
  const keepAlive = setInterval(() => {}, 1000);
  try {
    q.push({ a: 1 });
    q.push({ a: 2 });
    await new Promise((r) => setTimeout(r, 140));
  } finally {
    clearInterval(keepAlive);
  }
  assert.equal(flushed.length, 1, '应合并成一次');
  assert.equal(flushed[0].length, 2, '两条都应在里面');
});
