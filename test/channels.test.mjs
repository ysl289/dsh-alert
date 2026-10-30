import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CHANNELS, getChannel, channelIds, normalizeConfig } from '../lib/channels/index.js';
import { ntfy } from '../lib/channels/ntfy.js';
import { bark } from '../lib/channels/bark.js';
import { wecomApp, clearWecomTokenCache } from '../lib/channels/wecom-app.js';
import { qqbot, clearQQTokenCache } from '../lib/channels/qqbot.js';
import { webhook, WEBHOOK_PRESETS } from '../lib/channels/webhook.js';
import { serverchan } from '../lib/channels/serverchan.js';
import { custom } from '../lib/channels/custom.js';

const MSG = { title: '✅ 重构 runner · 任务完成', body: '任务已完成\n耗时：2 分 13 秒', url: 'http://127.0.0.1:60013/#/session/abc' };

function fakeRes(status, body) {
  return {
    status,
    text: async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// ── 注册表 ──

test('通道 id 唯一且可查', () => {
  const ids = channelIds();
  assert.equal(new Set(ids).size, ids.length, 'id 不能重复');
  for (const id of ids) assert.ok(getChannel(id), id);
  assert.equal(getChannel('nope'), undefined);
});

test('每个通道都有必需字段定义', () => {
  for (const c of CHANNELS) {
    assert.ok(c.id && c.label, c.id);
    assert.ok(Array.isArray(c.fields), `${c.id} 缺 fields`);
    for (const f of c.fields) {
      assert.ok(f.key && f.label && f.type, `${c.id}.${f.key}`);
    }
  }
});

test('normalizeConfig 补默认值并跳过空值', () => {
  const cfg = normalizeConfig(ntfy, { topic: 'abc', server: '' });
  assert.equal(cfg.server, 'https://ntfy.sh', '空串应回落到默认值');
  assert.equal(cfg.topic, 'abc');
  assert.equal(cfg.priority, 'default');
});

// ── ntfy ──

test('ntfy 构建请求：标题走头，正文走 body', () => {
  const req = ntfy.build(MSG, normalizeConfig(ntfy, { topic: 'dsh-test' }));
  assert.equal(req.url, 'https://ntfy.sh/dsh-test');
  assert.equal(req.method, 'POST');
  assert.equal(req.body, MSG.body);
  assert.equal(req.headers.Click, MSG.url);
});

test('ntfy 中文标题降级成 ASCII（HTTP 头不能带非 ASCII）', () => {
  const req = ntfy.build(MSG, normalizeConfig(ntfy, { topic: 't' }));
  assert.equal(req.headers.Title, 'DSH');
  // eslint-disable-next-line no-control-regex
  assert.ok(/^[\x20-\x7E]*$/.test(req.headers.Title));
});

test('ntfy 没填主题要报错', () => {
  assert.throws(() => ntfy.build(MSG, normalizeConfig(ntfy, {})), /主题名没填/);
});

test('ntfy 带 token 时加 Authorization', () => {
  const req = ntfy.build(MSG, normalizeConfig(ntfy, { topic: 't', token: 'tk_x' }));
  assert.equal(req.headers.Authorization, 'Bearer tk_x');
});

test('ntfy 自建服务器地址去尾斜杠', () => {
  const req = ntfy.build(MSG, normalizeConfig(ntfy, { server: 'https://ntfy.mydomain.com/', topic: 't' }));
  assert.equal(req.url, 'https://ntfy.mydomain.com/t');
});

// ── Bark ──

test('bark 构建请求', () => {
  const req = bark.build(MSG, normalizeConfig(bark, { key: 'K1' }));
  assert.equal(req.url, 'https://api.day.app/K1');
  const body = JSON.parse(req.body);
  assert.equal(body.title, MSG.title);
  assert.equal(body.url, MSG.url);
  assert.equal(body.group, 'DSH');
});

test('bark 没填 key 要报错', () => {
  assert.throws(() => bark.build(MSG, normalizeConfig(bark, {})), /Key 没填/);
});

test('bark 业务码判定', () => {
  assert.equal(bark.check(fakeRes(200), { code: 200 }).ok, true);
  assert.equal(bark.check(fakeRes(200), { code: 400, message: 'bad key' }).ok, false);
  assert.equal(bark.check(fakeRes(500), null).ok, false);
});

// ── 企业微信自建应用 ──

test('企业微信先换 token 再发消息', async () => {
  clearWecomTokenCache();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('gettoken')) return fakeRes(200, { errcode: 0, access_token: 'AT_1', expires_in: 7200 });
    return fakeRes(200, { errcode: 0, errmsg: 'ok' });
  };

  const cfg = normalizeConfig(wecomApp, { corpId: 'ww1', secret: 's1', agentId: '1000002' });
  const prepared = await wecomApp.prepare(cfg, fetchImpl);
  assert.equal(prepared.token, 'AT_1');

  const req = wecomApp.build(MSG, cfg, prepared);
  assert.match(req.url, /message\/send\?access_token=AT_1/);
  const body = JSON.parse(req.body);
  assert.equal(body.msgtype, 'textcard');
  assert.equal(body.agentid, 1000002);
  assert.equal(body.textcard.title, MSG.title);
});

