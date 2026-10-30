/**
 * IM 通道测试（可选通道，复用已装的 @xmanrui/dsh-im）。
 *
 * 两条底线：
 *   1. 没装 dsh-im 时插件照常工作，只是这个通道不可用
 *   2. 装了时能列出机器人/目标，并能真的投递
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hasDshIm, listBots, listTargets, send } from '../lib/im-bridge.js';
import { deliver } from '../lib/deliver.js';
import { apply } from '../lib/index.js';
import { normalizeConfig } from '../lib/channels/index.js';
import { custom } from '../lib/channels/custom.js';

let homeDir;
let sink;
let sinkUrl;

before(async () => {
  homeDir = mkdtempSync(join(tmpdir(), 'dsh-alert-im-'));
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

/** 造一个假的 dsh-im 服务。 */
function fakeIm(opts = {}) {
  const sent = [];
  return {
    sent,
    async listBots() {
      if (opts.listBotsFails) throw new Error('boom');
      return opts.bots ?? [{ botId: 'bot_111', channel: 'feishu' }];
    },
    async listTargets(botId) {
      if (opts.listTargetsFails) throw new Error('boom');
      return (opts.targets ?? {})[botId] ?? [{ targetId: 'release-alerts', name: '发布提醒', kind: 'group' }];
    },
    async send(botId, targetId, text, options) {
      sent.push({ botId, targetId, text, options });
      if (opts.sendFails) return { sent: false, reason: 'target-not-found' };
      return { sent: true };
    },
  };
}

// ── 检测 ──

test('hasDshIm：没有 ctx.dshIm 时返回 false', () => {
  assert.equal(hasDshIm({}), false);
  assert.equal(hasDshIm(null), false);
  assert.equal(hasDshIm({ dshIm: {} }), false, '没有 send 方法不算');
});

test('hasDshIm：有 send 时返回 true', () => {
  assert.equal(hasDshIm({ dshIm: fakeIm() }), true);
});

// ── 列表 ──

test('listBots 正常返回', async () => {
  const ctx = { dshIm: fakeIm() };
  const bots = await listBots(ctx);
  assert.equal(bots.length, 1);
  assert.equal(bots[0].botId, 'bot_111');
});

test('listBots 失败时返回空数组（不抛）', async () => {
  const ctx = { dshIm: fakeIm({ listBotsFails: true }) };
  const bots = await listBots(ctx);
  assert.deepEqual(bots, []);
});

test('listTargets 正常返回', async () => {
  const ctx = { dshIm: fakeIm() };
  const targets = await listTargets(ctx, 'bot_111');
  assert.equal(targets.length, 1);
  assert.equal(targets[0].targetId, 'release-alerts');
});

test('listTargets 失败时返回空数组', async () => {
  const ctx = { dshIm: fakeIm({ listTargetsFails: true }) };
  assert.deepEqual(await listTargets(ctx, 'bot_111'), []);
});

// ── 发送 ──

test('send 成功时返回 ok', async () => {
  const im = fakeIm();
  const ctx = { dshIm: im };
  const res = await send(ctx, { botId: 'bot_111', targetId: 'release-alerts' }, { title: 'T', body: 'B' });

  assert.equal(res.ok, true);
  assert.equal(im.sent.length, 1);
  assert.equal(im.sent[0].botId, 'bot_111');
  assert.equal(im.sent[0].targetId, 'release-alerts');
  assert.match(im.sent[0].text, /T/);
  assert.match(im.sent[0].text, /B/);
  assert.equal(im.sent[0].options.format, 'plain');
});

test('send 缺参数时给出明确原因', async () => {
  const ctx = { dshIm: fakeIm() };

  assert.match((await send(ctx, {}, { title: 'T', body: 'B' })).detail, /没选机器人/);
  assert.match((await send(ctx, { botId: 'b' }, { title: 'T', body: 'B' })).detail, /没选投递目标/);
});

test('没装 dsh-im 时 send 返回明确原因', async () => {
  const res = await send({}, { botId: 'b', targetId: 't' }, { title: 'T', body: 'B' });
  assert.equal(res.ok, false);
  assert.match(res.detail, /没装 IM 插件/);
});

test('send 业务失败时透传原因', async () => {
  const ctx = { dshIm: fakeIm({ sendFails: true }) };
  const res = await send(ctx, { botId: 'b', targetId: 't' }, { title: 'T', body: 'B' });
  assert.equal(res.ok, false);
  assert.match(res.detail, /target-not-found/);
});

test('send 抛异常时不冒出来', async () => {
  const ctx = {
    dshIm: {
      async send() {
        throw new Error('网络炸了');
      },
    },
  };
  const res = await send(ctx, { botId: 'b', targetId: 't' }, { title: 'T', body: 'B' });
  assert.equal(res.ok, false);
  assert.match(res.detail, /网络炸了/);
});

