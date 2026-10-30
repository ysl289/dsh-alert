/**
 * Server酱 端点拼接测试。
 *
 * 背景（这是上线后才发现的真 bug）：
 *   Server酱有两代服务，端点完全不同。
 *   老版 Turbo（SCT 开头）：https://sctapi.ftqq.com/<key>.send
 *   Server酱³（sctp 开头）：https://<uid>.push.ft07.com/send/<key>.send
 *
 *   之前代码写成 https://push.ft07.com/<key>.send —— 缺了 uid 子域、
 *   路径也少一段，结果 sctp 格式的 key 一律返回 522（Cloudflare 报错）。
 *   实测：修好后同样端点返回 {"error":"sendkey not found"}，说明地址对了。
 *
 * 官方文档：https://doc.ft07.com/zh/serverchan3/server/api
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { serverchan, buildUrl, uidFromSctpKey } from '../lib/channels/serverchan.js';

// ── uid 提取 ──

test('从 sctp key 里能提取 uid', () => {
  assert.equal(uidFromSctpKey('sctp1234tABCDEF'), '1234');
  assert.equal(uidFromSctpKey('sctp98765tabcdef'), '98765');
  assert.equal(uidFromSctpKey('  sctp42tXXX  '), '42', '要能容忍前后空格');
});

test('SCT 老格式提取不出 uid', () => {
  assert.equal(uidFromSctpKey('SCT123456Txxxx'), null);
  assert.equal(uidFromSctpKey('sct_123'), null);
});

test('畸形输入返回 null，不抛错', () => {
  assert.equal(uidFromSctpKey(''), null);
  assert.equal(uidFromSctpKey(null), null);
  assert.equal(uidFromSctpKey(undefined), null);
  assert.equal(uidFromSctpKey('sctpNOUIDhere'), null);
});

// ── URL 拼接 ──

test('老版 Turbo 用 sctapi.ftqq.com/<key>.send', () => {
  const url = buildUrl('SCT123456Tabcdefg');
  assert.equal(url, 'https://sctapi.ftqq.com/SCT123456Tabcdefg.send');
});

test('Server酱³ 用 <uid>.push.ft07.com/send/<key>.send', () => {
  const url = buildUrl('sctp1234tABCDEFG');
  assert.equal(url, 'https://1234.push.ft07.com/send/sctp1234tABCDEFG.send');
});

test('Server酱³ 的 URL 必须含 uid 子域（这是之前的 bug）', () => {
  const url = buildUrl('sctp777tXXXX');
  assert.match(url, /^https:\/\/777\.push\.ft07\.com\/send\//, 'uid 必须出现在子域');
  assert.ok(
    !/^https:\/\/push\.ft07\.com/.test(url),
    '不能是不带 uid 的裸域名 —— 那样会返回 522',
  );
  assert.match(url, /\/send\//, '路径里必须有 /send/ 这一段');
});

test('空 key 抛错', () => {
  assert.throws(() => buildUrl(''), /没填/);
  assert.throws(() => buildUrl(null), /没填/);
});

test('sctp 但取不出 uid 时给出可操作的报错', () => {
  assert.throws(
    () => buildUrl('sctpNOUID'),
    (err) => {
      assert.match(err.message, /sctp/);
      assert.match(err.message, /完整|复制/, '要告诉用户去哪里重新拿 key');
      return true;
    },
  );
});

// ── build() 端到端 ──

test('build 返回的请求体带 title 和 desp', () => {
  const req = serverchan.build(
    { title: '任务完成', body: '跑完了' },
    { sendKey: 'SCT123456Tabc' },
  );
  assert.equal(req.method, 'POST');
  assert.match(req.headers['Content-Type'], /x-www-form-urlencoded/);
  const params = new URLSearchParams(req.body);
  assert.equal(params.get('title'), '任务完成');
  assert.equal(params.get('desp'), '跑完了');
});

test('有 url 时把链接拼进正文（markdown 形式）', () => {
  const req = serverchan.build(
    { title: 'T', body: 'B', url: 'http://x/y' },
    { sendKey: 'SCT1T2' },
  );
  const desp = new URLSearchParams(req.body).get('desp');
  assert.match(desp, /\[打开会话\]\(http:\/\/x\/y\)/);
});

test('build 对 sctp key 也走新端点', () => {
  const req = serverchan.build({ title: 'T', body: 'B' }, { sendKey: 'sctp55tZZZ' });
  assert.match(req.url, /^https:\/\/55\.push\.ft07\.com\/send\/sctp55tZZZ\.send$/);
});

// ── 响应判定 ──

test('2xx 且 code=0 算成功', () => {
  assert.equal(serverchan.check({ status: 200 }, { code: 0 }).ok, true);
});

test('业务 code 非 0 判失败并带上服务端消息', () => {
  const r = serverchan.check({ status: 200 }, { code: 10003, message: 'sendkey not found' });
  assert.equal(r.ok, false);
  assert.match(r.detail, /10003/);
  assert.match(r.detail, /sendkey not found/);
});

test('522 的报错要提示多半是 uid 拼错', () => {
  const r = serverchan.check({ status: 522 }, null);
  assert.equal(r.ok, false);
  assert.match(r.detail, /522/);
  assert.match(r.detail, /uid|sctp/, '要提示检查 key 格式');
});

test('非 JSON 响应判失败', () => {
  const r = serverchan.check({ status: 200 }, null);
  assert.equal(r.ok, false);
  assert.match(r.detail, /JSON/i);
});
