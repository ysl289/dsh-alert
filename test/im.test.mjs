/**
 * IM 通道测试（可选通道，复用已装的 @xmanrui/dsh-im）。
 *
 * 三条底线：
 *   1. 没装 dsh-im 时插件照常工作，只是这个通道不可用
 *   2. 装了时能列出机器人/目标，并能真的投递
 *   3. **服务必须通过运行时 inject 拿到** —— 直接读 ctx.dshIm 在真实 Cordis 下会抛
 *
 * 关于第 3 点（这是踩过的真坑）：
 *
 *     ctx.dshIm                                        // ❌ throws without inject
 *     ctx.inject(['dshIm'], scoped => scoped.dshIm)    // ✅ 唯一可行
 *
 * 之前桥接层用 try/catch 吞掉那个异常 → 永远认为「没装」，
 * 用户明明装好了，界面还在让他装、发送测试必然失败。
 * 所以现在的单元测试按「服务对象」喂参，不再 mock 一个 ctx.dshIm 骗自己。
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hasIm, isImService, listBots, listTargets, send } from '../lib/im-bridge.js';
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

/** 造一个假的 dsh-im 服务（形状与真实 listBots/listTargets/send 一致）。 */
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

test('isImService：有 send 方法才算', () => {
  assert.equal(isImService(fakeIm()), true);
  assert.equal(isImService({}), false, '没有 send 不算');
  assert.equal(isImService(null), false);
  assert.equal(isImService(undefined), false);
});

test('hasIm：没服务时返回 false', () => {
  assert.equal(hasIm(null), false);
  assert.equal(hasIm(undefined), false);
  assert.equal(hasIm({}), false);
});

test('hasIm：有服务时返回 true', () => {
  assert.equal(hasIm(fakeIm()), true);
});

test('hasIm：接受取服务的函数（服务稍后才就绪）', () => {
  let svc = null;
  const get = () => svc;
  assert.equal(hasIm(get), false, '未就绪时 false');
  svc = fakeIm();
  assert.equal(hasIm(get), true, '就绪后变 true —— 这正是运行时 inject 的场景');
});

test('hasIm：取服务的函数抛错时返回 false，不崩', () => {
  assert.equal(hasIm(() => { throw new Error('nope'); }), false);
});

// ── 列表 ──

test('listBots 正常返回', async () => {
  const bots = await listBots(fakeIm());
  assert.equal(bots.length, 1);
  assert.equal(bots[0].botId, 'bot_111');
  assert.equal(bots[0].channel, 'feishu');
});

test('listBots 失败时返回空数组（不抛）', async () => {
  assert.deepEqual(await listBots(fakeIm({ listBotsFails: true })), []);
});

test('listBots 没有服务时返回空数组', async () => {
  assert.deepEqual(await listBots(null), []);
});

test('listBots 兼容字符串数组形态', async () => {
  const svc = { async send() { return { sent: true }; }, async listBots() { return ['a', 'b']; } };
  const bots = await listBots(svc);
  assert.deepEqual(bots.map((b) => b.botId), ['a', 'b']);
});

test('listTargets 正常返回', async () => {
  const targets = await listTargets(fakeIm(), 'bot_111');
  assert.equal(targets.length, 1);
  assert.equal(targets[0].targetId, 'release-alerts');
});

test('listTargets 失败时返回空数组', async () => {
  assert.deepEqual(await listTargets(fakeIm({ listTargetsFails: true }), 'bot_111'), []);
});

test('listTargets 空 botId 不触发调用', async () => {
  let called = false;
  const svc = { async listTargets() { called = true; return []; } };
  assert.deepEqual(await listTargets(svc, ''), []);
  assert.equal(called, false);
});

test('listTargets 兼容 { targets: [...] } 包装', async () => {
  const svc = {
    async send() { return { sent: true }; },
    async listTargets() { return { targets: [{ targetId: 'wrapped' }] }; },
  };
  const targets = await listTargets(svc, 'bot_111');
  assert.deepEqual(targets.map((t) => t.targetId), ['wrapped']);
});

// ── 发送 ──

test('send 成功时返回 ok', async () => {
  const im = fakeIm();
  const res = await send(im, { botId: 'bot_111', targetId: 'release-alerts' }, { title: 'T', body: 'B' });

  assert.equal(res.ok, true);
  assert.equal(im.sent.length, 1);
  assert.equal(im.sent[0].botId, 'bot_111');
  assert.equal(im.sent[0].targetId, 'release-alerts');
  assert.match(im.sent[0].text, /T/);
  assert.match(im.sent[0].text, /B/);
  assert.equal(im.sent[0].options.format, 'plain', '用 plain 最兼容各平台');
});

