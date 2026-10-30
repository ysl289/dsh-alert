/**
 * HTTP 小工具。
 *
 * 统一用 res.text() + JSON.parse 而不是 res.json()：
 *   - 有些服务失败时返回 HTML 错误页，res.json() 会抛一个信息量很低的异常
 *   - 测试里注入的假 response 只要实现 text() 就够了
 */

/** 读响应体并尝试解析成 JSON；不是 JSON 就返回 null。 */
export async function readJson(res) {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/** 读响应体原始文本（截断，避免把整个 HTML 错误页塞进日志）。 */
export async function readText(res, max = 300) {
  try {
    const text = await res.text();
    return text.length > max ? text.slice(0, max) + '…' : text;
  } catch {
    return '';
  }
}

/** 带超时的 fetch；超时抛 AbortError。 */
export async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