test('企业微信 token 会缓存，不重复换', async () => {
  clearWecomTokenCache();
  let tokenCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes('gettoken')) {
      tokenCalls += 1;
      return fakeRes(200, { errcode: 0, access_token: 'AT', expires_in: 7200 });
    }
    return fakeRes(200, { errcode: 0 });
  };
  const cfg = normalizeConfig(wecomApp, { corpId: 'ww1', secret: 's1', agentId: '1' });
  await wecomApp.prepare(cfg, fetchImpl);
  await wecomApp.prepare(cfg, fetchImpl);
  assert.equal(tokenCalls, 1, '第二次应命中缓存');
});

test('企业微信 errcode 非 0 判失败', () => {
  assert.equal(wecomApp.check(fakeRes(200), { errcode: 0 }).ok, true);
  assert.equal(wecomApp.check(fakeRes(200), { errcode: 81013, errmsg: 'user invalid' }).ok, false);
  assert.equal(wecomApp.check(fakeRes(200), { errcode: 0, invaliduser: 'zhangsan' }).ok, false);
});

test('企业微信没填凭据要报错', async () => {
  clearWecomTokenCache();
  await assert.rejects(() => wecomApp.prepare(normalizeConfig(wecomApp, {}), async () => fakeRes(200, {})), /CorpID/);
});

// ── QQ 机器人 ──

test('QQ 先换 token 再发单聊消息', async () => {
  clearQQTokenCache();
  const fetchImpl = async (url) => {
    if (url.includes('getAppAccessToken')) return fakeRes(200, { access_token: 'QQ_AT', expires_in: 7200 });
    return fakeRes(200, { id: 'msg1' });
  };
  const cfg = normalizeConfig(qqbot, { appId: '1020', appSecret: 'sec', openId: 'OP1' });
  const prepared = await qqbot.prepare(cfg, fetchImpl);
  const req = qqbot.build(MSG, cfg, prepared);
  assert.match(req.url, /\/v2\/users\/OP1\/messages/);
  assert.equal(req.headers.Authorization, 'QQBot QQ_AT');
  const body = JSON.parse(req.body);
  assert.equal(body.msg_type, 0);
  assert.match(body.content, /重构 runner/);
});

test('QQ 用户关了主动消息时给出明确提示', () => {
  const r = qqbot.check(fakeRes(403), { code: 40034105 });
  assert.equal(r.ok, false);
  assert.match(r.detail, /关闭了「允许机器人主动发消息」/);
});

test('QQ 超频控时给出明确提示', () => {
  const r = qqbot.check(fakeRes(429), { code: 40034100 });
  assert.match(r.detail, /频控/);
});

// ── Webhook ──

test('webhook 通用预设能正确替换占位符', () => {
  const cfg = normalizeConfig(webhook, { url: 'https://x/y' });
  const req = webhook.build(MSG, cfg);
  const body = JSON.parse(req.body);
  assert.equal(body.title, MSG.title);
  assert.equal(body.body, MSG.body);
});

test('webhook 钉钉预设', () => {
  const cfg = normalizeConfig(webhook, { url: 'https://x/y', preset: 'dingtalk' });
  const req = webhook.build(MSG, cfg);
  const body = JSON.parse(req.body);
  assert.equal(body.msgtype, 'text');
  assert.match(body.text.content, /重构 runner/);
});

