/**
 * 面板渲染测试：用最小 hooks 运行时驱动真实组件，验证渲染出来的内容。
 *
 * 这里实现的是一个「够用的」hooks 运行时：
 *   - useState 跨渲染保留值
 *   - useEffect 在首次渲染后执行一次
 *   - 状态变化触发重渲染（同步）
 * 不追求和 React 等价，只保证能验证组件的数据流与输出。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(here, '..', 'client', 'client.js');

/**
 * 造一个 hooks 运行时，返回 { React, render }。
 * render(component, props) 会反复渲染直到状态稳定（最多 20 轮）。
 */
function makeRuntime() {
  const states = [];
  let cursor = 0;
  let pendingEffects = [];
  let effectQueue = [];
  let dirty = false;

  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),

    useState(initial) {
      const i = cursor++;
      if (states[i] === undefined) {
        states[i] = { value: typeof initial === 'function' ? initial() : initial };
      }
      const slot = states[i];
      const setter = (next) => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (Object.is(value, slot.value)) return;
        slot.value = value;
        dirty = true;
      };
      return [slot.value, setter];
    },

    useEffect(fn) {
      const i = cursor++;
      // 每个 effect 位置只注册一次
      if (states[i] === undefined) {
        states[i] = { value: undefined, effect: fn };
        pendingEffects.push(i);
      }
    },

    useMemo(fn) {
      return fn();
    },
    useCallback(fn) {
      return fn;
    },
  };

  /**
   * 渲染到稳定：反复执行组件直到没有新的状态变化。
   *
   * 注意 dirty 的语义：它是「渲染之后是否又被 setState 标脏」。
   * 所以必须在每轮**渲染前**清零、渲染后检查，不能每轮开头就清。
   */
  function render(component, props) {
    let tree = null;
    for (let round = 0; round < 30; round += 1) {
      cursor = 0;

      // 执行上一轮注册的 effect（模拟 React 的 commit 阶段）
      if (effectQueue.length > 0) {
        const queue = effectQueue;
        effectQueue = [];
        for (const i of queue) {
          const fn = states[i]?.effect;
          if (fn) fn();
        }
      }

      // 清脏标记：这一轮渲染开始时是干净的
      dirty = false;
      tree = component(props);

      // 本轮新注册的 effect 留到下一轮
      if (pendingEffects.length > 0) {
        effectQueue = pendingEffects.splice(0);
      }

      // effect 还没跑过，或渲染中又改了状态 → 再来一轮
      if (effectQueue.length > 0 || dirty) continue;
      break;
    }
    return tree;
  }

  return { React, render };
}

function loadClient(React) {
  const source = readFileSync(CLIENT_PATH, 'utf8');
  const registry = new Map();
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => registry.set(def.id, def.factory) } },
    console,
  };
  new vm.Script(source).runInContext(vm.createContext(sandbox));
  return registry.get('dsh-alert')((id) => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return { jsx: React.createElement, jsxs: React.createElement };
    throw new Error(`unexpected require ${id}`);
  });
}

function collectText(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  if (typeof node === 'object' && node.children) {
    for (const child of node.children) collectText(child, out);
  }
  return out;
}

function findAll(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, pred, out);
    return out;
  }
  if (pred(node)) out.push(node);
  if (node.children) for (const child of node.children) findAll(child, pred, out);
  return out;
}

/**
 * 把函数组件展开成它们返回的元素树。
 * 这样 findAll 才能看到 Toggle / Row / Chip 这类组件内部的 DOM 节点。
 */
function expandComponents(node, depth = 0) {
  if (depth > 30 || !node) return node;
  if (Array.isArray(node)) return node.map((child) => expandComponents(child, depth + 1));
  if (typeof node !== 'object') return node;

  // 函数组件：调用它，拿到返回的元素树再递归展开
  if (typeof node.type === 'function') {
    const rendered = node.type(Object.assign({}, node.props, { children: node.children }));
    return expandComponents(rendered, depth + 1);
  }

  if (node.children) {
    return Object.assign({}, node, { children: node.children.map((c) => expandComponents(c, depth + 1)) });
  }
  return node;
}

