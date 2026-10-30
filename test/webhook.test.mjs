/**
 * Webhook 三家平台的格式与错误判定测试。
 *
 * 错误码来源（实测，2026-10）：
 *   钉钉 token 无效    300005  "token is not exist"
 *   飞书 token 无效    19001   "incoming webhook access token invalid"
 *   企微群地址无效     93000   "invalid webhook url"
 *
 * 关键词/加签相关（310000 / 19021）需要真实 token 才能触发，
 * 本次未实测，按社区资料写测试，标注为「未实测」。
 *
 * 三家消息格式不同，这是最容易出错的地方：
 *   钉钉/企微群  { "msgtype": "text", "text": { "content": ... } }
 *   飞书         { "msg_type": "text", "content": { "text": ... } }   ← 注意下划线
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { webhook, WEBHOOK_PRESETS } from '../lib/channels/webhook.js';

const MSG = { title: 'DSH 任务完成', body: '跑完了', url: 'http://x/y' };

/** 取预设模板生成的 body（先 normalize 再 build）。 */
function bodyFor(preset) {
  const cfg = webhook.normalize({ url: 'https://example.com/hook', preset, template: '' });
  const req = webhook.build(MSG, cfg);
  return { req, json: JSON.parse(req.body) };
}

// ── 消息格式 ──

test('钉钉用 msgtype + text.content', () => {
  const { json } = bodyFor('dingtalk');
  assert.equal(json.msgtype, 'text');
  assert.equal(typeof json.text.content, 'string');
  assert.match(json.text.content, /DSH 任务完成/);
});

test('企微群也用 msgtype + text.content', () => {
  const { json } = bodyFor('wecom');
  assert.equal(json.msgtype, 'text');
  assert.equal(typeof json.text.content, 'string');
});

test('飞书用 msg_type + content.text（下划线不一样）', () => {
  const { json } = bodyFor('feishu');
  assert.equal(json.msg_type, 'text', '飞书是 msg_type，不是 msgtype');
  assert.equal(typeof json.content.text, 'string');
  assert.equal(json.msgtype, undefined, '飞书不该出现 msgtype');
  assert.equal(json.text, undefined, '飞书不该出现 text');
});

test('钉钉和飞书的 key 不能混用（这是最常见的手误）', () => {
  const ding = bodyFor('dingtalk').json;
  const fei = bodyFor('feishu').json;
  // 互相不该有对方的字段
  assert.equal(ding.msg_type, undefined);
  assert.equal(fei.msgtype, undefined);
});

test('所有预设模板生成的 body 都是合法 JSON', () => {
  for (const preset of Object.keys(WEBHOOK_PRESETS)) {
    const { json } = bodyFor(preset);
    assert.equal(typeof json, 'object', `${preset} 模板生成的不是对象`);
    assert.ok(json !== null, `${preset} 模板生成了 null`);
  }
});

test('模板里的 {{title}} {{body}} 被替换成真实内容', () => {
  for (const preset of Object.keys(WEBHOOK_PRESETS)) {
    const { req } = bodyFor(preset);
    assert.ok(!req.body.includes('{{'), `${preset} 模板还有未替换的占位符`);
  }
});

// ── 错误判定（实测错误码）──

test('钉钉 token 无效：300005 判失败并带出错误信息', () => {
  const r = webhook.check({ status: 200 }, { errcode: 300005, errmsg: 'token is not exist' });
  assert.equal(r.ok, false);
  assert.match(r.detail, /300005/);
  assert.match(r.detail, /token is not exist/);
});

test('飞书 token 无效：19001 判失败（飞书用 code 不是 errcode）', () => {
  const r = webhook.check(
    { status: 200 },
    { code: 19001, data: {}, msg: 'param invalid: incoming webhook access token invalid' },
  );
  assert.equal(r.ok, false);
  assert.match(r.detail, /19001/);
  assert.match(r.detail, /token invalid/i);
});

test('企微群地址无效：93000 判失败', () => {
  const r = webhook.check({ status: 200 }, { errcode: 93000, errmsg: 'invalid webhook url' });
  assert.equal(r.ok, false);
  assert.match(r.detail, /93000/);
});

test('钉钉关键词不匹配：310000 判失败（未实测，社区资料）', () => {
  const r = webhook.check({ status: 200 }, { errcode: 310000, errmsg: 'keywords not in content' });
  assert.equal(r.ok, false);
  assert.match(r.detail, /310000/);
});

test('飞书签名失败：19021 判失败（未实测，社区资料）', () => {
  const r = webhook.check({ status: 200 }, { code: 19021, msg: 'sign match fail' });
  assert.equal(r.ok, false);
  assert.match(r.detail, /19021/);
});

test('errcode 0 判成功', () => {
  assert.equal(webhook.check({ status: 200 }, { errcode: 0, errmsg: 'ok' }).ok, true);
});

test('code 0 判成功（飞书成功态）', () => {
  assert.equal(webhook.check({ status: 200 }, { code: 0, msg: 'success' }).ok, true);
});

test('空 body 判成功（部分 webhook 成功时无响应体）', () => {
  assert.equal(webhook.check({ status: 200 }, null).ok, true);
});

test('HTTP 非 2xx 判失败', () => {
  const r = webhook.check({ status: 500 }, null);
  assert.equal(r.ok, false);
  assert.match(r.detail, /500/);
});

// ── 地址与平台识别 ──

test('三家平台的域名形态互不相同（引导按开头识别平台）', () => {
  // 引导里让用户按地址开头选平台，这里锁住这三种形态确实可区分
  const hosts = [
    'oapi.dingtalk.com',
    'open.feishu.cn',
    'qyapi.weixin.qq.com',
  ];
  assert.equal(new Set(hosts).size, 3, '三个域名应互不相同');

  // 每个域名都能对应到一个可用的预设
  const map = {
    'oapi.dingtalk.com': 'dingtalk',
    'open.feishu.cn': 'feishu',
    'qyapi.weixin.qq.com': 'wecom',
  };
  for (const [host, preset] of Object.entries(map)) {
    assert.ok(WEBHOOK_PRESETS[preset], `${host} 应对应预设 ${preset}`);
    const { json } = bodyFor(preset);
    assert.equal(typeof json, 'object', `${preset} 应生成合法 JSON`);
  }
});

test('没填地址要报错而不是发到 undefined', () => {
  assert.throws(() => webhook.build(MSG, { url: '', preset: 'dingtalk' }), /地址没填/);
});

test('额外请求头是非法 JSON 时报错', () => {
  const cfg = webhook.normalize({ url: 'https://x/y', preset: 'generic', template: '', headers: '{bad}' });
  assert.throws(() => webhook.build(MSG, cfg), /JSON/);
});

test('显式写了模板时不再套用预设', () => {
  const cfg = webhook.normalize({
    url: 'https://x/y',
    preset: 'dingtalk',
    template: '{"custom":true}',
  });
  assert.equal(cfg.template, '{"custom":true}');
});
