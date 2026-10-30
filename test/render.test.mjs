import { test } from 'node:test';
import assert from 'node:assert/strict';

import { render, renderDigest, humanDuration, truncate, extractContext, textOfMessage } from '../lib/render.js';

test('render 完成类：标题带会话名和类型', () => {
  const m = render({ kind: 'completed', title: '重构 runner' });
  assert.match(m.title, /重构 runner/);
  assert.match(m.title, /任务完成/);
  assert.match(m.body, /任务已完成/);
});

test('render 带耗时', () => {
  const m = render({ kind: 'completed', title: 'x', durationMs: 133_000 });
  assert.match(m.body, /耗时：2 分 13 秒/);
});

test('render 带回复摘要并截断', () => {
  const long = '这是一段很长很长的回复'.repeat(30);
  const m = render({ kind: 'completed', title: 'x', excerpt: long, excerptMaxChars: 20 });
  const line = m.body.split('\n').pop();
  assert.ok(line.length <= 20, `摘要应被截断，实际 ${line.length}`);
  assert.ok(line.endsWith('…'));
});

test('render 关掉摘要就不带', () => {
  const m = render({ kind: 'completed', title: 'x', excerpt: '最后说了什么', includeExcerpt: false });
  assert.ok(!m.body.includes('最后说了什么'));
});

test('render 审批类带工具名和原因', () => {
  const m = render({ kind: 'approval', title: 'x', toolName: 'bash', reason: '要删文件' });
  assert.match(m.body, /工具：bash/);
  assert.match(m.body, /原因：要删文件/);
});

test('render 提问类带问题和选项', () => {
  const m = render({ kind: 'question', title: 'x', question: '选哪个部署环境', choices: ['Blue', 'Green'] });
  assert.match(m.body, /选哪个部署环境/);
  assert.match(m.body, /Blue \/ Green/);
});

test('render 出错类区分输出超限', () => {
  const a = render({ kind: 'error', title: 'x', detail: 'max-tokens' });
  const b = render({ kind: 'error', title: 'x' });
  assert.match(a.body, /长度上限/);
  assert.match(b.body, /出错中断/);
});

test('render 目录默认不带，开了才带', () => {
  const off = render({ kind: 'completed', title: 'x', cwd: 'D:\\secret-project' });
  const on = render({ kind: 'completed', title: 'x', cwd: 'D:\\secret-project', includeCwd: true });
  assert.ok(!off.body.includes('secret-project'));
  assert.ok(on.body.includes('secret-project'));
});

test('render 带 url 时透传', () => {
  const m = render({ kind: 'completed', title: 'x', url: 'http://127.0.0.1:60013/#/session/abc' });
  assert.equal(m.url, 'http://127.0.0.1:60013/#/session/abc');
});

test('render 会话名过长会截断', () => {
  const m = render({ kind: 'completed', title: '很长的会话名'.repeat(20) });
  assert.ok(m.title.length < 80, `标题过长：${m.title.length}`);
});

test('renderDigest 多条合成一条', () => {
  const items = [
    { kind: 'completed', title: '重构 runner', message: { title: 'a', body: 'a' } },
    { kind: 'error', title: '修复登录', message: { title: 'b', body: 'b' } },
    { kind: 'completed', title: '跑测试', message: { title: 'c', body: 'c' } },
  ];
  const m = renderDigest(items);
  assert.match(m.title, /3 条/);
  assert.match(m.body, /重构 runner/);
  assert.match(m.body, /修复登录/);
  assert.match(m.body, /跑测试/);
});

test('renderDigest 只有一条时直接返回原文', () => {
  const one = { title: 'a', body: 'b' };
  const m = renderDigest([{ kind: 'completed', title: 'x', message: one }]);
  assert.deepEqual(m, one);
});

test('renderDigest 空数组返回 null', () => {
  assert.equal(renderDigest([]), null);
  assert.equal(renderDigest(null), null);
});

test('humanDuration 各档位', () => {
  assert.equal(humanDuration(45_000), '45 秒');
  assert.equal(humanDuration(133_000), '2 分 13 秒');
  assert.equal(humanDuration(3_700_000), '1 小时 1 分');
  assert.equal(humanDuration(undefined), '');
});

test('truncate 压缩空白并截断', () => {
  assert.equal(truncate('a\n\nb   c', 100), 'a b c');
  assert.equal(truncate('abcdef', 4), 'abc…');
});

test('textOfMessage 支持字符串与内容块', () => {
  assert.equal(textOfMessage({ content: '直接字符串' }), '直接字符串');
  assert.equal(
    textOfMessage({ content: [{ type: 'text', text: '第一段' }, { type: 'tool', id: 'x' }, { type: 'text', text: '第二段' }] }),
    '第一段\n第二段',
  );
  assert.equal(textOfMessage({ content: [] }), undefined);
  assert.equal(textOfMessage(null), undefined);
});

test('extractContext 抠出标题、摘要、耗时', () => {
  const events = [
    { type: 'session/title', data: { title: '重构 runner' }, seq: 1 },
    { type: 'turn/start', data: { turn: 4 }, timestamp: 1000, seq: 2 },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '改完了' }] } }, seq: 3 },
    { type: 'turn/end', data: { turn: 4, reason: { kind: 'completed' } }, timestamp: 134000, seq: 4 },
  ];
  const ctx = extractContext(events, events[3]);
  assert.equal(ctx.title, '重构 runner');
  assert.equal(ctx.lastAssistantText, '改完了');
  assert.equal(ctx.durationMs, 133000);
});

test('extractContext 事件缺失时不崩', () => {
  const ctx = extractContext([], undefined);
  assert.equal(ctx.title, undefined);
  assert.equal(ctx.lastAssistantText, undefined);
  assert.equal(ctx.durationMs, undefined);
});