/** 一份真实的 status 响应（RPC 信封是 { ok, value }）。 */
function statusPayload(opts = {}) {
  return {
    ok: true,
    value: {
      settings: {
        enabled: true,
        delaySeconds: 20,
        minTurnDurationSeconds: 30,
        quietHours: '23:00-08:00',
        quietMode: 'digest',
        digestEnabled: true,
        digestMinutes: 30,
        includeExcerpt: true,
        includeCwd: false,
        includeSubagents: false,
        openOnClick: true,
        triggers: { completed: true, error: true, approval: true, question: false, blocked: true, goal: true },
        channels: opts.emptyChannels
          ? // 空通道时也要有 ntfy 的预生成主题（真实场景由 ensureQuickStart 负责）
            [{ id: 'ntfy', enabled: false, config: { topic: 'dsh-35e5c3f3', server: 'https://ntfy.sh' } }]
          : [{ id: 'ntfy', enabled: true, config: { topic: 'dsh-abc', server: 'https://ntfy.sh' } }],
      },
      ready: opts.ready || [],
      integrations: opts.integrations || {
        costMeter: false,
        desktopNotify: false,
        claudeStyle: false,
        pocket: false,
        pocketUrl: null,
        im: false,
      },
      theme: opts.theme || { id: 'deepseek', accent: '#4d6bfe' },
      im: opts.imInstalled
        ? {
            installed: true,
            bots: [
              { botId: 'bot_111', channel: 'feishu' },
              { botId: 'bot_222', channel: 'telegram' },
            ],
            targets: {
              bot_111: [{ targetId: 'release-alerts', name: '发布提醒', kind: 'group' }],
              bot_222: [],
            },
          }
        : { installed: false, bots: [], targets: {} },
      channels: [
        {
          id: 'ntfy',
          label: 'ntfy',
          hint: '手机装 ntfy App',
          fields: [
            { key: 'server', label: '服务器', type: 'string', default: 'https://ntfy.sh' },
            { key: 'topic', label: '主题名', type: 'string', required: true },
          ],
        },
        {
          id: 'wecom-app',
          label: '企业微信自建应用 → 个人微信',
          hint: '官方免费路径',
          fields: [{ key: 'corpId', label: '企业 ID', type: 'string', required: true }],
        },
      ],
    },
  };
}

/** 造 ctx + 取出面板组件。 */
function setup(opts = {}) {
  const { React, render } = makeRuntime();
  const mod = loadClient(React);
  const registered = [];
  const rpcCalls = [];

  const ctx = {
    slots: {
      inject(name, fn) {
        return fn();
      },
      register(spec, component) {
        registered.push({ spec, component });
        return () => {};
      },
    },
    connection: {
      rpc: {
        async call(channel, endpoint, payload) {
          rpcCalls.push({ channel, endpoint, payload });
          if (opts.statusFails) return { ok: false, error: { code: 'boom', message: '读不到' } };
          return statusPayload(opts);
        },
      },
    },
    locale: undefined,
    effect(fn) {
      fn();
    },
  };

  mod.apply(ctx);
  const { spec, component } = registered[0];
  const props = spec.inject();
  return { render, component, props, rpcCalls, registered, mod };
}

/** 渲染并等 RPC 返回，再渲染一次。 */
async function renderSettled(ctx) {
  ctx.render(ctx.component, ctx.props);
  await new Promise((r) => setTimeout(r, 20));
  return ctx.render(ctx.component, ctx.props);
}

test('面板渲染出向导结构（标题 + 两步 + 进度条）', async () => {
  const ctx = setup();
  const text = collectText(await renderSettled(ctx)).join(' ');

  assert.match(text, /手机提醒/, '标题');
  assert.match(text, /第 1 步 · 选一个能收到的地方/, '第一步：选通道');
  assert.match(text, /第 2 步 · 照着做/, '第二步：照着做');
  assert.match(text, /差最后一步|已接通|还没开始/, '应有进度提示');
});

test('面板渲染出带图标的通道卡片', async () => {
  const ctx = setup();
  const tree = await renderSettled(ctx);
  const text = collectText(tree).join(' ');

  assert.match(text, /ntfy/, 'ntfy 卡片');
  assert.match(text, /免费、不限条数/);
  assert.match(text, /微信/, '企业微信卡片');
  assert.match(text, /Bark/);

  // 图标必须是 SVG，不能是 emoji —— emoji 是字体，跨平台不一致且不跟随主题色
  const svgs = findAll(tree, (n) => n.type === 'svg');
  assert.ok(svgs.length > 0, '通道卡片应渲染出 SVG 图标');
  for (const svg of svgs) {
    assert.equal(svg.props.viewBox, '0 0 24 24', '图标应统一 24×24 viewBox');
    assert.equal(svg.props.strokeWidth, 1.5, '图标应统一 1.5 描边');
    assert.equal(svg.props.fill, 'none', '图标应是描边风格，不是填充');
  }
});

