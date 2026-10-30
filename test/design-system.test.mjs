/**
 * 设计系统审计 —— 把 UI 审美规则钉成断言，防止改回去。
 *
 * 这些规则来自 ui-ux-pro-max 技能：
 *   1. 不用 emoji 当结构图标（字体依赖、跨平台不一致、无法跟随主题色）
 *   2. 字号走模块化音阶，不写 11.5 / 13.5 这种任意值
 *   3. 间距走 4 的倍数节奏
 *   4. 触控目标 ≥44px
 *   5. 文字对比度 ≥4.5:1（大字号/UI 组件 ≥3:1）
 *   6. 每个可交互控件都有可见焦点环
 *   7. 图标统一 24×24 viewBox、1.5 描边、outline 风格
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

import { CLAUDE, DEEPSEEK, DARK_OVERRIDES } from '../lib/theme.js';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(here, '..', 'client', 'client.js');
const CLIENT_SRC = readFileSync(CLIENT_PATH, 'utf8');

/** 加载客户端模块，拿到导出的 token 和图标表。 */
function loadClient() {
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn(),
  };
  const registry = new Map();
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => registry.set(def.id, def.factory) } },
    console,
  };
  new vm.Script(CLIENT_SRC).runInContext(vm.createContext(sandbox));
  return registry.get('dsh-alert')((id) => {
    if (id === 'react') return React;
    throw new Error(`unexpected require ${id}`);
  });
}

const mod = loadClient();

// ── 1. 不用 emoji 当图标 ──

test('源码里没有 emoji 结构图标', () => {
  // 只检查 UI 字符串里的 emoji，注释里的说明文字不算
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2713}\u{2717}]/gu;
  const hits = [];
  const lines = CLIENT_SRC.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // 跳过注释行
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
    const m = line.match(emoji);
    if (m) hits.push(`第 ${i + 1} 行: ${m[0]}  ← ${trimmed.slice(0, 70)}`);
  }
  assert.deepEqual(hits, [], `不该用 emoji 当图标：\n${hits.join('\n')}`);
});

test('每个通道的 icon 都是图标表里存在的键', () => {
  for (const g of mod.GUIDES) {
    assert.ok(
      mod.ICON_PATHS[g.icon],
      `通道 ${g.id} 的图标 "${g.icon}" 不在 ICON_PATHS 里`,
    );
  }
});

test('每个触发器的 icon 都是图标表里存在的键', () => {
  for (const tr of mod.TRIGGERS) {
    assert.ok(
      mod.ICON_PATHS[tr.icon],
      `触发器 ${tr.key} 的图标 "${tr.icon}" 不在 ICON_PATHS 里`,
    );
  }
});

// ── 2. 图标系统规范 ──

test('所有图标用同一个 viewBox', () => {
  for (const name of Object.keys(mod.ICON_PATHS)) {
    const icon = mod.makeIcon(name);
    assert.ok(icon, `${name} 应能渲染`);
    assert.equal(icon.props.viewBox, '0 0 24 24', `${name} 的 viewBox 不对`);
  }
});

test('所有图标统一 1.5 描边、outline 风格', () => {
  for (const name of Object.keys(mod.ICON_PATHS)) {
    const icon = mod.makeIcon(name);
    assert.equal(icon.props.strokeWidth, 1.5, `${name} 描边不是 1.5`);
    assert.equal(icon.props.fill, 'none', `${name} 应该是描边不是填充`);
    assert.equal(icon.props.strokeLinecap, 'round');
    assert.equal(icon.props.strokeLinejoin, 'round');
  }
});

test('图标尺寸只用 token 里的三档', () => {
  const allowed = new Set(Object.values(mod.ICON_SIZE));
  for (const size of allowed) {
    const icon = mod.makeIcon('phone', { size });
    assert.equal(icon.props.width, size);
    assert.equal(icon.props.height, size);
  }
  // 跨 vm 边界的对象原型不同，deepEqual 会误判，用 JSON 归一化
  assert.deepEqual(
    JSON.parse(JSON.stringify(mod.ICON_SIZE)),
    { sm: 16, md: 20, lg: 24 },
  );
});

