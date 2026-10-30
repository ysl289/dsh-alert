/**
 * 本地假推送服务器 —— 端到端联调用。
 *
 * 用法：node test/mock-server.mjs [端口]
 * 然后插件里配一个 custom 通道指向 http://127.0.0.1:18080/notify
 *
 * 它会把收到的每条请求打印出来，并返回 {"ok":true}。
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const port = Number(process.argv[2] ?? 18080);

export function startMock({ onRequest } = {}) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const record = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
        at: Date.now(),
      };
      if (onRequest) onRequest(record);
      else {
        console.log('─'.repeat(60));
        console.log(`${record.method} ${record.url}`);
        console.log('body:', body.slice(0, 500));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// 直接运行时启动（Windows 上必须用 pathToFileURL，手拼 file:// 会因中文路径和盘符出错）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMock().then(() => {
    console.log(`假推送服务器已启动：http://127.0.0.1:${port}/notify`);
    console.log('按 Ctrl+C 停止。收到的请求会打印在这里。');
  });
}
