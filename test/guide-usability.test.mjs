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

// ── 入口必须先引入再使用 ──

test('提到「管理后台」这类入口时，必须说清怎么进', () => {
  // 用户实际卡住的场景：企业微信第 2 步写「管理后台 → …」，
  // 但从没说过管理后台是什么、怎么进，他手上只有手机 App。
  const ENTRANCES = ['管理后台', '开放平台', '开发者后台', '控制台'];

  const bad = [];
  for (const g of mod.GUIDES) {
    if (!g.steps?.length) continue;
    for (const word of ENTRANCES) {
      const firstIdx = g.steps.findIndex((s) =>
        `${s.text} ${s.where || ''} ${s.look || ''}`.includes(word),
      );
      if (firstIdx === -1) continue;

      const first = g.steps[firstIdx];
      const blob = `${first.text} ${first.where || ''} ${first.look || ''}`;
      // 必须出现「打开/浏览器/网址/登录」这类进入动作
      if (!/浏览器|打开|网址|https?:|扫码登录|进入/.test(blob)) {
        bad.push(`${g.id} 第 ${firstIdx + 1} 步首次提到「${word}」却没说怎么进：${first.text}`);
      }
    }
  }
  assert.deepEqual(bad, [], `这些入口没交代清楚：\n${bad.join('\n')}`);
});

test('企业微信必须说明「管理后台是网页，不是手机 App」', () => {
  const g = byId['wecom-app'];
  const all = JSON.stringify(g);
  assert.match(all, /浏览器|网页/, '要说清是用浏览器打开');
  assert.match(
    all,
    /不是.*App|App.*没有|手机.*没有/,
    '用户手上只有手机 App，必须点明这不是 App 里的功能',
  );
});

test('每一步的「在哪儿做」必须包含可操作线索，不能只写概念', () => {
  const bad = [];
  for (const g of mod.GUIDES) {
    if (!g.steps?.length) continue;
    g.steps.forEach((s, i) => {
      const w = String(s.where || '');
      if (!w) return;
      const actionable = /→|打开|点|选择|复制|粘贴|扫|填|浏览器|进入|拉到|框|按钮|下拉/.test(w);
      if (!actionable) bad.push(`${g.id} 第 ${i + 1} 步：${w}`);
    });
  }
  assert.deepEqual(bad, [], `这些位置描述没有可操作线索：\n${bad.join('\n')}`);
});

test('「在哪儿做」里不该塞注意事项（那是 look 的活）', () => {
  const bad = [];
  for (const g of mod.GUIDES) {
    if (!g.steps?.length) continue;
    g.steps.forEach((s, i) => {
      const w = String(s.where || '');
      if (/注意|别把|不要|⚠️/.test(w)) {
        bad.push(`${g.id} 第 ${i + 1} 步把提醒写进了位置：${w.slice(0, 40)}`);
      }
    });
  }
  assert.deepEqual(bad, [], `这些位置描述混进了注意事项：\n${bad.join('\n')}`);
});

test('面向用户的文案里不该出现 Markdown 标记（会原样显示成星号）', () => {
  // 面板把这些字符串直接渲染成纯文本，**加粗** 会露出星号，看着像没写完
  const bad = [];
  for (const g of mod.GUIDES) {
    const spots = [];
    (g.steps || []).forEach((s, i) => {
      if (/\*\*/.test(`${s.text}${s.where || ''}${s.look || ''}`)) spots.push(`步骤 ${i + 1}`);
    });
    for (const f of g.fields || []) {
      if (/\*\*/.test(String(f.help || ''))) spots.push(`字段 ${f.key} 的 help`);
    }
    if (/\*\*/.test(String(g.warn || ''))) spots.push('warn');
    if (/\*\*/.test(String(g.subtitle || ''))) spots.push('subtitle');
    if (spots.length) bad.push(`${g.id}: ${spots.join('、')}`);
  }
  assert.deepEqual(bad, [], `这些文案里有 Markdown 星号：\n${bad.join('\n')}`);
});

