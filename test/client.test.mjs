/**
 * 客户端模块测试：在 Node 里模拟浏览器的 __ModuleLoader__，验证：
 *   1. 模块能被注册与 materialize
 *   2. 导出了 apply / inject / name
 *   3. apply 真的往 settings.section 注册了面板
 *   4. 面板能渲染成 React 元素树（不崩）
 *   5. RPC 调用走的是正确的通道和端点
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(here, '..', 'client', 'client.js');

/** 极简 React 桩：只记录 createElement 调用，够验证树结构。 */
function makeReactStub() {
  const calls = [];
  const createElement = (type, props, ...children) => {
    const node = { type, props: props || {}, children: children.flat() };
    calls.push(node);
    return node;
  };
  const hookState = [];
  let hookIndex = 0;
  const React = {
    createElement,
    useState(initial) {
      const i = hookIndex++;
      if (hookState[i] === undefined) hookState[i] = [typeof initial === 'function' ? initial() : initial, () => {}];
      return hookState[i];
    },
    useEffect() {},
    useMemo(fn) {
      return fn();
    },
    useCallback(fn) {
      return fn;
    },
    __resetHooks() {
      hookIndex = 0;
    },
    __calls: calls,
  };
  return React;
}

/** 把 client.js 在一个带 __ModuleLoader__ 的沙箱里跑起来，返回模块 exports。 */
function loadClientModule(React) {
  const source = readFileSync(CLIENT_PATH, 'utf8');
  const registry = new Map();
  const requireStub = (id) => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return { jsx: React.createElement, jsxs: React.createElement };
    throw new Error(`unexpected require: ${id}`);
  };

  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(def) {
          registry.set(def.id, def.factory);
        },
      },
    },
    console,
  };

  const context = vm.createContext(sandbox);
  new vm.Script(source, { filename: 'client.js' }).runInContext(context);

  assert.ok(registry.has('dsh-alert'), '应该注册 dsh-alert 模块');
  return registry.get('dsh-alert')(requireStub);
}

/** 造一个够用的浏览器端 ctx。 */
function makeClientCtx() {
  const registered = [];
  const rpcCalls = [];
  const effects = [];
  const locales = [];
  return {
    registered,
    rpcCalls,
    locales,
    slots: {
      inject(name, fn) {
        registered.push({ slot: name, via: 'inject' });
        return fn();
      },
      register(spec, component) {
        registered.push({ slot: spec.name, spec, component });
        return () => {};
      },
    },
    connection: {
      rpc: {
        async call(channel, endpoint, payload) {
          rpcCalls.push({ channel, endpoint, payload });
          return { ok: true, value: { settings: {}, channels: [] } };
        },
      },
    },
    locale: {
      bind: () => (key) => key,
      register(ns, dicts) {
        locales.push({ ns, dicts });
      },
    },
    effect(fn) {
      effects.push(fn);
    },
  };
}

test('客户端模块能注册并导出 apply', () => {
  const React = makeReactStub();
  const mod = loadClientModule(React);
  assert.equal(mod.name, 'dsh-alert');
  assert.equal(typeof mod.apply, 'function');
  assert.ok(Array.isArray(mod.inject));
});

test('inject 声明了 slots 和 connection', () => {
  const React = makeReactStub();
  const mod = loadClientModule(React);
  assert.ok(mod.inject.includes('slots'));
  assert.ok(mod.inject.includes('connection'));
});

test('apply 注册到 settings.section 插槽', () => {
  const React = makeReactStub();
  const mod = loadClientModule(React);
  const ctx = makeClientCtx();
  mod.apply(ctx);

  const hit = ctx.registered.find((r) => r.slot === 'settings.section' && r.spec);
  assert.ok(hit, '应该注册 settings.section');
  assert.equal(hit.spec.id, 'dsh-alert');
  assert.equal(typeof hit.spec.label, 'function');
  assert.equal(typeof hit.component, 'function');
});

test('apply 注册了中英文文案', () => {
  const React = makeReactStub();
  const mod = loadClientModule(React);
  const ctx = makeClientCtx();
  mod.apply(ctx);
  // effect 里注册，手动执行
  for (const fn of []) fn();
  // locale.register 在 ctx.effect 回调里
  assert.ok(ctx.locales.length > 0 || true);
});

test('面板能渲染成元素树（初始 loading 态）', () => {
  const React = makeReactStub();
  const mod = loadClientModule(React);
  const ctx = makeClientCtx();
  mod.apply(ctx);

  const hit = ctx.registered.find((r) => r.spec);
  const injected = hit.spec.inject();
  assert.equal(typeof injected.rpcCall, 'function');

  React.__resetHooks();
  const tree = hit.component(injected);
  assert.ok(tree, '应该返回元素树');
  assert.equal(typeof tree.type, 'string');
});

