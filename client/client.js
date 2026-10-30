/**
 * dsh-alert 设置面板（浏览器端）—— 向导式 + 双美术风格。
 *
 * 目标：让完全不懂的人也能照着做完。
 *
 * 结构：
 *   ① 进度条：配好了没有，一眼看见
 *   ② 选通道：大卡片，带图标和"推荐"角标
 *   ③ 三步引导：大数字 + 每一步一个动作（跳转 / 复制 / 粘贴）
 *   ④ 发送测试：同时就是验证
 *   ⑤ 联动徽标：装了 cost-meter / IM / Claude 皮肤时显示
 *   高级设置折叠，不挡路。
 *
 * 两套美术风格（见 lib/theme.js 的色卡）：
 *   claude   —— 珊瑚色 + 米白，圆角大、字重轻（本地版）
 *   deepseek —— 品牌蓝 + 中性灰（上传版 / 默认）
 *   用户装了换肤插件时自动跟随。
 */

window.__ModuleLoader__.load({
  id: 'dsh-alert',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    var React = require('react');
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useCallback = React.useCallback;
    var useMemo = React.useMemo;

    /** RPC 通道名，必须与 Host 端 lib/rpc.js 的 RPC_CHANNEL 一致。 */
    var RPC_CHANNEL = '/dsh-alert';

    //#region 色卡（与 lib/theme.js 保持一致；这里是浏览器端副本）
    var CLAUDE = {
      id: 'claude',
      accent: '#d97757',
      accentHover: '#c8663f',
      accentSoft: 'rgba(217,119,87,0.12)',
      // 主按钮上放深色文字而不是白字：珊瑚底配白字只有 2.9:1，配近黑有 5.3:1
      onAccent: '#1f1e1d',
      canvas: '#ffffff',
      canvasSunken: '#faf9f7',
      surface: '#f4f2f3',
      surfaceHover: '#efeceb',
      border: '#e8e4e1',
      borderStrong: '#d8d2cd',
      text: '#1f1e1d',
      textSecondary: '#5f5954',
      // 弱化文字必须仍然可读：在 #fff 上 4.80:1，在 #faf9f7 上 4.56:1
      textMuted: '#78716b',
      success: '#3d7a4e',
      successSoft: 'rgba(61,122,78,0.10)',
      warn: '#b45309',
      warnSoft: 'rgba(180,83,9,0.10)',
      danger: '#a63d2f',
      dangerSoft: 'rgba(166,61,47,0.10)',
      radiusSm: 8,
      radiusMd: 12,
      radiusLg: 16,
      fontFamily: "'Söhne','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      fontWeightMedium: 500,
      fontWeightBold: 600,
      shadow: '0 1px 2px rgba(31,30,29,0.04), 0 4px 12px rgba(31,30,29,0.04)',
      shadowStrong: '0 2px 6px rgba(31,30,29,0.06), 0 12px 28px rgba(31,30,29,0.08)',
    };

    var DEEPSEEK = {
      id: 'deepseek',
      accent: '#4d6bfe',
      accentHover: '#3b56d9',
      accentSoft: 'rgba(77,107,254,0.10)',
      onAccent: '#ffffff',
      canvas: '#ffffff',
      canvasSunken: '#f7f9ff',
      surface: '#f3f4f6',
      surfaceHover: '#e9ebef',
      border: '#e5e7eb',
      borderStrong: '#d1d5db',
      text: '#0f1115',
      textSecondary: '#5b6472',
      // 原来 #9ca3af 只有 2.5:1，几乎看不见；这个在 #fff 上 4.64、在 #f7f9ff 上 4.41 仍差一点，
      // 所以下沉面背景的弱化文字改用 textSecondary 级别
      textMuted: '#667085',
      success: '#15803d',
      successSoft: 'rgba(21,128,61,0.10)',
      warn: '#b45309',
      warnSoft: 'rgba(180,83,9,0.10)',
      danger: '#b91c1c',
      dangerSoft: 'rgba(185,28,28,0.10)',
      radiusSm: 8,
      radiusMd: 10,
      radiusLg: 14,
      fontFamily: 'inherit',
      fontWeightMedium: 500,
      fontWeightBold: 600,
      shadow: '0 1px 2px rgba(15,17,21,0.05)',
      shadowStrong: '0 4px 16px rgba(15,17,21,0.10)',
    };

    var DARK = {
      claude: {
        canvas: '#191919', canvasSunken: '#1f1f1f', surface: '#262626', surfaceHover: '#2f2f2f',
        border: '#333333', borderStrong: '#444444',
        text: '#f0eee9', textSecondary: '#a8a29a',
        // 原来 #7a746e 只有 3.6:1；提到 4.90:1（画布）/ 4.60:1（下沉面）
        textMuted: '#8d8680',
        // 深色下珊瑚色配近黑文字仍可读；保持与浅色一致的策略
        onAccent: '#191919',
        accentSoft: 'rgba(217,119,87,0.18)',
        success: '#6dbd85', successSoft: 'rgba(109,189,133,0.14)',
        warn: '#e0a458', warnSoft: 'rgba(224,164,88,0.14)',
        danger: '#e08a7a', dangerSoft: 'rgba(224,138,122,0.14)',
        shadow: '0 1px 2px rgba(0,0,0,0.3)', shadowStrong: '0 4px 16px rgba(0,0,0,0.4)',
      },
      deepseek: {
        canvas: '#13161d', canvasSunken: '#0f1218', surface: '#1c2028', surfaceHover: '#242933',
        border: '#2a2f3a', borderStrong: '#3a4150',
        text: '#eef1f8', textSecondary: '#9aa3b2',
        // 原来 #6b7280 只有 4.1:1；提到 5.85:1 / 6.06:1
        textMuted: '#8b93a1',
        onAccent: '#ffffff',
        accentSoft: 'rgba(77,107,254,0.18)',
        success: '#4ade80', successSoft: 'rgba(74,222,128,0.14)',
        warn: '#fbbf24', warnSoft: 'rgba(251,191,36,0.14)',
        danger: '#f87171', dangerSoft: 'rgba(248,113,113,0.14)',
        shadow: '0 1px 2px rgba(0,0,0,0.4)', shadowStrong: '0 4px 16px rgba(0,0,0,0.5)',
      },
    };

    function palette(id, dark) {
      var base = id === 'claude' ? CLAUDE : DEEPSEEK;
      if (!dark) return base;
      var o = DARK[base.id] || {};
      return Object.assign({}, base, o);
    }

    //#region 设计 token
    /**
     * 字号音阶 —— 模块化，不许在组件里写 11.5 / 13.5 这种任意值。
     *
     * 取 12 / 14 / 16 / 20 / 26，对应 UI 的五个层级：
     *   xs 辅助说明   sm 正文     md 强调正文
     *   lg 卡片标题   xl 页面标题
     */
    var TYPE = {
      xs: 12,
      sm: 14,
      md: 16,
      lg: 20,
      xl: 26,
    };

    /**
     * 间距节奏 —— 4 的倍数。
     *
     * 组件内边距用 2/3，区块之间用 4/5/6，页面级用 8。
     */
    var SPACE = {
      1: 4,
      2: 8,
      3: 12,
      4: 16,
      5: 20,
      6: 24,
      8: 32,
      10: 40,
    };

    /** 行高：正文 1.5，标题 1.3，紧凑 1.4。 */
    var LEADING = { tight: 1.3, normal: 1.5, snug: 1.4 };

    /** 圆角 token，跟随色卡但单独命名，避免各处硬编码 999。 */
    var RADIUS = { xs: 6, sm: 8, md: 12, lg: 16, pill: 999 };

    /** 动画时长：交互反馈 150ms，状态切换 250ms。 */
    var MOTION = { fast: '150ms', base: '250ms', ease: 'cubic-bezier(0.4, 0, 0.2, 1)' };

    /** 焦点环 —— 键盘用户必须能看见自己在哪。 */
    function focusRing(p) {
      return { outline: '2px solid ' + p.accent, outlineOffset: 2 };
    }
    //#endregion

    //#region 图标系统
    /**
     * 内联 SVG 图标 —— 替代原来的 emoji。
     *
     * 为什么换掉 emoji（这是本次改版的核心动机）：
     *   emoji 是字体，不同系统画出来形状/颜色/大小都不一样；它自带颜色，
     *   无法跟随主题色卡；也无法控制描边粗细，和界面其它线条不在一个视觉体系。
     *   对深色模式和换肤都是硬伤。
     *
     * 为什么内联而不是引图标库：客户端模块是单文件离线加载，不能加依赖；
     * 只用十几个图标，内联体积远小于一个库。
     *
     * 统一约束：24×24 viewBox、1.5 描边、round 端点、颜色继承 currentColor。
     */
    var ICON_SIZE = { sm: 16, md: 20, lg: 24 };

    var ICON_PATHS = {
      // 通道
      phone: [['rect', 6, 2, 12, 20, 2], ['line', 10, 18, 14, 18]],
      chat: [['path', 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z']],
      bell: [['path', 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9'], ['path', 'M13.73 21a2 2 0 0 1-3.46 0']],
      robot: [['rect', 4, 8, 16, 12, 2], ['line', 12, 4, 12, 8], ['circle', 9, 14, 1], ['circle', 15, 14, 1], ['line', 8, 18, 16, 18]],
      mail: [['rect', 2, 5, 20, 14, 2], ['path', 'M2 7l10 6 10-6']],
      link: [['path', 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'], ['path', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71']],
      sliders: [['line', 4, 6, 20, 6], ['line', 4, 12, 20, 12], ['line', 4, 18, 20, 18], ['circle', 9, 6, 2], ['circle', 15, 12, 2], ['circle', 7, 18, 2]],
      plug: [['path', 'M12 22v-4'], ['path', 'M9 8V2'], ['path', 'M15 8V2'], ['path', 'M6 8h12v4a6 6 0 0 1-12 0z']],

      // 触发器
      checkCircle: [['circle', 12, 12, 9], ['path', 'M8.5 12.5l2.5 2.5 4.5-5']],
      xCircle: [['circle', 12, 12, 9], ['path', 'M15 9l-6 6'], ['path', 'M9 9l6 6']],
      hand: [['path', 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12'], ['path', 'M11 12V4.5a1.5 1.5 0 0 1 3 0V12'], ['path', 'M14 12V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2.5-4a1.5 1.5 0 0 1 2.5-1.6L8 14']],
      helpCircle: [['circle', 12, 12, 9], ['path', 'M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.2-.9.8-.9 1.4v.3'], ['circle', 12, 17, 0.6]],
      ban: [['circle', 12, 12, 9], ['line', 5.6, 5.6, 18.4, 18.4]],
      target: [['circle', 12, 12, 9], ['circle', 12, 12, 5], ['circle', 12, 12, 1.2]],

      // 联动
      coin: [['circle', 12, 12, 9], ['path', 'M12 7v10'], ['path', 'M14.5 9.5a2.5 2.5 0 0 0-5 0c0 1.5 5 1.5 5 3.5a2.5 2.5 0 0 1-5 0']],
      palette: [['circle', 12, 12, 9], ['circle', 8.5, 10, 1], ['circle', 12, 8, 1], ['circle', 15.5, 10, 1]],
      monitor: [['rect', 2, 4, 20, 13, 2], ['line', 8, 21, 16, 21], ['line', 12, 17, 12, 21]],
      signal: [['path', 'M2 20h.01'], ['path', 'M7 20v-4'], ['path', 'M12 20v-8'], ['path', 'M17 20V8'], ['path', 'M22 20V4']],

      // 界面
      alert: [['path', 'M12 3l9 16H3z'], ['line', 12, 9, 12, 14], ['circle', 12, 17, 0.6]],
      check: [['path', 'M4 12.5l5 5L20 6.5']],
      x: [['path', 'M6 6l12 12'], ['path', 'M18 6L6 18']],
      copy: [['rect', 9, 9, 12, 12, 2], ['path', 'M5 15V5a2 2 0 0 1 2-2h10']],
      external: [['path', 'M15 3h6v6'], ['path', 'M10 14L21 3'], ['path', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6']],
      info: [['circle', 12, 12, 9], ['line', 12, 11, 12, 16], ['circle', 12, 8, 0.6]],
      chevronDown: [['path', 'M6 9l6 6 6-6']],
      gear: [['circle', 12, 12, 3], ['path', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z']],
      server: [['rect', 2, 3, 20, 8, 2], ['rect', 2, 13, 20, 8, 2], ['line', 6, 7, 6.01, 7], ['line', 6, 17, 6.01, 17]],
    };

    /**
     * 渲染一个图标。
     *
     * @param {string} name ICON_PATHS 的键
     * @param {object} [opts] { size, color, label, strokeWidth }
     *   label 不传 = 装饰性图标，对屏幕阅读器隐藏；
     *   label 传了 = 有意义的独立图标，暴露 aria-label。
     */
    function makeIcon(name, opts) {
      opts = opts || {};
      var parts = ICON_PATHS[name];
      if (!parts) return null;

      var size = opts.size || ICON_SIZE.md;
      var props = {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: opts.color || 'currentColor',
        strokeWidth: opts.strokeWidth || 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        // 和文字基线对齐，不靠 margin 硬顶
        style: { display: 'block', flex: 'none', verticalAlign: 'middle' },
      };

      if (opts.label) {
        props.role = 'img';
        props['aria-label'] = opts.label;
      } else {
        props['aria-hidden'] = 'true';
        props.focusable = 'false';
      }

      var children = [];
      for (var i = 0; i < parts.length; i += 1) {
        var part = parts[i];
        var kind = part[0];
        if (kind === 'path') children.push(h('path', { key: i, d: part[1] }));
        else if (kind === 'circle') children.push(h('circle', { key: i, cx: part[1], cy: part[2], r: part[3] }));
        else if (kind === 'line') children.push(h('line', { key: i, x1: part[1], y1: part[2], x2: part[3], y2: part[4] }));
        else if (kind === 'rect') children.push(h('rect', { key: i, x: part[1], y: part[2], width: part[3], height: part[4], rx: part[5] || 0 }));
      }
      return h('svg', props, children);
    }
    //#endregion


    /** 检测系统深色模式；没有 matchMedia 时按浅色。 */
    function prefersDark() {
      try {
        return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      } catch (e) {
        return false;
      }
    }

    /**
     * 用户是否要求减少动效。
     *
     * 这是无障碍要求：前庭功能障碍的用户会因为过渡动画不适。
     * 内联样式没法写 @media，只能在 JS 里读一次然后关掉所有 transition。
     */
    function prefersReducedMotion() {
      try {
        return Boolean(
          window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        );
      } catch (e) {
        return false;
      }
    }
    //#endregion

    //#region 引导数据
    /**
     * 引导数据结构说明（写在这里免得以后又改错）：
     *
     *   text       这一动作做什么（动词开头，一句话）
     *   where      在哪个页面/哪个位置（用户要能照着找到）
     *   look       看到什么就算找对了（给锚点，避免找错地方）
     *   note       注意事项，**数组**。渲染成警示色块，不进正文。
     *              —— 别在 look 里写「注意：xxx」。那是纯文本装饰，
     *                 应该用颜色 + 图标表达，由渲染层负责。
     *   copyField  这一步要复制的值来自哪个配置字段；给了就把值显示出来 + 复制按钮
     *   link       能直接跳过去的地址
     */
    var GUIDES = [
      {
        id: 'ntfy', title: 'ntfy', icon: 'phone',
        subtitle: '免费、不限条数、免注册',
        ease: 1, badge: '推荐',
        steps: [
          {
            text: '在手机上装 ntfy',
            where: '打开手机的应用商店（iPhone 是 App Store，安卓是 Google Play 或「应用市场」），搜索 ntfy 点安装',
            look: '图标是白底黑色小喇叭。认不准就看开发者名：Philipp Heckel',
          },
          {
            text: '复制下面这串主题名',
            where: '点这一行右边那个带复制图标的小按钮',
            look: '复制到的是一串 dsh-xxxx（4 位字母数字）',
            copyField: 'topic',
          },
          {
            text: '在 ntfy App 里订阅这个主题',
            where: '打开 ntfy → 点右上角「+」→ 选「Subscribe to topic」→ 在输入框里长按选「粘贴」→ 点 SUBSCRIBE',
            look: '订阅成功后，App 首页的列表里会多出一行 dsh-xxxx',
          },
          {
            text: '回到这里点「发送测试」',
            where: '就是下面那个蓝色的大按钮，写着「发送测试」',
            look: '手机响一声 = 成功。没响就看下方的红字，它会告诉你具体是哪一步不对',
          },
        ],
        fields: [
          {
            key: 'topic', label: '主题名', type: 'string', placeholder: '自动生成', required: true,
            help: '已经帮你生成好了。这就是手机和电脑之间的「暗号」，两边必须完全一样。想换就改，但改完要回 App 里重新订阅。',
          },
          {
            key: 'server', label: '服务器', type: 'string', placeholder: 'https://ntfy.sh',
            help: '用官方服务器就保持默认，不要改。只有你自己搭了 ntfy 服务器才需要改。',
          },
        ],
      },
      {
        id: 'wecom-app', title: '微信', icon: 'chat',
        subtitle: '官方路径，免费，不经第三方',
        ease: 2, badge: '官方',
        steps: [
          {
            text: '注册企业微信',
            where: '电脑浏览器打开这个网址，用微信扫码',
            look: '个人身份就能注册，不用营业执照。注册完会给你一个企业名字',
            link: 'https://work.weixin.qq.com/', linkText: '打开企业微信',
          },
          {
            text: '进「管理后台」（后面几步都在这里做）',
            where: '浏览器打开 work.weixin.qq.com → 右上角点「管理后台」→ 微信扫码登录',
            look: '进去后是一个网页界面，左侧有一列菜单：「我的企业」「通讯录」「应用管理」「管理工具」等。',
            note: ['这不是手机上的企业微信 App —— App 里没有这些菜单，必须用电脑浏览器进这个网页'],
            link: 'https://work.weixin.qq.com/wework_admin/frame', linkText: '直接打开管理后台',
          },
          {
            text: '建一个自建应用',
            where: '管理后台左侧「应用管理」→ 找到「应用」一栏 → 点「自建」旁边的「创建应用」',
            look: '上传个图标、随便填个名字（比如「DSH 提醒」）。建好后进入应用详情页，能看到 AgentId（一串数字）',
          },
          {
            text: '拿应用 Secret',
            where: '就在刚建的应用详情页里，AgentId 下方有「Secret」→ 点「查看」→ 会发一条消息到你手机企业微信，点开就能看到 Secret',
            look: '一串较长的随机字符。只显示这一次，先复制下来',
          },
          {
            text: '拿企业 ID（CorpID）',
            where: '管理后台左侧「我的企业」→「企业信息」→ 页面拉到最底部',
            look: '一串 ww 开头的字符，标注为「企业ID」',
          },
          {
            text: '扫码关注「微信插件」（不做过不了）',
            where: '管理后台左侧「我的企业」→「微信插件」→ 页面中间有个二维码 → 用你自己微信扫',
            look: '扫完你的微信里会多出一个企业号。',
            note: ['不做这步，消息只会停在企业微信 App 里，进不了你的个人微信'],
          },
          {
            text: '三个值填到下面，点发送测试',
            where: 'CorpID / Secret / AgentId 分别对应下面三个输入框',
            look: '微信收到一条提醒 = 成功。\n如果报 81013：把「发给谁」改成 @all 再试',
          },
        ],
        fields: [
          { key: 'corpId', label: '企业 ID（CorpID）', type: 'string', placeholder: 'ww 开头的一串', required: true, help: '我的企业 → 企业信息 → 页面最底部的「企业ID」' },
          { key: 'secret', label: '应用 Secret', type: 'secret', placeholder: '点「查看」后显示的那串', required: true, help: '应用管理 → 点进你建的应用 → Secret 旁边的「查看」。只显示一次，记下来。' },
          { key: 'agentId', label: '应用 AgentId', type: 'string', placeholder: '纯数字，如 1000002', required: true, help: '应用详情页顶部，「AgentId」后面那串数字' },
          { key: 'toUser', label: '发给谁', type: 'string', placeholder: '@all', help: '留空就是 @all（发给企业里所有人）。个人用建议保持 @all，填具体账号名容易报 81013。' },
        ],
      },
      {
        id: 'bark', title: 'Bark', icon: 'bell',
        subtitle: 'iPhone 专用，免费开源',
        ease: 3,
        steps: [
          {
            text: 'App Store 装 Bark',
            where: '打开 iPhone 上的 App Store，搜索 Bark 后点安装',
            look: '图标是白底黑色小铃铛。认不准就看作者：Finb',
            link: 'https://apps.apple.com/app/bark-customed-notifications/id1403753865', linkText: '打开 App Store',
          },
          {
            text: '在 App 里找到设备 Key',
            where: '打开 Bark → 点底部「服务器」标签页 → 在列表里点你正在用的那条服务器',
            look: '详情页里会显示一行完整地址，形如 https://api.day.app/AbCdEf123456。\n斜杠后面那一段（AbCdEf123456）才是 Key',
          },
          {
            text: '把 Key 填到下面，点「发送测试」',
            where: '填进下面的「设备 Key」框，然后点页面下方蓝色「发送测试」按钮',
            look: '手机响 = 成功。',
            note: ['只填斜杠后面那段，不要把 https:// 或 api.day.app 一起粘进去'],
          },
        ],
        fields: [
          { key: 'key', label: '设备 Key', type: 'secret', placeholder: '只要斜杠后那一段，如 AbCdEf123456', required: true, help: 'Bark App → 服务器 → 点进去 → 地址 https://api.day.app/XXXX 里的 XXXX。注意别把前面的网址也粘进来。' },
          { key: 'server', label: '服务器地址', type: 'string', placeholder: 'https://api.day.app', help: '用官方服务器保持默认。自建 Bark 改成自己的地址。' },
          { key: 'group', label: '通知分组', type: 'string', placeholder: 'DSH', help: '同一分组的通知会在手机锁屏上叠在一起。' },
        ],
      },
      {
        id: 'qqbot', title: 'QQ', icon: 'robot',
        subtitle: '官方机器人，免费',
        ease: 4,
        steps: [
          {
            text: '注册 QQ 开放平台并个人认证',
            where: '电脑浏览器打开这个网址，用手机 QQ 扫码登录，然后按提示做个人实名认证',
            look: '认证通过后才能创建机器人（个人上限 5 个）',
            link: 'https://q.qq.com/', linkText: '打开 QQ 开放平台',
          },
          {
            text: '创建机器人，拿 AppID 和 AppSecret',
            where: '进开放平台后，左侧「机器人」→ 点「创建」→ 填资料 → 建好后进这个机器人的「开发设置」页',
            look: 'AppID 是纯数字。AppSecret 要点「重置」才显示，且只显示一次，先复制下来',
          },
          {
            text: '把你自己加进「开发体验用户」',
            where: '还是在机器人的「开发设置」页，往下找到「开发体验用户」→ 点添加 → 填你自己的 QQ 号',
            look: '不加这一步，机器人给你发消息会直接失败',
          },
          {
            text: '在手机 QQ 里给机器人发一句话',
            where: '打开手机 QQ → 搜索你刚创建的机器人名字 → 进聊天 → 随便发一句「你好」',
            look: '消息发出去后，在开放平台的「开发设置 → 消息推送」或沙箱消息列表里，能看到一条带 openid 字段的记录',
          },
          {
            text: '把 openid 填到下面，点「发送测试」',
            where: '找到记录里的 openid 值，复制进下面的「你的 OpenID」框',
            look: 'QQ 收到消息 = 成功。',
            note: [
              'openid 是一长串字母数字，不是你的 QQ 号',
              '报 40034105 → 你在 QQ 里关掉了「允许机器人主动发消息」，去机器人资料页打开',
            ],
          },
        ],
        fields: [
          { key: 'appId', label: 'AppID', type: 'string', placeholder: '纯数字', required: true, help: '开放平台 → 你的机器人 → 开发设置 → AppID' },
          { key: 'appSecret', label: 'AppSecret', type: 'secret', placeholder: '点重置后显示的那串', required: true, help: '开发设置 → AppSecret → 点「重置」。只显示一次，务必记下来。' },
          { key: 'openId', label: '你的 OpenID', type: 'string', placeholder: '一长串字母数字，不是 QQ 号', required: true, help: '给机器人发一条消息，从消息事件里取 openid。这个值后台界面上不一定直接显示，通常在回调日志里。' },
          { key: 'msgType', label: '消息类型', type: 'select', placeholder: 'text', options: [
            { v: 'text', label: '纯文本（最稳）' },
            { v: 'markdown', label: 'Markdown（需权限）' },
          ], help: '选纯文本最稳。Markdown 需要机器人有对应权限，权限不够会发不出去。' },
        ],
      },
      {
        id: 'serverchan', title: 'Server酱', icon: 'mail',
        subtitle: '微信收，但免费版每天只有 5 条',
        ease: 5,
        warn: '免费版每天只能发 5 条，任务一多就不够用。想长期用建议选上面的 ntfy 或企业微信。',
        steps: [
          {
            text: '微信扫码登录 Server酱',
            where: '电脑浏览器打开这个网址，用微信扫页面中间的二维码',
            look: '登录成功后，页面顶部会显示你的 SendKey',
            link: 'https://sct.ftqq.com/', linkText: '打开 Server酱',
          },
          {
            text: '复制 SendKey',
            where: '页面上标着「SendKey」的那一栏，点右边的复制按钮',
            look: 'SCT 开头的一长串，例如 SCT123456Txxxxxxxxxxxx',
          },
          {
            text: '粘到下面，点「发送测试」',
            where: '填进下面的「SendKey」输入框，再点页面下方蓝色「发送测试」按钮',
            look: '微信会收到一条「Server酱」服务号消息。',
            note: ['别把 SCT 后面的空格也粘进去'],
          },
        ],
        fields: [
          { key: 'sendKey', label: 'SendKey', type: 'secret', placeholder: 'SCT 开头的一长串', required: true, help: 'sct.ftqq.com 登录后首页就有。如果以 sctp 开头说明是 Turbo 版，也能用。' },
        ],
      },
      {
        id: 'webhook', title: 'Webhook', icon: 'link',
        subtitle: '钉钉 / 飞书 / 企业微信群机器人',
        ease: 6,
        steps: [
          {
            text: '先在下面的「平台」下拉框里选你用的是哪个',
            where: '页面下方表单的第一个下拉框，标着「平台」',
            look: '选「钉钉群机器人」/「飞书群机器人」/「企业微信群机器人」。\n选完会自动套用该平台认的消息格式，你不用自己写 JSON',
          },
          {
            text: '在群里添加一个自定义机器人，拿 Webhook 地址',
            where: '钉钉群：群设置（右上角···）→「智能群助手」→「添加机器人」→「自定义」\n飞书群：群设置 →「群机器人」→「添加机器人」→「自定义机器人」\n企微群：群设置 →「群机器人」→「添加」→「新建」',
            look: '创建完最后一步会给你一条 https 开头的地址，这就是 Webhook',
          },
          {
            text: '安全设置选「自定义关键词」，关键词填 DSH',
            where: '就在上一步创建机器人的流程里，会有一页让你选安全方式 → 点「自定义关键词」→ 在输入框里填 DSH',
            look: '钉钉和飞书都强制要求配一种安全方式，选关键词最省事。',
            note: ['关键词必须出现在消息里，否则对方直接拒收 —— 填 DSH 就行，本插件发的每条消息标题都带 DSH'],
          },
          {
            text: '把 Webhook 地址粘到下面，点「发送测试」',
            where: '整条地址填进下面标着「Webhook 地址」的输入框，再点页面下方蓝色「发送测试」按钮',
            look: '群里出现一条测试消息 = 成功。',
            note: ['整条地址都要，包括 ? 后面的 access_token 部分'],
          },
        ],
        fields: [
          { key: 'url', label: 'Webhook 地址', type: 'string', placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=...', required: true, help: '整条地址都要，包括 ? 后面的参数。' },
          { key: 'preset', label: '平台', type: 'select', placeholder: 'generic', options: [
            { v: 'generic', label: '通用 JSON（自己写模板）' },
            { v: 'dingtalk', label: '钉钉群机器人' },
            { v: 'feishu', label: '飞书群机器人' },
            { v: 'wecom', label: '企业微信群机器人' },
            { v: 'slack', label: 'Slack' },
            { v: 'discord', label: 'Discord' },
          ], help: '选错平台会导致对方收不到（消息格式不认）。不确定就选「通用 JSON」。' },
        ],
      },
      {
        id: 'custom', title: '自定义', icon: 'sliders',
        subtitle: '接到你自己的服务',
        ease: 7,
        steps: [
          {
            text: '填你服务的接收地址',
            where: '下面标着「URL」的输入框',
            look: '必须是完整地址，例如 https://your-server.com/notify',
          },
          {
            text: '确认请求体格式',
            where: '标着「请求体」的那个输入框（默认已填好 {"title":"...","body":"..."}）',
            look: '{{title}} {{body}} {{url}} 会被替换成真实内容。你的服务照这个 JSON 解析就行。',
          },
          {
            text: '点「发送测试」',
            where: '页面下方那个蓝色的大按钮',
            look: '你的服务收到请求、返回 2xx 就算成功',
          },
        ],
        fields: [
          { key: 'url', label: 'URL', type: 'string', placeholder: 'https://your-server/notify', required: true, help: '能接收 HTTP 请求的完整地址。' },
          { key: 'method', label: '方法', type: 'select', placeholder: 'POST', options: [
            { v: 'POST', label: 'POST' },
            { v: 'GET', label: 'GET' },
            { v: 'PUT', label: 'PUT' },
          ], help: '大多数情况用 POST。GET 会把内容放 URL 里。' },
          { key: 'body', label: '请求体', type: 'text', placeholder: '{"title":"{{title}}","body":"{{body}}"}', help: '支持 {{title}} {{body}} {{url}} 占位。GET 方法可留空。' },
        ],
      },
      {
        id: 'im', title: 'IM 复用', icon: 'plug',
        subtitle: '装了 IM 插件就能直接用',
        ease: 8, requiresPlugin: true,
        steps: [], fields: [],
      },
    ];

    var TRIGGERS = [
      { key: 'completed', label: '任务完成', icon: 'checkCircle' },
      { key: 'error', label: '任务出错', icon: 'xCircle' },
      { key: 'approval', label: '等你审批', icon: 'hand' },
      { key: 'question', label: '等你回答', icon: 'helpCircle' },
      { key: 'blocked', label: '任务受阻', icon: 'ban' },
      { key: 'goal', label: '目标完成', icon: 'target' },
    ];

    /**
     * 取一步里的注意事项。
     *
     * 兼容两种写法：
     *   note: ['要小心 A', '要小心 B']    ← 推荐
     *   look: '正文\n注意：要小心 A'      ← 老写法，自动拆出来
     *
     * 这样即使以后有人又把注意事项写回正文，也会被正确渲染成警示块，
     * 而不是在界面上露出「注意：」这种纯文本装饰。
     */
    function warningsFor(step) {
      var out = [];
      if (Array.isArray(step.note)) {
        for (var i = 0; i < step.note.length; i += 1) {
          var s = String(step.note[i] || '').trim();
          if (s) out.push(s);
        }
      }
      // 从 look 里捡漏：万一有人把注意事项写回正文
      var lines = String(step.look || '').split('\n');
      for (var j = 1; j < lines.length; j += 1) {
        var m = /^\s*注意[：:]\s*(.+)$/.exec(lines[j]);
        if (m) out.push(m[1].trim());
      }
      return out;
    }
    //#endregion

    //#region 样式生成
    /**
     * 根据色卡生成整套样式。
     *
     * 为什么是函数而不是常量：主题运行时才知道（跟随宿主换肤），深色要换一套颜色。
     *
     * 所有数值都走 TYPE / SPACE / RADIUS / MOTION token，不在组件里写任意值。
     * 这是上一版最大的问题：11.5 / 12.5 / 13.5 混用、间距 5/9/11/13 随意，
     * 单看每一处都还行，整体就没有节奏。
     */
    function buildStyles(p, reducedMotion) {
      var ring = focusRing(p);
      // 用户要求减少动效时，把过渡时长归零（不是删掉 transition，避免布局语义变化）
      var t = reducedMotion ? '0ms' : MOTION.fast + ' ' + MOTION.ease;
      var tb = reducedMotion ? '0ms' : MOTION.base + ' ' + MOTION.ease;

      return {
        wrap: {
          display: 'flex', flexDirection: 'column', gap: SPACE[5],
          maxWidth: 720, fontFamily: p.fontFamily, color: p.text,
          fontSize: TYPE.sm, lineHeight: LEADING.normal,
        },

        // ── 头部 ──
        head: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACE[4] },
        headText: { display: 'flex', flexDirection: 'column', gap: SPACE[1], minWidth: 0 },
        h2: {
          margin: 0, fontSize: TYPE.lg, fontWeight: p.fontWeightBold,
          color: p.text, letterSpacing: '-0.01em', lineHeight: LEADING.tight,
        },
        desc: { margin: 0, fontSize: TYPE.sm, lineHeight: LEADING.normal, color: p.textSecondary },

        // ── 进度 ──
        progress: {
          display: 'flex', alignItems: 'center', gap: SPACE[3],
          padding: SPACE[3] + 'px ' + SPACE[4] + 'px',
          borderRadius: p.radiusMd, background: p.canvasSunken,
          border: '1px solid ' + p.border,
        },
        progressBar: { flex: 1, height: 6, borderRadius: RADIUS.pill, background: p.surface, overflow: 'hidden' },
        progressFill: {
          height: '100%', borderRadius: RADIUS.pill, background: p.accent,
          transition: 'width ' + tb,
        },
        progressText: {
          fontSize: TYPE.xs, fontWeight: p.fontWeightMedium, color: p.textSecondary,
          whiteSpace: 'nowrap',
        },

        // ── 卡片 ──
        card: {
          background: p.canvas, border: '1px solid ' + p.border, borderRadius: p.radiusLg,
          padding: SPACE[5], display: 'flex', flexDirection: 'column', gap: SPACE[4],
          boxShadow: p.shadow,
        },
        stepTag: {
          fontSize: TYPE.xs, fontWeight: p.fontWeightBold, color: p.accent,
          letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: SPACE[2],
        },

        // ── 通道卡片 ──
        cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(148px,1fr))', gap: SPACE[3] },
        pick: {
          font: 'inherit', textAlign: 'left', cursor: 'pointer',
          border: '1px solid ' + p.border, background: p.canvas, color: p.text,
          borderRadius: p.radiusMd, padding: SPACE[3],
          display: 'flex', flexDirection: 'column', gap: SPACE[1], position: 'relative',
          // 用 border-color 而不是 transform 做反馈，避免布局抖动
          transition: 'border-color ' + t + ', background ' + t + ', box-shadow ' + t,
          minHeight: 44,
        },
        pickHover: { borderColor: p.borderStrong, background: p.surface },
        pickOn: { borderColor: p.accent, background: p.accentSoft, boxShadow: 'inset 0 0 0 1px ' + p.accent },
        pickIcon: { color: p.textSecondary, marginBottom: SPACE[1] },
        pickIconOn: { color: p.accent },
        pickTitle: { fontSize: TYPE.sm, fontWeight: p.fontWeightBold, color: p.text, lineHeight: LEADING.snug },
        pickSub: { fontSize: TYPE.xs, lineHeight: LEADING.snug, color: p.textSecondary },
        badge: {
          position: 'absolute', top: -8, right: SPACE[2],
          fontSize: TYPE.xs, padding: '2px ' + SPACE[2] + 'px',
          borderRadius: RADIUS.pill, background: p.accent, color: p.onAccent,
          fontWeight: p.fontWeightBold, letterSpacing: '0.02em',
        },
        readyTag: {
          fontSize: TYPE.xs, color: p.success, fontWeight: p.fontWeightBold,
          display: 'flex', alignItems: 'center', gap: SPACE[1], marginTop: SPACE[1],
        },
        needTag: { fontSize: TYPE.xs, color: p.textMuted, fontWeight: p.fontWeightMedium, marginTop: SPACE[1] },

        // ── 步骤 ──
        steps: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none' },
        step: {
          display: 'flex', gap: SPACE[3], alignItems: 'flex-start',
          fontSize: TYPE.sm, lineHeight: LEADING.normal,
          padding: SPACE[2] + 'px 0', position: 'relative',
        },
        num: {
          flex: 'none', width: 24, height: 24, borderRadius: '50%',
          background: p.accentSoft, color: p.accent,
          fontSize: TYPE.xs, fontWeight: p.fontWeightBold,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        },
        connector: {
          position: 'absolute', left: 11.5, top: 32, width: 1,
          height: 'calc(100% - 24px)', background: p.border,
        },
        stepBody: { display: 'flex', flexDirection: 'column', gap: SPACE[1], flex: 1, minWidth: 0 },
        stepTitle: {
          fontWeight: p.fontWeightMedium, color: p.text,
          display: 'flex', alignItems: 'center', gap: SPACE[2], flexWrap: 'wrap',
        },
        stepSub: { fontSize: TYPE.xs, color: p.textSecondary, lineHeight: LEADING.normal },

        // 「在哪儿做」—— 上一版最缺的锚点
        stepWhere: {
          display: 'flex', gap: SPACE[1], alignItems: 'flex-start',
          fontSize: TYPE.xs, color: p.textSecondary, lineHeight: LEADING.normal,
          background: p.canvasSunken, borderRadius: p.radiusSm,
          padding: SPACE[2], marginTop: 2,
        },
        stepWhereText: { flex: 1, minWidth: 0, whiteSpace: 'pre-wrap' },
        // 「看到什么算对」
        stepLook: {
          display: 'flex', gap: SPACE[1], alignItems: 'flex-start',
          fontSize: TYPE.xs, color: p.textSecondary, lineHeight: LEADING.normal,
          paddingLeft: SPACE[2], marginTop: 2,
        },
        stepLookText: { flex: 1, minWidth: 0, whiteSpace: 'pre-wrap' },

        // 注意事项：用警示底色 + 图标，不靠正文里的「注意：」字样
        stepWarn: {
          display: 'flex', gap: SPACE[2], alignItems: 'flex-start',
          marginTop: SPACE[1], padding: SPACE[2] + 'px ' + SPACE[3] + 'px',
          borderRadius: p.radiusSm,
          background: p.warnSoft,
          border: '1px solid ' + p.warn,
        },
        stepWarnIcon: { color: p.warn, flex: 'none', marginTop: 1 },
        stepWarnBody: { display: 'flex', flexDirection: 'column', gap: SPACE[1], flex: 1, minWidth: 0 },
        stepWarnLine: {
          fontSize: TYPE.xs, lineHeight: LEADING.normal,
          color: p.warn, fontWeight: p.fontWeightMedium, whiteSpace: 'pre-wrap',
        },

        // 要复制的值：明文 + 复制按钮
        copyRow: {
          display: 'flex', alignItems: 'center', gap: SPACE[2],
          marginTop: SPACE[1], flexWrap: 'wrap',
        },
        copyValue: {
          fontFamily: "ui-monospace,SFMono-Regular,Menlo,'Cascadia Code',monospace",
          fontSize: TYPE.xs, padding: SPACE[1] + 'px ' + SPACE[2] + 'px',
          borderRadius: RADIUS.xs, background: p.accentSoft, color: p.accent,
          border: '1px solid ' + p.accent, wordBreak: 'break-all',
          fontWeight: p.fontWeightMedium,
        },
        // 输入框下方的说明
        fieldHelp: {
          fontSize: TYPE.xs, color: p.textSecondary, lineHeight: LEADING.normal,
          marginTop: -SPACE[1],
        },

        // 出错排查
        troubleshoot: {
          display: 'flex', flexDirection: 'column', gap: SPACE[3],
          marginTop: SPACE[2], padding: SPACE[3],
          borderRadius: p.radiusSm, background: p.dangerSoft,
          border: '1px solid ' + p.danger,
        },
        troubleshootItem: { display: 'flex', flexDirection: 'column', gap: SPACE[1] },
        troubleshootTitle: {
          display: 'flex', alignItems: 'center', gap: SPACE[2],
          fontSize: TYPE.xs, fontWeight: p.fontWeightBold, color: p.danger,
        },
        troubleshootList: {
          margin: 0, paddingLeft: SPACE[5],
          display: 'flex', flexDirection: 'column', gap: SPACE[1],
        },
        troubleshootLine: {
          fontSize: TYPE.xs, lineHeight: LEADING.normal, color: p.text,
        },
        link: {
          color: p.accent, textDecoration: 'none', fontWeight: p.fontWeightMedium,
          whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: SPACE[1],
          borderRadius: RADIUS.xs, padding: '1px 2px',
        },
        linkHover: { textDecoration: 'underline' },

        // ── 表单 ──
        field: { display: 'flex', flexDirection: 'column', gap: SPACE[2] },
        fieldLabel: { fontSize: TYPE.xs, color: p.textSecondary, fontWeight: p.fontWeightMedium },
        input: {
          font: 'inherit', fontSize: TYPE.sm, padding: SPACE[2] + 'px ' + SPACE[3] + 'px',
          borderRadius: p.radiusSm, border: '1px solid ' + p.borderStrong,
          background: p.canvas, color: p.text, width: '100%', boxSizing: 'border-box',
          minHeight: 44, transition: 'border-color ' + t + ', box-shadow ' + t,
        },
        inputFocus: { borderColor: p.accent, boxShadow: '0 0 0 3px ' + p.accentSoft },

        // ── 按钮 ──
        // 高度 44 起，满足触控目标下限；小按钮靠 padding 扩展热区
        btn: {
          font: 'inherit', fontSize: TYPE.sm, fontWeight: p.fontWeightMedium, cursor: 'pointer',
          border: '1px solid ' + p.borderStrong, background: p.canvas, color: p.text,
          height: 44, padding: '0 ' + SPACE[4] + 'px', borderRadius: RADIUS.pill,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: SPACE[2],
          whiteSpace: 'nowrap', transition: 'background ' + t + ', border-color ' + t,
        },
        btnHover: { background: p.surfaceHover },
        btnSmall: {
          font: 'inherit', fontSize: TYPE.xs, fontWeight: p.fontWeightMedium, cursor: 'pointer',
          border: '1px solid ' + p.borderStrong, background: p.canvas, color: p.textSecondary,
          height: 32, padding: '0 ' + SPACE[3] + 'px', borderRadius: RADIUS.pill,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: SPACE[1],
          transition: 'background ' + t,
        },
        btnPrimary: {
          font: 'inherit', fontSize: TYPE.md, fontWeight: p.fontWeightBold, cursor: 'pointer',
          border: 'none', background: p.accent, color: p.onAccent,
          height: 48, padding: '0 ' + SPACE[6] + 'px', borderRadius: RADIUS.pill,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: SPACE[2],
          transition: 'background ' + t + ', opacity ' + t,
        },
        btnPrimaryHover: { background: p.accentHover },
        disabled: { opacity: 0.5, cursor: 'not-allowed' },
        footer: { display: 'flex', alignItems: 'center', gap: SPACE[3], flexWrap: 'wrap' },

        // ── 状态 ──
        status: { fontSize: TYPE.sm, lineHeight: LEADING.normal, margin: 0 },
        ok: { color: p.success },
        err: { color: p.danger },
        muted: { fontSize: TYPE.xs, lineHeight: LEADING.normal, color: p.textSecondary, margin: 0 },
        callout: {
          margin: 0, fontSize: TYPE.xs, lineHeight: LEADING.normal,
          padding: SPACE[3], borderRadius: p.radiusSm,
          background: p.warnSoft, color: p.warn,
          display: 'flex', gap: SPACE[2], alignItems: 'flex-start',
        },
        calloutOk: { background: p.successSoft, color: p.success },
        calloutIcon: { flex: 'none', marginTop: 1 },
        code: {
          fontFamily: "ui-monospace,SFMono-Regular,Menlo,'Cascadia Code',monospace",
          fontSize: TYPE.xs, padding: '2px ' + SPACE[2] + 'px', borderRadius: RADIUS.xs,
          background: p.surface, color: p.text,
          border: '1px solid ' + p.border,
        },

        // ── 联动徽标 ──
        badges: { display: 'flex', flexWrap: 'wrap', gap: SPACE[2] },
        integBadge: {
          fontSize: TYPE.xs, padding: SPACE[1] + 'px ' + SPACE[3] + 'px',
          borderRadius: RADIUS.pill, background: p.successSoft, color: p.success,
          fontWeight: p.fontWeightMedium,
          display: 'inline-flex', alignItems: 'center', gap: SPACE[2],
        },

        // ── 链接可打开性说明 ──
        linkNote: {
          display: 'flex', gap: SPACE[3], alignItems: 'flex-start',
          padding: SPACE[3], borderRadius: p.radiusSm,
          background: p.canvasSunken, border: '1px solid ' + p.border,
        },
        linkNoteIcon: { flex: 'none', marginTop: 1 },
        linkNoteBody: { display: 'flex', flexDirection: 'column', gap: SPACE[1], flex: 1, minWidth: 0 },
        linkNoteTitle: { fontSize: TYPE.xs, fontWeight: p.fontWeightBold, color: p.text },
        linkNoteSub: { fontSize: TYPE.xs, lineHeight: LEADING.normal, color: p.textSecondary },
        linkNoteRow: {
          display: 'flex', alignItems: 'center', gap: SPACE[2],
          marginTop: SPACE[1], flexWrap: 'wrap',
        },

        // ── 开关 ──
        toggle: {
          width: 44, height: 26, borderRadius: RADIUS.pill, border: 'none', cursor: 'pointer',
          position: 'relative', flex: 'none', background: p.borderStrong,
          transition: 'background ' + t, padding: 0,
        },
        toggleOn: { background: p.accent },
        knob: {
          position: 'absolute', top: 3, width: 20, height: 20, borderRadius: '50%',
          background: '#fff', transition: 'left ' + t,
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        },

        // ── 高级设置 ──
        summary: {
          fontSize: TYPE.sm, cursor: 'pointer', color: p.textSecondary,
          fontWeight: p.fontWeightMedium, userSelect: 'none',
          display: 'flex', alignItems: 'center', gap: SPACE[2],
          padding: SPACE[2] + 'px 0', minHeight: 44,
        },
        adv: { display: 'flex', flexDirection: 'column', gap: SPACE[4], marginTop: SPACE[3] },
        row: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: SPACE[3], minHeight: 44,
        },
        rowLabel: { fontSize: TYPE.sm, color: p.text },
        rowHint: { fontSize: TYPE.xs, color: p.textSecondary, marginTop: 2 },
        chips: { display: 'flex', flexWrap: 'wrap', gap: SPACE[2] },
        chip: {
          font: 'inherit', fontSize: TYPE.xs, cursor: 'pointer',
          padding: SPACE[2] + 'px ' + SPACE[3] + 'px',
          borderRadius: RADIUS.pill, border: '1px solid ' + p.borderStrong,
          background: p.canvas, color: p.textSecondary,
          minHeight: 36, transition: 'background ' + t + ', border-color ' + t,
        },
        chipOn: { borderColor: p.accent, background: p.accent, color: p.onAccent, fontWeight: p.fontWeightMedium },
        inputSmall: {
          font: 'inherit', fontSize: TYPE.sm, padding: SPACE[2] + 'px ' + SPACE[3] + 'px',
          borderRadius: p.radiusSm, border: '1px solid ' + p.borderStrong,
          background: p.canvas, color: p.text, width: 128, minHeight: 44,
        },
        select: {
          font: 'inherit', fontSize: TYPE.sm, padding: SPACE[2] + 'px ' + SPACE[3] + 'px',
          borderRadius: p.radiusSm, border: '1px solid ' + p.borderStrong,
          background: p.canvas, color: p.text, minHeight: 44,
        },

        // 焦点环：键盘用户必须看得见自己在哪
        focus: ring,
      };
    }
    //#endregion

    //#region 小组件
    function Toggle(props) {
      var S = props.S;
      var on = props.value !== false;
      var s = useState(false);
      var focused = s[0];
      var setFocused = s[1];
      return h(
        'button',
        {
          type: 'button', role: 'switch',
          'aria-checked': on ? 'true' : 'false',
          'aria-label': props.label || '',
          style: Object.assign(
            {},
            S.toggle,
            on ? S.toggleOn : {},
            focused ? S.focus : {},
          ),
          onFocus: function () { setFocused(true); },
          onBlur: function () { setFocused(false); },
          onClick: function () { props.onChange(!on); },
        },
        h('span', { style: Object.assign({}, S.knob, { left: on ? 21 : 3 }) }),
      );
    }

    function legacyCopy(text) {
      try {
        var ta = document.createElement('textarea');
        ta.value = String(text);
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) {
        return false;
      }
    }

    function copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(String(text)).then(
            function () { return true; },
            function () { return legacyCopy(text); },
          );
        }
      } catch (e) { /* 落到降级 */ }
      return Promise.resolve(legacyCopy(text));
    }

    /** 带 hover 效果和焦点环的按钮。 */
    function Btn(props) {
      var S = props.S;
      var s0 = useState(false);
      var hover = s0[0];
      var setHover = s0[1];
      var s1 = useState(false);
      var focused = s1[0];
      var setFocused = s1[1];
      var base = props.primary ? S.btnPrimary : props.small ? S.btnSmall : S.btn;
      var hoverStyle = props.primary ? S.btnPrimaryHover : S.btnHover;
      return h(
        'button',
        {
          type: 'button',
          style: Object.assign(
            {},
            base,
            props.disabled ? S.disabled : {},
            hover && !props.disabled ? hoverStyle : {},
            // 焦点环只在键盘聚焦时出现（浏览器 :focus-visible 的等价实现）
            focused && !props.disabled ? S.focus : {},
            props.style || {},
          ),
          disabled: props.disabled,
          onMouseEnter: function () { setHover(true); },
          onMouseLeave: function () { setHover(false); },
          onFocus: function () { setFocused(true); },
          onBlur: function () { setFocused(false); },
          onClick: props.onClick,
        },
        props.icon ? makeIcon(props.icon, { size: ICON_SIZE.sm }) : null,
        props.children,
      );
    }
    //#endregion

    //#region 出错排查
    /**
     * 常见错误 → 具体该改什么。
     *
     * 这是「傻子都能做成」的最后一道保险：失败了不能只甩一句报错，
     * 要直接告诉他去改哪个框。
     *
     * 匹配用错误文本里的关键词，不依赖精确文案（服务商随时会改措辞）。
     */
    var TROUBLESHOOT = [
      // ── 通用 ──
      {
        match: /ENOTFOUND|EAI_AGAIN|getaddrinfo|ECONNREFUSED|network|fetch failed|timeout|ETIMEDOUT/i,
        title: '连不上服务器',
        fix: [
          '检查电脑能不能上网（浏览器打开 https://ntfy.sh 试试）',
          '如果开了代理/梯子，先关掉再试 —— 有些通知服务走代理反而连不上',
          '公司网络可能拦了这些域名，换手机热点试一次',
        ],
      },
      {
        match: /主题名没填|topic/i,
        title: '主题名是空的',
        fix: ['回到上面「主题名」框，点右边的「复制」把生成的 dsh-xxxx 填进去'],
      },
      {
        match: /没填|missing|required/i,
        title: '有必填项没填',
        fix: ['把下面每个标了「必填」的框都填上（没有「可不填」字样的都是必填）'],
      },

      // ── ntfy ──
      {
        match: /ntfy.*40[13]|Unauthorized|403/i,
        title: 'ntfy 拒绝了请求',
        fix: [
          '如果你用的是自建服务器，需要填「访问令牌」',
          '如果用官方 ntfy.sh，把「服务器」框清空或保持 https://ntfy.sh',
        ],
      },

      // ── 企业微信 ──
      {
        match: /errcode 40013|invalid corpid/i,
        title: 'CorpID 不对',
        fix: ['重新复制：管理后台 →「我的企业」→「企业信息」→ 最底部「企业ID」，ww 开头的那串'],
      },
      {
        match: /errcode 40001|invalid credential|secret/i,
        title: 'Secret 不对',
        fix: [
          'Secret 要点「查看」才显示，别复制成别的应用的',
          '如果 Secret 泄露过被重置了，去后台重新生成一个再填',
        ],
      },
      {
        match: /errcode 60020|not allow to access from your ip|ip/i,
        title: '企业微信 IP 白名单拦了',
        fix: [
          '管理后台 →「应用管理」→ 你的应用 →「企业可信IP」',
          '把电脑的公网 IP 加进去，或者先清空白名单（内网自用可以先关掉限制）',
        ],
      },
      {
        match: /errcode 81013|invalid user|invalidparty|invalidtag/i,
        title: '「发给谁」填的账号不存在',
        fix: ['把「发给谁」改成 @all（发给全企业），个人用这是最简单的'],
      },
      {
        match: /errcode 45009|api freq|超频/i,
        title: '调用太频繁',
        fix: ['等一分钟再试。企业微信有每分钟调用上限。'],
      },

      // ── Bark ──
      {
        match: /Bark.*code 400|failed to get device|key/i,
        title: 'Bark Key 不对',
        fix: [
          '只填地址里斜杠后面那一段，例如 https://api.day.app/AbCdEf123456 只填 AbCdEf123456',
          '不要带 https:// 或 api.day.app',
          '确认手机上的 Bark 没有被卸载、Key 没被重置',
        ],
      },

      // ── QQ ──
      {
        match: /40034105/,
        title: '你在 QQ 里关掉了「允许机器人主动发消息」',
        fix: [
          '手机 QQ → 找到你的机器人 → 点进聊天 → 右上角设置 → 打开「允许机器人主动发消息」',
        ],
      },
      {
        match: /40034100/,
        title: '超出 QQ 主动消息频控',
        fix: ['QQ 限制 20 条/分钟、1000 条/天，等一会儿再试'],
      },
      {
        match: /QQ.*401|access_token|appid|secret/i,
        title: 'QQ 凭据不对',
        fix: [
          'AppID 是纯数字，AppSecret 要点「重置」才显示且只显示一次',
          '确认机器人没有被平台下架或封禁',
        ],
      },

      // ── Webhook ──
      {
        match: /errcode 310000|keywords not in content|关键词/i,
        title: '钉钉/飞书的关键词校验没过',
        fix: [
          '创建机器人时选了「自定义关键词」，消息里必须包含那个词',
          '最简单的办法：把关键词设成 DSH，我们发的每条消息标题都带 DSH',
          '或者改用「加签」方式，但那样更麻烦，建议用关键词',
        ],
      },
      {
        match: /errcode 300001|token is not exist|invalid token/i,
        title: 'Webhook 地址不对或机器人被删了',
        fix: ['重新在群里加一次机器人，把新地址完整复制过来（包括 ?access_token= 后面那段）'],
      },
      {
        match: /errcode 400|errcode 40058/i,
        title: '消息格式和平台对不上',
        fix: ['回到上面把「平台」选成你实际用的那个（钉钉 / 飞书 / 企微群），选错格式对方不认'],
      },

      // ── Server酱 ──
      {
        match: /Server酱|sendkey|SCT/i,
        title: 'Server酱 SendKey 不对或额度用完',
        fix: [
          'SendKey 是 SCT 开头的一长串，别复制成别的',
          '免费版每天只有 5 条，超了就等明天或换 ntfy',
        ],
      },
    ];

    /**
     * 渲染排查建议。
     *
     * @param {object} S 样式
     * @param {string} channelId 当前通道
     * @param {object} result 测试结果
     */
    function renderTroubleshoot(S, channelId, result) {
      // 把所有错误文本拼起来做匹配
      var texts = [];
      if (result.error) texts.push(String(result.error));
      for (var i = 0; i < (result.results || []).length; i += 1) {
        var r = result.results[i];
        if (r && r.error) texts.push(String(r.error));
      }
      var blob = texts.join(' ');

      var hits = [];
      for (var k = 0; k < TROUBLESHOOT.length; k += 1) {
        if (TROUBLESHOOT[k].match.test(blob)) hits.push(TROUBLESHOOT[k]);
      }

      // 没匹配上就给出该通道的通用检查清单
      if (hits.length === 0) {
        var g = null;
        for (var m = 0; m < GUIDES.length; m += 1) {
          if (GUIDES[m].id === channelId) { g = GUIDES[m]; break; }
        }
        var generic = ['对着上面的步骤再走一遍，特别注意「看到什么算对」那一行'];
        if (g && g.fields) {
          for (var n = 0; n < g.fields.length; n += 1) {
            var f = g.fields[n];
            if (f.required && f.help) generic.push(f.label + '：' + f.help);
          }
        }
        hits = [{ title: '没认出具体原因，逐项检查这些', fix: generic }];
      }

      return h(
        'div',
        { style: S.troubleshoot },
        hits.slice(0, 3).map(function (hit, idx) {
          return h(
            'div',
            { key: idx, style: S.troubleshootItem },
            h(
              'span',
              { style: S.troubleshootTitle },
              makeIcon('alert', { size: ICON_SIZE.sm, color: S.troubleshootTitle.color }),
              hit.title,
            ),
            h(
              'ul',
              { style: S.troubleshootList },
              hit.fix.map(function (line, j) {
                return h('li', { key: j, style: S.troubleshootLine }, line);
              }),
            ),
          );
        }),
      );
    }
    //#endregion


    //#region IM 面板
    function ImPanel(props) {
      var S = props.S;
      var im = props.im || { installed: false, bots: [], targets: {} };
      var cfg = props.cfg || {};

      if (!im.installed) {
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: SPACE[3] } },
          h('p', { style: S.muted }, '这条不是必须的。但如果你已经装了 IM 插件，就能直接用微信 / 飞书 / Telegram 收提醒，不用再装 ntfy 之类的 App。'),
          h(
            'ul',
            { style: S.steps },
            [
              ['装 IM 插件', '在 DSH 插件页装 @xmanrui/dsh-im，或在对话里说「装 dsh-im」'],
              ['接入机器人', '在它的设置里扫码接入微信 / 飞书 / Telegram'],
              ['回来选一下', '选机器人 + 投递目标，点发送测试'],
            ].map(function (row, i) {
              return h(
                'li',
                { key: i, style: S.step },
                h('span', { style: S.num }, String(i + 1)),
                h(
                  'span',
                  { style: S.stepBody },
                  h('span', { style: S.stepTitle }, row[0]),
                  h('span', { style: S.stepSub }, row[1]),
                ),
              );
            }),
          ),
          h('p', { style: Object.assign({}, S.muted, { color: S.accent, fontWeight: S.rowLabel.fontWeight || 500 }) }, '装好后这一页会自动变成选择框，不用重新配置。'),
        );
      }

      var bots = im.bots || [];
      if (bots.length === 0) {
        return h('p', { style: S.muted }, 'IM 插件装了，但还没接入任何机器人。先去它的设置里扫码接一个，再回来。');
      }

      var targets = (im.targets || {})[cfg.botId] || [];

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: SPACE[3] } },
        h(
          'label',
          { style: S.field },
          h('span', { style: S.fieldLabel }, '机器人'),
          h(
            'select',
            {
              style: S.select,
              value: cfg.botId || '',
              onChange: function (e) {
                props.onChange('botId', e.target.value);
                props.onChange('targetId', '');
              },
            },
            h('option', { value: '' }, '选一个…'),
            bots.map(function (b) {
              return h('option', { key: b.botId, value: b.botId }, b.channel + ' · ' + String(b.botId).slice(0, 12));
            }),
          ),
        ),
        cfg.botId
          ? h(
              'label',
              { style: S.field },
              h('span', { style: S.fieldLabel }, '投递目标'),
              targets.length === 0
                ? h('span', { style: S.muted }, '这个机器人还没有保存的投递目标，先去 IM 插件里加一个。')
                : h(
                    'select',
                    {
                      style: S.select,
                      value: cfg.targetId || '',
                      onChange: function (e) { props.onChange('targetId', e.target.value); },
                    },
                    h('option', { value: '' }, '选一个…'),
                    targets.map(function (t) {
                      return h('option', { key: t.targetId, value: t.targetId }, t.name || t.targetId);
                    }),
                  ),
            )
          : null,
      );
    }
    //#endregion

    //#region 主面板
    function AlertPanel(props) {
      var rpcCall = props.rpcCall;

      var s0 = useState(null); var data = s0[0]; var setData = s0[1];
      var s1 = useState(''); var error = s1[0]; var setError = s1[1];
      var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
      var s3 = useState(''); var notice = s3[0]; var setNotice = s3[1];
      var s4 = useState(''); var testing = s4[0]; var setTesting = s4[1];
      var s5 = useState(null); var testResult = s5[0]; var setTestResult = s5[1];
      var s6 = useState(''); var copied = s6[0]; var setCopied = s6[1];
      var s7 = useState(''); var picked = s7[0]; var setPicked = s7[1];

      var load = useCallback(function () {
        setError('');
        rpcCall('status', {})
          .then(function (res) {
            if (res && res.ok) setData(res.value);
            else setError((res && res.error && res.error.message) || '读取失败');
          })
          .catch(function (e) { setError(String((e && e.message) || e)); });
      }, [rpcCall]);

      useEffect(function () { load(); }, [load]);

      // 主题：服务端已经解析好了（它才知道装没装换肤插件），优先用它给的结论。
      // 只有老宿主不返回 theme 时才自己退化成客户端判断。
      var themeId = (data && data.settings && data.settings.theme) || 'auto';
      var resolved = (data && data.theme && data.theme.id)
        ? data.theme.id
        : themeId === 'auto'
          ? ((data && data.integrations && data.integrations.claudeStyle) ? 'claude' : 'deepseek')
          : themeId;

      var s8 = useState(prefersDark()); var dark = s8[0]; var setDark = s8[1];
      var s9 = useState(prefersReducedMotion()); var reduceMotion = s9[0]; var setReduceMotion = s9[1];
      useEffect(function () {
        try {
          if (!window.matchMedia) return;
          var mq = window.matchMedia('(prefers-color-scheme: dark)');
          var onChange = function (e) { setDark(Boolean(e.matches)); };
          if (mq.addEventListener) mq.addEventListener('change', onChange);
          else if (mq.addListener) mq.addListener(onChange);

          // 减少动效的偏好可能被用户随时改，跟着变
          var mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
          var onMotion = function (e) { setReduceMotion(Boolean(e.matches)); };
          if (mqMotion.addEventListener) mqMotion.addEventListener('change', onMotion);
          else if (mqMotion.addListener) mqMotion.addListener(onMotion);
        } catch (e) { /* 忽略 */ }
      }, []);

      var S = useMemo(
        function () { return buildStyles(palette(resolved, dark), reduceMotion); },
        [resolved, dark, reduceMotion],
      );

      var draft = data ? data.settings : null;
      var ready = (data && data.ready) || [];
      var im = (data && data.im) || { installed: false, bots: [], targets: {} };
      var integ = (data && data.integrations) || {};

      var activeId = picked;
      if (!activeId) {
        if (ready.length > 0) activeId = ready[0];
        else if (draft) {
          var enabledOne = (draft.channels || []).find(function (c) { return c.enabled !== false; });
          activeId = enabledOne ? enabledOne.id : GUIDES[0].id;
        } else activeId = GUIDES[0].id;
      }

      var activeGuide = GUIDES.find(function (g) { return g.id === activeId; }) || GUIDES[0];

      var patch = useCallback(function (changes) {
        setData(function (prev) {
          if (!prev) return prev;
          return Object.assign({}, prev, { settings: Object.assign({}, prev.settings, changes) });
        });
        setNotice('');
      }, []);

      var patchTrigger = useCallback(function (key, value) {
        setData(function (prev) {
          if (!prev) return prev;
          var triggers = Object.assign({}, prev.settings.triggers, {});
          triggers[key] = value;
          return Object.assign({}, prev, { settings: Object.assign({}, prev.settings, { triggers: triggers }) });
        });
        setNotice('');
      }, []);

      var selectChannel = useCallback(function (id) {
        setPicked(id);
        setData(function (prev) {
          if (!prev) return prev;
          var list = (prev.settings.channels || []).slice();
          var idx = -1;
          for (var i = 0; i < list.length; i += 1) { if (list[i].id === id) { idx = i; break; } }
          if (idx === -1) list.push({ id: id, enabled: true, config: {} });
          else list[idx] = Object.assign({}, list[idx], { enabled: true });
          return Object.assign({}, prev, { settings: Object.assign({}, prev.settings, { channels: list }) });
        });
        setNotice('');
        setTestResult(null);
      }, []);

      var patchChannel = useCallback(function (id, key, value) {
        setData(function (prev) {
          if (!prev) return prev;
          var list = (prev.settings.channels || []).slice();
          var idx = -1;
          for (var i = 0; i < list.length; i += 1) { if (list[i].id === id) { idx = i; break; } }
          if (idx === -1) {
            var init = {}; init[key] = value;
            list.push({ id: id, enabled: true, config: init });
          } else {
            var nextCfg = Object.assign({}, list[idx].config);
            nextCfg[key] = value;
            list[idx] = Object.assign({}, list[idx], { enabled: true, config: nextCfg });
          }
          return Object.assign({}, prev, { settings: Object.assign({}, prev.settings, { channels: list }) });
        });
        setNotice('');
        setTestResult(null);
      }, []);

      var cfgOf = useCallback(function (id) {
        var entry = (draft && draft.channels ? draft.channels : []).find(function (c) { return c.id === id; });
        return (entry && entry.config) || {};
      }, [draft]);

      var persist = useCallback(function () {
        if (!draft) return Promise.reject(new Error('还没加载完'));
        return rpcCall('save', { settings: draft }).then(function (res) {
          if (res && res.ok) {
            setData(function (prev) {
              return Object.assign({}, prev, { settings: res.value.settings, ready: res.value.ready || prev.ready });
            });
            return res.value;
          }
          throw new Error((res && res.error && res.error.message) || '保存失败');
        });
      }, [draft, rpcCall]);

      var onTest = useCallback(function () {
        var id = activeId;
        setTesting(id);
        setTestResult(null);
        setNotice('');
        persist()
          .then(function () { return rpcCall('test', { channel: id }); })
          .then(function (res) {
            if (res && res.ok) {
              setTestResult(res.value);
              if (res.value && res.value.ok) setNotice('配好了！手机看下有没有响');
            } else {
              setTestResult({ ok: false, results: [], error: (res && res.error && res.error.message) || '测试失败' });
            }
          })
          .catch(function (e) { setTestResult({ ok: false, results: [], error: String((e && e.message) || e) }); })
          .then(function () { setTesting(''); load(); });
      }, [activeId, persist, rpcCall, load]);

      var onCopy = useCallback(function (key, value) {
        copyText(value).then(function (ok) {
          if (!ok) return;
          setCopied(key);
          setTimeout(function () { setCopied(''); }, 1600);
        });
      }, []);

      // ── 渲染 ──

      if (error) {
        return h(
          'div',
          { style: S.wrap },
          h(
            'div',
            { style: S.card },
            h('p', { style: Object.assign({}, S.status, S.err) }, '读不到设置：' + error),
            h(Btn, { S: S, onClick: load }, '重试'),
          ),
        );
      }

      if (!draft) {
        return h('div', { style: S.wrap }, h('p', { style: S.muted }, '读取中…'));
      }

      var triggers = draft.triggers || {};
      var activeCfg = cfgOf(activeId);
      var isReady = ready.length > 0;

      // 进度：0 = 没配，50 = 选了通道，100 = 配好了
      var progressPct = isReady ? 100 : activeId ? 50 : 0;
      var progressLabel = isReady ? '已接通，可以用了' : activeId ? '差最后一步：点发送测试' : '还没开始';

      // 联动徽标（图标 + 文字，不是 emoji）
      var integBadges = [];
      if (integ.costMeter) integBadges.push({ icon: 'coin', text: '成本统计已联动' });
      if (integ.im) integBadges.push({ icon: 'plug', text: 'IM 插件已检测到' });
      if (integ.claudeStyle) integBadges.push({ icon: 'palette', text: '跟随 Claude 皮肤' });
      if (integ.desktopNotify) integBadges.push({ icon: 'monitor', text: '桌面通知已装（手机不重复响）' });
      if (integ.pocket && integ.pocketUrl) integBadges.push({ icon: 'signal', text: '手机链接可用' });
      else if (integ.pocket) integBadges.push({ icon: 'signal', text: 'dsh-pocket 已装，但局域网没开' });

      return h(
        'div',
        { style: S.wrap },

        // 标题
        h(
          'div',
          { style: S.head },
          h(
            'div',
            { style: S.headText },
            h('h2', { style: S.h2 }, '手机提醒'),
            h('p', { style: S.desc }, isReady ? '已接通。AI 跑完 / 出错 / 等你审批时，手机会响一声。' : '照着下面两步做，两分钟搞定。'),
          ),
          h(Toggle, {
            S: S, value: draft.enabled !== false, label: '总开关',
            onChange: function (v) { patch({ enabled: v }); },
          }),
        ),

        // 进度条
        h(
          'div',
          { style: S.progress },
          h('div', { style: S.progressBar }, h('div', { style: Object.assign({}, S.progressFill, { width: progressPct + '%' }) })),
          h('span', { style: S.progressText }, progressLabel),
        ),

        // 联动徽标
        integBadges.length
          ? h(
              'div',
              { style: S.badges },
              integBadges.map(function (b, i) {
                return h(
                  'span',
                  { key: i, style: S.integBadge },
                  makeIcon(b.icon, { size: ICON_SIZE.sm }),
                  b.text,
                );
              }),
            )
          : null,

        // ① 选通道
        h(
          'div',
          { style: S.card },
          h(
            'div',
            { style: S.stepTag },
            makeIcon('target', { size: ICON_SIZE.sm }),
            '第 1 步 · 选一个能收到的地方',
          ),
          h(
            'div',
            { style: S.cards },
            GUIDES.slice().sort(function (a, b) { return a.ease - b.ease; }).map(function (g) {
              var on = g.id === activeId;
              var done = ready.indexOf(g.id) !== -1;
              var needsInstall = g.requiresPlugin && !im.installed;
              return h(
                'button',
                {
                  key: g.id, type: 'button',
                  // 选中状态对屏幕阅读器也要可见
                  'aria-pressed': on ? 'true' : 'false',
                  style: Object.assign({}, S.pick, on ? S.pickOn : {}, needsInstall && !on ? { opacity: 0.7 } : {}),
                  onClick: function () { selectChannel(g.id); },
                },
                g.badge && on ? h('span', { style: S.badge }, g.badge) : null,
                h('span', { style: Object.assign({}, S.pickIcon, on ? S.pickIconOn : {}) },
                  makeIcon(g.icon, { size: ICON_SIZE.lg })),
                h('span', { style: S.pickTitle }, g.title),
                h('span', { style: S.pickSub }, g.subtitle),
                done
                  ? h('span', { style: S.readyTag }, makeIcon('check', { size: 14 }), '已配好')
                  : null,
                needsInstall ? h('span', { style: S.needTag }, '需装 IM 插件') : null,
              );
            }),
          ),
        ),

        // ② 照着做
        h(
          'div',
          { style: S.card },
          h(
            'div',
            { style: S.stepTag },
            makeIcon('sliders', { size: ICON_SIZE.sm }),
            '第 2 步 · 照着做',
          ),

          activeId === 'im'
            ? h(ImPanel, {
                S: S, im: im, cfg: activeCfg,
                onChange: function (key, value) { patchChannel('im', key, value); },
                onCopy: onCopy, copied: copied,
              })
            : h(
                'ul',
                { style: S.steps },
                (activeGuide.steps || []).map(function (step, i) {
                  var copyValue = step.copyField ? String(activeCfg[step.copyField] || '') : '';
                  var isLast = i === (activeGuide.steps || []).length - 1;
                  return h(
                    'li',
                    { key: i, style: S.step },
                    !isLast ? h('span', { style: S.connector }) : null,
                    h('span', { style: S.num }, String(i + 1)),
                    h(
                      'span',
                      { style: S.stepBody },
                      h(
                        'span',
                        { style: S.stepTitle },
                        step.text,
                        step.link
                          ? h(
                              'a',
                              { href: step.link, target: '_blank', rel: 'noreferrer noopener', style: S.link },
                              step.linkText || '打开',
                              makeIcon('external', { size: 13 }),
                            )
                          : null,
                      ),
                      // 在哪儿做：这是上一版最缺的锚点
                      step.where
                        ? h(
                            'span',
                            { style: S.stepWhere },
                            makeIcon('target', { size: 13 }),
                            h('span', { style: S.stepWhereText }, step.where),
                          )
                        : null,
                      // 看到什么算对：避免用户找错地方
                      step.look
                        ? h(
                            'span',
                            { style: S.stepLook },
                            makeIcon('info', { size: 13 }),
                            h('span', { style: S.stepLookText }, String(step.look).split('\n')[0]),
                          )
                        : null,
                      // 需要提醒的地方单独用警示色块，不靠在正文里写「注意：」
                      warningsFor(step).length
                        ? h(
                            'span',
                            { style: S.stepWarn },
                            h('span', { style: S.stepWarnIcon }, makeIcon('alert', { size: 13 })),
                            h(
                              'span',
                              { style: S.stepWarnBody },
                              warningsFor(step).map(function (w, wi) {
                                return h('span', { key: wi, style: S.stepWarnLine }, w);
                              }),
                            ),
                          )
                        : null,
                      // 要复制的值必须明文显示出来，不能只给个「复制」按钮
                      copyValue
                        ? h(
                            'span',
                            { style: S.copyRow },
                            h('code', { style: S.copyValue }, copyValue),
                            h(Btn, {
                              S: S, small: true, icon: copied === step.copyField ? 'check' : 'copy',
                              onClick: function () { onCopy(step.copyField, copyValue); },
                            }, copied === step.copyField ? '已复制' : '复制'),
                          )
                        : null,
                    ),
                  );
                }),
              ),

          activeGuide.warn
            ? h(
                'p',
                { style: S.callout },
                h('span', { style: S.calloutIcon }, makeIcon('alert', { size: ICON_SIZE.sm })),
                h('span', null, activeGuide.warn),
              )
            : null,

          // 输入框
          activeId === 'im'
            ? null
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: SPACE[3] } },
                (activeGuide.fields || []).map(function (f) {
                  var raw = activeCfg[f.key];
                  var fallback = f.key === 'server' ? 'https://ntfy.sh' : (f.type === 'select' ? (f.placeholder || '') : '');
                  var value = raw === undefined || raw === '' ? fallback : raw;
                  var inputId = 'dsh-alert-' + activeId + '-' + f.key;
                  var labelEl = h('span', { style: S.fieldLabel }, f.label + (f.required ? '' : '（可不填）'));
                  var helpEl = f.help
                    ? h('span', { id: inputId + '-help', style: S.fieldHelp }, f.help)
                    : null;
                  var describedBy = f.help ? inputId + '-help' : undefined;

                  // 下拉框：用于「平台 / 方法 / 消息类型」这类必须选对才有用的字段
                  if (f.type === 'select' && Array.isArray(f.options)) {
                    return h(
                      'label',
                      { key: f.key, htmlFor: inputId, style: S.field },
                      labelEl,
                      h(
                        'select',
                        {
                          id: inputId,
                          name: f.key,
                          style: S.select,
                          value: value,
                          'aria-describedby': describedBy,
                          onChange: function (e) { patchChannel(activeId, f.key, e.target.value); },
                        },
                        f.options.map(function (o) {
                          return h('option', { key: o.v, value: o.v }, o.label);
                        }),
                      ),
                      helpEl,
                    );
                  }

                  return h(
                    'label',
                    { key: f.key, htmlFor: inputId, style: S.field },
                    labelEl,
                    h('input', {
                      id: inputId,
                      name: f.key,
                      type: f.type === 'secret' ? 'password' : 'text',
                      placeholder: f.placeholder || '',
                      style: S.input,
                      value: value,
                      autoComplete: f.type === 'secret' ? 'new-password' : 'off',
                      'aria-describedby': describedBy,
                      onChange: function (e) { patchChannel(activeId, f.key, e.target.value); },
                    }),
                    helpEl,
                  );
                }),
              ),

          // ③ 测试
          h(
            'div',
            { style: Object.assign({}, S.footer, { marginTop: SPACE[1] }) },
            h(
              Btn,
              { S: S, primary: true, disabled: Boolean(testing), onClick: onTest, icon: 'bell' },
              testing ? '发送中…' : '发送测试',
            ),
            notice
              ? h('span', { style: Object.assign({}, S.status, S.ok, { display: 'inline-flex', alignItems: 'center', gap: SPACE[2] }) },
                  makeIcon('check', { size: ICON_SIZE.sm }), notice)
              : null,
          ),

          testResult
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: SPACE[2] } },
                h(
                  'p',
                  { style: Object.assign({}, S.status, testResult.ok ? S.ok : S.err, { display: 'flex', alignItems: 'center', gap: SPACE[2] }) },
                  makeIcon(testResult.ok ? 'checkCircle' : 'xCircle', { size: ICON_SIZE.sm }),
                  testResult.ok ? '发出去了，看看手机' : '没发出去' + (testResult.error ? '：' + testResult.error : ''),
                ),
                (testResult.results || []).map(function (r, i) {
                  return h(
                    'p',
                    { key: i, style: Object.assign({}, S.status, r.ok ? S.ok : S.err, { display: 'flex', alignItems: 'center', gap: SPACE[2], paddingLeft: SPACE[4] }) },
                    makeIcon(r.ok ? 'check' : 'x', { size: 14 }),
                    r.channel + (r.error ? '：' + r.error : ''),
                  );
                }),
                // 失败时给出「照着改」的具体动作，而不是让用户自己猜
                !testResult.ok ? renderTroubleshoot(S, activeId, testResult) : null,
              )
            : null,
        ),

        // 高级（折叠）
        h(
          'div',
          { style: S.card },
          h(
            'details',
            null,
            h(
              'summary',
              { style: S.summary },
              makeIcon('gear', { size: ICON_SIZE.sm }),
              '高级设置：什么时候提醒 / 提醒什么 / 外观',
            ),

            h(
              'div',
              { style: S.adv },

              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: SPACE[2] } },
                h('div', { style: S.rowLabel }, '什么时候提醒'),
                h(
                  'div',
                  { style: S.chips },
                  TRIGGERS.map(function (tr) {
                    var on = triggers[tr.key] !== false;
                    return h(
                      'button',
                      {
                        key: tr.key, type: 'button',
                        // 开关状态要能被读屏念出来
                        'aria-pressed': on ? 'true' : 'false',
                        style: Object.assign({}, S.chip, on ? S.chipOn : {}),
                        onClick: function () { patchTrigger(tr.key, triggers[tr.key] === false); },
                      },
                      makeIcon(tr.icon, { size: ICON_SIZE.sm }),
                      tr.label,
                    );
                  }),
                ),
              ),

              h(
                'div',
                { style: S.row },
                h('span', { style: S.rowLabel }, '通知里带跳回链接'),
                h(Toggle, { S: S, value: draft.openOnClick !== false, label: '带跳回链接', onChange: function (v) { patch({ openOnClick: v }); } }),
              ),

              // 链接能不能在手机上打开，取决于有没有 dsh-pocket
              draft.openOnClick !== false
                ? h(
                    'div',
                    { style: S.linkNote },
                    h(
                      'span',
                      { style: S.linkNoteIcon },
                      makeIcon(integ.pocketUrl ? 'signal' : 'alert', {
                        size: ICON_SIZE.md,
                        color: integ.pocketUrl ? S.ok.color : S.callout.color,
                      }),
                    ),
                    h(
                      'div',
                      { style: S.linkNoteBody },
                      h(
                        'span',
                        { style: S.linkNoteTitle },
                        integ.pocketUrl
                          ? '手机上点得开'
                          : integ.pocket
                            ? 'dsh-pocket 装了，但局域网访问是关的'
                            : '手机上点不开（链接是 127.0.0.1）',
                      ),
                      h(
                        'span',
                        { style: S.linkNoteSub },
                        integ.pocketUrl
                          ? '提醒里的链接会指向 ' + integ.pocketUrl + '，手机连同一个 WiFi 就能直接打开会话。'
                          : integ.pocket
                            ? '去「手机访问」设置页把局域网访问打开，链接就会自动换成手机能用的地址。'
                            : '装上 dsh-pocket（手机访问）插件后，链接会自动换成手机能打开的地址。现在这个链接只在电脑上有效。',
                      ),
                      integ.pocketUrl
                        ? h(
                            'div',
                            { style: S.linkNoteRow },
                            h('code', { style: S.code }, integ.pocketUrl),
                            h(
                              Btn,
                              {
                                S: S, small: true, icon: copied === 'pocketUrl' ? 'check' : 'copy',
                                onClick: function () { onCopy('pocketUrl', integ.pocketUrl); },
                              },
                              copied === 'pocketUrl' ? '已复制' : '复制',
                            ),
                          )
                        : null,
                    ),
                  )
                : null,

              h(
                'div',
                { style: S.row },
                h('span', { style: S.rowLabel }, '延迟提醒（秒）'),
                h('input', {
                  type: 'number', min: 0, step: 5, style: S.inputSmall,
                  value: draft.delaySeconds,
                  onChange: function (e) { patch({ delaySeconds: Number(e.target.value) || 0 }); },
                }),
              ),

              h(
                'div',
                { style: S.row },
                h('span', { style: S.rowLabel }, '短任务不提醒（秒）'),
                h('input', {
                  type: 'number', min: 0, step: 10, style: S.inputSmall,
                  value: draft.minTurnDurationSeconds,
                  onChange: function (e) { patch({ minTurnDurationSeconds: Number(e.target.value) || 0 }); },
                }),
              ),

              h(
                'div',
                { style: S.row },
                h('span', { style: S.rowLabel }, '免打扰时段'),
                h('input', {
                  type: 'text', placeholder: '23:00-08:00',
                  style: Object.assign({}, S.inputSmall, { width: 140 }),
                  value: draft.quietHours || '',
                  onChange: function (e) { patch({ quietHours: e.target.value }); },
                }),
              ),

              h(
                'div',
                { style: S.row },
                h('span', { style: S.rowLabel }, '免打扰时'),
                h(
                  'select',
                  {
                    style: S.select, value: draft.quietMode || 'digest',
                    onChange: function (e) { patch({ quietMode: e.target.value }); },
                  },
                  h('option', { value: 'digest' }, '攒着之后发'),
                  h('option', { value: 'drop' }, '直接丢掉'),
                  h('option', { value: 'send' }, '照发'),
                ),
              ),

              h(
                'div',
                { style: S.row },
                h('span', { style: S.rowLabel }, '带上 AI 最后一段回复'),
                h(Toggle, { S: S, value: draft.includeExcerpt !== false, label: '带上回复摘要', onChange: function (v) { patch({ includeExcerpt: v }); } }),
              ),

              h(
                'div',
                { style: S.row },
                h('span', { style: S.rowLabel }, '带上工作目录'),
                h(Toggle, { S: S, value: draft.includeCwd === true, label: '带上工作目录', onChange: function (v) { patch({ includeCwd: v }); } }),
              ),

              h(
                'div',
                { style: S.row },
                h('span', { style: S.rowLabel }, '子代理会话也提醒'),
                h(Toggle, { S: S, value: draft.includeSubagents === true, label: '子代理也提醒', onChange: function (v) { patch({ includeSubagents: v }); } }),
              ),

              integ.costMeter
                ? h(
                    'div',
                    { style: S.row },
                    h('span', { style: S.rowLabel }, '带上本轮花费（需 cost-meter）'),
                    h(Toggle, { S: S, value: draft.includeCost === true, label: '带上花费', onChange: function (v) { patch({ includeCost: v }); } }),
                  )
                : null,

              // 外观
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: SPACE[2] } },
                h('div', { style: S.rowLabel }, '面板外观'),
                h(
                  'div',
                  { style: S.chips },
                  [
                    { v: 'auto', label: '跟随宿主' },
                    { v: 'deepseek', label: 'DeepSeek 蓝' },
                    { v: 'claude', label: 'Claude 珊瑚' },
                  ].map(function (o) {
                    var on = (draft.theme || 'auto') === o.v;
                    return h(
                      'button',
                      {
                        key: o.v, type: 'button',
                        'aria-pressed': on ? 'true' : 'false',
                        style: Object.assign({}, S.chip, on ? S.chipOn : {}),
                        onClick: function () { patch({ theme: o.v }); },
                      },
                      o.label,
                    );
                  }),
                ),
              ),

              h(
                'div',
                { style: S.footer },
                h(
                  Btn,
                  {
                    S: S, disabled: busy,
                    onClick: function () {
                      setBusy(true);
                      setNotice('');
                      persist()
                        .then(function () { setNotice('已保存'); })
                        .catch(function (e) { setNotice(String((e && e.message) || e)); })
                        .then(function () { setBusy(false); });
                    },
                  },
                  busy ? '保存中…' : '保存',
                ),
                h(Btn, { S: S, onClick: load }, '重新读取'),
              ),
            ),
          ),
        ),
      );
    }
    //#endregion

    //#region 插件入口
    var name = 'dsh-alert';
    var inject = ['slots', 'connection'];

    function apply(ctx) {
      var rpcCall = function (endpoint, payload) {
        return ctx.connection.rpc.call(RPC_CHANNEL, endpoint, payload || {});
      };

      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          {
            name: 'settings.section',
            id: 'dsh-alert',
            order: 5,
            label: function () { return '手机提醒'; },
            inject: function () { return { rpcCall: rpcCall }; },
          },
          AlertPanel,
        );
      });
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    exports.AlertPanel = AlertPanel;
    exports.ImPanel = ImPanel;
    exports.GUIDES = GUIDES;
    exports.TRIGGERS = TRIGGERS;
    exports.buildStyles = buildStyles;
    exports.palette = palette;
    exports.CLAUDE = CLAUDE;
    exports.DEEPSEEK = DEEPSEEK;
    exports.ICON_PATHS = ICON_PATHS;
    exports.ICON_SIZE = ICON_SIZE;
    exports.makeIcon = makeIcon;
    exports.TYPE = TYPE;
    exports.SPACE = SPACE;
    exports.RADIUS = RADIUS;
    exports.MOTION = MOTION;
    exports.prefersReducedMotion = prefersReducedMotion;
    return module.exports;
  },
});
