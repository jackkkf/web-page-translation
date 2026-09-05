/**
 * 统一的翻译错误模型。引擎只负责抛出带语义的错误码，
 * 重试、降级、提示文案都由上层（TranslateService / UI）决定。
 */

export type TranslationErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'AUTH'
  | 'MISSING_CREDENTIALS'
  | 'QUOTA'
  | 'UNSUPPORTED_LANGUAGE'
  | 'BAD_RESPONSE'
  | 'ABORTED'
  | 'UNKNOWN';

/** 可以通过重试（可能配合退避）自行恢复的错误。 */
const RETRYABLE_CODES = new Set<TranslationErrorCode>(['NETWORK', 'TIMEOUT', 'RATE_LIMIT', 'BAD_RESPONSE']);

/** 换一个引擎有可能成功的错误；`ABORTED` 属于用户主动取消，不降级。 */
const FALLBACKABLE_CODES = new Set<TranslationErrorCode>([
  'NETWORK',
  'TIMEOUT',
  'RATE_LIMIT',
  'AUTH',
  'MISSING_CREDENTIALS',
  'QUOTA',
  'UNSUPPORTED_LANGUAGE',
  'BAD_RESPONSE',
  'UNKNOWN',
]);

export interface TranslationErrorOptions {
  engineId?: string;
  status?: number;
  cause?: unknown;
}

export class TranslationError extends Error {
  readonly code: TranslationErrorCode;
  readonly engineId?: string;
  readonly status?: number;

  constructor(code: TranslationErrorCode, message: string, options: TranslationErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'TranslationError';
    this.code = code;
    this.engineId = options.engineId;
    this.status = options.status;
  }

  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }

  get fallbackable(): boolean {
    return FALLBACKABLE_CODES.has(this.code);
  }
}

export function isTranslationError(value: unknown): value is TranslationError {
  return value instanceof TranslationError;
}

/** 把任意异常收敛成 TranslationError，避免上层到处做类型判断。 */
export function toTranslationError(value: unknown, engineId?: string): TranslationError {
  if (isTranslationError(value)) return value;

  if (value instanceof DOMException && value.name === 'AbortError') {
    return new TranslationError('ABORTED', '请求已取消', { engineId, cause: value });
  }
  if (value instanceof Error) {
    // fetch 在网络层失败时统一抛 TypeError('Failed to fetch')
    const code: TranslationErrorCode = value.name === 'AbortError' ? 'ABORTED' : 'NETWORK';
    return new TranslationError(code, value.message, { engineId, cause: value });
  }
  return new TranslationError('UNKNOWN', String(value), { engineId, cause: value });
}

/** 根据 HTTP 状态码推断错误码。 */
export function codeFromHttpStatus(status: number): TranslationErrorCode {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 500) return 'NETWORK';
  return 'BAD_RESPONSE';
}

/** 面向用户的中文提示。 */
export function describeError(code: TranslationErrorCode): string {
  switch (code) {
    case 'NETWORK':
      return '网络请求失败，请检查网络或代理设置';
    case 'TIMEOUT':
      return '翻译请求超时';
    case 'RATE_LIMIT':
      return '请求过于频繁，已被引擎限流';
    case 'AUTH':
      return '引擎鉴权失败，请检查密钥配置';
    case 'MISSING_CREDENTIALS':
      return '该引擎需要先在设置中填写 API 密钥';
    case 'QUOTA':
      return '引擎免费额度已用尽';
    case 'UNSUPPORTED_LANGUAGE':
      return '该引擎不支持所选语言方向';
    case 'BAD_RESPONSE':
      return '引擎返回了无法解析的内容';
    case 'ABORTED':
      return '翻译已取消';
    default:
      return '翻译失败，请稍后重试';
  }
}