test('界面里不再出现 emoji 当图标', async () => {
  const ctx = setup();
  const text = collectText(await renderSettled(ctx)).join(' ');
  // 常见的、之前被当作结构图标的 emoji
  const banned = /[📱💬🍎🐧✉️🔗⚙️🔌✅❌✋❓⛔🎯💰🎨🖥️📲🏷️📊⚠️✓✗]/u;
  assert.ok(!banned.test(text), `不该再有 emoji 图标，发现：${text.match(banned)?.[0]}`);
});

test('面板里不再出现 PushPlus', async () => {
  const ctx = setup();
  const text = collectText(await renderSettled(ctx)).join(' ');
  assert.ok(!/PushPlus/i.test(text), 'PushPlus 要付费，不该出现在界面里');
});

test('没有已启用通道时，默认选中 ntfy（免费且不限条数）', async () => {
  const ctx = setup({ emptyChannels: true });
  const text = collectText(await renderSettled(ctx)).join(' ');

  assert.match(text, /手机装 ntfy/, '应默认显示 ntfy 的引导步骤');
  assert.match(text, /主题名/, '应有主题名字段');
  assert.match(text, /复制/, 'ntfy 要提供一键复制主题名');
});

test('IM 通道始终显示，没装时给出装法', async () => {
  const ctx = setup({ emptyChannels: true, imInstalled: false });
  const text = collectText(await renderSettled(ctx)).join(' ');

  assert.match(text, /IM 复用/, 'IM 卡片要在列表里');
  assert.match(text, /需装 IM 插件/, '应提示需要额外插件');
});

test('IM 面板：没装时显示安装引导', async () => {
  // 直接渲染 ImPanel，不依赖模拟运行时的点击重渲染
  const React = makeRuntime().React;
  const mod = loadClient(React);
  const tree = mod.ImPanel({
    S: mod.buildStyles(mod.palette('deepseek', false)),
    im: { installed: false, bots: [], targets: {} },
    cfg: {},
    onChange: () => {},
    onCopy: () => {},
    copied: '',
  });

  const text = collectText(tree).join(' ');
  assert.match(text, /@xmanrui\/dsh-im/, '应告诉用户装哪个插件');
  assert.match(text, /装好后这一页会自动变成选择框/, '应说明装完会怎样');
  assert.match(text, /微信|飞书|Telegram/, '应说明能收到哪些渠道');
});

test('IM 面板：装了但没机器人时给出提示', async () => {
  const React = makeRuntime().React;
  const mod = loadClient(React);
  const tree = mod.ImPanel({
    S: mod.buildStyles(mod.palette('deepseek', false)),
    im: { installed: true, bots: [], targets: {} },
    cfg: {},
    onChange: () => {},
    onCopy: () => {},
    copied: '',
  });

  const text = collectText(tree).join(' ');
  assert.match(text, /还没接入任何机器人/);
});

test('IM 面板：装了且有机器人时给选择框', async () => {
  const React = makeRuntime().React;
  const mod = loadClient(React);
  const tree = mod.ImPanel({
    S: mod.buildStyles(mod.palette('deepseek', false)),
    im: {
      installed: true,
      bots: [
        { botId: 'bot_111', channel: 'feishu' },
        { botId: 'bot_222', channel: 'telegram' },
      ],
      targets: { bot_111: [{ targetId: 'release-alerts', name: '发布提醒' }], bot_222: [] },
    },
    cfg: { botId: 'bot_111' },
    onChange: () => {},
    onCopy: () => {},
    copied: '',
  });

  const selects = findAll(tree, (n) => n.type === 'select');
  assert.ok(selects.length >= 1, '应该有机器人选择框');
  const text = collectText(tree).join(' ');
  assert.match(text, /机器人/);
  assert.match(text, /投递目标/);
  assert.match(text, /发布提醒/, '应列出已保存的目标');
});

test('装了 dsh-im 且有机器人时显示选择框', async () => {
  const ctx = setup({ emptyChannels: true, imInstalled: true });
  let tree = await renderSettled(ctx);

  const picks = findAll(tree, (n) => n.type === 'button' && n.props && typeof n.props.onClick === 'function');
  const imBtn = picks.find((b) => collectText(b).join(' ').includes('IM 复用'));
  assert.ok(imBtn);
  imBtn.props.onClick();

  tree = await renderSettled(ctx);
  const selects = findAll(tree, (n) => n.type === 'select');
  assert.ok(selects.length > 0, '应该有机器人选择框');
  const text = collectText(tree).join(' ');
  assert.match(text, /机器人/, '应有机器人选择');
});