test('注意事项走 note 数组，不靠正文里的「注意：」字样', () => {
  // 用颜色 + 图标表达提醒，而不是在句子里塞纯文本前缀
  const bad = [];
  for (const g of mod.GUIDES) {
    (g.steps || []).forEach((s, i) => {
      const look = String(s.look || '');
      const where = String(s.where || '');
      if (/注意[：:]/.test(look) || /注意[：:]/.test(where)) {
        bad.push(`${g.id} 第 ${i + 1} 步：正文里有「注意：」，应改用 note 数组`);
      }
    });
  }
  assert.deepEqual(bad, [], `这些步骤该用 note：\n${bad.join('\n')}`);
});

test('渲染层会把 note 渲染成警示块（带图标和警示色）', () => {
  assert.match(SRC, /warningsFor/, '应有 warningsFor 提取注意事项');
  assert.match(SRC, /S\.stepWarn/, '应有警示块样式');
  assert.match(SRC, /stepWarnIcon/, '警示块应带图标');
  // 样式里必须用 warn 色系，不是普通文字色
  assert.match(SRC, /stepWarn[\s\S]{0,400}?p\.warnSoft/, '警示块应用 warnSoft 背景');
});

test('已有 note 的步骤确实非空且是字符串数组', () => {
  for (const g of mod.GUIDES) {
    (g.steps || []).forEach((s, i) => {
      if (s.note === undefined) return;
      assert.ok(Array.isArray(s.note), `${g.id} 第 ${i + 1} 步的 note 应是数组`);
      for (const n of s.note) {
        assert.equal(typeof n, 'string', `${g.id} 第 ${i + 1} 步 note 里有非字符串`);
        assert.ok(n.trim().length > 0, `${g.id} 第 ${i + 1} 步 note 里有空字符串`);
      }
    });
  }
});

// ── 难点通道必须提前警告 ──

test('企业微信必须在选之前说明「要配可信 IP、家用宽带做不了」', () => {
  // 用户真实踩过：走到最后一步才报 60020，白折腾半小时
  const g = byId['wecom-app'];
  assert.ok(g.warn, '企业微信必须有 warn 前置警告');
  assert.match(g.warn, /IP/i, '警告里要点明 IP 限制');
  assert.match(g.warn, /动态|家庭|家用/, '要说明家用宽带的问题');
  assert.match(g.warn, /ntfy/, '要给出更省事的替代方案');
});

test('通道按真实动手成本排序，ntfy 必须排第一', () => {
  const sorted = [...mod.GUIDES].sort((a, b) => a.ease - b.ease);
  assert.equal(sorted[0].id, 'ntfy', 'ntfy 最省事，应排第一');
  assert.equal(sorted[0].badge, '推荐', 'ntfy 应带推荐标');

  const wecom = byId['wecom-app'];
  const bark = byId.bark;
  assert.ok(
    wecom.ease > bark.ease,
    `企业微信(${wecom.ease}) 应排在 Bark(${bark.ease}) 之后 —— 它麻烦得多`,
  );
});

test('麻烦的通道要在卡片上就标出来，不能只写在步骤里', () => {
  const g = byId['wecom-app'];
  const hint = `${g.subtitle} ${g.badge || ''}`;
  assert.match(hint, /麻烦|折腾|较难/, `卡片上应提示难度，实际：${hint}`);
});

test('60020 的排查建议要给出「换 ntfy」这条活路', () => {
  // 只教人配动态 IP 等于没给方案
  const idx = SRC.indexOf('60020');
  assert.ok(idx > 0, '应有 60020 的排查规则');
  const block = SRC.slice(idx, idx + 900);
  assert.match(block, /ntfy/, '要建议换用 ntfy');
  assert.match(block, /动态|家用|家庭/, '要说明家用宽带的困难');
});

// ── 数据质量：别把 null 当字符串写进界面 ──

test("badge 不能是字符串 'null'（会直接显示成 null）", () => {
  for (const g of mod.GUIDES) {
    assert.notEqual(
      g.badge,
      'null',
      `${g.id} 的 badge 是字符串 'null'，界面上会显示字面 null`,
    );
    assert.notEqual(g.badge, 'undefined', `${g.id} 的 badge 是字符串 'undefined'`);
  }
});

test('badge 要么没有，要么是非空短标签', () => {
  for (const g of mod.GUIDES) {
    if (g.badge === undefined || g.badge === null) continue;
    assert.equal(typeof g.badge, 'string', `${g.id}.badge 应是字符串`);
    assert.ok(g.badge.trim().length > 0, `${g.id}.badge 是空字符串`);
    assert.ok(g.badge.length <= 6, `${g.id}.badge 太长（${g.badge}），卡片上放不下`);
  }
});

