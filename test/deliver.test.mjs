import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deliver, Deduper } from '../lib/deliver.js';

const MSG = { title: '✅ 测试 · 任务完成', body: '跑完了' };

function okRes(body = {}) {
  return { status: 200, text: async () => JSON.stringify(body) };
}
function errRes(status = 500, body = {}) {
  return { status, text: async () => JSON.stringify(body) };
}

const ntfyTarget = (topic = 't1') => ({ id: 'ntfy', enabled: true, config: { topic } });

test('单通道成功', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return okRes();
  };
  const res = await deliver(MSG, [ntfyTarget()], { fetch: fetchImpl, retries: 0 });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /ntfy\.sh\/t1/);
});

test('没有启用通道时明确返回失败', async () => {
  const logs = [];
  const res = await deliver(MSG, [], { fetch: async () => okRes(), log: (e) => logs.push(e) });
  assert.equal(res.ok, false);
  assert.equal(res.results.length, 0);
  assert.ok(logs.some((l) => l.event === 'no-channel'));
});

test('禁用的通道被跳过', async () => {
  const res = await deliver(MSG, [{ id: 'ntfy', enabled: false, config: { topic: 't' } }], {
    fetch: async () => okRes(),
  });
  assert.equal(res.ok, false);
  assert.equal(res.results.length, 0);
});

test('未知通道 id 被跳过，不会崩', async () => {
  const res = await deliver(MSG, [{ id: '不存在的通道', enabled: true, config: {} }], {
    fetch: async () => okRes(),
  });
  assert.equal(res.ok, false);
});

test('多通道并发，一条成功即整体成功', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('ntfy')) return okRes();
    return errRes(500);
  };
  const res = await deliver(
    MSG,
    [ntfyTarget(), { id: 'bark', enabled: true, config: { key: 'K' } }],
    { fetch: fetchImpl, retries: 0 },
  );
  assert.equal(res.ok, true, '有一个成功就算成功');
  assert.equal(res.results.filter((r) => r.ok).length, 1);
  assert.equal(res.results.filter((r) => !r.ok).length, 1);
});

test('全部失败时整体失败', async () => {
  const res = await deliver(MSG, [ntfyTarget()], { fetch: async () => errRes(500), retries: 0 });
  assert.equal(res.ok, false);
});

test('失败会重试，次数符合配置', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return errRes(500);
  };
  await deliver(MSG, [ntfyTarget()], { fetch: fetchImpl, retries: 2 });
  assert.equal(calls, 3, '首次 + 2 次重试 = 3');
});

test('重试后成功', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls >= 2 ? okRes() : errRes(500);
  };
  const res = await deliver(MSG, [ntfyTarget()], { fetch: fetchImpl, retries: 2 });
  assert.equal(res.ok, true);
  assert.equal(calls, 2);
});

test('通道抛异常不会冒出来，只记失败', async () => {
  const fetchImpl = async () => {
    throw new Error('网络炸了');
  };
  const res = await deliver(MSG, [ntfyTarget()], { fetch: fetchImpl, retries: 0 });
  assert.equal(res.ok, false);
  assert.match(res.results[0].error, /网络炸了/);
});

test('通道配置缺失（没填 topic）判失败但不崩', async () => {
  const res = await deliver(MSG, [{ id: 'ntfy', enabled: true, config: {} }], {
    fetch: async () => okRes(),
    retries: 0,
  });
  assert.equal(res.ok, false);
  assert.match(res.results[0].error, /主题名没填/);
});

test('超时会中断请求', async () => {
  const fetchImpl = async (url, init) => {
    // 永不返回，等 abort
    return new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  };
  const started = Date.now();
  const res = await deliver(MSG, [ntfyTarget()], { fetch: fetchImpl, timeoutMs: 50, retries: 0 });
  assert.equal(res.ok, false);
  assert.ok(Date.now() - started < 2000, '应该在超时后很快返回');
});

test('企业微信通道走 prepare + build 两段', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes('gettoken')) return okRes({ errcode: 0, access_token: 'AT', expires_in: 7200 });
    return okRes({ errcode: 0 });
  };
  const res = await deliver(
    MSG,
    [{ id: 'wecom-app', enabled: true, config: { corpId: 'ww', secret: 's', agentId: '1' } }],
    { fetch: fetchImpl, retries: 0 },
  );
  assert.equal(res.ok, true);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /gettoken/);
  assert.match(urls[1], /message\/send/);
});

// ── 去重 ──

test('Deduper 首次返回 true，重复返回 false', () => {
  const d = new Deduper();
  assert.equal(d.firstTime('a'), true);
  assert.equal(d.firstTime('a'), false);
  assert.equal(d.firstTime('b'), true);
});

test('Deduper 超过上限后淘汰最旧的', () => {
  const d = new Deduper(2);
  d.firstTime('a');
  d.firstTime('b');
  d.firstTime('c'); // 挤掉 a
  assert.equal(d.firstTime('a'), true, 'a 已被淘汰，应重新算首次');
});

test('Deduper clear 清空', () => {
  const d = new Deduper();
  d.firstTime('a');
  d.clear();
  assert.equal(d.firstTime('a'), true);
});
