/**
 * 宿主契约测试：验证插件导出的东西符合 Cordis 的加载约定。
 *
 * 这些约束一旦破了，插件会在「激活阶段」就失败，然后被插件管理器写成
 * disabled: true —— 用户看到的现象是「设置页读不到路由」，很难反推。
 * 所以每一条都要有测试守着。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as mod from '../lib/index.js';

test('导出 name / apply', () => {
  assert.equal(typeof mod.name, 'string');
  assert.equal(mod.name, 'dsh-alert');
  assert.equal(typeof mod.apply, 'function');
});

test('inject 必须是数组（Cordis 的 Inject.resolve 只吃数组/对象）', () => {
  assert.ok(Array.isArray(mod.inject), 'inject 必须是数组');
});

test('绝不能导出普通对象当 Config', () => {
  const Config = mod.Config;
  if (Config === undefined) return; // 不导出是允许的

  // 如果导出了，必须能当 Standard Schema 用：
  //   runtime.Config['~standard'].validate(config)
  const standard = Config['~standard'];
  assert.ok(standard, 'Config 缺 "~standard"，宿主 resolveConfig 会抛 TypeError');
  assert.equal(typeof standard.validate, 'function', 'Config["~standard"].validate 必须是函数');

  // 真跑一次，确保不抛
  assert.doesNotThrow(() => standard.validate({}), 'Config 校验自身必须不抛');
});

test('模拟宿主 resolveConfig：不因 Config 抛错', () => {
  // 复刻 cordis/lib/index.js 的 resolveConfig
  function resolveConfig(runtime, config) {
    if (!runtime.Config) return config;
    const result = runtime.Config['~standard'].validate(config);
    if ('then' in result) throw new TypeError('Async config validation is not supported');
    if (result.issues) throw new Error('ValidationError');
    return result.value;
  }

  const runtime = { Config: mod.Config };
  assert.doesNotThrow(() => resolveConfig(runtime, {}));
});

test('插件不声明静态 webServer 依赖（否则 headless 不加载）', () => {
  assert.ok(!mod.inject.includes('webServer'), 'webServer 必须用运行时 ctx.inject');
  assert.ok(!mod.inject.includes('connection'), 'connection 必须用运行时 ctx.inject');
});

test('apply 在裸 ctx 上不抛（最小宿主）', () => {
  const ctx = {
    on() {},
    effect() {},
    logger: { info() {}, warn() {}, error() {} },
  };
  assert.doesNotThrow(() => mod.apply(ctx, {}));
});

test('apply 返回可调用的 dispose', () => {
  const ctx = {
    on() {},
    effect() {},
    logger: { info() {}, warn() {}, error() {} },
  };
  const dispose = mod.apply(ctx, {});
  assert.equal(typeof dispose, 'function');
  assert.doesNotThrow(() => dispose());
});

test('包清单里的 dsh.client 只声明 platform', async () => {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dsh.client.platform, 'web');
  // 客户端 bundle 只 require react，不需要声明模块依赖；
  // 声明不存在的模块会让客户端组合失败。
  assert.equal(pkg.dsh.client.inject, undefined, '不该声明 dsh.client.inject');
});

test('包清单 exports["./client"] 指向真实文件', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');

  const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const rel = pkg.exports['./client'];
  assert.equal(typeof rel, 'string');
  const abs = join(dirname(pkgPath), rel);
  assert.ok(existsSync(abs), `客户端入口不存在：${abs}`);
});
