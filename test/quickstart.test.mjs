/**
 * 「零输入」相关测试：首次运行自动生成主题、已配置通道识别、按通道测试。
 *
 * 这些直接对应用户诉求「一步到位」——少填一个字段就是少一个放弃的理由。
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { randomTopic, ensureQuickStart, configuredChannels, defaultSettings } from '../lib/settings.js';
import { apply } from '../lib/index.js';
import { getChannel } from '../lib/channels/index.js';

let homeDir;
let sink;
let sinkUrl;

before(async () => {
  homeDir = mkdtempSync(join(tmpdir(), 'dsh-alert-quick-'));
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

// ── 纯函数 ──

test('randomTopic 生成的形状稳定', () => {
  for (let i = 0; i < 20; i += 1) {
    const t = randomTopic();
    assert.match(t, /^dsh-[0-9a-f]{4}$/);
  }
});

test('randomTopic 每次都不一样', () => {
  const set = new Set();
  for (let i = 0; i < 50; i += 1) set.add(randomTopic());
  assert.ok(set.size >= 48, `应该有足够随机性，实际 ${set.size}/50`);
});

test('首次运行自动补一个 ntfy 主题', () => {
  const before = defaultSettings();
  assert.equal(before.channels.length, 0);

  const { settings, changed } = ensureQuickStart(before);
  assert.equal(changed, true);

  const ntfy = settings.channels.find((c) => c.id === 'ntfy');
  assert.ok(ntfy, '应自动加上 ntfy 通道');
  assert.match(ntfy.config.topic, /^dsh-[0-9a-f]{4}$/);
  // 关键：默认不启用，等用户真的订阅了再说
  assert.equal(ntfy.enabled, false, '自动加的通道不该默认启用');
});

test('已有主题时不覆盖', () => {
  const settings = defaultSettings();
  settings.channels = [{ id: 'ntfy', enabled: true, config: { topic: 'dsh-mytopic' } }];

  const { settings: next, changed } = ensureQuickStart(settings);
  assert.equal(changed, false);
  assert.equal(next.channels[0].config.topic, 'dsh-mytopic');
});

test('ntfy 存在但主题为空时补上', () => {
  const settings = defaultSettings();
  settings.channels = [{ id: 'ntfy', enabled: true, config: {} }];
  const { settings: next, changed } = ensureQuickStart(settings);
  assert.equal(changed, true);
  assert.match(next.channels[0].config.topic, /^dsh-[0-9a-f]{4}$/);
});

test('configuredChannels 只算启用的且必填齐全的', () => {
  const settings = defaultSettings();
  settings.channels = [
    { id: 'ntfy', enabled: true, config: { topic: 'dsh-a' } }, // 齐全
    { id: 'serverchan', enabled: true, config: {} }, // 缺 sendKey
    { id: 'bark', enabled: false, config: { key: 'K' } }, // 没启用
    { id: 'webhook', enabled: true, config: { url: 'https://x/y' } }, // 齐全
    { id: '不存在的通道', enabled: true, config: {} }, // 无效
  ];
  const ready = configuredChannels(settings, getChannel);
  assert.equal(ready.join(','), 'ntfy,webhook');
});

// ── 集成：首次运行落盘 ──

function makeCtx() {
  const handlers = [];
  const routes = [];
  return {
    dshHome: homeDir,
    on(type, fn) {
      handlers.push({ type, fn });
    },
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
      requestRejection: () => undefined,
    },
    inject(deps, cb) {
      return cb(this);
    },
    routes,
  };
}

/** 通过捕获到的路由调一次 RPC。 */
async function callRpc(ctx, endpoint, payload = {}) {
  const route = ctx.routes[0];
  assert.ok(route, '应该挂上了路由');

  const body = JSON.stringify({ type: 'client-request', rpcId: 'q1', method: endpoint, payload });
  let text = '';
  const req = {
    method: 'POST',
    url: `/dsh-alert/${endpoint}`,
    headers: { 'content-type': 'application/json', host: '127.0.0.1:1' },
    on(ev, fn) {
      if (ev === 'data') fn(Buffer.from(body));
      if (ev === 'end') fn();
      return this;
    },
  };
  const res = {
    writeHead() {
      return res;
    },
    end(t) {
      text = t ?? '';
    },
  };
  await route.handler(req, res);
  const parsed = JSON.parse(text);
  assert.equal(parsed.rpcId, 'q1');
  return parsed.result;
}

