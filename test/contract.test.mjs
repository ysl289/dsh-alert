/**
 * 客户端 ⇄ 服务端契约测试：用 dsh-client-connection 浏览器端的真实调用方式
 * （相对路径 + client-request 信封）打一遍，确保两端字段对得上。
 *
 * 这是「读不到设置」最贴近现场的回归测试。
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, RPC_CHANNEL } from '../lib/index.js';

let homeDir;

before(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'dsh-alert-contract-'));
});

after(() => {
  try {
    rmSync(homeDir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
});

function baseSettings() {
  return {
    enabled: true,
    delaySeconds: 12,
    minTurnDurationSeconds: 0,
    quietHours: '23:00-08:00',
    quietMode: 'digest',
    digestEnabled: false,
    includeExcerpt: true,
    includeCwd: false,
    includeSubagents: false,
    openOnClick: true,
    retries: 0,
    timeoutMs: 5000,
    triggers: { completed: true, error: true, approval: true, question: true, blocked: true, goal: true },
    channels: [],
  };
}

/** 起一个模拟宿主：prefix 路由 + 根路径兜底。 */
async function startHost() {
  const routes = [];
  const ctx = {
    dshHome: homeDir,
    on() {},
    logger: { info() {}, warn() {}, error() {} },
    webServer: {
      register(route) {
        if (routes.some((r) => r.kind === route.kind && r.path === route.path)) {
          throw new Error(`duplicate ${route.kind} route "${route.path}"`);
        }
        routes.push(route);
        return () => {
          const i = routes.indexOf(route);
          if (i >= 0) routes.splice(i, 1);
        };
      },
    },
    connection: { requestRejection: () => undefined },
    /** 模拟 cordis 运行时注入：服务就绪立刻回调 */
    inject(deps, callback) {
      const scoped = Object.create(ctx);
      const dispose = callback(scoped);
      return () => {
        if (typeof dispose === 'function') dispose();
      };
    },
  };

  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const hit = routes.find((r) => r.kind === 'prefix' && (path === r.path || path.startsWith(`${r.path}/`)));
    if (hit) {
      await hit.handler(req, res);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { ctx, server, port: server.address().port, routes };
}

/**
 * 复刻 dsh-client-connection 浏览器端的 call：
 *   fetch(`${channel}/${endpoint}`.slice(1), ...)
 * 注意是相对路径 —— 这正是容易踩的坑。
 */
async function clientCall(baseUrl, channel, endpoint, payload) {
  const rpcId = `id-${Math.random().toString(36).slice(2)}`;
  const message = { type: 'client-request', rpcId, method: endpoint, payload };

  // 关键：相对路径（去掉前导斜杠），和浏览器端一致
  const response = await fetch(new URL(`${channel}/${endpoint}`.slice(1), `${baseUrl}/`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message),
  });

  if (!response.ok) throw new Error(`transport failure: HTTP ${response.status}`);
  const full = await response.json();
  if (full.rpcId !== rpcId) throw new Error('rpcId mismatch');
  if (full.type !== 'server-response') throw new Error(`bad envelope type: ${full.type}`);
  return full.result;
}

test('客户端相对路径能打到服务端路由', async () => {
  const { ctx, server, port } = await startHost();
  try {
    apply(ctx, baseSettings());
    const baseUrl = `http://127.0.0.1:${port}`;

    const res = await clientCall(baseUrl, RPC_CHANNEL, 'status', {});
    assert.equal(res.ok, true, `应该成功：${JSON.stringify(res).slice(0, 300)}`);
    assert.ok(res.value, '必须有 value 字段');
    assert.equal(res.value.settings.delaySeconds, 12);
    assert.equal(res.value.settings.quietHours, '23:00-08:00');
    assert.equal(res.value.channels.length, 7);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('客户端 save 后 status 能读到新值', async () => {
  const { ctx, server, port } = await startHost();
  try {
    apply(ctx, baseSettings());
    const baseUrl = `http://127.0.0.1:${port}`;

    const saved = await clientCall(baseUrl, RPC_CHANNEL, 'save', { settings: { enabled: false, delaySeconds: 5 } });
    assert.equal(saved.ok, true);
    assert.equal(saved.value.settings.enabled, false);

    const again = await clientCall(baseUrl, RPC_CHANNEL, 'status', {});
    assert.equal(again.value.settings.enabled, false);
    assert.equal(again.value.settings.delaySeconds, 5);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('通道目录带完整字段定义（面板要用）', async () => {
  const { ctx, server, port } = await startHost();
  try {
    apply(ctx, baseSettings());
    const res = await clientCall(`http://127.0.0.1:${port}`, RPC_CHANNEL, 'status', {});

    const ids = res.value.channels.map((c) => c.id);
    assert.deepEqual(
      ids,
      ['ntfy', 'wecom-app', 'bark', 'qqbot', 'webhook', 'serverchan', 'custom'],
      '通道顺序即设置页顺序（免费优先）',
    );

    for (const chan of res.value.channels) {
      assert.ok(chan.label, `${chan.id} 缺 label`);
      assert.ok(chan.hint, `${chan.id} 缺 hint`);
      assert.ok(Array.isArray(chan.fields) && chan.fields.length > 0, `${chan.id} 缺 fields`);
      for (const f of chan.fields) {
        assert.ok(f.key && f.label && f.type, `${chan.id}.${f.key} 字段定义不全`);
      }
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('设置值能完整往返（不被裁剪）', async () => {
  const { ctx, server, port } = await startHost();
  try {
    apply(ctx, baseSettings());
    const baseUrl = `http://127.0.0.1:${port}`;

    const before = await clientCall(baseUrl, RPC_CHANNEL, 'status', {});
    const s = before.value.settings;

    // 面板会读这些字段，缺一个就会渲染出 undefined
    for (const key of [
      'enabled',
      'delaySeconds',
      'minTurnDurationSeconds',
      'quietHours',
      'quietMode',
      'digestEnabled',
      'digestMinutes',
      'includeExcerpt',
      'includeCwd',
      'includeSubagents',
      'openOnClick',
      'triggers',
      'channels',
    ]) {
      assert.ok(key in s, `设置缺字段：${key}`);
    }

    assert.equal(typeof s.triggers.completed, 'boolean');
    assert.ok(Array.isArray(s.channels));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('重复 apply 不会因路由重名而崩', async () => {
  const { ctx, server } = await startHost();
  try {
    // 第一次装成功
    const dispose1 = apply(ctx, baseSettings());
    // 第二次装同一路径：webServer 会抛 duplicate，插件应捕获而不是崩
    assert.doesNotThrow(() => {
      const dispose2 = apply(ctx, baseSettings());
      dispose2();
    });
    dispose1();
  } finally {
    await new Promise((r) => server.close(r));
  }
});
