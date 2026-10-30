/**
 * 设置页 ⇄ Host 的数据通道。
 *
 * 浏览器端调用：
 *   ctx.connection.rpc.call('/dsh-alert', endpoint, payload)
 * 返回值信封固定是 { ok: true, value } 或 { ok: false, error }。
 *
 * 挂载有两条路径，按优先级尝试：
 *   1. webServer 路由（新版 DSH）：POST /dsh-alert/<endpoint>，
 *      线上协议和宿主自己的 /api 一致：
 *        请求  { rpcId: string, method: string, payload?: any }
 *        响应  { type: 'server-response', rpcId, result }
 *      走这条是因为 dsh-client-connection 只 inject 了 credentials，
 *      它内部读不到 webServer，rpc.handle 装出来的传输层不完整。
 *   2. ctx.connection.rpc.handle（老版本 DSH 的官方 seam）
 *
 * 两条都不通时安静降级：插件本体照常推送，只是没有设置页。
 */

import { readJson } from './http.js';

/** 通道名，浏览器端必须用同一个。 */
export const RPC_CHANNEL = '/dsh-alert';

/** endpoint 允许的字符，与宿主 endpointFromPath 的规则一致。 */
const SEGMENT = /^[A-Za-z0-9_$.-]+$/;

/** 请求体上限：设置页只发小 JSON。 */
const BODY_MAX = 256 * 1024;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/** 成功信封。 */
export function ok(value) {
  return { ok: true, value };
}

/**
 * 失败信封。
 * DSH 的 rpcErrorSchema 是 discriminated union，details 必填且按 code 定形；
 * 'internal' 不在合法 code 集合里，所以非取消一律归到 bad-request。
 */
export function fail(message, code = 'bad-request') {
  if (code === 'cancelled') {
    return { ok: false, error: { code: 'cancelled', message, details: {} } };
  }
  return {
    ok: false,
    error: { code: 'bad-request', message, details: { issues: [{ message }] } },
  };
}

/**
 * 把设置接口包成 endpoint 分发表。
 *
 * @param {object} api  { getSettings, saveSettings, listChannels, sendTest }
 * @param {(e:object)=>void} log
 * @returns {(endpoint:string, payload:any, signal?:AbortSignal)=>Promise<object>}
 */
export function createDispatcher(api, log) {
  return async function dispatch(endpoint, payload = {}, signal) {
    if (signal?.aborted) return fail('请求已取消', 'cancelled');

    try {
      switch (endpoint) {
        case 'status': {
          // im 状态单独拿：装了 dsh-im 才有机器人列表，没装也要报告 installed:false
          const im = api.imStatus ? await api.imStatus() : { installed: false, bots: [], targets: {} };
          return ok({
            settings: api.getSettings(),
            channels: api.listChannels(),
            ready: api.readyChannels?.() ?? [],
            im,
            // 联动探测结果：设置页用它决定显示哪些徽标、"链接手机上能不能打开"的提示
            integrations: api.integrations?.() ?? {},
            // 解析后的主题 id：让面板在宿主换肤时跟上，而不是各自猜
            theme: api.theme?.() ?? null,
          });
        }

        case 'save': {
          const next = payload?.settings;
          if (!next || typeof next !== 'object' || Array.isArray(next)) {
            return fail('缺少 settings 对象');
          }
          return ok({ settings: api.saveSettings(next), ready: api.readyChannels?.() ?? [] });
        }

        case 'test': {
          const only = typeof payload?.channel === 'string' ? payload.channel : undefined;
          const res = await api.sendTest(only);
          return ok({
            ok: Boolean(res?.ok),
            results: (res?.results ?? []).map((r) => ({
              channel: r.channel,
              ok: Boolean(r.ok),
              error: r.error,
              attempts: r.attempts,
            })),
          });
        }

        default:
          return fail(`未知端点：${endpoint}`);
      }
    } catch (error) {
      const message = String(error?.message ?? error);
      log({ event: 'rpc-error', endpoint, message });
      return fail(message);
    }
  };
}

/**
 * 安装 RPC 通道。
 *
 * @returns {(() => void) | undefined} 清理函数；两条路径都不通时返回 undefined
 */
export function installRpc(ctx, dispatch, log) {
  const mounted =
    mountWebRoute(ctx, dispatch, log) ??
    mountLegacyHandle(ctx, dispatch, log);

  if (!mounted) {
    log({
      event: 'rpc-unavailable',
      message: '没有可用的 RPC 装载路径，设置页不可用（推送功能不受影响）',
    });
  }
  return mounted;
}

// ── 路径一：webServer 路由 ──

function mountWebRoute(ctx, dispatch, log) {
  let webServer;
  try {
    webServer = ctx?.webServer;
  } catch {
    return undefined; // 没 inject webServer
  }
  if (!webServer || typeof webServer.register !== 'function') return undefined;

  const route = {
    kind: 'prefix',
    path: RPC_CHANNEL,
    handler: async (req, res) => {
      // 信任栅栏：优先用 Connection 自己的判定（它管 Host/Origin/cookie）
      const rejection = rejectReason(ctx, req);
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
        return;
      }

      try {
        await serveRpcRequest(req, res, dispatch, log);
      } catch (error) {
        log({ event: 'rpc-transport-error', message: String(error?.message ?? error) });
        try {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('internal');
        } catch {
          /* 已经写了响应头 */
        }
      }
    },
  };

  let registered;
  try {
    registered = webServer.register(route);
  } catch (error) {
    log({ event: 'rpc-route-failed', message: String(error?.message ?? error) });
    return undefined;
  }

  return normalizeDisposer(registered);
}