test('卡片标题和副标题不能是 null / undefined 字面量', () => {
  for (const g of mod.GUIDES) {
    for (const field of ['title', 'subtitle']) {
      const v = g[field];
      assert.ok(typeof v === 'string' && v.trim().length > 0, `${g.id}.${field} 缺失`);
      assert.notEqual(v, 'null', `${g.id}.${field} 是字符串 null`);
      assert.notEqual(v, 'undefined', `${g.id}.${field} 是字符串 undefined`);
    }
  }
});

test('每个通道的 ease 是正整数且不重复', () => {
  const seen = new Map();
  for (const g of mod.GUIDES) {
    assert.equal(typeof g.ease, 'number', `${g.id}.ease 应是数字`);
    assert.ok(Number.isInteger(g.ease) && g.ease > 0, `${g.id}.ease 应是正整数`);
    assert.ok(!seen.has(g.ease), `ease ${g.ease} 被 ${seen.get(g.ease)} 和 ${g.id} 重复使用`);
    seen.set(g.ease, g.id);
  }
});

// ── 事实核对 ──

/** IM 面板整段（含之前的来源注释）。 */
function imPanelSrc() {
  const start = SRC.indexOf('//#region IM 面板');
  const end = SRC.indexOf('//#region 主面板');
  assert.ok(start > 0 && end > start, '应能找到 IM 面板区块');
  return SRC.slice(start, end);
}

test('IM 引导必须指向真实入口「IM机器人」而不是模糊说法', () => {
  const im = imPanelSrc();
  assert.match(im, /IM机器人/, '要写真实菜单名「IM机器人」');
  assert.ok(
    !/在它的设置里扫码/.test(im),
    '不能写模糊的「在它的设置里扫码」，要给出具体菜单路径',
  );
});

test('IM 引导必须提到「齿轮」「新建目标」「Bot ID」这些真实控件', () => {
  const im = imPanelSrc();
  assert.match(im, /齿轮/, '要说明点卡片右上角齿轮');
  assert.match(im, /新建目标/, '目标是在 dsh-im 里「新建目标」建的');
  assert.match(im, /Bot ID/i, '要复制 Bot ID');
});

test('引导代码里要注明事实来源（文档或 README）', () => {
  // IM 引导之前凭印象写，全错。现在要求代码里留下出处，方便日后核对。
  // 注意：来源注释写在 function ImPanel 之前，所以从 region 标记开始截。
  const start = SRC.indexOf('//#region IM 面板');
  const end = SRC.indexOf('//#region 主面板');
  assert.ok(start > 0 && end > start, '应能找到 IM 面板区块');
  const im = SRC.slice(start, end);
  assert.match(im, /README|PROACTIVE_DELIVERY|事实来源|文档/, 'IM 面板应注明依据的文档');
});

// ── QQ 官方事实（依据 bot.q.qq.com 文档核对）──

test('QQ 引导要点明「Token 已弃用，只要 AppID + AppSecret」', () => {
  const g = byId.qqbot;
  const all = JSON.stringify(g);
  assert.match(all, /Token/, '应提到 Token 字段');
  assert.match(all, /弃用|不用管/, '应说明 Token 已弃用，别让用户去填');
  assert.match(all, /AppID[\s\S]{0,20}AppSecret/, '应明确这两样就够了');
});

test('QQ 引导要说 openid 来自 C2C_MESSAGE_CREATE 事件', () => {
  const all = JSON.stringify(byId.qqbot);
  assert.match(all, /C2C_MESSAGE_CREATE|单聊消息事件/, '官方事件名要写出来，方便配 intents');
});

test('QQ 引导要把 40034105 对应到 C2C_MSG_REJECT', () => {
  const all = JSON.stringify(byId.qqbot);
  assert.match(all, /40034105/, '要写错误码');
  assert.match(all, /C2C_MSG_REJECT|主动消息推送/, '要说明这是用户关了主动推送');
});

test('QQ 引导必须给出「用 dsh-im 更省事」的替代方案', () => {
  // 这条路客观很难，不给退路等于坑用户
  const all = JSON.stringify(byId.qqbot);
  assert.match(all, /IM机器人|dsh-im/, '要指向更省事的替代路径');
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
