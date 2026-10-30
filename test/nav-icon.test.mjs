/**
 * 设置导航图标装饰的测试。
 *
 * 背景：宿主的 navIcon(id) 按 section id 硬编码，只认 account / models /
 * agent-presets / plugins / archived-sessions 五个 id，其余一律画齿轮。
 * register() 里没有 icon 字段 —— 插件侧改不了，所有第三方插件都是齿轮。
 *
 * 所以我们按标题文字认出自己那一项，把 svg 换掉。
 * 这些测试锁住「别误伤别的项」和「宿主改版时安静失败」。
 *
 * 真实浏览器验证见 downloads/verify-nav-icon.mjs（已跑通）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'client', 'client.js'), 'utf8');

/** 按花括号精确截出函数体（标签里不能用固定长度切片）。 */
function sliceFunction(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.ok(start > 0, `找不到 ${name}`);
  let depth = 0;
  let i = SRC.indexOf('{', start);
  for (; i < SRC.length; i += 1) {
    if (SRC[i] === '{') depth += 1;
    else if (SRC[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return SRC.slice(start, i + 1);
}

const DECORATE = sliceFunction('decorateSettingsNavIcon');

test('存在导航图标装饰函数', () => {
  assert.ok(DECORATE.length > 500, '函数体应有实际内容');
});

test('按标题文字认位置，不依赖宿主 class 名', () => {
  // 宿主的 class 是 hash 过的（如 AnXs9G_navCell），跟着它写必挂
  assert.match(DECORATE, /textContent/, '应按文字内容识别');
  assert.match(DECORATE, /querySelectorAll\('button > span'\)/, '应找标题 span');
  assert.ok(
    !/AnXs9G_|navCell/.test(DECORATE),
    '不该依赖宿主的 hash class 名 —— 它随时会变',
  );
});

test('找不到目标时安静退出，不抛错', () => {
  assert.match(DECORATE, /typeof document === 'undefined'/, '无 DOM 环境要安全返回');
  assert.match(DECORATE, /try\s*\{/, '应有 try');
  assert.match(DECORATE, /catch/, '应有 catch');
});

test('替换前确认第一个子节点是 svg，防止误伤', () => {
  assert.match(DECORATE, /tagName\.toLowerCase\(\) !== 'svg'/, '要确认是 svg 才替换');
});

test('已经替换过的项不重复处理', () => {
  assert.match(DECORATE, /data-dsh-alert-nav/, '应打标记避免重复替换');
  assert.match(DECORATE, /data-dsh-alert-icon/, '替换后的 svg 应带标记');
});

test('装饰是可停止的（dispose 时清理观察器与计时器）', () => {
  assert.match(DECORATE, /observer\??\.disconnect|observer\.disconnect/, '应断开观察器');
  assert.match(DECORATE, /clearInterval|clearTimeout/, '应清理计时器');
});

test('图标用位置参数数组映射，和 makeIcon 一致', () => {
  // ICON_PATHS 的值形如 ['rect', 6, 2, 12, 20, 2]，不是属性对象
  assert.match(DECORATE, /kind === 'path'/, '应处理 path');
  assert.match(DECORATE, /kind === 'line'/, '应处理 line');
  assert.match(DECORATE, /kind === 'circle'/, '应处理 circle');
  assert.match(DECORATE, /kind === 'rect'/, '应处理 rect');
  assert.ok(
    !/for \(var k in attrs\)/.test(DECORATE),
    '不能把位置参数当属性对象遍历（这是之前的实现错误）',
  );
});

test('slot 注册的 disposer 同时清理图标装饰和面板', () => {
  const i = SRC.indexOf("ctx.slots.inject('settings.section'");
  assert.ok(i > 0, '应有注册调用');
  const body = SRC.slice(i, i + 900);
  assert.match(body, /stopNavIcon\(\)/, 'disposer 里应停止图标装饰');
  assert.match(body, /unregister\(\)/, 'disposer 里应注销面板');
  // 正确形态：先 register 拿到 unregister，再返回 disposer。
  // 不能把 register 放进返回的函数里（那样销毁时才注册）。
  assert.match(body, /var unregister = ctx\.slots\.register/, '应立刻注册并保存 unregister');
});

test('用铃铛而不是齿轮作为我们的图标', () => {
  const i = SRC.indexOf("ctx.slots.inject('settings.section'");
  const body = SRC.slice(i, i + 900);
  assert.match(body, /'bell'/, '应使用 bell 图标');
});

test('铃铛图标在 ICON_PATHS 里存在', () => {
  assert.match(SRC, /bell:\s*\[/, 'ICON_PATHS 应有 bell');
});