test('装饰性图标对屏幕阅读器隐藏', () => {
  const icon = mod.makeIcon('phone');
  assert.equal(icon.props['aria-hidden'], 'true');
  assert.equal(icon.props.focusable, 'false');
});

test('有意义的图标给出无障碍名', () => {
  const icon = mod.makeIcon('phone', { label: '手机通知' });
  assert.equal(icon.props.role, 'img');
  assert.equal(icon.props['aria-label'], '手机通知');
  assert.equal(icon.props['aria-hidden'], undefined);
});

test('图标颜色默认继承 currentColor（这样才能跟随主题）', () => {
  const icon = mod.makeIcon('phone');
  assert.equal(icon.props.stroke, 'currentColor');
});

test('未知图标名安静返回 null，不抛错', () => {
  assert.equal(mod.makeIcon('not-a-real-icon'), null);
});

// ── 3. 字号音阶 ──

test('字号是模块化音阶，不是任意值', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(mod.TYPE)),
    { xs: 12, sm: 14, md: 16, lg: 20, xl: 26 },
  );
});

test('样式表里的 fontSize 只取音阶值', () => {
  const S = mod.buildStyles(mod.CLAUDE);
  const allowed = new Set(Object.values(mod.TYPE));
  const bad = [];
  for (const [key, style] of Object.entries(S)) {
    if (!style || typeof style !== 'object') continue;
    const size = style.fontSize;
    if (typeof size === 'number' && !allowed.has(size)) bad.push(`${key}: ${size}`);
  }
  assert.deepEqual(bad, [], `这些 fontSize 不在音阶上：${bad.join(', ')}`);
});

// ── 4. 间距节奏 ──

test('间距 token 都是 4 的倍数', () => {
  for (const [k, v] of Object.entries(mod.SPACE)) {
    assert.equal(v % 4, 0, `SPACE[${k}]=${v} 不是 4 的倍数`);
  }
});

// ── 5. 触控目标 ──

test('按钮高度 ≥44px（触控目标下限）', () => {
  const S = mod.buildStyles(mod.CLAUDE);
  assert.ok(S.btn.height >= 44, `普通按钮只有 ${S.btn.height}px`);
  assert.ok(S.btnPrimary.height >= 44, `主按钮只有 ${S.btnPrimary.height}px`);
});

test('输入框高度 ≥44px', () => {
  const S = mod.buildStyles(mod.CLAUDE);
  assert.ok(S.input.minHeight >= 44, `输入框只有 ${S.input.minHeight}px`);
  assert.ok(S.inputSmall.minHeight >= 44);
  assert.ok(S.select.minHeight >= 44);
});

// ── 6. 焦点环 ──

test('每个主题都有焦点环样式', () => {
  for (const theme of [mod.CLAUDE, mod.DEEPSEEK]) {
    const S = mod.buildStyles(theme);
    assert.ok(S.focus, `${theme.id} 缺焦点环`);
    assert.match(S.focus.outline, /2px solid/, '焦点环应是 2px 实线');
    assert.ok(S.focus.outline.includes(theme.accent), '焦点环应跟随强调色');
  }
});

// ── 7. 对比度（WCAG） ──

