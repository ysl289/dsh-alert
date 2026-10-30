/**
 * 排查规则覆盖测试。
 *
 * 背景：审计时发现两个真问题——
 *   1. Bark 的规则里写了裸的 "key"，把 Server酱 的「[AUTH]错误的Key」
 *      和钉钉的 "keywords not in content" 一起匹配进来，
 *      用户看到「Bark Key 不对」被指错方向。
 *   2. `/errcode 400/` 会命中 "errcode 40013"（400 是前缀），
 *      于是 CorpID 错误同时显示「消息格式对不上」。
 *
 * 这里用**真实服务端错误文本**（都是实测拿到的）逐条验证：
 *   - 每条错误至少命中一条规则
 *   - 每条错误命中的规则里，包含语义正确的那条
 *   - 不应该命中的规则不能命中
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'client', 'client.js'), 'utf8');

/** 从 client.js 里取出 TROUBLESHOOT 规则。 */
function loadRules() {
  const start = SRC.indexOf('var TROUBLESHOOT = [');
  assert.ok(start > 0, '应能找到 TROUBLESHOOT');
  const end = SRC.indexOf('];', start) + 2;
  const block = SRC.slice(start, end);

  const rules = [];
  const re = /match:\s*\/((?:[^/\\]|\\.)+)\/([a-z]*)\s*,\s*\n\s*title:\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    rules.push({ re: new RegExp(m[1], m[2]), title: m[3] });
  }
  return rules;
}

const RULES = loadRules();

/** 命中的规则标题列表。 */
function hits(detail) {
  return RULES.filter((r) => r.re.test(detail)).map((r) => r.title);
}

// ── 真实错误文本（全部来自实际请求）──

const REAL_ERRORS = [
  {
    ch: 'bark',
    detail: 'HTTP 400: failed to get device token: failed to get [ABC] device token from database',
    want: 'Bark 的设备 Key 不对',
  },
  {
    ch: 'serverchan',
    detail: 'HTTP 400: [AUTH]错误的Key',
    want: 'Server酱 SendKey 不对或额度用完',
  },
  {
    ch: 'serverchan',
    detail: 'errcode 10003: sendkey not found',
    want: 'Server酱 SendKey 不对或额度用完',
  },
  {
    ch: 'webhook',
    detail: 'errcode 300005: token is not exist',
    want: 'Webhook 地址里的 token 无效',
  },
  {
    ch: 'webhook',
    detail: 'errcode 19001: param invalid: incoming webhook access token invalid',
    want: 'Webhook 地址里的 token 无效',
  },
  {
    ch: 'webhook',
    detail: 'errcode 93000: invalid webhook url',
    want: '企业微信群机器人地址无效',
  },
  {
    ch: 'webhook',
    detail: 'errcode 310000: keywords not in content',
    want: '钉钉/飞书的安全设置没过',
  },
  {
    ch: 'webhook',
    detail: 'errcode 19021: sign match fail',
    want: '钉钉/飞书的安全设置没过',
  },
  {
    ch: 'wecom-app',
    detail: 'errcode 40013: invalid corpid',
    want: 'CorpID 不对',
  },
  {
    ch: 'wecom-app',
    detail: 'errcode 60020: not allow to access from your ip',
    want: '企业微信要求「企业可信IP」，家用宽带做不了',
  },
  {
    ch: 'wecom-app',
    detail: 'errcode 81013: user & party & tag all invalid',
    want: '「发给谁」填的账号不存在',
  },
  {
    ch: 'wecom-app',
    detail: '无效收件人：zhangsan', // 我们自己 check() 输出的
    want: '「发给谁」填的账号不存在',
  },
  {
    ch: 'qqbot',
    detail: '{"code":10004,"message":"机器人不存在"}',
    want: 'QQ 说「机器人不存在」—— AppID 不对',
  },
  {
    ch: 'qqbot',
    detail: 'code 40034105: 主动消息推送被关闭',
    want: '你在 QQ 里关掉了「允许机器人主动发消息」',
  },
];

test('每条真实错误至少命中一条规则', () => {
  const missing = [];
  for (const e of REAL_ERRORS) {
    if (hits(e.detail).length === 0) missing.push(`${e.ch}: ${e.detail}`);
  }
  assert.deepEqual(missing, [], `这些错误没有对应提示：\n${missing.join('\n')}`);
});

test('每条真实错误都命中语义正确的那条规则', () => {
  const wrong = [];
  for (const e of REAL_ERRORS) {
    const got = hits(e.detail);
    if (!got.includes(e.want)) {
      wrong.push(`${e.ch}: 期望「${e.want}」，实际命中 [${got.join(' / ') || '无'}]`);
    }
  }
  assert.deepEqual(wrong, [], `规则指错了方向：\n${wrong.join('\n')}`);
});

test('Server酱 的 [AUTH] 错误不能被误判成 Bark', () => {
  // 这是审计抓到的真 bug：Bark 规则里写了裸的 "key"
  const got = hits('HTTP 400: [AUTH]错误的Key');
  assert.ok(!got.includes('Bark 的设备 Key 不对'), `不该命中 Bark，实际：${got.join(' / ')}`);
  assert.ok(got.includes('Server酱 SendKey 不对或额度用完'), '应命中 Server酱');
});

test('钉钉的关键词错误不能被误判成 Bark', () => {
  const got = hits('errcode 310000: keywords not in content');
  assert.ok(!got.includes('Bark 的设备 Key 不对'), `不该命中 Bark，实际：${got.join(' / ')}`);
});

test('errcode 40013 不能被误判成「消息格式对不上」', () => {
  // /errcode 400/ 会把 40013 也吃掉，已加 \b 边界
  const got = hits('errcode 40013: invalid corpid');
  assert.ok(
    !got.includes('消息格式和平台对不上'),
    `40013 不该命中格式规则，实际：${got.join(' / ')}`,
  );
});

test('真正的格式错误仍然能命中格式规则', () => {
  assert.ok(hits('errcode 400: bad request').includes('消息格式和平台对不上'));
  assert.ok(hits('msgtype is invalid').includes('消息格式和平台对不上'));
});

test('网络类错误有专门提示', () => {
  for (const t of ['ENOTFOUND', 'ECONNREFUSED', 'fetch failed', 'timeout']) {
    assert.ok(hits(t).includes('连不上服务器'), `${t} 应命中「连不上服务器」`);
  }
});

test('5xx 与 413 有通用提示', () => {
  assert.ok(hits('HTTP 500').includes('对方的服务器出错了（不是你配错）'));
  assert.ok(hits('HTTP 502').includes('对方的服务器出错了（不是你配错）'));
  assert.ok(hits('HTTP 413').includes('消息太长被拒'));
});

test('规则数量在合理范围（防止误删或爆炸）', () => {
  assert.ok(RULES.length >= 15, `规则太少（${RULES.length}），可能误删了`);
  assert.ok(RULES.length <= 40, `规则太多（${RULES.length}），可能重复`);
});

test('每条规则都有可操作的修复建议', () => {
  // 只给标题不给怎么做 = 没解决问题
  const start = SRC.indexOf('var TROUBLESHOOT = [');
  const end = SRC.indexOf('];', start);
  const block = SRC.slice(start, end);
  const titles = [...block.matchAll(/title:\s*'([^']*)'/g)].length;
  const fixes = [...block.matchAll(/fix:\s*\[/g)].length;
  assert.equal(fixes, titles, `有 ${titles} 条规则但只有 ${fixes} 条给了 fix`);
});