test('首次启动就把 ntfy 主题写进设置文件', async () => {
  const fresh = mkdtempSync(join(tmpdir(), 'dsh-alert-fresh-'));
  const ctx = makeCtx();
  ctx.dshHome = fresh;
  try {
    apply(ctx, {});

    const file = join(fresh, 'dsh-alert', 'settings.json');
    assert.ok(existsSync(file), '设置文件应该被创建');

    const saved = JSON.parse(readFileSync(file, 'utf8'));
    const ntfy = (saved.channels || []).find((c) => c.id === 'ntfy');
    assert.ok(ntfy, '应写入 ntfy 通道');
    assert.match(ntfy.config.topic, /^dsh-[0-9a-f]{4}$/);
  } finally {
    rmSync(fresh, { recursive: true, force: true });
  }
});

test('status 端点返回 ready 列表', async () => {
  const ctx = makeCtx();
  apply(ctx, {
    channels: [{ id: 'custom', enabled: true, config: { url: `${sinkUrl}/notify`, body: '{}' } }],
  });

  const res = await callRpc(ctx, 'status');
  assert.equal(res.ok, true);
  assert.ok(Array.isArray(res.value.ready), 'status 应带 ready');
  assert.ok(res.value.ready.includes('custom'), `custom 应算已配置，实际 ${res.value.ready.join(',')}`);
});

test('status 端点必须带 integrations（否则设置页的联动徽标永远不显示）', async () => {
  const ctx = makeCtx();
  apply(ctx, {});

  const res = await callRpc(ctx, 'status');
  assert.equal(res.ok, true);
  assert.ok(res.value.integrations, 'status 应带 integrations');
  assert.equal(typeof res.value.integrations, 'object');
  // 四个开关都得在，缺一个客户端就是 undefined 判断
  for (const key of ['costMeter', 'desktopNotify', 'claudeStyle', 'pocket', 'im']) {
    assert.equal(
      typeof res.value.integrations[key],
      'boolean',
      `integrations.${key} 应是布尔值`,
    );
  }
});

test('status 端点必须带解析后的主题', async () => {
  const ctx = makeCtx();
  apply(ctx, {});

  const res = await callRpc(ctx, 'status');
  assert.equal(res.ok, true);
  assert.ok(res.value.theme, 'status 应带 theme');
  assert.ok(
    res.value.theme.id === 'claude' || res.value.theme.id === 'deepseek',
    `theme.id 应是 claude 或 deepseek，实际 ${res.value.theme.id}`,
  );
  // 色卡要跟着一起下发，客户端才能直接渲染
  assert.ok(res.value.theme.accent, 'theme 应带 accent 色');
});

test('显式选了主题时 status 返回的就是那个主题', async () => {
  const ctx = makeCtx();
  apply(ctx, { theme: 'claude' });

  const res = await callRpc(ctx, 'status');
  assert.equal(res.value.theme.id, 'claude');

  const ctx2 = makeCtx();
  apply(ctx2, { theme: 'deepseek' });
  const res2 = await callRpc(ctx2, 'status');
  assert.equal(res2.value.theme.id, 'deepseek');
});

test('test 端点可以只测指定通道', async () => {
  const ctx = makeCtx();
  apply(ctx, {
    channels: [
      { id: 'custom', enabled: true, config: { url: `${sinkUrl}/ok`, body: '{}' } },
      { id: 'ntfy', enabled: true, config: { server: 'http://127.0.0.1:1', topic: 't' } },
    ],
  });

  const res = await callRpc(ctx, 'test', { channel: 'custom' });

  assert.equal(res.ok, true);
  assert.equal(res.value.results.length, 1, '只应测一个通道');
  assert.equal(res.value.results[0].channel, 'custom');
  assert.equal(res.value.results[0].ok, true);
});

test('save 返回更新后的 ready', async () => {
  const ctx = makeCtx();
  apply(ctx, {});

  const res = await callRpc(ctx, 'save', {
    settings: {
      channels: [{ id: 'custom', enabled: true, config: { url: `${sinkUrl}/notify`, body: '{}' } }],
    },
  });

  assert.equal(res.ok, true);
  assert.ok(Array.isArray(res.value.ready));
  assert.ok(res.value.ready.includes('custom'));
});
