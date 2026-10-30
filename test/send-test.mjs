/**
 * 真机单发脚本 —— 用来确认某个通道真的能到你手机。
 *
 * 用法：
 *   node test/send-test.mjs ntfy --topic dsh-abc123
 *   node test/send-test.mjs bark --key YOUR_KEY
 *   node test/send-test.mjs wecom --corp-id ww1 --secret s1 --agent-id 1000002
 *   node test/send-test.mjs webhook --url https://oapi.dingtalk.com/robot/send?access_token=xxx --preset dingtalk
 *   node test/send-test.mjs custom --url http://127.0.0.1:18080/notify
 *
 * 不带参数运行会打印帮助。
 */

import { deliver } from '../lib/deliver.js';
import { normalizeConfig, getChannel, channelIds } from '../lib/channels/index.js';

const argv = process.argv.slice(2);
const channelId = argv[0];

if (!channelId || channelId === '--help' || channelId === '-h') {
  console.log('用法：node test/send-test.mjs <通道> [--字段 值 ...]');
  console.log('可用通道：', channelIds().join(', '));
  console.log('');
  console.log('例：node test/send-test.mjs ntfy --topic dsh-abc123');
  process.exit(0);
}

const channel = getChannel(channelId);
if (!channel) {
  console.error(`未知通道：${channelId}`);
  console.error('可用：', channelIds().join(', '));
  process.exit(1);
}

// 把 --foo-bar 1 解析成 { fooBar: '1' }
const raw = {};
for (let i = 1; i < argv.length; i += 1) {
  const key = argv[i];
  if (!key.startsWith('--')) continue;
  const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  raw[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
}

const cfg = normalizeConfig(channel, raw);

const message = {
  title: '🔔 手机提醒 · 真机测试',
  body: [
    '这条能收到，就说明通道配好了。',
    '之后 AI 跑完任务、出错、等你审批时，都会从这里通知你。',
    '',
    `通道：${channel.label}`,
    `时间：${new Date().toLocaleString('zh-CN')}`,
  ].join('\n'),
};

console.log(`正在通过「${channel.label}」发送测试消息…`);
const res = await deliver(message, [{ id: channel.id, enabled: true, config: cfg }], {
  retries: 1,
  log: (e) => console.log('  ·', e.event, e.channel ?? '', e.detail ?? ''),
});

if (res.ok) {
  console.log('\n✅ 发送成功。手机上应该收到了。');
} else {
  console.log('\n❌ 发送失败：');
  for (const r of res.results) {
    console.log(`  ${r.channel}: ${r.error ?? '未知原因'}`);
  }
  process.exit(1);
}