test('webhook 飞书预设', () => {
  const cfg = normalizeConfig(webhook, { url: 'https://x/y', preset: 'feishu' });
  const body = JSON.parse(webhook.build(MSG, cfg).body);
  assert.equal(body.msg_type, 'text');
  assert.match(body.content.text, /重构 runner/);
});

test('webhook 自定义模板能替换', () => {
  const cfg = normalizeConfig(webhook, {
    url: 'https://x/y',
    template: '{"msg":"{{title}}","detail":"{{body}}"}',
  });
  const body = JSON.parse(webhook.build(MSG, cfg).body);
  assert.equal(body.msg, MSG.title);
  assert.equal(body.detail, MSG.body);
});

test('webhook 模板里的换行不会破坏 JSON', () => {
  const cfg = normalizeConfig(webhook, { url: 'https://x/y', template: '{"t":"{{body}}"}' });
  const req = webhook.build(MSG, cfg);
  assert.doesNotThrow(() => JSON.parse(req.body));
});

test('webhook 额外请求头', () => {
  const cfg = normalizeConfig(webhook, { url: 'https://x/y', headers: '{"Authorization":"Bearer z"}' });
  const req = webhook.build(MSG, cfg);
  assert.equal(req.headers.Authorization, 'Bearer z');
});

test('webhook 请求头非法 JSON 要报错', () => {
  const cfg = normalizeConfig(webhook, { url: 'https://x/y', headers: '{bad' });
  assert.throws(() => webhook.build(MSG, cfg), /不是合法 JSON/);
});

test('webhook 业务码判定', () => {
  assert.equal(webhook.check(fakeRes(200), { errcode: 0 }).ok, true);
  assert.equal(webhook.check(fakeRes(200), { errcode: 310000, errmsg: 'sign not match' }).ok, false);
  assert.equal(webhook.check(fakeRes(200), { code: 0 }).ok, true);
  assert.equal(webhook.check(fakeRes(500), null).ok, false);
});

test('所有预设都能产出合法 JSON', () => {
  for (const [name, tpl] of Object.entries(WEBHOOK_PRESETS)) {
    const cfg = normalizeConfig(webhook, { url: 'https://x/y', template: tpl });
    assert.doesNotThrow(() => JSON.parse(webhook.build(MSG, cfg).body), name);
  }
});

// ── Server酱 ──

test('serverchan 构建请求', () => {
  const cfg = normalizeConfig(serverchan, { sendKey: 'SCT123' });
  const req = serverchan.build(MSG, cfg);
  assert.equal(req.url, 'https://sctapi.ftqq.com/SCT123.send');
  assert.match(req.body, /title=/);
});

test('serverchan 业务码判定', () => {
  assert.equal(serverchan.check(fakeRes(200), { code: 0 }).ok, true);
  assert.equal(serverchan.check(fakeRes(200), { code: 40001 }).ok, false);
});

// ── 自定义 HTTP ──

test('custom 构建 POST 请求', () => {
  const cfg = normalizeConfig(custom, { url: 'https://my/server', body: '{"t":"{{title}}"}' });
  const req = custom.build(MSG, cfg);
  assert.equal(req.method, 'POST');
  assert.equal(JSON.parse(req.body).t, MSG.title);
});

test('custom GET 不带 body', () => {
  const cfg = normalizeConfig(custom, { url: 'https://my/server', method: 'GET' });
  const req = custom.build(MSG, cfg);
  assert.equal(req.method, 'GET');
  assert.equal(req.body, undefined);
});

test('custom 状态码区间判定', () => {
  const cfg = { successCodes: '200-299' };
  assert.equal(custom.check(fakeRes(200), null, cfg).ok, true);
  assert.equal(custom.check(fakeRes(299), null, cfg).ok, true);
  assert.equal(custom.check(fakeRes(300), null, cfg).ok, false);
});

test('custom 状态码枚举判定', () => {
  const cfg = { successCodes: '200,201,204' };
  assert.equal(custom.check(fakeRes(201), null, cfg).ok, true);
  assert.equal(custom.check(fakeRes(202), null, cfg).ok, false);
});
