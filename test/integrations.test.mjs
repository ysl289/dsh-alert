/**
 * 联动层测试。
 *
 * 这一层最容易出的事故是「宿主没装那个插件，我们自己去访问它的服务，
 * Cordis 的 Proxy 直接抛异常，整个插件激活失败」。
 * 所以重点测：没有服务时全部安静降级，绝不抛错。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  readCost,
  formatCost,
  hasDesktopNotify,
  hasClaudeStyle,
  hasPocket,
  readPocketConfig,
  pocketBaseUrl,
  detectIntegrations,
} from '../lib/integrations.js';

/**
 * 造一个「真 Proxy」ctx —— 访问任何没 inject 的服务都抛。
 * 这是 Cordis 4.x 的实际行为，用普通对象测不出来。
 */
function strictCtx(services = {}) {
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key === 'symbol') return undefined;
        if (key in services) return services[key];
        throw new Error(`cannot get required service ${key}`);
      },
      has(_target, key) {
        return key in services;
      },
    },
  );
}

// ── 空 ctx：什么都没装 ──

test('什么服务都没有时，detectIntegrations 不抛错且全 false', () => {
  const result = detectIntegrations(strictCtx());
  assert.deepEqual(result, {
    costMeter: false,
    desktopNotify: false,
    claudeStyle: false,
    pocket: false,
    pocketUrl: null,
    im: false,
  });
});

test('什么服务都没有时，readCost 返回 null', async () => {
  assert.equal(await readCost(strictCtx()), null);
});

test('什么服务都没有时，hasDesktopNotify / hasClaudeStyle 返回 false', () => {
  assert.equal(hasDesktopNotify(strictCtx()), false);
  assert.equal(hasClaudeStyle(strictCtx()), false);
});

test('ctx 是 null 或 undefined 时也不抛错', () => {
  assert.equal(readCost.length, 1); // 只是确认签名没被改
  assert.doesNotThrow(() => detectIntegrations(null));
  assert.doesNotThrow(() => detectIntegrations(undefined));
  assert.deepEqual(detectIntegrations(null), {
    costMeter: false,
    desktopNotify: false,
    claudeStyle: false,
    pocket: false,
    pocketUrl: null,
    im: false,
  });
});

// ── dsh-cost-meter ──

test('costMeter 可用性要通过 opts 传进来（不能直接读 ctx）', () => {
  // 服务挂在 ctx 上但没通过 opts 传 → 应报 false，说明没走「读 ctx」那条会抛的路
  const ctx = strictCtx({ costMeter: { getState: () => ({}) } });
  assert.equal(detectIntegrations(ctx).costMeter, false);
  assert.equal(detectIntegrations(ctx, { costAvailable: true }).costMeter, true);
});

test('costMeter.getState 抛错时 readCost 返回 null，不传染', async () => {
  const svc = {
    getState: () => {
      throw new Error('boom');
    },
  };
  assert.equal(await readCost(svc), null);
});

test('costMeter 返回 undefined 时 readCost 返回 null', async () => {
  assert.equal(await readCost({ getState: () => undefined }), null);
});

test('costMeter 返回非对象时 readCost 返回 null', async () => {
  assert.equal(await readCost({ getState: () => 42 }), null);
});

test('没有 getState 方法时 readCost 返回 null', async () => {
  assert.equal(await readCost({}), null);
});

test('读到 today.cost 时返回金额与币种', async () => {
  const svc = { getState: () => ({ today: { cost: 0.32 } }) };
  assert.deepEqual(await readCost(svc), { amount: 0.32, currency: 'CNY', balance: undefined });
});

test('兼容 today.totalCost 字段', async () => {
  const cost = await readCost({ getState: () => ({ today: { totalCost: 1.5 } }) });
  assert.equal(cost.amount, 1.5);
});

test('兼容 state.todayCost 字段', async () => {
  const cost = await readCost({ getState: () => ({ todayCost: 2.25 }) });
  assert.equal(cost.amount, 2.25);
});

test('兼容 state.current.cost 字段', async () => {
  const cost = await readCost({ getState: () => ({ current: { cost: 0.07 } }) });
  assert.equal(cost.amount, 0.07);
});

test('带余额时一并取出', async () => {
  const svc = {
    getState: () => ({ today: { cost: 0.5 }, balance: { remaining: 88.8 } }),
  };
  const cost = await readCost(svc);
  assert.equal(cost.balance, 88.8);
});

test('金额不是数字时返回 null（避免 NaN 写进提醒）', async () => {
  const svc = { getState: () => ({ today: { cost: '0.32' } }) };
  assert.equal(await readCost(svc), null);
});

// ── formatCost ──

test('formatCost 人民币', () => {
  assert.equal(formatCost({ amount: 0.32, currency: 'CNY' }), '本轮花费 ¥0.32');
});

