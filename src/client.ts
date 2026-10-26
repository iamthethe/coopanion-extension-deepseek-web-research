/** 只把检索参数发到 DeepSeek 官方端点；错误回执不包含远端正文或鉴权头。 */
export const API_BASE = 'https://api.deepseek.com/v1/tools';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export class RequestError extends Error {}

export function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new RequestError(`${name} 必须是 ${min}～${max} 的整数。`);
  }
  return value;
}

export function queryText(value: unknown, name = 'query'): string {
  if (typeof value !== 'string' || !value.trim() || [...value].length > 128) {
    throw new RequestError(`${name} 必须是 1～128 个 Unicode 字符，不能全为空白。`);
  }
  return value.trim();
}

export function pageUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) throw new RequestError('url 长度不得超过 8192。');
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new RequestError('url 必须为不含用户名或密码的 HTTP(S) 网页地址。');
  }
}

const HTTP_HINTS: Record<number, string> = {
  400: '请求参数不合法。', 401: 'API Key 无效，请检查 World 配置中的 DeepSeek API Key。',
  402: 'DeepSeek 余额不足。', 403: '抓取被 DeepSeek 安全策略拒绝。',
  404: '未取得可用网页正文，站点可能不可访问或不支持抓取。',
  408: '服务读取请求超时，可稍后重试。', 413: '请求过大。',
  429: '请求频率受限，请稍后重试。',
};

export async function request(
  kind: 'search' | 'fetch', body: Record<string, unknown>, apiKey: string,
  timeoutMs: number, signal: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!apiKey.trim()) throw new RequestError('缺少 DeepSeek API Key，请在 World 配置中填写并保存。');
  const timeout = AbortSignal.timeout(integer(timeoutMs, 'timeoutMs', 1000, 120000));
  const combined = AbortSignal.any([signal, timeout]);
  try {
    combined.throwIfAborted();
    const response = await fetch(`${API_BASE}/${kind}`, {
      method: 'POST', redirect: 'error', signal: combined,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new RequestError(`DeepSeek HTTP ${response.status}：${HTTP_HINTS[response.status] ?? (response.status >= 500 ? '服务暂时不可用，可稍后重试。' : '请求失败。')}`);
    }
    if (!response.body) throw new RequestError('DeepSeek 返回空响应。');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new RequestError('DeepSeek 响应超过 8 MiB 上限，请减少结果或关闭正文。');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch (error) {
    if (signal.aborted) throw new RequestError('请求已取消。');
    if (timeout.aborted) throw new RequestError('DeepSeek 请求超时，请稍后重试。');
    if (error instanceof RequestError) throw error;
    throw new RequestError('DeepSeek 网络请求失败或返回了无效 JSON，请检查网络后重试。');
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError('DeepSeek 返回的数据结构不合法。');
  return value as Record<string, unknown>;
}

export function string(value: unknown): string {
  if (typeof value !== 'string') throw new RequestError('DeepSeek 返回的数据字段不合法。');
  return value;
}
