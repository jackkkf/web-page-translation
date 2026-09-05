import type { EngineTranslateInput, EngineTranslateResult, LangCode } from '../core/types';
import type { EngineCredentials } from '../core/settings';
import type { EngineId } from './ids';

/** 引擎的配额/并发约束，由 TranslateService 用来切分批次和限流。 */
export interface EngineLimits {
  /** 单次请求最多携带多少条文本（不支持批量的引擎填 1）。 */
  maxTextsPerRequest: number;
  /** 单次请求的字符预算。 */
  maxCharsPerRequest: number;
  /** 允许的并发请求数。 */
  concurrency: number;
  /** 两次请求之间的最小间隔，用于满足 QPS 限制（如百度标准版 QPS=1）。 */
  minIntervalMs: number;
}

export interface EngineRuntimeContext {
  credentials: EngineCredentials;
  signal?: AbortSignal;
  /** 便于单测注入假的 fetch。 */
  fetchImpl: typeof fetch;
}

export interface TranslationEngine {
  readonly id: EngineId;
  readonly name: string;
  /** 是否零成本可用（不需要用户自备密钥）。 */
  readonly keyless: boolean;
  readonly limits: EngineLimits;
  /** 展示给用户的说明，也用于商店文案与权限说明。 */
  readonly notes: string;
  readonly docsUrl?: string;

  /** 该引擎是否支持这个语言方向。 */
  supports(lang: LangCode): boolean;

  /** 校验凭据是否齐备；返回 false 时上层抛 MISSING_CREDENTIALS。 */
  hasCredentials(credentials: EngineCredentials): boolean;

  translate(input: EngineTranslateInput, ctx: EngineRuntimeContext): Promise<EngineTranslateResult>;
}