test('formatCost 美元', () => {
  assert.equal(formatCost({ amount: 1.5, currency: 'USD' }), '本轮花费 $1.50');
});

test('formatCost 不足一分显示 <0.01', () => {
  assert.equal(formatCost({ amount: 0.004, currency: 'CNY' }), '本轮花费 ¥<0.01');
});

test('formatCost 没有成本时返回空串', () => {
  assert.equal(formatCost(null), '');
  assert.equal(formatCost(undefined), '');
});

// ── 通过 loader.entries() 探测 ──

test('loader 里有 dsh-notify-windows 时认出来', () => {
  const ctx = strictCtx({
    loader: { entries: () => [{ options: { name: 'dsh-notify-windows' } }] },
  });
  assert.equal(hasDesktopNotify(ctx), true);
});

test('loader 里有 dsh-notify 也认', () => {
  const ctx = strictCtx({
    loader: { entries: () => [{ options: { name: 'dsh-notify' } }] },
  });
  assert.equal(hasDesktopNotify(ctx), true);
});

test('loader 里没有通知插件时返回 false', () => {
  const ctx = strictCtx({
    loader: { entries: () => [{ options: { name: 'dsh-cost-meter' } }] },
  });
  assert.equal(hasDesktopNotify(ctx), false);
});

test('loader 里有 dsh-claude-style 时认出来', () => {
  const ctx = strictCtx({
    loader: { entries: () => [{ options: { name: 'dsh-claude-style' } }] },
  });
  assert.equal(hasClaudeStyle(ctx), true);
});

test('loader.entries 抛错时安静返回 false', () => {
  const ctx = strictCtx({
    loader: {
      entries: () => {
        throw new Error('loader 挂了');
      },
    },
  });
  assert.equal(hasDesktopNotify(ctx), false);
  assert.equal(hasClaudeStyle(ctx), false);
});

test('loader.entries 返回非数组时安静返回 false', () => {
  const ctx = strictCtx({ loader: { entries: () => null } });
  assert.equal(hasDesktopNotify(ctx), false);
  assert.equal(hasClaudeStyle(ctx), false);
});

test('entries 里缺 options 的条目不会炸', () => {
  const ctx = strictCtx({ loader: { entries: () => [{}, null, { options: null }] } });
  assert.equal(hasDesktopNotify(ctx), false);
  assert.equal(hasClaudeStyle(ctx), false);
});

// ── dsh-im ──

test('dshIm 可用性要通过 opts 传进来（不能直接读 ctx）', () => {
  const ctx = strictCtx({ dshIm: { send: () => {} } });
  assert.equal(detectIntegrations(ctx).im, false);
  assert.equal(detectIntegrations(ctx, { imAvailable: true }).im, true);
});

test('全装齐时四项都是 true', () => {
  const ctx = strictCtx({
    loader: {
      entries: () => [
        { options: { name: 'dsh-notify-windows' } },
        { options: { name: 'dsh-claude-style' } },
      ],
    },
  });
  // 服务类联动靠 inject 探测后传进来；loader 类直接读 ctx
  const result = detectIntegrations(ctx, { costAvailable: true, imAvailable: true });
  assert.equal(result.costMeter, true);
  assert.equal(result.desktopNotify, true);
  assert.equal(result.claudeStyle, true);
  assert.equal(result.im, true);
});

// ── dsh-pocket ──

test('loader 里有 dsh-pocket 时认出来', () => {
  const ctx = strictCtx({
    loader: { entries: () => [{ options: { name: 'dsh-pocket' } }] },
  });
  assert.equal(hasPocket(ctx), true);
});

test('没装 dsh-pocket 时 hasPocket 返回 false', () => {
  const ctx = strictCtx({
    loader: { entries: () => [{ options: { name: 'dsh-cost-meter' } }] },
  });
  assert.equal(hasPocket(ctx), false);
});

test('loader 抛错时 hasPocket 安静返回 false', () => {
  const ctx = strictCtx({
    loader: {
      entries: () => {
        throw new Error('boom');
      },
    },
  });
  assert.equal(hasPocket(ctx), false);
});

test('没装 dsh-pocket 时 pocketUrl 是 null（不会瞎猜地址）', () => {
  const ctx = strictCtx({ loader: { entries: () => [] } });
  assert.equal(detectIntegrations(ctx).pocketUrl, null);
});

test('readPocketConfig 在文件不存在时返回 null', () => {
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = 'C:\\definitely-not-a-real-dir-dsh-alert-test';
  try {
    assert.equal(readPocketConfig(), null);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
  }
});

test('pocketBaseUrl 在没配置时返回 null', () => {
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = 'C:\\definitely-not-a-real-dir-dsh-alert-test';
  try {
    assert.equal(pocketBaseUrl(), null);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
  }
});