test('已有启用通道时，默认选中它', async () => {
  const ctx = setup(); // 默认 mock 里 ntfy 是启用的
  const text = collectText(await renderSettled(ctx)).join(' ');

  assert.match(text, /手机装 ntfy/, '应沿用已启用通道的引导');
});

test('选中有限额的通道时显示警告', async () => {
  const ctx = setup({ emptyChannels: true });
  let tree = await renderSettled(ctx);

  // 找到 Server酱 卡片并点击
  const picks = findAll(tree, (n) => n.type === 'button' && n.props && typeof n.props.onClick === 'function');
  const scBtn = picks.find((b) => collectText(b).join(' ').includes('Server酱'));
  assert.ok(scBtn, '应能找到 Server酱 卡片');
  scBtn.props.onClick();

  tree = await renderSettled(ctx);
  const text = collectText(tree).join(' ');
  assert.match(text, /每天只有 5 条/, '应提示免费额度限制');

  // 警示图标现在是 SVG（不是 ⚠️ emoji），验证它确实渲染出来了
  const callouts = findAll(tree, (n) => n.type === 'p' && n.props?.style?.background);
  assert.ok(callouts.length > 0, '应有警示块');
  const svgInCallout = findAll(callouts[0], (n) => n.type === 'svg');
  assert.ok(svgInCallout.length > 0, '警示块里应有 SVG 图标');
});

test('ntfy 被选中时显示自动生成的主题名和复制按钮', async () => {
  const ctx = setup();
  let tree = await renderSettled(ctx);

  // 点 ntfy 卡片
  const picks = findAll(tree, (n) => n.type === 'button' && n.props && typeof n.props.onClick === 'function');
  const ntfyBtn = picks.find((b) => collectText(b).join(' ').includes('免费、不限条数'));
  assert.ok(ntfyBtn, '应能找到 ntfy 卡片');
  ntfyBtn.props.onClick();

  tree = await renderSettled(ctx);
  const text = collectText(tree).join(' ');

  assert.match(text, /主题名/, '应有主题名字段');
  assert.match(text, /复制/, '应有复制按钮');
});

test('面板渲染出触发器开关文案', async () => {
  const ctx = setup();
  const text = collectText(await renderSettled(ctx)).join(' ');

  assert.match(text, /任务完成/);
  assert.match(text, /等你审批/);
  assert.match(text, /等你回答/);
  assert.match(text, /目标完成/);
});

test('面板有保存和测试按钮', async () => {
  const ctx = setup();
  const text = collectText(await renderSettled(ctx)).join(' ');

  assert.match(text, /保存/);
  assert.match(text, /发送测试/);
});

test('所有按钮都带 type="button"（避免表单误提交）', async () => {
  const ctx = setup();
  const tree = await renderSettled(ctx);

  const buttons = findAll(tree, (n) => n.type === 'button');
  assert.ok(buttons.length > 0, '应该有按钮');
  for (const b of buttons) {
    assert.equal(b.props.type, 'button', `按钮缺 type：${JSON.stringify(b.props).slice(0, 100)}`);
  }
});

test('开关带 role="switch" 和 aria-checked（可访问性）', async () => {
  const ctx = setup();
  const tree = await renderSettled(ctx);

  // Toggle 是函数组件：先展开所有函数组件，再找 role="switch" 的 DOM 节点
  const expanded = expandComponents(tree);
  const switches = findAll(expanded, (n) => n.props && n.props.role === 'switch');
  assert.ok(switches.length > 0, '应该有开关');
  for (const s of switches) {
    assert.ok(['true', 'false'].includes(s.props['aria-checked']), 'aria-checked 必须是 true/false 字符串');
    assert.ok(s.props['aria-label'] !== undefined, '开关应有 aria-label');
  }
});

test('加载时先显示读取中', () => {
  const ctx = setup();
  const tree = ctx.render(ctx.component, ctx.props);
  const text = collectText(tree).join(' ');
  assert.match(text, /读取中/);
});

test('读取失败时显示错误和重试按钮', async () => {
  const ctx = setup({ statusFails: true });
  const text = collectText(await renderSettled(ctx)).join(' ');

  assert.match(text, /读不到设置/);
  assert.match(text, /重试/);
});

