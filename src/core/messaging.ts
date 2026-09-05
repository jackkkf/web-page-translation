import { defineExtensionMessaging } from '@webext-core/messaging';
import type { EngineId } from '../engines/ids';
import type { TranslationErrorCode } from './errors';
import type { LangCode, SourceLang } from './types';

export interface TranslateBatchRequest {
  texts: string[];
  from: SourceLang;
  to: LangCode;
  /** 不传则使用当前设置里的引擎。 */
  engineId?: EngineId;
}

export type TranslateBatchItem =
  { ok: true; text: string; cached: boolean } | { ok: false; code: TranslationErrorCode; message: string };

export interface TranslateBatchResponse {
  /** 本次实际发起请求的主引擎。 */
  engineId: EngineId;
  /** 主引擎失败后是否启用了降级引擎。 */
  usedFallback: boolean;
  items: TranslateBatchItem[];
}

export interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
}

export type PageCommand = 'translate' | 'restore' | 'toggle' | 'refresh';

export type PagePhase = 'idle' | 'translating' | 'translated' | 'error';

export interface PageStatus {
  phase: PagePhase;
  engineId: EngineId | null;
  targetLang: LangCode;
  /** 已渲染出译文的段落数 */
  translatedUnits: number;
  /** 已发现的可译段落数 */
  totalUnits: number;
  error?: string;
}

interface ProtocolMap {
  // ---- 发往 background ----
  translateBatch(request: TranslateBatchRequest): TranslateBatchResponse;
  /** 确认目标标签页已注入内容脚本（幂等）。 */
  ensureContentScript(request: { tabId: number }): boolean;
  clearCache(): void;
  getCacheStats(): CacheStats;

  // ---- 发往内容脚本（调用时必须带 tabId）----
  ping(): true;
  runPageCommand(request: { command: PageCommand }): PageStatus;
  getPageStatus(): PageStatus;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
