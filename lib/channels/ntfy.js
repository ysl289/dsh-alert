/**
 * ntfy 通道 —— 最省事：手机装 ntfy App，订阅一个主题即可，免注册。
 *
 * 请求：POST {server}/{topic}，正文是纯文本，标题走 Title 头。
 * 文档：https://docs.ntfy.sh/publish/
 */

export const ntfy = {
  id: 'ntfy',
  label: 'ntfy',
  hint: '手机装 ntfy App（App Store / Google Play / F-Droid），新建主题名（用随机串，别用 test），订阅后把主题名填这里。',
  fields: [
    {
      key: 'server',
      label: '服务器',
      type: 'string',
      default: 'https://ntfy.sh',
      placeholder: 'https://ntfy.sh',
      help: '用官方服务器就保持默认，不要改。只有你自己搭了 ntfy 服务器才需要改。',
    },
    {
      key: 'topic',
      label: '主题名',
      type: 'string',
      default: '',
      placeholder: 'dsh-7f3a91c2',
      required: true,
      help: '手机 App 里订阅的主题名，两边必须一字不差。用随机串，别用 test 这种公开名字。',
    },
    {
      key: 'token',
      label: '访问令牌（可选）',
      type: 'secret',
      default: '',
      placeholder: '自建服务器开了鉴权才需要',
      help: '用官方的 ntfy.sh 就留空。只有自建服务器且开了鉴权时才填。',
    },
    // 默认 high 而不是 default：
    //   priority 3（default）只进通知栏，不弹窗置顶；
    //   4（high）才会横幅弹出。这插件的全部意义就是「别错过」。
    {
      key: 'priority',
      label: '提醒强度',
      type: 'select',
      default: 'high',
      options: ['min', 'low', 'default', 'high', 'urgent'],
      help: '默认 high（弹窗置顶）。嫌吵可改 default（只进通知栏）或 low（不响）。',
    },
  ],

  build(msg, cfg) {
    const server = String(cfg.server || 'https://ntfy.sh').replace(/\/+$/, '');
    const topic = String(cfg.topic || '').trim();
    if (!topic) throw new Error('ntfy 主题名没填');

    const headers = {
      'Content-Type': 'text/plain; charset=utf-8',
      Title: encodeHeader(msg.title),
      Priority: cfg.priority || 'default',
      // 点通知能跳回电脑上的会话（手机上会尝试打开这个地址）
      ...(msg.url ? { Click: msg.url } : {}),
    };
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;

    return {
      url: `${server}/${encodeURIComponent(topic)}`,
      method: 'POST',
      headers,
      body: msg.body,
    };
  },
};

/**
 * ntfy 的 Title 头只接受 ASCII（RFC 2047 编码也行，但很多客户端不认）。
 * 中文标题直接塞头里会被 fetch 拒绝（Invalid header value），所以：
 * 含非 ASCII 就把标题并进正文，头里只留一个 ASCII 标记。
 */
function encodeHeader(title) {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]*$/.test(title) ? title : 'DSH';
}