/** 判定请求是否该被拒绝；返回状态码或 undefined。 */
function rejectReason(ctx, req) {
  const connection = safeRead(() => ctx.connection);

  // Connection 的判定是类方法，内部读 this.trustedHosts / this.browserAuth，
  // 必须以方法形式调用，抽成裸函数会丢 this。
  if (connection && typeof connection.requestRejection === 'function') {
    try {
      const rejection = connection.requestRejection(req);
      return rejection;
    } catch {
      return 403;
    }
  }

  // 没有 Connection 服务时的最小栅栏：只放行 loopback，拒绝跨站
  const host = req.headers?.host;
  if (!host) return 403;
  const hostname = host.split(':')[0];
  if (!LOOPBACK_HOSTS.has(hostname)) return 403;
  if (req.headers['sec-fetch-site'] === 'cross-site') return 403;
  const origin = req.headers.origin;
  if (origin === undefined) return undefined;
  try {
    return new URL(origin).host === host ? undefined : 403;
  } catch {
    return 403;
  }
}

/** RPC over HTTP：复刻宿主 /api 的 wire 语义。 */
async function serveRpcRequest(req, res, dispatch, log) {
  const endpoint = endpointOf(req.url);
  if (req.method !== 'POST' || endpoint === undefined) {
    send(res, 404, 'not found');
    return;
  }

  const mediaType = (req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    send(res, 415, 'content type must be application/json');
    return;
  }

  const raw = await readBody(req, BODY_MAX);
  if (raw === undefined) {
    send(res, 413, 'body too large');
    return;
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    send(res, 400, 'body is not JSON');
    return;
  }

  const rpcId = typeof body?.rpcId === 'string' && body.rpcId ? body.rpcId : undefined;
  const method = typeof body?.method === 'string' ? body.method : undefined;

  if (!rpcId || !method) {
    sendJson(res, {
      type: 'server-response',
      rpcId: 'invalid-request',
      result: fail('invalid client-request message'),
    });
    return;
  }

  if (method !== endpoint) {
    sendJson(res, {
      type: 'server-response',
      rpcId,
      result: fail(`method ${JSON.stringify(method)} 与 endpoint ${JSON.stringify(endpoint)} 不一致`),
    });
    return;
  }

  const result = await dispatch(endpoint, body.payload, undefined);
  sendJson(res, { type: 'server-response', rpcId, result });
}

/** `/dsh-alert/status` → `status`；路径非法返回 undefined。 */
function endpointOf(url) {
  let pathname;
  try {
    pathname = new URL(url, 'http://localhost').pathname;
  } catch {
    return undefined;
  }
  const prefix = `${RPC_CHANNEL}/`;
  if (!pathname.startsWith(prefix)) return undefined;
  const endpoint = pathname.slice(prefix.length);
  if (!endpoint) return undefined;
  for (const seg of endpoint.split('/')) {
    if (!seg || seg === '.' || seg === '..' || !SEGMENT.test(seg)) return undefined;
  }
  return endpoint;
}

function readBody(req, max) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) {
        finish(undefined);
        try {
          req.destroy();
        } catch {
          /* 忽略 */
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => finish(undefined));
  });
}

function send(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sendJson(res, value) {
  const body = JSON.stringify(value);
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

// ── 路径二：老版本 DSH 的 rpc.handle ──

function mountLegacyHandle(ctx, dispatch, log) {
  let connection;
  try {
    connection = ctx?.connection;
  } catch {
    return undefined;
  }
  const handle = connection?.rpc?.handle;
  if (typeof handle !== 'function') return undefined;

  const handler = async (endpoint, payload, signal) => dispatch(endpoint, payload, signal);
  try {
    const dispose = handle.call(connection.rpc, RPC_CHANNEL, handler, { authority: 'loopback' });
    log({ event: 'rpc-legacy-mounted' });
    return normalizeDisposer(dispose);
  } catch (error) {
    log({ event: 'rpc-legacy-failed', message: String(error?.message ?? error) });
    return undefined;
  }
}

// ── 小工具 ──

function safeRead(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** register/handle 可能返回函数、Promise<函数> 或 undefined，统一成同步清理函数。 */
function normalizeDisposer(value) {
  if (typeof value === 'function') {
    return () => {
      try {
        value();
      } catch {
        /* 已经清理过 */
      }
    };
  }
  if (value && typeof value.then === 'function') {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      Promise.resolve(value)
        .then((real) => {
          if (typeof real === 'function') real();
        })
        .catch(() => {
          /* 忽略 */
        });
    };
  }
  return () => {};
}

// 供测试用：把路由 handler 直接暴露出来，不必起真的 HTTP 服务器
export const __internals = { endpointOf, rejectReason, serveRpcRequest, readJson };
