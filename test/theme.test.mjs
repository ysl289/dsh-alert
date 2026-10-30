/**
 * 主题层测试。
 *
 * 要守住的几条：
 *   1. 两套色卡都能独立渲染，字段齐全（漏一个 token 面板就白块）
 *   2. resolveTheme 的优先级：显式指定 > 跟随换肤插件 > 默认 DeepSeek
 *   3. 深色变体只改颜色，不改形状（否则切深色布局会跳）
 *   4. 设计红线：不用纯黑、不用冷灰、强调色克制
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLAUDE,
  DEEPSEEK,
  THEMES,
  DARK_OVERRIDES,
  resolveTheme,
  paletteFor,
} from '../lib/theme.js';

/** 面板渲染必须读到的 token，缺一个就是白块/看不见字。 */
const REQUIRED_TOKENS = [
  'accent',
  'accentHover',
  'accentSoft',
  'canvas',
  'canvasSunken',
  'surface',
  'surfaceHover',
  'border',
  'borderStrong',
  'text',
  'textSecondary',
  'textMuted',
  'success',
  'successSoft',
  'warn',
  'warnSoft',
  'danger',
  'dangerSoft',
  'radiusSm',
  'radiusMd',
  'radiusLg',
  'radiusPill',
  'fontFamily',
  'fontWeightNormal',
  'fontWeightMedium',
  'fontWeightBold',
  'shadow',
  'shadowStrong',
];

test('两套色卡都字段齐全', () => {
  for (const theme of [CLAUDE, DEEPSEEK]) {
    for (const token of REQUIRED_TOKENS) {
      assert.ok(
        theme[token] !== undefined && theme[token] !== '',
        `${theme.id} 缺 token: ${token}`,
      );
    }
  }
});

test('色卡的 id 与 name 对得上', () => {
  assert.equal(CLAUDE.id, 'claude');
  assert.equal(DEEPSEEK.id, 'deepseek');
  assert.equal(THEMES.claude, CLAUDE);
  assert.equal(THEMES.deepseek, DEEPSEEK);
});

test('两套色卡的强调色确实不同（不是同一套换名字）', () => {
  assert.notEqual(CLAUDE.accent, DEEPSEEK.accent);
});

test('Claude 用暖珊瑚，DeepSeek 用品牌蓝', () => {
  assert.equal(CLAUDE.accent, '#d97757');
  assert.equal(DEEPSEEK.accent, '#4d6bfe');
});

// ── resolveTheme 优先级 ──

test('显式指定 claude 就用 claude', () => {
  assert.equal(resolveTheme('claude').id, 'claude');
  assert.equal(resolveTheme('claude', false).id, 'claude');
});

test('显式指定 deepseek 就用 deepseek，装了换肤插件也不跟随', () => {
  assert.equal(resolveTheme('deepseek').id, 'deepseek');
  assert.equal(resolveTheme('deepseek', true).id, 'deepseek');
});

test('auto 或没指定时，装了 claude-style 就跟随它', () => {
  assert.equal(resolveTheme('auto', true).id, 'claude');
  assert.equal(resolveTheme(undefined, true).id, 'claude');
});

test('auto 且没装换肤插件时，默认 DeepSeek（上传版走这套）', () => {
  assert.equal(resolveTheme('auto', false).id, 'deepseek');
  assert.equal(resolveTheme(undefined, false).id, 'deepseek');
});

test('非法主题名退化成默认值，不抛错', () => {
  assert.equal(resolveTheme('nonsense', false).id, 'deepseek');
  assert.equal(resolveTheme('nonsense', true).id, 'claude');
  assert.equal(resolveTheme(null, false).id, 'deepseek');
  assert.equal(resolveTheme(123, false).id, 'deepseek');
});

// ── 深色变体 ──

test('两个主题都有深色变体', () => {
  assert.ok(DARK_OVERRIDES.claude);
  assert.ok(DARK_OVERRIDES.deepseek);
});

test('深色变体只覆盖颜色，不覆盖形状与字重', () => {
  const shapeTokens = [
    'radiusSm',
    'radiusMd',
    'radiusLg',
    'radiusPill',
    'fontFamily',
    'fontWeightNormal',
    'fontWeightMedium',
    'fontWeightBold',
  ];
  for (const [id, override] of Object.entries(DARK_OVERRIDES)) {
    for (const token of shapeTokens) {
      assert.equal(
        override[token],
        undefined,
        `${id} 的深色变体不该覆盖 ${token}（会让布局跳动）`,
      );
    }
  }
});

test('深色变体把画布调暗、把文字调亮', () => {
  for (const [id, override] of Object.entries(DARK_OVERRIDES)) {
    assert.ok(override.canvas, `${id} 深色缺 canvas`);
    assert.ok(override.text, `${id} 深色缺 text`);
    // 深色的画布必须比浅色的暗
    const light = THEMES[id];
    assert.notEqual(override.canvas, light.canvas, `${id} 深色画布没变`);
  }
});

test('paletteFor 浅色直接返回原色卡', () => {
  assert.equal(paletteFor(CLAUDE, false), CLAUDE);
});

test('paletteFor 深色返回合并后的新对象，不改原色卡', () => {
  const dark = paletteFor(CLAUDE, true);
  assert.notEqual(dark, CLAUDE);
  assert.equal(dark.canvas, DARK_OVERRIDES.claude.canvas);
  // 形状继承下来了
  assert.equal(dark.radiusMd, CLAUDE.radiusMd);
  // 原对象没被污染
  assert.equal(CLAUDE.canvas, '#ffffff');
});

// ── 设计红线 ──

test('永不用纯黑做画布或文字', () => {
  for (const theme of [CLAUDE, DEEPSEEK]) {
    assert.notEqual(theme.canvas.toLowerCase(), '#000000', `${theme.id} 画布是纯黑`);
    assert.notEqual(theme.text.toLowerCase(), '#000000', `${theme.id} 文字是纯黑`);
  }
  for (const [id, override] of Object.entries(DARK_OVERRIDES)) {
    assert.notEqual(override.canvas.toLowerCase(), '#000000', `${id} 深色画布是纯黑`);
  }
});

test('强调色占比克制：软背景透明度都在 0.3 以下', () => {
  for (const theme of [CLAUDE, DEEPSEEK]) {
    for (const token of ['accentSoft', 'successSoft', 'warnSoft', 'dangerSoft']) {
      const match = /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(theme[token]);
      assert.ok(match, `${theme.id}.${token} 不是 rgba 格式`);
      const alpha = Number(match[1]);
      assert.ok(
        alpha > 0 && alpha < 0.3,
        `${theme.id}.${token} 透明度 ${alpha} 太强，会抢视觉重心`,
      );
    }
  }
});

test('Claude 圆角比 DeepSeek 更圆（审美差异）', () => {
  assert.ok(
    CLAUDE.radiusLg > DEEPSEEK.radiusLg,
    'Claude 的大圆角应该比 DeepSeek 更圆',
  );
});
