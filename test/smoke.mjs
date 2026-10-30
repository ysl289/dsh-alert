/**
 * 冒烟测试：起假服务器 + 用 send-test 脚本打一条，验证「装到本机之后」
 * 这条路径是通的。跑法：node test/smoke.mjs
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const PORT = 18093;

const srv = spawn(process.execPath, [join(here, 'mock-server.mjs'), String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
srv.stdout.on('data', (c) => {
  serverOutput += c;
});
srv.stderr.on('data', (c) => {
  serverOutput += c;
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 等服务器起来
  let up = false;
  for (let i = 0; i < 40; i += 1) {
    await wait(100);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/ping`, { method: 'POST', body: 'ping' });
      if (res.status === 200) {
        up = true;
        break;
      }
    } catch {
      /* 还没起来 */
    }
  }

  if (!up) {
    console.error('❌ 假服务器没起来');
    console.error(serverOutput);
    srv.kill();
    process.exit(1);
  }
  console.log('✅ 假服务器已启动');

  // 用 send-test 打一条
  const send = spawn(
    process.execPath,
    [join(here, 'send-test.mjs'), 'custom', '--url', `http://127.0.0.1:${PORT}/notify`, '--body', '{"t":"{{title}}","b":"{{body}}"}'],
    { stdio: 'inherit' },
  );

  const code = await new Promise((resolve) => send.on('exit', resolve));
  srv.kill();

  if (code === 0) {
    console.log('\n✅ 冒烟测试通过：插件 → HTTP → 接收端 整条链路通了');
    process.exit(0);
  }
  console.error('\n❌ 冒烟测试失败');
  process.exit(1);
}

main();