test('面板加载时调用了 status 端点', async () => {
  const ctx = setup();
  await renderSettled(ctx);

  assert.ok(ctx.rpcCalls.length > 0, '应该发过 RPC');
  assert.equal(ctx.rpcCalls[0].channel, '/dsh-alert');
  assert.equal(ctx.rpcCalls[0].endpoint, 'status');
});

test('表单输入是受控的（value 来自 settings）', async () => {
  const ctx = setup();
  const tree = await renderSettled(ctx);

  const inputs = findAll(tree, (n) => n.type === 'input');
  assert.ok(inputs.length > 0, '应该有输入框');
  for (const input of inputs) {
    assert.ok('value' in input.props, `输入框应是受控的：${JSON.stringify(input.props).slice(0, 100)}`);
    assert.ok(typeof input.props.onChange === 'function', '输入框应有 onChange');
  }
});

// ── 联动徽标 ──

test('装了联动插件时显示对应徽标', async () => {
  const ctx = setup({
    integrations: {
      costMeter: true,
      desktopNotify: true,
      claudeStyle: true,
      pocket: true,
      pocketUrl: 'http://10.0.0.5:3081',
      im: true,
    },
  });
  const text = collectText(await renderSettled(ctx)).join(' ');

  assert.match(text, /成本统计已联动/);
  assert.match(text, /IM 插件已检测到/);
  assert.match(text, /跟随 Claude 皮肤/);
  assert.match(text, /桌面通知已装/);
  assert.match(text, /手机链接可用/);
});

test('什么都没装时不显示任何联动徽标', async () => {
  const ctx = setup();
  const text = collectText(await renderSettled(ctx)).join(' ');

  assert.ok(!/成本统计已联动/.test(text));
  assert.ok(!/手机链接可用/.test(text));
});

// ── 「链接手机上能不能打开」的说明 ──

test('装了 pocket 且算得出地址时，显示可用地址和复制按钮', async () => {
  const ctx = setup({
    integrations: {
      costMeter: false,
      desktopNotify: false,
      claudeStyle: false,
      pocket: true,
      pocketUrl: 'http://10.169.96.251:3081',
      im: false,
    },
  });
  const text = collectText(await renderSettled(ctx)).join(' ');

  assert.match(text, /手机上点得开/, '应告诉用户链接能用');
  assert.match(text, /10\.169\.96\.251:3081/, '应显示具体地址供复制');
  assert.match(text, /同一个 WiFi/, '应说明前提条件');
});

test('装了 pocket 但局域网没开时，指路去打开开关', async () => {
  const ctx = setup({
    integrations: {
      costMeter: false,
      desktopNotify: false,
      claudeStyle: false,
      pocket: true,
      pocketUrl: null,
      im: false,
    },
  });
  const text = collectText(await renderSettled(ctx)).join(' ');

  assert.match(text, /局域网访问是关的/, '应说明是开关没开');
  assert.match(text, /把局域网访问打开/, '应给出下一步动作');
});

test('没装 pocket 时，明确告知链接在手机上点不开', async () => {
  const ctx = setup();
  const text = collectText(await renderSettled(ctx)).join(' ');

  assert.match(text, /手机上点不开/, '必须说清现状');
  assert.match(text, /127\.0\.0\.1/, '应指出原因');
  assert.match(text, /dsh-pocket/, '应告诉用户装什么能解决');
});

test('关掉「带跳回链接」后，链接说明块真的消失', async () => {
  const ctx = setup();
  let tree = await renderSettled(ctx);

  // 开着的时候有说明
  assert.match(
    collectText(tree).join(' '),
    /手机上点不开|手机上点得开/,
    '开着时应显示说明',
  );

  // 找到「带跳回链接」那个开关并点掉
  const toggle = findAll(
    expandComponents(tree),
    (n) => n.type === 'button' && n.props?.['aria-label'] === '带跳回链接',
  )[0];
  assert.ok(toggle, '应能按 aria-label 找到「带跳回链接」开关');
  assert.equal(toggle.props['aria-checked'], 'true', '默认应该是开着的');

  toggle.props.onClick();
  tree = ctx.render(ctx.component, ctx.props);

  assert.ok(
    !/手机上点不开|手机上点得开/.test(collectText(tree).join(' ')),
    '关掉后不该再显示链接说明',
  );
});
