/**
 * 用真实 Cordis 加载插件 —— 最接近现场的一次验证。
 *
 * Cordis 是宿主自带的（在 app.asar 里），profile 的 node_modules 里没有。
 * 所以从环境变量 CORDIS_ENTRY 指向的副本加载；没设或不存在时跳过，不误报失败。
 *
 * 用法（PowerShell）：
 *   $env:CORDIS_ENTRY="C:\path\to\cordis\lib\index.js"; npm test
 *
 * 抽取方法见 README「本地验证」一节。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** 插件入口：相对本测试文件定位，不写死绝对路径。 */
const PLUGIN_ENTRY = join(here, '..', 'lib', 'index.js');

/** Cordis 副本由使用者提供（宿主自带，不能随仓库分发）。 */
const CORDIS_ENTRY = process.env.CORDIS_ENTRY || '';

const haveCordis = Boolean(CORDIS_ENTRY) && existsSync(CORDIS_ENTRY);
const skip = haveCordis
  ? false
  : '未设置 CORDIS_ENTRY 或文件不存在，跳过真实 Cordis 验证（见 README）';

async function loadCordis() {
  const mod = await import(pathToFileURL(CORDIS_ENTRY).href);
  return mod;
}

test('真实 Cordis 能加载 dsh-alert 并挂上 /dsh-alert 路由', { skip }, async () => {
  const cordis = await loadCordis();
  const Context = cordis.Context;
  assert.ok(Context, 'cordis 应导出 Context');

  const routes = [];
  const ctx = new Context();
  ctx.provide('webServer', {
    register(route) {
      routes.push(route);
      return () => {
        const i = routes.indexOf(route);
        if (i >= 0) routes.splice(i, 1);
      };
    },
  });
  ctx.provide('connection', { requestRejection: () => undefined });

  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href);

  // 复刻宿主 resolveConfig
  assert.equal(plugin.Config, undefined, '不该导出 Config（会导致激活失败）');
  assert.deepEqual(plugin.inject, [], '静态 inject 应为空');

  let fiber;
  assert.doesNotThrow(() => {
    fiber = ctx.plugin(plugin, {});
  }, 'ctx.plugin 不应抛错');

  await new Promise((r) => setTimeout(r, 400));

  assert.equal(routes.length, 1, `应挂上 1 条路由，实际 ${routes.length}`);
  assert.equal(routes[0].kind, 'prefix');
  assert.equal(routes[0].path, '/dsh-alert');

  // 直接调 handler，验证端到端有数据
  const body = JSON.stringify({ type: 'client-request', rpcId: 't-1', method: 'status', payload: {} });
  let payload = '';
  const req = {
    method: 'POST',
    url: '/dsh-alert/status',
    headers: { 'content-type': 'application/json', host: '127.0.0.1:1234' },
    on(ev, fn) {
      if (ev === 'data') fn(Buffer.from(body));
      if (ev === 'end') fn();
      return this;
    },
  };
  const res = {
    writeHead() {
      return res;
    },
    end(text) {
      payload = text ?? '';
    },
  };
  await routes[0].handler(req, res);

  const parsed = JSON.parse(payload);
  assert.equal(parsed.type, 'server-response');
  assert.equal(parsed.rpcId, 't-1');
  assert.equal(parsed.result.ok, true);

  // 通道数量从通道注册表推导，不写死数字（加通道时这个断言不该失败）
  const { CHANNELS } = await import('../lib/channels/index.js');
  assert.equal(
    parsed.result.value.channels.length,
    CHANNELS.length,
    'status 返回的通道数应与注册表一致',
  );

  try {
    fiber?.dispose?.();
  } catch {
    /* 忽略 */
  }
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(routes.length, 0, 'dispose 后应移除路由');
});

test('真实 Cordis 里没有 webServer 也不影响加载', { skip }, async () => {
  const cordis = await loadCordis();
  const ctx = new cordis.Context();
  const plugin = await import(pathToFileURL(PLUGIN_ENTRY).href);

  assert.doesNotThrow(() => {
    ctx.plugin(plugin, {});
  }, '没有 webServer 时也应能加载（只是没设置页）');

  await new Promise((r) => setTimeout(r, 200));
});