test('send 把 url 拼进正文', async () => {
  const im = fakeIm();
  await send(im, { botId: 'b', targetId: 't' }, { title: 'T', body: 'B', url: 'http://x/y' });
  assert.match(im.sent[0].text, /\[打开会话\]\(http:\/\/x\/y\)/);
});

test('send 缺参数时给出明确原因', async () => {
  const im = fakeIm();
  assert.match((await send(im, {}, { title: 'T', body: 'B' })).detail, /没选机器人/);
  assert.match((await send(im, { botId: 'b' }, { title: 'T', body: 'B' })).detail, /没选目标/);
});

test('没装 dsh-im 时 send 返回明确原因', async () => {
  const res = await send(null, { botId: 'b', targetId: 't' }, { title: 'T', body: 'B' });
  assert.equal(res.ok, false);
  assert.match(res.detail, /没检测到 dsh-im/);
});

test('send 业务失败时透传原因', async () => {
  const res = await send(fakeIm({ sendFails: true }), { botId: 'b', targetId: 't' }, { title: 'T', body: 'B' });
  assert.equal(res.ok, false);
  assert.match(res.detail, /target-not-found/);
});

test('send 抛异常时不冒出来', async () => {
  const svc = {
    async send() {
      throw new Error('网络炸了');
    },
  };
  const res = await send(svc, { botId: 'b', targetId: 't' }, { title: 'T', body: 'B' });
  assert.equal(res.ok, false);
  assert.match(res.detail, /网络炸了/);
});

test('send 把错误的 code 带出来', async () => {
  const svc = {
    async send() {
      const e = new Error('delivery failed');
      e.code = 'unknown-target';
      throw e;
    },
  };
  const res = await send(svc, { botId: 'b', targetId: 't' }, { title: 'T', body: 'B' });
  assert.match(res.detail, /unknown-target/);
});

// ── deliver 集成 ──

test('deliver 能走 IM 通道', async () => {
  const im = fakeIm();
  const res = await deliver(
    { title: 'T', body: 'B' },
    [{ id: 'im', enabled: true, config: { botId: 'bot_111', targetId: 'release-alerts' } }],
    { imSend: (cfg, msg) => send(im, cfg, msg) },
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
    { imSend: (cfg, msg) => send(im, cfg, msg), retries: 0 },
  );

  assert.equal(res.ok, true);
  assert.equal(res.results.length, 2);
  assert.equal(im.sent.length, 1);
});

// ── 插件集成 ──

/**
 * 造一个尽量贴近真实 Cordis 的 ctx。
 *
 * 关键：inject 会像真实宿主那样把「被依赖的服务」放到 scoped ctx 上。
 * 也就是说组件只能通过 inject 拿到 dshIm，直接 ctx.dshIm 拿不到 ——
 * 正好用来验证我们确实走了 inject 这条路。
 */
function makeCtx(services = {}) {
  const routes = [];
  const webServer = {
    register(route) {
      routes.push(route);
      return () => {};
    },
  };
  const connection = { requestRejection: () => undefined };

  // 真实宿主里这些服务都已就绪；inject 时按依赖名分发
  const provided = {
    webServer,
    connection,
    dshIm: services.dshIm,
    costMeter: services.costMeter,
  };

  const ctx = {
    dshHome: homeDir,
    on() {},
    logger: { info() {}, warn() {}, error() {} },
    webServer,
    connection,
    inject(deps, cb) {
      // 真实 Cordis：只有声明过的依赖才出现在 scoped ctx 上；
      // 没声明的（包括 dshIm）在 scoped 上读不到。
      const scoped = {};
      for (const dep of deps) {
        if (provided[dep] !== undefined) scoped[dep] = provided[dep];
      }
      scoped.inject = () => () => {};
      try {
        const disposer = cb(scoped);
        return typeof disposer === 'function' ? disposer : () => {};
      } catch {
        return () => {};
      }
    },
    routes,
  };
  // 故意不把 dshIm 挂在 ctx 外层：
  // 真实 Cordis 下 ctx.dshIm 会抛，插件必须走 inject 才拿得到。
  return ctx;
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
  // 通过 inject 提供 —— 和真实宿主一样，只有 inject 才拿得到
  const ctx = makeCtx({ dshIm: im });
  apply(ctx, {});
  const res = await callRpc(ctx, 'status');

  assert.equal(res.value.im.installed, true, 'inject 拿到的服务应被认出来');
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
