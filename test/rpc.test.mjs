/**
 * RPC 传输测试：真的起一个 HTTP 服务器，把路由 handler 挂上去，
 * 用真实请求走一遍 wire 协议，验证设置页能读到数据。
 *
 * 这是「设置页显示读不到设置」的直接回归测试。
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, RPC_CHANNEL, inject } from '../lib/index.js';
import { createDispatcher, ok, fail, __internals } from '../lib/rpc.js';
import { normalizeConfig } from '../lib/channels/index.js';
import { custom } from '../lib/channels/custom.js';

let homeDir;
let sink;
let sinkUrl;

before(async () => {
  homeDir = mkdtempSync(join(tmpdir(), 'dsh-alert-rpc2-'));
  // 一个假的推送接收端，给 sendTest 用
  sink = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise((r) => sink.listen(0, '127.0.0.1', r));
  sinkUrl = `http://127.0.0.1:${sink.address().port}`;
});

after(async () => {
  await new Promise((r) => sink.close(r));
  try {
    rmSync(homeDir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
});

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
    channels: [
      {
        id: 'custom',
        enabled: true,
        config: normalizeConfig(custom, { url: `${sinkUrl}/notify`, body: '{"t":"{{title}}"}' }),
      },
    ],
    ...overrides,
  };
}

/** 造 ctx，webServer.register 会真的挂到 HTTP 服务器上。 */
async function makeCtxWithServer() {
  const routes = [];
  const disposers = [];
  const ctx = {
    dshHome: homeDir,
    on() {},
    logger: { info() {}, warn() {}, error() {} },
    webServer: {
      register(route) {
        routes.push(route);
        return () => {
          const i = routes.indexOf(route);
          if (i >= 0) routes.splice(i, 1);
        };
      },
    },
    connection: {
      requestRejection() {
        return undefined; // 全放行（测试里没有 Host 校验）
      },
    },
    /** 模拟 cordis 的运行时注入：服务就绪时立刻回调 */
    inject(deps, callback) {
      const scoped = Object.create(ctx);
      const dispose = callback(scoped);
      if (typeof dispose === 'function') disposers.push(dispose);
      return () => {
        if (typeof dispose === 'function') dispose();
      };
    },
  };

  const server = createServer(async (req, res) => {
    for (const route of routes) {
      if (route.kind === 'prefix' && req.url.startsWith(route.path)) {
        await route.handler(req, res);
        return;
      }
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { ctx, server, base, routes, disposers };
}

/** 按 wire 协议发一次 RPC。 */
async function rpc(base, endpoint, payload = {}) {
  const res = await fetch(`${base}${RPC_CHANNEL}/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rpcId: `r${Math.random().toString(36).slice(2)}`, method: endpoint, payload }),
  });
  const json = await res.json();
  assert.equal(json.type, 'server-response', '响应必须是 server-response');
  assert.ok(typeof json.rpcId === 'string', '必须回带 rpcId');
  return json.result;
}

test('静态 inject 为空（保证任何 profile 都能加载）', () => {
  assert.ok(Array.isArray(inject));
  assert.deepEqual(inject, [], '不能静态依赖 webServer，否则 headless profile 里插件不加载');
});

test('设置页通过运行时 ctx.inject 挂载 webServer + connection', () => {
  const src = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
  assert.match(
    src,
    /ctx\.inject\?\.\(\['webServer', 'connection'\]/,
    '必须用运行时注入同时取 webServer（传输）和 connection（信任栅栏）',
  );
});

test('RPC_CHANNEL 是 /dsh-alert', () => {
  assert.equal(RPC_CHANNEL, '/dsh-alert');
});

test('信封形状正确：成功是 { ok, value }', () => {
  assert.deepEqual(ok({ a: 1 }), { ok: true, value: { a: 1 } });
});

test('信封形状正确：失败带 details', () => {
  const e = fail('坏了');
  assert.equal(e.ok, false);
  assert.equal(e.error.code, 'bad-request');
  assert.ok(e.error.details, 'details 必填');
});

test('取消类错误用 cancelled 码', () => {
  const e = fail('取消了', 'cancelled');
  assert.equal(e.error.code, 'cancelled');
  assert.deepEqual(e.error.details, {});
});

// ── 真实 HTTP 传输 ──

test('status 端点走真实 HTTP 能取到设置', async () => {
  const { ctx, server, base } = await makeCtxWithServer();
  try {
    apply(ctx, baseSettings());

    const res = await rpc(base, 'status');
    assert.equal(res.ok, true, `应该成功，实际：${JSON.stringify(res).slice(0, 300)}`);
    assert.ok(res.value.settings, '要有 settings');
    assert.equal(res.value.settings.enabled, true);
    assert.ok(Array.isArray(res.value.channels), '要有通道目录');
    assert.equal(res.value.channels.length, 7, '应有 7 个免费通道');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('save 端点走真实 HTTP 能写入并生效', async () => {
  const { ctx, server, base } = await makeCtxWithServer();
  try {
    apply(ctx, baseSettings());

    const res = await rpc(base, 'save', { settings: { delaySeconds: 77 } });
    assert.equal(res.ok, true);
    assert.equal(res.value.settings.delaySeconds, 77);

    // 再读一次确认持久化
    const again = await rpc(base, 'status');
    assert.equal(again.value.settings.delaySeconds, 77);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('test 端点走真实 HTTP 真的发一条', async () => {
  const { ctx, server, base } = await makeCtxWithServer();
  try {
    apply(ctx, baseSettings());

    const res = await rpc(base, 'test');
    assert.equal(res.ok, true);
    assert.equal(res.value.ok, true, '发送应成功');
    assert.equal(res.value.results.length, 1);
    assert.equal(res.value.results[0].channel, 'custom');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('未知端点返回错误而不是 500', async () => {
  const { ctx, server, base } = await makeCtxWithServer();
  try {
    apply(ctx, baseSettings());
    const res = await rpc(base, 'nope');
    assert.equal(res.ok, false);
    assert.match(res.error.message, /未知端点/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('GET 请求返回 404', async () => {
  const { ctx, server, base } = await makeCtxWithServer();
  try {
    apply(ctx, baseSettings());
    const res = await fetch(`${base}${RPC_CHANNEL}/status`);
    assert.equal(res.status, 404);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('错误的 content-type 返回 415', async () => {
  const { ctx, server, base } = await makeCtxWithServer();
  try {
    apply(ctx, baseSettings());
    const res = await fetch(`${base}${RPC_CHANNEL}/status`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    assert.equal(res.status, 415);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('rpcId 缺失时返回 invalid-request', async () => {
  const { ctx, server, base } = await makeCtxWithServer();
  try {
    apply(ctx, baseSettings());
    const res = await fetch(`${base}${RPC_CHANNEL}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'status' }),
    });
    const json = await res.json();
    assert.equal(json.rpcId, 'invalid-request');
    assert.equal(json.result.ok, false);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('method 与 endpoint 不一致时被拒', async () => {
  const { ctx, server, base } = await makeCtxWithServer();
  try {
    apply(ctx, baseSettings());
    const res = await fetch(`${base}${RPC_CHANNEL}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rpcId: 'x', method: '别的' }),
    });
    const json = await res.json();
    assert.equal(json.result.ok, false);
    assert.match(json.result.error.message, /不一致/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('信任栅栏拒绝时返回 403', async () => {
  const { ctx, server, base } = await makeCtxWithServer();
  try {
    ctx.connection.requestRejection = () => 403;
    apply(ctx, baseSettings());
    const res = await fetch(`${base}${RPC_CHANNEL}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rpcId: 'x', method: 'status' }),
    });
    assert.equal(res.status, 403);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('路径段含 .. 时被拒（防穿越）', async () => {
  assert.equal(__internals.endpointOf('/dsh-alert/../secret'), undefined);
  assert.equal(__internals.endpointOf('/dsh-alert/'), undefined);
  assert.equal(__internals.endpointOf('/dsh-alert/status'), 'status');
});

test('没有 webServer 时回退到 rpc.handle', () => {
  const registered = [];
  const ctx = {
    dshHome: homeDir,
    on() {},
    logger: { info() {}, warn() {}, error() {} },
    connection: {
      rpc: {
        handle(channel, handler) {
          registered.push({ channel, handler });
          return () => registered.pop();
        },
      },
    },
  };
  apply(ctx, baseSettings());
  assert.equal(registered.length, 1, '应回退到 rpc.handle');
  assert.equal(registered[0].channel, '/dsh-alert');
});

test('两条路径都不可用时安静降级', () => {
  const ctx = {
    dshHome: homeDir,
    on() {},
    logger: { info() {}, warn() {}, error() {} },
  };
  assert.doesNotThrow(() => apply(ctx, baseSettings()));
});

test('dispose 会注销 webServer 路由', async () => {
  const { ctx, server, routes } = await makeCtxWithServer();
  try {
    const dispose = apply(ctx, baseSettings());
    assert.equal(routes.length, 1);
    dispose();
    assert.equal(routes.length, 0, '卸载后路由应移除');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('dispatcher 单独可用（不依赖 HTTP）', async () => {
  const dispatch = createDispatcher(
    {
      getSettings: () => ({ enabled: true }),
      saveSettings: (n) => ({ ...n, saved: true }),
      listChannels: () => [{ id: 'x' }],
      sendTest: async () => ({ ok: true, results: [] }),
    },
    () => {},
  );

  const status = await dispatch('status', {});
  assert.equal(status.ok, true);
  assert.equal(status.value.settings.enabled, true);

  const saved = await dispatch('save', { settings: { a: 1 } });
  assert.equal(saved.value.settings.saved, true);

  const bad = await dispatch('save', {});
  assert.equal(bad.ok, false);
});