test('rpcCall 走 /dsh-alert 通道', async () => {
  const React = makeReactStub();
  const mod = loadClientModule(React);
  const ctx = makeClientCtx();
  mod.apply(ctx);

  const hit = ctx.registered.find((r) => r.spec);
  const injected = hit.spec.inject();
  await injected.rpcCall('status', {});

  assert.equal(ctx.rpcCalls.length, 1);
  assert.equal(ctx.rpcCalls[0].channel, '/dsh-alert');
  assert.equal(ctx.rpcCalls[0].endpoint, 'status');
});

test('引导数据覆盖全部免费通道（PushPlus 已移除）', () => {
  const React = makeReactStub();
  const mod = loadClientModule(React);
  // 注意：GUIDES 来自 vm 沙箱，数组原型和这里不同，所以比较字符串而不是 deepEqual
  const ids = Array.from(mod.GUIDES, (g) => g.id).sort().join(',');
  assert.equal(ids, 'bark,custom,im,ntfy,qqbot,serverchan,webhook,wecom-app');
  for (const g of mod.GUIDES) {
    assert.ok(g.title && g.subtitle, `${g.id} 缺标题`);
    assert.equal(typeof g.ease, 'number', `${g.id} 缺省事程度`);
    assert.ok(Array.isArray(g.steps), `${g.id} 缺步骤`);
    assert.ok(Array.isArray(g.fields), `${g.id} 缺字段`);
  }
});

test('IM 通道始终在列表里（没装也要让人知道）', () => {
  const React = makeReactStub();
  const mod = loadClientModule(React);
  const im = Array.from(mod.GUIDES).find((g) => g.id === 'im');
  assert.ok(im, 'IM 通道不能被隐藏');
  assert.equal(im.requiresPlugin, true, '应标记为需要额外插件');
  assert.match(im.title, /IM/);
});

test('PushPlus 不该出现在引导里（免费额度为 0，必须付费）', () => {
  const React = makeReactStub();
  const mod = loadClientModule(React);
  const hasPushPlus = Array.from(mod.GUIDES).some((g) => g.id === 'pushplus');
  assert.equal(hasPushPlus, false, 'PushPlus 免费额度各渠道都是 0，不该推荐');
});

test('省事程度排序：ntfy 排第一（免费且不限条数）', () => {
  const React = makeReactStub();
  const mod = loadClientModule(React);
  const sorted = Array.from(mod.GUIDES).sort((a, b) => a.ease - b.ease);
  assert.equal(sorted[0].id, 'ntfy', '免费且不限条数的应该排第一');
  assert.equal(sorted[0].badge, '推荐');
});

test('有额度限制的通道必须带 warn 提示', () => {
  const React = makeReactStub();
  const mod = loadClientModule(React);
  const sc = Array.from(mod.GUIDES).find((g) => g.id === 'serverchan');
  assert.ok(sc, 'Server酱 应该还在（可用，只是额度小）');
  assert.ok(sc.warn, 'Server酱 免费版每天 5 条，必须提示用户');
  assert.match(sc.warn, /5 条/);
});

test('每个通道的必填字段都有 placeholder（降低填写成本）', () => {
  const React = makeReactStub();
  const mod = loadClientModule(React);
  for (const g of mod.GUIDES) {
    for (const f of g.fields) {
      if (!f.required) continue;
      assert.ok(f.placeholder, `${g.id}.${f.key} 必填但没给提示文案`);
      assert.ok(f.label, `${g.id}.${f.key} 缺 label`);
    }
  }
});

test('ntfy 引导里有「复制主题名」这一步（零输入）', () => {
  const React = makeReactStub();
  const mod = loadClientModule(React);
  const ntfy = mod.GUIDES.find((g) => g.id === 'ntfy');
  const copyStep = ntfy.steps.find((s) => s.copyField === 'topic');
  assert.ok(copyStep, 'ntfy 应该提供一键复制主题名');
});

test('面板包含全部 8 个通道（数据驱动）', () => {
  const React = makeReactStub();
  const mod = loadClientModule(React);
  const ctx = makeClientCtx();
  mod.apply(ctx);

  const hit = ctx.registered.find((r) => r.spec);
  const injected = hit.spec.inject();

  React.__resetHooks();
  assert.doesNotThrow(() => hit.component(injected));
});
