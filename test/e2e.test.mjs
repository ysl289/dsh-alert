/**
 * 端到端联调：真的起一个 HTTP 服务器，真的走 fetch，验证整条链路。
 *
 * 跑法：node test/e2e.test.mjs
 * 它会在随机端口起服务，不占用 18080。
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { deliver } from '../lib/deliver.js';
import { normalizeConfig } from '../lib/channels/index.js';
import { custom } from '../lib/channels/custom.js';
import { ntfy } from '../lib/channels/ntfy.js';
import { render } from '../lib/render.js';

let server;
let baseUrl;
/** 收到的请求 */
const received = [];

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body });
      // /fail 用来测失败路径
      if (req.url === '/fail') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('端到端：custom 通道真的把消息发到了服务器', async () => {
  received.length = 0;

  const message = render({
    kind: 'completed',
    title: '端到端测试',
    excerpt: '这条是从插件发出来的',
    durationMs: 65_000,
  });

  const cfg = normalizeConfig(custom, {
    url: `${baseUrl}/notify`,
    body: '{"title":"{{title}}","body":"{{body}}"}',
  });

  const res = await deliver(message, [{ id: 'custom', enabled: true, config: cfg }], { retries: 0 });

  assert.equal(res.ok, true, '应该发送成功');
  assert.equal(received.length, 1, '服务器应该收到 1 条');

  const got = JSON.parse(received[0].body);
  assert.match(got.title, /端到端测试/);
  assert.match(got.body, /1 分 5 秒/);
  assert.match(got.body, /这条是从插件发出来的/);
});

test('端到端：ntfy 通道的请求形状正确', async () => {
  received.length = 0;

  const message = { title: 'DSH', body: '纯 ASCII 标题能进头' };
  const cfg = normalizeConfig(ntfy, { server: baseUrl, topic: 'dsh-e2e' });

  const res = await deliver(message, [{ id: 'ntfy', enabled: true, config: cfg }], { retries: 0 });
  assert.equal(res.ok, true);

  assert.equal(received[0].url, '/dsh-e2e');
  assert.equal(received[0].headers.title, 'DSH');
  assert.equal(received[0].body, '纯 ASCII 标题能进头');
});

test('端到端：服务器返回 500 时判失败并重试', async () => {
  received.length = 0;

  const cfg = normalizeConfig(custom, { url: `${baseUrl}/fail`, body: '{"t":"x"}' });
  const res = await deliver({ title: 't', body: 'b' }, [{ id: 'custom', enabled: true, config: cfg }], {
    retries: 2,
  });

  assert.equal(res.ok, false);
  assert.equal(received.length, 3, '首次 + 2 次重试');
});

test('端到端：多通道并发都送到', async () => {
  received.length = 0;

  const targets = [
    {
      id: 'custom',
      enabled: true,
      config: normalizeConfig(custom, { url: `${baseUrl}/a`, body: '{"src":"custom"}' }),
    },
    {
      id: 'ntfy',
      enabled: true,
      config: normalizeConfig(ntfy, { server: baseUrl, topic: 'b' }),
    },
  ];

  const res = await deliver({ title: 'x', body: 'y' }, targets, { retries: 0 });
  assert.equal(res.ok, true);
  assert.equal(received.length, 2);
  const urls = received.map((r) => r.url).sort();
  assert.deepEqual(urls, ['/a', '/b']);
});
