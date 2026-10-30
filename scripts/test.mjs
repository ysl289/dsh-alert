#!/usr/bin/env node
/**
 * 跨版本测试运行器。
 *
 * 为什么需要它：`node --test "test/*.test.mjs"` 在不同 Node 版本行为不同
 *   - Node 20 及更早：把引号里的通配符当字面路径 → "Could not find"
 *   - Node 21+：支持 glob 展开
 * 而且 Windows 的 PowerShell 和 Linux 的 bash 对通配符展开规则也不一样。
 *
 * 最稳的做法：自己读目录、显式列出文件，交给 node --test。
 * 这样在 18/20/22/24 和三种 OS 上行为完全一致。
 */

import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// 本文件在 scripts/ 下，测试目录和它同级
const root = join(here, '..');
const testDir = join(root, 'test');

let files;
try {
  files = readdirSync(testDir)
    .filter((f) => f.endsWith('.test.mjs'))
    .sort()
    .map((f) => join('test', f));
} catch {
  console.error(`找不到测试目录：${testDir}`);
  process.exit(1);
}

if (files.length === 0) {
  console.error('测试目录里没有 *.test.mjs');
  process.exit(1);
}

console.log(`跑 ${files.length} 个测试文件\n`);

// 用 spawn 而不是 exec，保留输出实时性；stdio inherit 让 TAP 直接流到终端
const child = spawn(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`测试进程被信号 ${signal} 终止`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  console.error('启动测试进程失败：', err.message);
  process.exit(1);
});
