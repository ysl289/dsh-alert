<div align="center">

<img src="icon.svg" alt="dsh-alert" width="88" height="88">

# dsh-alert · 手机提醒

**AI 在电脑上干活，人在外面刷手机。跑完了、出错了、等你审批了 —— 手机上响一声。**

[![test](https://github.com/ysl289/dsh-alert/actions/workflows/test.yml/badge.svg)](https://github.com/ysl289/dsh-alert/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![tests](https://img.shields.io/badge/tests-422%20passing-success.svg)](test/)
[![version](https://img.shields.io/github/v/release/ysl289/dsh-alert?label=version)](https://github.com/ysl289/dsh-alert/releases)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4D6BFE)](https://github.com/deepseek-ai)

**7 个免费通道** · **纯提醒，不带审批按钮** · **不强依赖任何其它插件**

</div>

---

📹 **[49 秒介绍视频](docs/demo-v2.mp4)** 　·　🖼 **[设置面板截图](docs/screenshot.png)** 　·　📖 **[引导事实核对表](docs/GUIDE-SOURCES.md)**

---

## 目录

- [它解决什么](#它解决什么)
- [特性一览](#特性一览)
- [什么时候会提醒你](#什么时候会提醒你)
- [什么时候**不**吵你](#什么时候不吵你四道闸门)
- [能推到哪儿](#能推到哪儿7-个免费通道可多选)
- [安装](#安装)
- [快速开始（2 分钟）](#快速开始2-分钟ntfy)
- [各通道配置](#各通道配置)
- [设置项](#设置项)
- [和其它插件联动](#和你已装的插件联动)
- [设计](#设计)
- [常见问题](#常见问题)
- [排错](#排错)
- [开发](#开发)
- [隐私](#隐私)
- [许可](#许可)

---

## 它解决什么

用 AI 跑长任务时，最难受的是这三件事：

| 场景 | 没有这个插件 | 装了这个插件 |
|---|---|---|
| 任务跑完了，你在客厅 | 每隔一会儿回来瞄一眼屏幕 | 手机响一声，回来看结果 |
| 任务卡在「等你审批」 | 半小时后回来才发现，白等 | 手机响一声，回来点一下 |
| 任务报错了，你没看见 | 下次回来才看到红字 | 立刻知道，能重跑 |

**这个插件只做一件事：把通知送到你手机上。** 它没有远程审批按钮 ——
知道「该回来了」就够了，真要点什么还是回电脑上点更稳妥。

---

## 特性一览

| | |
|---|---|
| **7 个通道** | ntfy / 微信（企业微信）/ Bark / Server酱 / Webhook（钉钉·飞书·企微群）/ QQ / 自定义 |
| **可多选同时发** | 开了几个就发几个，任一成功就算成功 |
| **四道防打扰闸门** | 延迟提醒、短任务过滤、免打扰时段、定时汇总 |
| **纯提醒** | 不做远程审批。减少被滥用的面，也少一堆权限 |
| **零依赖** | 不 `require` 任何其它插件。装了 dsh-im / cost-meter / pocket 会自动增强，没装也照常工作 |
| **两套皮肤** | 默认跟随宿主（DeepSeek 蓝）；装了 claude-style 自动切珊瑚色 |
| **失败能自解释** | 常见错误码都配上「这是什么 + 怎么办」，不给干巴巴的报错 |
| **422 项测试** | 三平台 × 两版本 CI。关键约束都有断言锁着 |

---

## 什么时候会提醒你

六个触发器，默认全开，可以单独关：

| 触发器 | 什么时候响 |
|---|---|
| **任务完成** | 一轮对话正常结束 |
| **任务出错** | 出错、被中断 |
| **等你审批** | AI 请求执行需要批准的命令 |
| **等你回答** | AI 用 `ask_user_question` 问你问题 |
| **任务受阻** | 权限不足、目标被阻塞 |
| **目标完成** | 长期目标达成 |

---

## 什么时候**不**吵你（四道闸门）

| 闸门 | 默认行为 | 为什么 |
|---|---|---|
| **延迟提醒** | 等 20 秒再发 | 你 10 秒就回来看屏幕了，通知自动取消 |
| **短任务过滤** | 跑不到 30 秒的不发 | 「你好」这种一问一答不值得吵你 |
| **免打扰时段** | 可设如 `23:00-08:00` | 夜里攒着，早上发一条 |
| **定时汇总** | 可选 30 分钟一条 | 连续跑十个任务时，攒成一条而不是十条 |

四个都能在设置页里调，也可以关掉。

---

## 能推到哪儿（7 个免费通道，可多选）

按**真实动手成本**排序 —— 不是按「官方程度」：

| # | 通道 | 适合谁 | 成本 | 限额 |
|---|---|---|---|---|
| 1 | **ntfy** ⭐ | 所有人 | 装个 App + 订阅，2 分钟 | 无 |
| 2 | **Bark** | iPhone 用户 | 装 App + 复制 key，3 分钟 | 无 |
| 3 | **Server酱** | 想收在微信里 | 微信扫码，1 分钟 | 免费 5 条/天 |
| 4 | **Webhook** | 已有钉钉/飞书/企微群 | 群里加机器人，5 分钟 | 平台限制 |
| 5 | **微信（企业微信）** | 想走官方路径 | 注册企业 + 建应用 + 配 IP，半小时起 | 无 |
| 6 | **自定义** | 有自己服务的开发者 | 有个能收 HTTP 的地址 | 你的 |
| 7 | **QQ** | 已有 QQ 机器人 | 认证 + 抠 openid，最折腾 | 20 条/分钟 |
| + | **IM 复用** | 装了 dsh-im 的人 | 直接复用现成机器人 | 平台限制 |

> **推荐第 1 个。** ntfy 不用注册、不限条数、不用配 IP。
> 企业微信虽好，但它要求「企业可信IP」——家庭宽带是动态 IP，今天加明天变，个人用户基本做不成。

<details>
<summary><b>为什么去掉了 PushPlus 和抖音</b></summary>

- **PushPlus**：免费额度各渠道都是 0，必须付费。这个插件的卖点是「免费能用」，留着它就是在误导人。
- **抖音**：只对企业主体开放，且是「商户 → 粉丝」方向，个人做不了主动推送。

</details>

<details>
<summary><b>已经有 dsh-im 的人：可以直接复用</b></summary>

装了 [@xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) 的话，选「IM 复用」，
直接复用它已经接好的微信 / 飞书 / Telegram 机器人，不用再申请一套推送服务。

需要先在 dsh-im 里给机器人配一个「目标」（齿轮 → 新建目标 → 测试 → 保存），
之后这一页会自动出现下拉框。

</details>

---

## 安装

### 方式一：插件市场（最简单）

打开 DSH → 设置 → 插件 → 搜索 `dsh-alert` → 安装 → **重启 DSH**。

### 方式二：命令行

在 DSH 对话里直接说：

```
帮我装 dsh-alert
```

### 方式三：从 GitHub 装

```bash
# 找到你的 profile 目录（通常 ~/.dsh/profiles/desktop）
cd ~/.dsh/profiles/desktop
npm install github:ysl289/dsh-alert
```

然后在 `package.json` 的 `dsh.profile.bundles` 里加一行 `"dsh-alert"`。

### 方式四：本地目录（改代码调试用）

```bash
cd ~/.dsh/profiles/desktop
npm install /path/to/dsh-alert
```

### 所有方式都要做的最后一步

**重启 DSH。** 插件不是热加载的：

- Desktop：退出应用再打开
- Web：重启 `dsh web`，然后刷新浏览器

重启后进 **设置 → 手机提醒**，就能看到面板了。

---

## 快速开始（2 分钟，ntfy）

以最省事的 ntfy 为例：

1. **手机装 App**
   应用商店搜 `ntfy` 安装。图标是白底黑色小喇叭，开发者 `Philipp Heckel`。

2. **复制主题名**
   面板里已经帮你生成好了，形如 `dsh-7f3a`。点右边复制按钮。

3. **在 App 里订阅**
   打开 ntfy → 右上角 `+` → `Subscribe to topic` → 粘贴 → `SUBSCRIBE`。
   订阅成功后首页会多出一行 `dsh-xxxx`。

4. **回来点「发送测试」**
   手机响一声就配好了。

之后 AI 跑完任务、出错、等你审批时，手机会自动响。

> ⚠️ 主题名就是手机和电脑之间的「暗号」，两边必须完全一致。
> 改完要回 App 里重新订阅。

---

## 各通道配置

每个通道的面板里都有分步引导，写着「在哪儿做 / 看到什么算对 / 注意事项」。
下面是梗概，细节以面板为准。

<details>
<summary><b>ntfy（推荐）</b></summary>

| 字段 | 说明 |
|---|---|
| 主题名 | 必填。手机 App 里订阅的那个名字 |
| 服务器 | 用官方的保持 `https://ntfy.sh` |
| 访问令牌 | 只有自建服务器开了鉴权才需要 |
| 提醒强度 | 默认 `high`（会弹窗置顶）。`default` 只进通知栏 |

**注意**：`default` 优先级不会弹窗，只躺在通知栏里 —— 那就失去意义了。所以默认给了 `high`。

</details>

<details>
<summary><b>Bark（iPhone）</b></summary>

| 字段 | 说明 |
|---|---|
| 设备 Key | 必填。Bark App 里那条地址 `https://api.day.app/XXXXXXXX`，只取斜杠后那段 |
| 服务器地址 | 官方保持 `https://api.day.app` |
| 提示音 / 分组 | 可选 |

**注意**：只填斜杠后那一段。连 `https://` 一起粘会报 `failed to get device token`。

</details>

<details>
<summary><b>微信（企业微信自建应用）</b></summary>

| 字段 | 说明 |
|---|---|
| 企业 ID（CorpID） | 管理后台 →「我的企业」→「企业信息」→ 页面最底部的「企业ID」，ww 开头 |
| 应用 Secret | 管理后台 →「应用管理」→ 点进你建的应用 → Secret 旁点「查看」 |
| 应用 AgentId | 应用详情页顶部「AgentId」后面那串数字 |
| 发给谁 | 留空 = `@all`（发给全企业） |

**⚠️ 这条路有门槛**：企业微信会校验「企业可信IP」。
家庭宽带是动态 IP，今天加了明天可能就变。**个人用户建议直接用 ntfy。**

如果坚持要用，管理后台 →「应用管理」→ 你的应用 →「企业可信IP」里加 IP。

</details>

<details>
<summary><b>Server酱</b></summary>

| 字段 | 说明 |
|---|---|
| SendKey | `SCT` 开头是老版（sct.ftqq.com），`sctp` 开头是新版 Server酱³（sc3.ft07.com） |

两代都支持，插件会自动识别用哪个端点。

**注意**：免费版每天只有 5 条。

</details>

<details>
<summary><b>Webhook（钉钉 / 飞书 / 企微群）</b></summary>

| 字段 | 说明 |
|---|---|
| Webhook 地址 | 必填。整条地址，含 `?access_token=` 或 `/hook/` 后面那段 |
| 平台 | 按地址开头选：`oapi.dingtalk.com`→钉钉，`open.feishu.cn`→飞书，`qyapi.weixin.qq.com`→企微群 |
| 请求体模板 | 留空就按平台自动生成 |
| 额外请求头 | 一般不填 |

**注意**：钉钉和飞书强制要求配「安全设置」。选「自定义关键词」填 `DSH` 最省事——
本插件发的每条消息标题都带 DSH。

</details>

<details>
<summary><b>QQ 机器人</b></summary>

| 字段 | 说明 |
|---|---|
| AppID | 开放平台 → 你的机器人 →「开发设置」→ AppID（纯数字） |
| AppSecret | 同一个页面 → 点「重置」才显示，只显示一次 |
| OpenID | **不是 QQ 号**。来自单聊消息事件 `C2C_MESSAGE_CREATE` 的 `author.user_openid` |

**这条路最折腾**：openid 不在后台界面上直接显示，得从消息事件里取。
建议改用 dsh-im 的扫码接入。

</details>

<details>
<summary><b>自定义 HTTP</b></summary>

| 字段 | 说明 |
|---|---|
| URL | 必填。能接收 HTTP 请求的完整地址 |
| 方法 | 一般 POST |
| 请求头 | 需要鉴权时填 JSON |
| 请求体 | 支持 `{{title}}` `{{body}}` `{{url}}` 占位 |
| 视为成功的状态码 | 默认 2xx |

</details>

<details>
<summary><b>IM 复用（需装 dsh-im）</b></summary>

需要 [@xmanrui/dsh-im](https://github.com/xmanrui/dsh-im)，在它的「设置 → IM机器人」里：

1. 添加机器人（飞书/微信/QQ 扫码，Telegram 填 Bot Token）
2. 点卡片右上角齿轮 → 复制 Bot ID →「新建目标」→ 选已聊会话 → 测试 → 保存
3. 回到本插件的「IM 复用」页，选机器人 + 目标，点发送测试

**注意**：装完 dsh-im 必须重启 DSH，插件不是热加载的。

</details>

---

## 设置项

### 什么时候提醒

| 项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| 六个触发器 | 开关 | 全开 | 见上文触发器表 |
| 延迟提醒 | 秒 | 20 | 这段时间内你回来操作了就取消 |
| 短任务不提醒 | 秒 | 30 | 跑得比这快的不发 |
| 免打扰时段 | 文本 | 空 | 形如 `23:00-08:00` |
| 免打扰时 | 单选 | 攒着之后发 | 也可选直接丢掉 / 照发 |
| 定时汇总 | 开关 + 分钟 | 关 | 攒成一条再发 |

### 提醒里带什么

| 项 | 默认 | 说明 |
|---|---|---|
| 带跳回链接 | 开 | 手机上点得开（需 dsh-pocket） |
| 带上 AI 最后一段回复 | 开 | |
| 带上工作目录 | 关 | |
| 带上花费 | 关 | 需 dsh-cost-meter |
| 子代理会话也提醒 | 关 | |

### 面板外观

跟随宿主 / DeepSeek 蓝 / Claude 珊瑚。装了 claude-style 会自动跟随。

---

## 和你已装的插件联动

**每一条都是可选的。缺了谁，对应增强就安静地不生效，绝不会因此挂掉。**

| 插件 | 联动效果 |
|---|---|
| **dsh-pocket** | 通知里的链接自动换成局域网地址，手机直接点开 |
| **dsh-cost-meter** | 提醒里带上本次花费 |
| **dsh-claude-style** | 面板自动切成珊瑚色 |
| **dsh-im** | 多一个「IM 复用」通道，直接用现成机器人 |
| **dsh-notify-windows** | 桌面也弹一下 |

<details>
<summary><b>dsh-pocket 这条为什么最值钱</b></summary>

默认情况下，通知里的链接是 `http://127.0.0.1:PORT` —— 这个地址在手机上指手机自己，必然打不开。

装了 dsh-pocket 并开启局域网访问后，链接会换成 `http://10.x.x.x:3081`，同一个 WiFi 下手机能直接点开，跳回那个会话。

这个替换是自动的，不需要配置。

</details>

---

## 设计

### 两套皮肤

| 皮肤 | 主色 | 用于 |
|---|---|---|
| DeepSeek（默认） | `#4d6bfe` | 官方风格 |
| Claude | `#d97757` | 配 claude-style 插件 |

两套都经过对比度校验：珊瑚色配白字只有 2.9:1（不达标），所以按钮文字改用了近黑色 `#1f1e1d`，达到 5.33:1。

### 设计规范（都有测试锁着）

- ❌ 不用 emoji 当结构图标（字体依赖、跨平台不一致）
- ✅ 字号只用 12 / 14 / 16 / 20 / 26 五档
- ✅ 间距只用 4 的倍数
- ✅ 触摸目标 ≥ 44px
- ✅ 文字对比度 ≥ 4.5:1
- ✅ 键盘焦点环始终可见
- ✅ 尊重 `prefers-reduced-motion`

> 提醒的「注意事项」用**警示色块 + 图标**表达，而不是在正文里写「注意：」。
> 这是刻意的：颜色比文字前缀更容易被看见。

---

## 常见问题

<details>
<summary><b>装了以后设置里看不到？</b></summary>

先确认重启过 DSH。插件不是热加载的，装完必须重启应用（Web 要重启 `dsh web` 并刷新浏览器）。

还看不到就检查 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 里有没有 `dsh-alert`。

</details>

<details>
<summary><b>点了发送测试，手机没响？</b></summary>

按这个顺序查：

1. 手机上 App 确实装了吗，主题名订阅了吗
2. 主题名两边完全一致吗（大小写、位数）
3. 面板下方有没有红字报错？那行字会告诉你具体原因
4. ntfy 的话，App 里有没有开「instant delivery」——不开可能延迟很久

</details>

<details>
<summary><b>为什么不做远程审批按钮？</b></summary>

这是刻意的取舍。

远程审批意味着插件要能替你「批准」命令执行 —— 这是很大的权限面。
而且手机上点错一下就可能批准了危险操作。

提醒的价值是「让你知道该回来了」，做到这一点就够。

</details>

<details>
<summary><b>为什么企业微信默认排在后面？</b></summary>

因为它要求「企业可信IP」，而家庭宽带是动态 IP。今天加了明天变，个人用户基本做不成。

这不是能力问题，是它的设计面向企业内网。所以面板里明确标了「较麻烦」并前置警告，
而不是等用户走完五步才在最后一步撞墙。

</details>

<details>
<summary><b>为什么设置侧边栏的图标是自制铃铛？</b></summary>

宿主的设置图标是**按 section id 硬编码**的，只认 `account` / `models` /
`agent-presets` / `plugins` / `archived-sessions` 五个 id，其余一律回退成齿轮。
`register()` 里没有 icon 字段 —— 插件侧改不了。

所以本插件按标题文字认出自己那一项，把 svg 换成铃铛。宿主将来改版找不到时，
它会安静失效（变回齿轮），不影响任何功能。

</details>

---

## 排错

面板会把常见错误翻译成人话。下面是完整的映射表：

| 你会看到 | 意思 | 怎么办 |
|---|---|---|
| `errcode 60020` | 企业微信要求可信 IP | 换 ntfy，或把公网 IP 加进白名单 |
| `errcode 40013` | CorpID 不对 | 检查企业 ID 是否 `ww` 开头、有没有复制全 |
| `errcode 40001` | Secret 不对 | Secret 点「查看」重新拿一次 |
| `errcode 81013` | 「发给谁」的账号不存在 | 改成 `@all` |
| `errcode 300005` | 钉钉 webhook token 无效 | 重新加机器人，整条地址复制 |
| `errcode 93000` | 企微群 webhook 地址无效 | 注意别和「企业微信自建应用」搞混 |
| `errcode 310000` | 钉钉关键词没匹配 | 关键词填 `DSH` |
| `failed to get device token` | Bark Key 不对 | 只填斜杠后那段 |
| `[AUTH]错误的Key` | Server酱 SendKey 不对 | 整串复制，别截断 |
| `code 10004` | QQ 说机器人不存在 | AppID 不对，是纯数字 |
| `40034105` | 你在 QQ 里关了主动消息 | 机器人资料页打开 |
| `HTTP 5xx` | 对方服务器出错 | 等几分钟再试，不是你配错 |

更细的来源依据见 [docs/GUIDE-SOURCES.md](docs/GUIDE-SOURCES.md)。

---

## 开发

```bash
git clone https://github.com/ysl289/dsh-alert.git
cd dsh-alert
npm test          # 422 项离线断言
```

### 测试怎么跑

```bash
node scripts/test.mjs     # 跨版本安全，列文件而不是靠 glob
```

> 不要用 `node --test "test/*.test.mjs"` —— Node 20 会把引号里的 glob 当字面量。

### 真实 Cordis 验证

想确认插件在真宿主里能激活（而不只是单测过）：

```bash
# 从 app.asar 里抽出 Cordis（只需一次）
node scripts/extract-cordis.mjs
CORDIS_ENTRY=/path/to/cordis/lib/index.js npm run test:e2e
```

### 目录结构

```
dsh-alert/
├── lib/                 服务端
│   ├── index.js         入口：事件订阅、去重、策略、投递
│   ├── channels/        每个通道独立一个文件，纯对象、可脱离宿主测试
│   ├── policy.js        延迟队列 / 汇总队列 / 免打扰
│   ├── deliver.js       重试与超时
│   ├── integrations.js  探测已装的联动插件
│   └── im-bridge.js     dsh-im 桥接（注意：必须 inject）
├── client/
│   └── client.js        设置面板 + 引导数据 + 图标系统
├── test/                422 项断言
├── docs/                截图、视频、核对表
└── scripts/             测试运行器
```

### 两个必须知道的约束

1. **`Config` 不能导出普通对象。** 宿主会调 `Config['~standard'].validate()`，普通对象会抛 TypeError，然后插件被写成 `disabled: true`。
2. **兄弟插件的服务必须用 `ctx.inject` 拿。** 直接 `ctx.dshIm` 在真实 Cordis 下会抛 `cannot get property without inject`。之前的实现用 try/catch 吞异常，导致「装好了也认不到」——用户踩过。

---

## 隐私

- **不收集任何数据。** 没有统计、没有上报、没有账号。
- **消息只发到你配的那个通道。** 用的是各平台自己的 API。
- **凭据只存在本地。** 在 `~/.dsh/dsh-alert/settings.json`，权限跟随系统用户目录。
- **第三方通道意味着消息经过它。** 选 Server酱 / Webhook 时请注意这点；只想走官方路径就用 ntfy 自建或企业微信。

---

## 许可

[MIT](LICENSE) © ysl289

---

<div align="center">

**[⬆ 回到顶部](#dsh-alert--手机提醒)**

<sub>如果这个插件省了你几次来回跑，给个 ⭐ 就好</sub>

</div>
