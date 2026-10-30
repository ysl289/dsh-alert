# 引导事实核对表

> 每个渠道的引导步骤，必须能追溯到具体来源。
> 这张表是写引导时的依据，也是日后核对的入口。

## 核对原则

1. **不凭印象写界面名称**。写「管理后台」「设置里」这种模糊词之前，先确认它到底叫什么、从哪进。
2. **优先读官方文档或源码**。插件包里的 README / 文档是最可靠的一手资料。
3. **拿不到可靠来源时，教「怎么认」而不是「背菜单」**。比如 Bark 各版本界面不同，就写「看到 https://api.day.app/XXXX 形式就对了」。
4. **实测过的写实测**。比如 Server酱 端点、Bark 错误响应，都是实际发请求验证过的。

## 各渠道依据

| 渠道 | 依据来源 | 核对状态 |
|---|---|---|
| **ntfy** | [docs.ntfy.sh/subscribe/phone](https://docs.ntfy.sh/subscribe/phone/) | ✅ 已读官方文档 |
| **Bark** | 官方文档是 SPA 抓不到正文；改用**实测 API**：三种地址形式（纯路径 / `?device_key=` / 带标题路径）都能识别出同一个 device token | ✅ 关键事实已实测（Key = device token）；界面路径按「怎么认」写 |
| **Server酱** | [doc.ft07.com/zh/serverchan3/server/api](https://doc.ft07.com/zh/serverchan3/server/api) | ✅ 已读官方文档 + 实测两个端点 |
| **企业微信** | 腾讯官方开发者文档（此前已核对）；IP 白名单限制由**用户实测报错 60020 证实** | ✅ 文档 + 实测 |
| **QQ 机器人** | [bot.q.qq.com 启动接入](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/getting-started.html) + [事件订阅与通知](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html) | ✅ 已读官方文档：确认只要 AppID+AppSecret（Token 已弃用）、openid 来自 `C2C_MESSAGE_CREATE` 事件、关「主动消息」对应 `C2C_MSG_REJECT` |
| **Webhook** | 三家**实测错误码**（见下表）+ 消息格式实测；创建机器人的菜单路径仍属通用描述 | ✅ 错误码与格式已实测；⚠️ 菜单路径未逐家核官方文档 |
| **IM 复用** | `@xmanrui/dsh-im` 包内 `README.md` + `PROACTIVE_DELIVERY.md`（v5.7.0） | ✅ 已读一手文档，重写全部步骤 |

## QQ 机器人官方事实（已核对）

| 事实 | 来源 |
|---|---|
| 只需 `AppID` + `AppSecret`；`Token` 字段**已弃用** | 启动接入页「接入票据」表 |
| openid 来自单聊消息事件 `C2C_MESSAGE_CREATE` | 事件订阅页 intents 表 |
| 用户关掉「主动消息推送」时平台发 `C2C_MSG_REJECT` 事件 | 同上（`GROUP_AND_C2C_EVENT` 位） |
| 订阅单聊事件需要 `GROUP_AND_C2C_EVENT (1 << 25)` 这个 intent | 同上 |
| 回调地址只允许 80/443/8080/8443 端口 | webhook 方式一节 |
| 回调需要 ed25519 签名校验（seed = AppSecret） | 签名校验一节 |

## Webhook 三家实测记录（2026-10）

用无效 token 真发请求，观察服务端返回：

| 平台 | 端点 | 无效 token 返回 | 含义 |
|---|---|---|---|
| 钉钉 | `oapi.dingtalk.com/robot/send?access_token=` | `{"errcode":300005,"errmsg":"token is not exist"}` | HTTP 200，错误在 body |
| 飞书 | `open.feishu.cn/open-apis/bot/v2/hook/` | `{"code":19001,"msg":"...access token invalid"}` | 用 `code` 不是 `errcode` |
| 企微群 | `qyapi.weixin.qq.com/cgi-bin/webhook/send?key=` | `{"errcode":93000,"errmsg":"invalid webhook url"}` | HTTP 200 |

**消息格式差异**（已由单元测试锁定）：

```
钉钉 / 企微群   {"msgtype":"text","text":{"content":"..."}}
飞书           {"msg_type":"text","content":{"text":"..."}}   ← 下划线不同
```

**未实测项**：关键词/加签不匹配的错误码（钉钉 310000、飞书 19021）需要真实 token 才能触发，
本次无真实 token，按社区资料写入，已在测试注释里标注。

## 已修正的事实错误（记录在案，避免重犯）

| 位置 | 原来写的（错） | 实际是 |
|---|---|---|
| IM 入口 | 「在它的设置里扫码接入」 | 「设置 → IM机器人」；不同渠道接入方式不同（扫码/Manifest/填凭据） |
| IM 目标 | 「投递目标」 | dsh-im 里叫「目标」，要通过卡片右上角**齿轮** → 「新建目标」创建 |
| IM 流程 | 直接选机器人+目标 | 要先复制 **Bot ID**，再新建目标、测试、保存 |
| Server酱 端点 | `https://push.ft07.com/<key>.send` | `https://<uid>.push.ft07.com/send/<key>.send`（缺 uid 会 522） |
| Server酱 版本 | 「sctp 开头是 Turbo 版」 | sctp 是**新版 Server酱³**；SCT 才是老版 Turbo |
| 企业微信入口 | 直接写「管理后台 → ...」 | 必须先说明「用浏览器打开 → 右上角管理后台 → 扫码登录」 |
| 企业微信选型 | 排第 2、标「官方」 | 排第 5、标「较麻烦」，并前置说明 IP 白名单限制 |
| 钉钉 token 错误码 | `300001` | `300005`（实测） |
| Webhook 步骤顺序 | 先让选平台，再让拿地址 | 改成**先拿地址**，按地址开头识别平台才有依据 |
| QQ 凭据 | 没说 Token 已弃用 | 明确「只要 AppID+AppSecret，Token 字段不用管」 |
| QQ openid 来源 | 「去开发设置翻消息日志」 | 官方事件是 `C2C_MESSAGE_CREATE`，openid 在事件里；后台不直接显示 |
| QQ 主动消息开关 | 「去机器人资料页打开」 | 平台对应事件 `C2C_MSG_REJECT`，现象是报 40034105 |
| 数据质量 | `badge: 'null'`（字符串） | 已清除，界面上原本会显示字面 "null" |

## 待补

- [ ] Webhook：三家「创建机器人」的菜单路径与安全设置项名称，尚未逐家核官方文档（目前是通用描述）
- [ ] Bark：界面路径按「怎么认」写（各版本 UI 不同），拿到具体版本截图后可细化
- [ ] QQ：回调地址只允许 80/443/8080/8443 端口这点，是否需要写进引导（目前只在代码里有 `X-Union-Appid`）

## 已解决

- [x] Server酱 端点拼接（实测修复）
- [x] Webhook 三家错误码与消息格式（实测）
- [x] QQ 凭据与 openid 来源（官方文档核对）
- [x] IM 引导（读 dsh-im 一手 README 后重写）
- [x] 企业微信入口与 IP 限制（文档 + 用户实测）

## 测试如何防止复发

`test/guide-usability.test.mjs` 里有这些断言：

- 提到「管理后台」这类入口时，必须说清怎么进
- 每一步必须有可操作线索（动作词 / 菜单层级）
- 「在哪儿做」里不能塞注意事项
- 注意事项必须走 `note` 数组，不能靠正文写「注意：」
- badge / 标题 / 副标题不能是字符串 `'null'`
- IM 引导必须提到「IM机器人」「齿轮」「新建目标」「Bot ID」这些真实控件
- ease 不重复、是正整数
