/**
 * 集成测试：用假的 ctx 驱动真实的 apply()，验证整条业务链路。
 *
 * 这一步不碰 DSH，但验证的是「插件真的接上了事件之后会不会发」。
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply } from '../lib/index.js';
import { normalizeConfig } from '../lib/channels/index.js';
import { custom } from '../lib/channels/custom.js';

let server;
let baseUrl;
let received = [];
let homeDir;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      received.push({ url: req.url, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  homeDir = mkdtempSync(join(tmpdir(), 'dsh-alert-test-'));
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    rmSync(homeDir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
});

/** 造一个够用的假 ctx。 */
function makeCtx() {
  const handlers = [];
  const store = new Map();
  return {
    handlers,
    dshHome: homeDir,
    on(type, fn) {
      handlers.push({ type, fn });
    },
    set(key, value) {
      store.set(key, value);
    },
    get(key) {
      return store.get(key);
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    /** 触发某个类型的所有处理器 */
    emit(type, ...args) {
      for (const h of handlers) {
        if (h.type === type) h.fn(...args);
      }
    },
  };
}

/** 造一个够用的假 session。 */
function makeSession(events = [], header = {}) {
  return {
    id: header.id ?? 'sess-1',
    header: { delegationDepth: 0, ...header },
    snapshotEvents: () => events,
  };
}

function channelConfig() {
  return [
    {
      id: 'custom',
      enabled: true,
      config: normalizeConfig(custom, { url: `${baseUrl}/notify`, body: '{"t":"{{title}}","b":"{{body}}"}' }),
    },
  ];
}

function baseSettings(overrides = {}) {
  return {
    enabled: true,
    delaySeconds: 0,
    minTurnDurationSeconds: 0,
    quietHours: '',
    quietMode: 'digest',
    digestEnabled: false,
    includeExcerpt: true,
    includeCwd: false,
    includeSubagents: false,
    openOnClick: false,
    retries: 0,
    timeoutMs: 5000,
    triggers: { completed: true, error: true, approval: true, question: true, blocked: true, goal: true },
    channels: channelConfig(),
    ...overrides,
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('完成事件会触发一次推送', async () => {
  received = [];
  const ctx = makeCtx();
  apply(ctx, baseSettings());

  const events = [
    { type: 'session/title', data: { title: '重构 runner' }, seq: 1 },
    { type: 'turn/start', data: { turn: 1 }, timestamp: 1000, seq: 2 },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '改完了' }] } }, seq: 3 },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, timestamp: 5000, seq: 4 },
  ];
  const session = makeSession(events);
  ctx.emit('session/event', session, events[3]);
  await wait(200);

  assert.equal(received.length, 1, '应该推 1 条');
  const got = JSON.parse(received[0].body);
  assert.match(got.t, /重构 runner/);
  assert.match(got.b, /改完了/);
});

test('同一个事件重复投递只推一次（去重）', async () => {
  received = [];
  const ctx = makeCtx();
  apply(ctx, baseSettings());

  const end = { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, timestamp: 5000, seq: 4 };
  const events = [{ type: 'turn/start', data: { turn: 1 }, timestamp: 1000, seq: 2 }, end];
  const session = makeSession(events);

  ctx.emit('session/event', session, end);
  ctx.emit('session/event', session, end);
  await wait(200);

  assert.equal(received.length, 1, '重复事件不应重复推送');
});

test('审批事件带工具名', async () => {
  received = [];
  const ctx = makeCtx();
  apply(ctx, baseSettings());

  const session = makeSession([{ type: 'session/title', data: { title: '部署' }, seq: 1 }]);
  ctx.emit('session/event', session, {
    type: 'approval/asked',
    data: { id: 'ap1', toolName: 'bash', reason: '要删文件' },
    seq: 2,
  });
  await wait(200);

  assert.equal(received.length, 1);
  const got = JSON.parse(received[0].body);
  assert.match(got.b, /bash/);
});

test('用户自己按停止不推送', async () => {
  received = [];
  const ctx = makeCtx();
  apply(ctx, baseSettings());

  const session = makeSession([]);
  ctx.emit('session/event', session, {
    type: 'turn/end',
    data: { turn: 1, reason: { kind: 'aborted' } },
    seq: 2,
  });
  await wait(150);

  assert.equal(received.length, 0);
});

test('子代理会话默认不推送', async () => {
  received = [];
  const ctx = makeCtx();
  apply(ctx, baseSettings());

  const session = makeSession([], { origin: 'subagent', delegationDepth: 1 });
  ctx.emit('session/event', session, {
    type: 'turn/end',
    data: { turn: 1, reason: { kind: 'completed' } },
    seq: 2,
  });
  await wait(150);

  assert.equal(received.length, 0);
});

test('打开 includeSubagents 后子代理也推', async () => {
  received = [];
  const ctx = makeCtx();
  apply(ctx, baseSettings({ includeSubagents: true }));

  const session = makeSession([], { origin: 'subagent', delegationDepth: 1, id: 'sub-1' });
  ctx.emit('session/event', session, {
    type: 'turn/end',
    data: { turn: 1, reason: { kind: 'completed' } },
    seq: 2,
  });
  await wait(200);

  assert.equal(received.length, 1);
});

test('短任务被过滤掉', async () => {
  received = [];
  const ctx = makeCtx();
  apply(ctx, baseSettings({ minTurnDurationSeconds: 60 }));

  const events = [
    { type: 'turn/start', data: { turn: 1 }, timestamp: 1000, seq: 1 },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, timestamp: 3000, seq: 2 },
  ];
  const session = makeSession(events);
  ctx.emit('session/event', session, events[1]);
  await wait(200);

  assert.equal(received.length, 0, '只跑了 2 秒，不该提醒');
});