/** sRGB → 相对亮度。 */
function luminance(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

test('正文对比度 ≥4.5:1（浅色 + 深色）', () => {
  const pairs = [
    ['Claude 正文', CLAUDE.text, CLAUDE.canvas],
    ['Claude 次要', CLAUDE.textSecondary, CLAUDE.canvas],
    ['Claude 弱化', CLAUDE.textMuted, CLAUDE.canvas],
    ['Claude暗 正文', DARK_OVERRIDES.claude.text, DARK_OVERRIDES.claude.canvas],
    ['Claude暗 次要', DARK_OVERRIDES.claude.textSecondary, DARK_OVERRIDES.claude.canvas],
    ['Claude暗 弱化', DARK_OVERRIDES.claude.textMuted, DARK_OVERRIDES.claude.canvas],
    ['DeepSeek 正文', DEEPSEEK.text, DEEPSEEK.canvas],
    ['DeepSeek 次要', DEEPSEEK.textSecondary, DEEPSEEK.canvas],
    ['DeepSeek 弱化', DEEPSEEK.textMuted, DEEPSEEK.canvas],
    ['DeepSeek暗 正文', DARK_OVERRIDES.deepseek.text, DARK_OVERRIDES.deepseek.canvas],
    ['DeepSeek暗 次要', DARK_OVERRIDES.deepseek.textSecondary, DARK_OVERRIDES.deepseek.canvas],
    ['DeepSeek暗 弱化', DARK_OVERRIDES.deepseek.textMuted, DARK_OVERRIDES.deepseek.canvas],
  ];
  const bad = [];
  for (const [label, fg, bg] of pairs) {
    const r = contrast(fg, bg);
    if (r < 4.5) bad.push(`${label}: ${r.toFixed(2)}:1`);
  }
  assert.deepEqual(bad, [], `对比度不足 4.5:1：\n${bad.join('\n')}`);
});

test('弱化文字在下沉面背景上也要 ≥4.5:1', () => {
  const bad = [];
  const checks = [
    ['Claude', CLAUDE.textMuted, CLAUDE.canvasSunken],
    ['Claude暗', DARK_OVERRIDES.claude.textMuted, DARK_OVERRIDES.claude.canvasSunken],
    ['DeepSeek', DEEPSEEK.textMuted, DEEPSEEK.canvasSunken],
    ['DeepSeek暗', DARK_OVERRIDES.deepseek.textMuted, DARK_OVERRIDES.deepseek.canvasSunken],
  ];
  for (const [label, fg, bg] of checks) {
    const r = contrast(fg, bg);
    if (r < 4.5) bad.push(`${label}: ${r.toFixed(2)}:1`);
  }
  assert.deepEqual(bad, [], `下沉面上的弱化文字太淡：\n${bad.join('\n')}`);
});

test('主按钮文字对比度 ≥4.5:1', () => {
  const bad = [];
  const checks = [
    ['Claude', CLAUDE.onAccent, CLAUDE.accent],
    ['Claude暗', DARK_OVERRIDES.claude.onAccent, CLAUDE.accent],
    ['DeepSeek', DEEPSEEK.onAccent, DEEPSEEK.accentHover],
    ['DeepSeek暗', DARK_OVERRIDES.deepseek.onAccent, DEEPSEEK.accentHover],
  ];
  for (const [label, fg, bg] of checks) {
    const r = contrast(fg, bg);
    if (r < 4.5) bad.push(`${label}: ${r.toFixed(2)}:1`);
  }
  assert.deepEqual(bad, [], `主按钮文字对比度不足：\n${bad.join('\n')}`);
});

test('强调色作为图形元素对比度 ≥3:1', () => {
  const bad = [];
  const checks = [
    ['Claude', CLAUDE.accent, CLAUDE.canvas],
    ['DeepSeek', DEEPSEEK.accent, DEEPSEEK.canvas],
  ];
  for (const [label, fg, bg] of checks) {
    const r = contrast(fg, bg);
    if (r < 3) bad.push(`${label}: ${r.toFixed(2)}:1`);
  }
  assert.deepEqual(bad, [], `强调色太淡：\n${bad.join('\n')}`);
});

// ── 8. 主题一致性 ──

test('客户端色卡与服务端色卡完全一致', () => {
  // 客户端是服务端的副本，两边漂移会让"跟随宿主"行为不一致
  for (const [name, server] of [['CLAUDE', CLAUDE], ['DEEPSEEK', DEEPSEEK]]) {
    const client = mod[name];
    for (const key of ['accent', 'accentHover', 'canvas', 'canvasSunken', 'text', 'textSecondary', 'textMuted', 'onAccent', 'border', 'borderStrong']) {
      assert.equal(
        client[key],
        server[key],
        `${name}.${key} 两边不一致：客户端 ${client[key]} vs 服务端 ${server[key]}`,
      );
    }
  }
});

test('两套主题都有 onAccent（主按钮文字色）', () => {
  for (const theme of [CLAUDE, DEEPSEEK]) {
    assert.ok(theme.onAccent, `${theme.id} 缺 onAccent`);
  }
  for (const [id, dark] of Object.entries(DARK_OVERRIDES)) {
    assert.ok(dark.onAccent, `${id} 的深色变体缺 onAccent`);
  }
});

test('动画时长用 token，不散落魔法数字', () => {
  assert.ok(mod.MOTION.fast);
  assert.ok(mod.MOTION.base);
  assert.match(mod.MOTION.fast, /^\d+ms$/);
  assert.match(mod.MOTION.base, /^\d+ms$/);
});

test('尊重 prefers-reduced-motion：开启后过渡时长归零', () => {
  const normal = mod.buildStyles(mod.CLAUDE, false);
  const reduced = mod.buildStyles(mod.CLAUDE, true);

  // 正常模式有过渡时长
  assert.ok(normal.btn.transition.includes('150ms'), '正常模式应有过渡时长');

  // 减少动效模式下，所有过渡的时长都必须是 0ms
  const noDuration = (value) => {
    // transition 形如 "background 0ms, border-color 0ms"，每个时长都应为 0ms
    const durations = String(value).match(/\d+m?s/g) || [];
    return durations.length > 0 && durations.every((d) => d === '0ms' || d === '0s');
  };

  for (const key of ['btn', 'btnPrimary', 'progressFill', 'toggle', 'knob', 'pick', 'input', 'chip']) {
    if (!reduced[key] || reduced[key].transition === undefined) continue;
    assert.ok(
      noDuration(reduced[key].transition),
      `${key}.transition 在减少动效模式下没归零：${reduced[key].transition}`,
    );
  }
});

test('减少动效不影响布局与颜色（只关动画）', () => {
  const normal = mod.buildStyles(mod.CLAUDE, false);
  const reduced = mod.buildStyles(mod.CLAUDE, true);
  // 尺寸、颜色、间距必须完全一致，否则说明动效开关会改变界面结构
  for (const key of ['btn', 'btnPrimary', 'input', 'card', 'toggle', 'pick']) {
    for (const prop of ['height', 'minHeight', 'padding', 'borderRadius', 'background', 'color', 'border']) {
      if (normal[key][prop] === undefined) continue;
      assert.deepEqual(
        reduced[key][prop],
        normal[key][prop],
        `${key}.${prop} 在减少动效模式下被改了`,
      );
    }
  }
});

test('prefersReducedMotion 在没有 matchMedia 时安静返回 false', () => {
  // 测试环境没有 window.matchMedia，不该抛错
  assert.equal(mod.prefersReducedMotion(), false);
});

test('圆角只用 token 里的档位', () => {
  const S = mod.buildStyles(mod.CLAUDE);
  const allowed = new Set([...Object.values(mod.RADIUS), ...Object.values(mod.RADIUS).map((v) => `${v}px`)]);
  for (const [key, style] of Object.entries(S)) {
    if (!style || typeof style !== 'object') continue;
    const r = style.borderRadius;
    if (r === undefined || r === '50%') continue;
    assert.ok(
      allowed.has(r) || allowed.has(String(r).replace('px', '')),
      `${key}.borderRadius=${r} 不在圆角 token 里`,
    );
  }
});
