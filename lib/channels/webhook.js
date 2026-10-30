/**
 * 通用 Webhook 通道 —— 覆盖钉钉 / 飞书 / 企业微信群机器人 / 自建服务。
 *
 * 这些服务的 payload 形状各不相同，所以这里做「模板替换」：
 * 你在配置里写一个 JSON 模板，用 {{title}} {{body}} {{url}} 占位，
 * 发送时替换成真实内容。这样一套代码就能覆盖所有 webhook。
 */

export const webhook = {
  id: 'webhook',
  label: 'Webhook（钉钉 / 飞书 / 企微群机器人 / 自建）',
  hint: '在群里加一个自定义机器人拿到 webhook 地址。模板里用 {{title}} {{body}} {{url}} 占位，下面的预设按钮可以一键填入对应平台的格式。',
  fields: [
    { key: 'url', label: 'Webhook 地址', type: 'string', default: '', placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=...', required: true ,
      help: '整条地址都要，包括 ?access_token= 或 /hook/ 后面那一段，少一段就 401。',
    },
    { key: 'template', label: '请求体模板', type: 'text', default: '', placeholder: '留空则用预设平台的格式' ,
      help: '留空就按上面选的「平台」自动生成。要自定义就在这写 JSON，支持 {{title}} {{body}} {{url}} 占位。',
    },
    { key: 'preset', label: '平台预设', type: 'select', default: 'generic', options: ['generic', 'dingtalk', 'feishu', 'wecom', 'slack', 'discord'] ,
      help: '按地址开头选：oapi.dingtalk.com→钉钉，open.feishu.cn→飞书，qyapi.weixin.qq.com→企微群。选错对方不认格式。',
    },
    { key: 'headers', label: '额外请求头（JSON）', type: 'text', default: '', placeholder: '{"Authorization":"Bearer xxx"}' ,
      help: '对方要求自定义请求头时才填，例如 {"X-Token":"abc"}。一般留空。',
    },
  ],

  /** 没写模板时按预设平台生成。 */
  normalize(cfg) {
    if (String(cfg.template || '').trim()) return cfg;
    return { ...cfg, template: PRESETS[cfg.preset] ?? PRESETS.generic };
  },

  build(msg, cfg) {
    const url = String(cfg.url || '').trim();
    if (!url) throw new Error('Webhook 地址没填');

    const template = String(cfg.template || '').trim() || PRESETS.generic;
    const body = fillTemplate(template, msg);

    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    if (String(cfg.headers || '').trim()) {
      try {
        Object.assign(headers, JSON.parse(cfg.headers));
      } catch {
        throw new Error('额外请求头不是合法 JSON');
      }
    }

    return { url, method: 'POST', headers, body };
  },

  /** 钉钉/飞书/企微都用 errcode 表达业务失败。 */
  check(res, json) {
    if (res.status < 200 || res.status >= 300) return { ok: false, detail: `HTTP ${res.status}` };
    if (!json || typeof json !== 'object') return { ok: true, detail: 'ok' };

    const errcode = json.errcode ?? json.code ?? json.StatusCode;
    if (typeof errcode === 'number' && errcode !== 0) {
      return { ok: false, detail: `errcode ${errcode}: ${json.errmsg ?? json.msg ?? json.StatusMessage ?? ''}` };
    }
    return { ok: true, detail: 'ok' };
  },
};

const PRESETS = {
  generic: '{"title":"{{title}}","body":"{{body}}","url":"{{url}}"}',
  // 钉钉自定义机器人
  dingtalk: '{"msgtype":"text","text":{"content":"{{title}}\\n{{body}}"}}',
  // 飞书自定义机器人
  feishu: '{"msg_type":"text","content":{"text":"{{title}}\\n{{body}}"}}',
  // 企业微信群机器人
  wecom: '{"msgtype":"text","text":{"content":"{{title}}\\n{{body}}"}}',
  slack: '{"text":"{{title}}\\n{{body}}"}',
  discord: '{"content":"{{title}}\\n{{body}}"}',
};

/** 把 {{key}} 换成 JSON 转义后的值（含引号，直接插进 JSON 模板里就是合法字符串）。 */
function fillTemplate(template, msg) {
  const values = {
    title: msg.title,
    body: msg.body,
    url: msg.url ?? '',
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const raw = values[key] ?? '';
    // 去掉外层引号，因为模板里已经写了引号
    return JSON.stringify(String(raw)).slice(1, -1);
  });
}

/** 给设置页用：一键填入预设模板。 */
export { PRESETS as WEBHOOK_PRESETS };
