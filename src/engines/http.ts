import { TranslationError, codeFromHttpStatus, toTranslationError } from '../core/errors';
import type { EngineId } from './ids';

export interface RequestOptions {
  fetchImpl: typeof fetch;
  engineId: EngineId;
  signal?: AbortSignal;
  timeoutMs?: number;
  init?: RequestInit;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * 统一的请求封装：超时、状态码 → 错误码映射、AbortSignal 合并。
 *
 * 所有引擎请求都只在 background 里发起：MV3 的 background 拿到
 * host_permissions 后不受页面 CORS 限制，内容脚本则会被 CORS 拦下。
 */
export async function requestText(url: string, options: RequestOptions): Promise<string> {
  const { fetchImpl, engineId, signal, timeoutMs = DEFAULT_TIMEOUT_MS, init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new TranslationError(codeFromHttpStatus(response.status), `${engineId} 返回 HTTP ${response.status}`, {
        engineId,
        status: response.status,
      });
    }
    return await response.text();
  } catch (error) {
    // 自己触发的超时会表现为 AbortError，需要和用户取消区分开
    if (!signal?.aborted && error instanceof Error && error.name === 'AbortError') {
      throw new TranslationError('TIMEOUT', `${engineId} 请求超时`, { engineId, cause: error });
    }
    throw toTranslationError(error, engineId);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function requestJson<T>(url: string, options: RequestOptions): Promise<T> {
  const body = await requestText(url, options);
  try {
    return JSON.parse(body) as T;
  } catch (error) {
    throw new TranslationError('BAD_RESPONSE', `${options.engineId} 返回了非 JSON 内容`, {
      engineId: options.engineId,
      cause: error,
    });
  }
}
