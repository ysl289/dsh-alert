/**
 * 主题层 —— 两套美术风格。
 *
 * 为什么不是硬编码颜色：
 *   - 本地版用 Claude Code 的珊瑚色卡，上传版用 DeepSeek Harness 的品牌蓝
 *   - 两套的差异只在「色卡」，布局与交互完全一致，所以抽成 token 表
 *   - 用户如果装了换肤插件（比如 dsh-claude-style），我们跟随它，不抢戏
 *
 * 取色依据：dsh-claude-style 的 STYLE.md 里那张 tokens 表
 *   claude   accent #d97757 / canvas #ffffff / #191919 / sidebar #fafafa / #1f1f1f
 *   deepseek accent #4d6bfe / canvas #fbfcff / #13161d / sidebar #f7f9ff / #13161d
 *
 * 原则（抄它的）：永不用纯黑，永不用冷灰；强调色占比控制在 10% 以内。
 */

/** Claude Code 风格：暖珊瑚 + 米白，字重轻、圆角大。 */
export const CLAUDE = {
  id: 'claude',
  name: 'Claude',

  // 色卡
  accent: '#d97757',
  accentHover: '#c8663f',
  accentSoft: 'rgba(217, 119, 87, 0.12)',
  // 珊瑚底上放白字只有 2.9:1；放近黑有 5.3:1
  onAccent: '#1f1e1d',

  canvas: '#ffffff',
  canvasSunken: '#faf9f7',
  surface: '#f4f2f3',
  surfaceHover: '#efeceb',

  border: '#e8e4e1',
  borderStrong: '#d8d2cd',

  text: '#1f1e1d',
  textSecondary: '#5f5954',
  // 弱化文字仍需可读：#fff 上 4.80:1，#faf9f7 上 4.56:1
  textMuted: '#78716b',

  success: '#3d7a4e',
  successSoft: 'rgba(61, 122, 78, 0.10)',
  warn: '#b45309',
  warnSoft: 'rgba(180, 83, 9, 0.10)',
  danger: '#a63d2f',
  dangerSoft: 'rgba(166, 61, 47, 0.10)',

  // 形状与字
  radiusSm: 8,
  radiusMd: 12,
  radiusLg: 16,
  radiusPill: 999,
  fontFamily: "'Söhne', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontWeightNormal: 400,
  fontWeightMedium: 500,
  fontWeightBold: 600,

  // 阴影：Claude 用很淡的一层
  shadow: '0 1px 2px rgba(31, 30, 29, 0.04), 0 4px 12px rgba(31, 30, 29, 0.04)',
  shadowStrong: '0 2px 6px rgba(31, 30, 29, 0.06), 0 12px 28px rgba(31, 30, 29, 0.08)',
};

/** DeepSeek Harness 原生风格：品牌蓝 + 中性灰，字重常规、圆角适中。 */
export const DEEPSEEK = {
  id: 'deepseek',
  name: 'DeepSeek',

  accent: '#4d6bfe',
  accentHover: '#3b56d9',
  accentSoft: 'rgba(77, 107, 254, 0.10)',
  onAccent: '#ffffff',

  canvas: '#ffffff',
  canvasSunken: '#f7f9ff',
  surface: '#f3f4f6',
  surfaceHover: '#e9ebef',

  border: '#e5e7eb',
  borderStrong: '#d1d5db',

  text: '#0f1115',
  textSecondary: '#5b6472',
  // 原来 #9ca3af 只有 2.5:1，几乎看不见；现在 #fff 上 4.64:1
  textMuted: '#667085',

  success: '#15803d',
  successSoft: 'rgba(21, 128, 61, 0.10)',
  warn: '#b45309',
  warnSoft: 'rgba(180, 83, 9, 0.10)',
  danger: '#b91c1c',
  dangerSoft: 'rgba(185, 28, 28, 0.10)',

  radiusSm: 8,
  radiusMd: 10,
  radiusLg: 14,
  radiusPill: 999,
  fontFamily: "inherit",
  fontWeightNormal: 400,
  fontWeightMedium: 500,
  fontWeightBold: 600,

  shadow: '0 1px 2px rgba(15, 17, 21, 0.05)',
  shadowStrong: '0 4px 16px rgba(15, 17, 21, 0.10)',
};

export const THEMES = { claude: CLAUDE, deepseek: DEEPSEEK };

/**
 * 选主题。
 *
 * 优先级：
 *   1. 用户显式指定的（设置里 theme 字段）
 *   2. 跟着宿主的换肤插件走（装了 claude-style 就用 Claude 色卡）
 *   3. 默认 DeepSeek（上传版走这套）
 *
 * @param {string|undefined} explicit
 * @param {boolean} [claudeStyleInstalled]
 * @returns {object}
 */
export function resolveTheme(explicit, claudeStyleInstalled = false) {
  if (explicit === 'claude' || explicit === 'deepseek') return THEMES[explicit];
  if (claudeStyleInstalled) return CLAUDE;
  return DEEPSEEK;
}

/**
 * 深色模式变体。
 *
 * 只覆盖颜色，形状和字重不动 —— 这样切换深色不会让布局跳动。
 */
export const DARK_OVERRIDES = {
  claude: {
    canvas: '#191919',
    canvasSunken: '#1f1f1f',
    surface: '#262626',
    surfaceHover: '#2f2f2f',
    border: '#333333',
    borderStrong: '#444444',
    text: '#f0eee9',
    textSecondary: '#a8a29a',
    // 原来 #7a746e 只有 3.6:1；提到 4.90:1（画布）/ 4.60:1（下沉面）
    textMuted: '#8d8680',
    onAccent: '#191919',
    accentSoft: 'rgba(217, 119, 87, 0.18)',
    success: '#6dbd85',
    successSoft: 'rgba(109, 189, 133, 0.14)',
    warn: '#e0a458',
    warnSoft: 'rgba(224, 164, 88, 0.14)',
    danger: '#e08a7a',
    dangerSoft: 'rgba(224, 138, 122, 0.14)',
    shadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
    shadowStrong: '0 4px 16px rgba(0, 0, 0, 0.4)',
  },
  deepseek: {
    canvas: '#13161d',
    canvasSunken: '#0f1218',
    surface: '#1c2028',
    surfaceHover: '#242933',
    border: '#2a2f3a',
    borderStrong: '#3a4150',
    text: '#eef1f8',
    textSecondary: '#9aa3b2',
    // 原来 #6b7280 只有 4.1:1；提到 5.85:1 / 6.06:1
    textMuted: '#8b93a1',
    onAccent: '#ffffff',
    accentSoft: 'rgba(77, 107, 254, 0.18)',
    success: '#4ade80',
    successSoft: 'rgba(74, 222, 128, 0.14)',
    warn: '#fbbf24',
    warnSoft: 'rgba(251, 191, 36, 0.14)',
    danger: '#f87171',
    dangerSoft: 'rgba(248, 113, 113, 0.14)',
    shadow: '0 1px 2px rgba(0, 0, 0, 0.4)',
    shadowStrong: '0 4px 16px rgba(0, 0, 0, 0.5)',
  },
};

/** 取某个主题在指定配色方案下的完整色卡。 */
export function paletteFor(theme, dark = false) {
  if (!dark) return theme;
  return { ...theme, ...(DARK_OVERRIDES[theme.id] ?? {}) };
}