// ── deliver 集成 ──

test('deliver 能走 IM 通道', async () => {
  const im = fakeIm();
  const res = await deliver(
    { title: 'T', body: 'B' },
    [{ id: 'im', enabled: true, config: { botId: 'bot_111', targetId: 'release-alerts' } }],
    { imSend: (cfg, msg) => send({ dshIm: im }, cfg, msg) },
  );

  assert.equal(res.ok, true);
  assert.equal(res.results[0].channel, 'im');
  assert.equal(im.sent.length, 1);
});

test('deliver 没传 imSend 时忽略 IM 通道', async () => {
  const res = await deliver(
    { title: 'T', body: 'B' },
    [{ id: 'im', enabled: true, config: { botId: 'b', targetId: 't' } }],
    {},
  );
  assert.equal(res.ok, false);
  assert.equal(res.results.length, 0);
});

test('deliver 可以 HTTP + IM 混发', async () => {
  const im = fakeIm();
  const res = await deliver(
    { title: 'T', body: 'B' },
    [
      { id: 'custom', enabled: true, config: normalizeConfig(custom, { url: `${sinkUrl}/n`, body: '{}' }) },
      { id: 'im', enabled: true, config: { botId: 'bot_111', targetId: 'release-alerts' } },
    ],
    { imSend: (cfg, msg) => send({ dshIm: im }, cfg, msg), retries: 0 },
  );

  assert.equal(res.ok, true);
  assert.equal(res.results.length, 2);
  assert.equal(im.sent.length, 1);
});

// ── 插件集成 ──

function makeCtx(extra = {}) {
  const routes = [];
  return {
    dshHome: homeDir,
    on() {},
    logger: { info() {}, warn() {}, error() {} },
    webServer: {
      register(route) {
        routes.push(route);
        return () => {};
      },
    },
    connection: { requestRejection: () => undefined },
    inject(deps, cb) {
      return cb(this);
    },
    routes,
    ...extra,
  };
}

async function callRpc(ctx, endpoint, payload = {}) {
  const route = ctx.routes[0];
  const body = JSON.stringify({ type: 'client-request', rpcId: 'i1', method: endpoint, payload });
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
  return JSON.parse(text).result;
}

test('没装 dsh-im 时 status 仍报告 im.installed=false', async () => {
  const ctx = makeCtx();
  apply(ctx, {});
  const res = await callRpc(ctx, 'status');

  assert.equal(res.ok, true);
  assert.ok(res.value.im, 'status 必须带 im 字段');
  assert.equal(res.value.im.installed, false, '没装要如实报告');
  assert.deepEqual(res.value.im.bots, []);
});

test('装了 dsh-im 时 status 返回机器人和目标', async () => {
  const im = fakeIm({
    bots: [{ botId: 'bot_111', channel: 'feishu' }],
    targets: { bot_111: [{ targetId: 'release-alerts', name: '发布提醒', kind: 'group' }] },
  });
  const ctx = makeCtx({ dshIm: im });
  apply(ctx, {});
  const res = await callRpc(ctx, 'status');

  assert.equal(res.value.im.installed, true);
  assert.equal(res.value.im.bots.length, 1);
  assert.equal(res.value.im.targets.bot_111.length, 1);
});

test('IM 通道能出现在 ready 里', async () => {
  const ctx = makeCtx({ dshIm: fakeIm() });
  apply(ctx, {
    channels: [{ id: 'im', enabled: true, config: { botId: 'bot_111', targetId: 'release-alerts' } }],
  });
  const res = await callRpc(ctx, 'status');
  assert.ok(res.value.ready.includes('im'), `IM 应在 ready 里，实际 ${res.value.ready.join(',')}`);
});

test('没装 dsh-im 时 IM 通道不算 ready', async () => {
  const ctx = makeCtx();
  apply(ctx, {
    channels: [{ id: 'im', enabled: true, config: { botId: 'b', targetId: 't' } }],
  });
  const res = await callRpc(ctx, 'status');
  assert.ok(!res.value.ready.includes('im'), '没装不该算已配置');
});

test('IM 通道能真的发出测试消息', async () => {
  const im = fakeIm();
  const ctx = makeCtx({ dshIm: im });
  apply(ctx, {
    channels: [{ id: 'im', enabled: true, config: { botId: 'bot_111', targetId: 'release-alerts' } }],
  });

  const res = await callRpc(ctx, 'test', { channel: 'im' });
  assert.equal(res.ok, true);
  assert.equal(res.value.ok, true);
  assert.equal(im.sent.length, 1);
});
