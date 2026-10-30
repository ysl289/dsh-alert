/**
 * 引导可执行性测试 —— 防止「照着做还是错」。
 *
 * 上一版的失败模式：
 *   1. 只说「复制主题名」，但用户看不见要复制什么
 *   2. 只说「在设置里打开」，但没说哪个页面、看到什么算对
 *   3. 必填字段没渲染出来，用户根本填不了
 *   4. 平台不同格式不同，却只有一个输入框
 *
 * 这组测试把「一条引导能不能被照着做完」变成可判定的。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

import { CHANNELS } from '../lib/channels/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(here, '..', 'client', 'client.js');
const SRC = readFileSync(CLIENT_PATH, 'utf8');

function loadClient() {
  const React = {
    createElement: (t, p, ...c) => ({ type: t, props: p || {}, children: c.flat() }),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {},
    useMemo: (f) => f(),
    useCallback: (f) => f(),
  };
  const registry = new Map();
  new vm.Script(SRC).runInContext(
    vm.createContext({
      window: { __ModuleLoader__: { load: (d) => registry.set(d.id, d.factory) } },
      console,
    }),
  );
  return registry.get('dsh-alert')((id) => {
    if (id === 'react') return React;
    throw new Error('unexpected ' + id);
  });
}

const mod = loadClient();
const byId = Object.fromEntries(mod.GUIDES.map((g) => [g.id, g]));

// ── 字段完整性：引导必须覆盖通道的必填字段 ──

test('每个 HTTP 通道的必填字段都出现在引导里', () => {
  const bad = [];
  for (const ch of CHANNELS) {
    const g = byId[ch.id];
    assert.ok(g, `${ch.id} 在引导里不存在`);
    const guideKeys = new Set((g.fields || []).map((f) => f.key));
    for (const f of ch.fields) {
      if (f.required && !guideKeys.has(f.key)) {
        bad.push(`${ch.id}.${f.key}（必填但引导没渲染）`);
      }
    }
  }
  assert.deepEqual(bad, [], `这些必填字段用户填不了：\n${bad.join('\n')}`);
});

test('引导里的字段名都是通道认识的', () => {
  const bad = [];
  for (const ch of CHANNELS) {
    const g = byId[ch.id];
    const channelKeys = new Set(ch.fields.map((f) => f.key));
    for (const f of g.fields || []) {
      if (!channelKeys.has(f.key)) bad.push(`${ch.id}.${f.key}`);
    }
  }
  assert.deepEqual(bad, [], `引导里有通道不认的字段：${bad.join(', ')}`);
});

test('企业微信必须能填「发给谁」，否则 @all 失败时用户无从下手', () => {
  const g = byId['wecom-app'];
  const keys = g.fields.map((f) => f.key);
  assert.ok(keys.includes('toUser'), '缺 toUser 字段：报 81013 时用户改不了');
});

test('Webhook 必须能选平台，否则钉钉/飞书格式对不上', () => {
  const g = byId.webhook;
  const preset = g.fields.find((f) => f.key === 'preset');
  assert.ok(preset, '缺平台选择字段');
  assert.equal(preset.type, 'select', '平台必须是下拉选择，不能是自由输入');
  assert.ok(Array.isArray(preset.options) && preset.options.length >= 3, '至少覆盖钉钉/飞书/企微');
  const values = preset.options.map((o) => o.v);
  for (const v of ['dingtalk', 'feishu', 'wecom']) {
    assert.ok(values.includes(v), `平台选项缺 ${v}`);
  }
});

// ── 步骤可操作性 ──

test('每一步都说了「做什么」', () => {
  for (const g of mod.GUIDES) {
    if (g.id === 'im') continue; // IM 由独立面板渲染
    (g.steps || []).forEach((s, i) => {
      assert.ok(
        typeof s.text === 'string' && s.text.trim().length >= 3,
        `${g.id} 第 ${i + 1} 步没有可执行的动作描述`,
      );
    });
  }
});

test('每一步都说清了「在哪儿做」（这是上一版最缺的）', () => {
  const bad = [];
  for (const g of mod.GUIDES) {
    if (g.id === 'im') continue;
    (g.steps || []).forEach((s, i) => {
      if (!s.where || String(s.where).trim().length < 4) {
        bad.push(`${g.id} 第 ${i + 1} 步（${s.text}）没说在哪儿做`);
      }
    });
  }
  assert.deepEqual(bad, [], `这些步骤缺少操作位置：\n${bad.join('\n')}`);
});

test('每一步都说清了「看到什么算对」', () => {
  const bad = [];
  for (const g of mod.GUIDES) {
    if (g.id === 'im') continue;
    (g.steps || []).forEach((s, i) => {
      if (!s.look || String(s.look).trim().length < 4) {
        bad.push(`${g.id} 第 ${i + 1} 步（${s.text}）没说看到什么算对`);
      }
    });
  }
  assert.deepEqual(bad, [], `这些步骤缺少结果锚点：\n${bad.join('\n')}`);
});

test('每个要复制的值都指明了来源字段', () => {
  for (const g of mod.GUIDES) {
    (g.steps || []).forEach((s) => {
      if (s.copyField) {
        const keys = (g.fields || []).map((f) => f.key);
        assert.ok(
          keys.includes(s.copyField),
          `${g.id} 的步骤要复制 "${s.copyField}"，但引导里没这个字段`,
        );
      }
    });
  }
});

test('至少要有一个步骤提供可复制的值（否则等于让用户手抄）', () => {
  const withCopy = mod.GUIDES.filter((g) =>
    (g.steps || []).some((s) => s.copyField),
  );
  assert.ok(withCopy.length >= 1, '没有任何通道提供「复制」便利');
  assert.ok(
    withCopy.some((g) => g.id === 'ntfy'),
    'ntfy 是推荐通道，主题名必须能一键复制',
  );
});

// ── 字段说明 ──

test('每个必填字段都说明了从哪儿拿', () => {
  const bad = [];
  for (const g of mod.GUIDES) {
    if (g.id === 'im') continue;
    for (const f of g.fields || []) {
      if (f.required && !f.help) bad.push(`${g.id}.${f.key}`);
    }
  }
  assert.deepEqual(bad, [], `这些必填字段没说来源：${bad.join(', ')}`);
});

test('下拉类型的字段必须给出选项', () => {
  const bad = [];
  for (const g of mod.GUIDES) {
    for (const f of g.fields || []) {
      if (f.type === 'select' && (!Array.isArray(f.options) || f.options.length === 0)) {
        bad.push(`${g.id}.${f.key}`);
      }
    }
  }
  assert.deepEqual(bad, [], `这些下拉框没有选项，用户选不了：${bad.join(', ')}`);
});

test('下拉选项的 value 都是非空字符串', () => {
  for (const g of mod.GUIDES) {
    for (const f of g.fields || []) {
      for (const o of f.options || []) {
        assert.ok(typeof o.v === 'string' && o.v.length > 0, `${g.id}.${f.key} 有空的 option value`);
        assert.ok(typeof o.label === 'string' && o.label.length > 0, `${g.id}.${f.key} 有空的 option label`);
      }
    }
  }
});

// ── 易错点必须写在引导里 ──

test('Bark 引导要说清 Key 是「斜杠后面那段」，而不是整个地址', () => {
  const g = byId.bark;
  const all = JSON.stringify(g);
  assert.match(all, /斜杠|最后一段|后面那段/, 'Bark 最容易错在把整个网址粘进去');
});

test('企业微信引导要提到「微信插件」扫码这一步', () => {
  const all = JSON.stringify(byId['wecom-app']);
  assert.match(all, /微信插件/, '不做这步消息进不了个人微信');
});

test('QQ 引导要提醒「开发体验用户」和 openid 不是 QQ 号', () => {
  const all = JSON.stringify(byId.qqbot);
  assert.match(all, /开发体验用户/, '不加这个机器人发不出消息');
  assert.match(all, /不是你的 QQ 号|不是 QQ 号/, 'openid 和 QQ 号容易混淆');
});

test('Webhook 引导要提到安全设置/关键词（钉钉飞书强制要求）', () => {
  const all = JSON.stringify(byId.webhook);
  assert.match(all, /关键词|安全设置/, '不配关键词钉钉直接拒发');
});

test('Server酱 引导要标注每天 5 条的限制', () => {
  const g = byId.serverchan;
  assert.ok(g.warn, '必须有警告');
  assert.match(g.warn, /5 条/, '要说明具体额度');
});

// ── 渲染层：值必须可见 ──

test('渲染代码里可复制的值是明文显示的，不是只有按钮', () => {
  // 找 copyValue 的使用处，确认它被渲染成 <code> 而不是只传给按钮
  assert.match(SRC, /copyValue/, '应有 copyValue 变量');
  assert.match(
    SRC,
    /S\.copyValue[\s\S]{0,200}copyValue/,
    '可复制的值应渲染进 <code style={S.copyValue}>，让用户看见',
  );
});

test('渲染代码支持 where / look 两个锚点', () => {
  assert.match(SRC, /step\.where/, '步骤应渲染 where');
  assert.match(SRC, /step\.look/, '步骤应渲染 look');
});

test('渲染代码支持字段级 help 说明', () => {
  assert.match(SRC, /f\.help/, '字段应渲染 help');
  assert.match(SRC, /aria-describedby/, 'help 应与输入框关联，读屏才念得到');
});

// ── 出错排查 ──

test('失败时给出可照做的排查建议，而不是只甩报错', () => {
  assert.match(SRC, /TROUBLESHOOT/, '应有排查规则表');
  assert.match(SRC, /renderTroubleshoot/, '应有排查渲染函数');
});

test('排查规则覆盖最容易踩的坑', () => {
  const rules = [
    ['网络不通', /ENOTFOUND|fetch failed|timeout/i],
    ['企业微信 IP 白名单', /60020|ip/i],
    ['企业微信收件人无效', /81013/i],
    ['QQ 关了主动消息', /40034105/],
    ['钉钉关键词校验', /310000|关键词/i],
  ];
  for (const [label, pattern] of rules) {
    assert.match(SRC, pattern, `排查规则缺「${label}」`);
  }
});

test('排查建议包含具体动作（去哪个页面改什么）', () => {
  // 检查几条规则里是否写了具体位置
  assert.match(SRC, /企业可信IP|白名单/, '要指到具体设置项');
  assert.match(SRC, /自定义关键词|关键词设成 DSH/, '要给出具体关键词值');
  assert.match(SRC, /允许机器人主动发消息/, '要指到具体开关');
});

test('没匹配上任何规则时也给通用检查清单', () => {
  assert.match(SRC, /没认出具体原因|generic/, '应有兜底');
});