test('延迟提醒：用户中途操作会取消', async () => {
  received = [];
  const ctx = makeCtx();
  apply(ctx, baseSettings({ delaySeconds: 1 }));

  const events = [
    { type: 'turn/start', data: { turn: 1 }, timestamp: 1000, seq: 1 },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, timestamp: 5000, seq: 2 },
  ];
  const session = makeSession(events);
  ctx.emit('session/event', session, events[1]);

  // 500ms 后用户发了消息 → 取消
  await wait(500);
  ctx.emit('session/event', session, { type: 'user/message', data: { source: { kind: 'user' } }, seq: 3 });

  await wait(900);
  assert.equal(received.length, 0, '用户回来了，不该再响');
});

test('延迟提醒：用户没回来就正常发', async () => {
  received = [];
  const ctx = makeCtx();
  apply(ctx, baseSettings({ delaySeconds: 0.3 }));

  const events = [
    { type: 'turn/start', data: { turn: 1 }, timestamp: 1000, seq: 1 },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, timestamp: 5000, seq: 2 },
  ];
  const session = makeSession(events);
  ctx.emit('session/event', session, events[1]);

  await wait(800);
  assert.equal(received.length, 1, '没回来，应该发');
});

test('免打扰时段 + drop 模式不推送', async () => {
  received = [];
  const ctx = makeCtx();
  // 构造一个「现在一定在免打扰时段内」的配置：当前时间前后各一小时
  const now = new Date();
  const start = `${String(now.getHours()).padStart(2, '0')}:00`;
  const end = `${String((now.getHours() + 2) % 24).padStart(2, '0')}:00`;
  apply(ctx, baseSettings({ quietHours: `${start}-${end}`, quietMode: 'drop' }));

  const session = makeSession([]);
  ctx.emit('session/event', session, {
    type: 'turn/end',
    data: { turn: 1, reason: { kind: 'completed' } },
    seq: 2,
  });
  await wait(150);

  assert.equal(received.length, 0, '免打扰时段应丢弃');
});

test('总开关关掉后什么都不发', async () => {
  received = [];
  const ctx = makeCtx();
  apply(ctx, baseSettings({ enabled: false }));

  const session = makeSession([]);
  ctx.emit('session/event', session, {
    type: 'turn/end',
    data: { turn: 1, reason: { kind: 'completed' } },
    seq: 2,
  });
  await wait(150);

  assert.equal(received.length, 0);
});

test('通道全挂也不影响会话（不抛异常）', async () => {
  const ctx = makeCtx();
  apply(
    ctx,
    baseSettings({
      channels: [{ id: 'custom', enabled: true, config: { url: 'http://127.0.0.1:1/nowhere', body: '{}' } }],
    }),
  );

  const session = makeSession([]);
  assert.doesNotThrow(() => {
    ctx.emit('session/event', session, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
      seq: 2,
    });
  });
  await wait(300);
});

test('设置接口：listChannels 返回全部免费通道', () => {
  const ctx = makeCtx();
  apply(ctx, baseSettings());
  const api = ctx.get('dshAlert');
  assert.ok(api, '应暴露设置接口');
  const channels = api.listChannels();
  assert.equal(channels.length, 7, '只保留免费可用的通道');
  assert.ok(channels.every((c) => c.id && c.label && Array.isArray(c.fields)));
  assert.ok(!channels.some((c) => c.id === 'pushplus'), 'PushPlus 要付费，应已移除');
});

test('设置接口：sendTest 会真的发一条', async () => {
  received = [];
  const ctx = makeCtx();
  apply(ctx, baseSettings());
  const api = ctx.get('dshAlert');

  const res = await api.sendTest();
  assert.equal(res.ok, true);
  assert.equal(received.length, 1);
  assert.match(received[0].body, /测试/);
});

test('设置接口：saveSettings 后生效', async () => {
  received = [];
  const ctx = makeCtx();
  apply(ctx, baseSettings());
  const api = ctx.get('dshAlert');

  api.saveSettings({ enabled: false });

  const session = makeSession([]);
  ctx.emit('session/event', session, {
    type: 'turn/end',
    data: { turn: 1, reason: { kind: 'completed' } },
    seq: 2,
  });
  await wait(150);

  assert.equal(received.length, 0, '关掉后不该发');
});

test('提问事件从 tool/call 里识别并推送', async () => {
  received = [];
  const ctx = makeCtx();
  apply(ctx, baseSettings());

  const session = makeSession([{ type: 'session/title', data: { title: '部署' }, seq: 1 }]);
  ctx.emit('session/event', session, {
    type: 'tool/call',
    data: {
      name: 'ask_user_question',
      callId: 'c1',
      arguments: JSON.stringify({ questions: [{ question: '选哪个环境', options: ['Blue', 'Green'] }] }),
    },
    seq: 2,
  });
  await wait(200);

  assert.equal(received.length, 1);
  const got = JSON.parse(received[0].body);
  assert.match(got.b, /选哪个环境/);
  assert.match(got.b, /Blue/);
});

test('dispose 会清掉待发提醒', async () => {
  received = [];
  const ctx = makeCtx();
  const dispose = apply(ctx, baseSettings({ delaySeconds: 1 }));

  const events = [{ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, timestamp: 5000, seq: 1 }];
  const session = makeSession(events);
  ctx.emit('session/event', session, events[0]);

  assert.equal(typeof dispose, 'function');
  dispose();

  await wait(1300);
  assert.equal(received.length, 0, '卸载后不该再发');
});
