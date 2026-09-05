import type { TranslationCache } from '../core/cache';
import { cacheKey } from '../core/cache';
import { TranslationError, describeError, toTranslationError } from '../core/errors';
import { RateLimiter, backoffDelay, sleep } from '../core/limiter';
import type { TranslateBatchItem, TranslateBatchRequest, TranslateBatchResponse } from '../core/messaging';
import type { EngineCredentials, Settings } from '../core/settings';
import type { LangCode, SourceLang } from '../core/types';
import type { EngineId } from '../engines/ids';
import type { EngineRegistry } from '../engines/registry';
import type { TranslationEngine } from '../engines/types';

export interface TranslateServiceDeps {
  engines: EngineRegistry;
  cache: TranslationCache;
  loadSettings: () => Promise<Settings>;
  loadCredentials: () => Promise<EngineCredentials>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** 单条待翻译文本及其在原请求中的下标。 */
interface PendingText {
  index: number;
  text: string;
}

const MAX_RETRIES = 2;
/** 连续失败多少次后短路该引擎。 */
const CIRCUIT_FAILURE_THRESHOLD = 3;
/** 短路持续时长：过后放行一次探测请求。 */
const CIRCUIT_OPEN_MS = 60_000;

/**
 * 翻译编排层：把"一批文本"变成"若干次符合引擎约束的请求"。
 *
 * 职责边界：
 * - 引擎（src/engines）只管一次请求怎么发、怎么解析
 * - 这里管缓存、分批、限流、重试、降级、熔断、错误归一
 */
export class TranslateService {
  #deps: TranslateServiceDeps;
  #limiters = new Map<EngineId, RateLimiter>();
  #failures = new Map<EngineId, number>();
  #openUntil = new Map<EngineId, number>();

  constructor(deps: TranslateServiceDeps) {
    this.#deps = deps;
  }

  async translateBatch(request: TranslateBatchRequest): Promise<TranslateBatchResponse> {
    const settings = await this.#deps.loadSettings();
    const requestedId = request.engineId ?? settings.engineId;
    const fallbackId =
      settings.fallbackEngineId && settings.fallbackEngineId !== requestedId ? settings.fallbackEngineId : null;

    // 主引擎正处于熔断窗口内时，直接用降级引擎，省掉一轮必然失败的请求
    const primaryId = this.#isOpen(requestedId) && fallbackId ? fallbackId : requestedId;
    const secondaryId = primaryId === requestedId ? fallbackId : null;

    if (request.texts.length === 0) {
      return { engineId: primaryId, usedFallback: primaryId !== requestedId, items: [] };
    }

    const { from, to } = request;
    if (settings.cacheEnabled) {
      this.#deps.cache.configure({
        maxEntries: settings.cacheMaxEntries,
        ttlMs: settings.cacheTtlHours * 3600_000,
      });
      await this.#deps.cache.ready();
    }

    const items = new Array<TranslateBatchItem | undefined>(request.texts.length);

    // 1) 先吃缓存
    const pending: PendingText[] = [];
    request.texts.forEach((text, index) => {
      if (settings.cacheEnabled) {
        const hit = this.#deps.cache.get(cacheKey(primaryId, from, to, text));
        if (hit !== undefined) {
          items[index] = { ok: true, text: hit, cached: true };
          return;
        }
      }
      pending.push({ index, text });
    });

    if (pending.length === 0) {
      return {
        engineId: primaryId,
        usedFallback: primaryId !== requestedId,
        items: items.map((item) => item ?? unknownFailure()),
      };
    }

    // 2) 主引擎
    const credentials = await this.#deps.loadCredentials();
    const primaryResults = await this.#runEngine(primaryId, pending, from, to, credentials, settings.cacheEnabled);
    for (const [index, item] of primaryResults) items[index] = item;

    // 3) 失败的部分交给降级引擎再试一轮
    let usedFallback = primaryId !== requestedId;
    const failed = secondaryId ? pending.filter(({ index }) => items[index]?.ok === false) : [];

    if (secondaryId && failed.length > 0) {
      const fallbackResults = await this.#runEngine(secondaryId, failed, from, to, credentials, settings.cacheEnabled);
      for (const [index, item] of fallbackResults) {
        // 只在降级成功时覆盖，否则保留主引擎的错误信息（更贴近用户的引擎配置）
        if (item.ok) {
          items[index] = item;
          usedFallback = true;
        }
      }
    }

    return { engineId: primaryId, usedFallback, items: items.map((item) => item ?? unknownFailure()) };
  }

  #now(): number {
    return this.#deps.now?.() ?? Date.now();
  }

  #isOpen(engineId: EngineId): boolean {
    const until = this.#openUntil.get(engineId) ?? 0;
    if (until <= this.#now()) return false;
    return true;
  }

  #recordSuccess(engineId: EngineId): void {
    this.#failures.delete(engineId);
    this.#openUntil.delete(engineId);
  }

  #recordFailure(engineId: EngineId, error: TranslationError): void {
    // 用户主动取消不算引擎的错
    if (error.code === 'ABORTED') return;
    const failures = (this.#failures.get(engineId) ?? 0) + 1;
    this.#failures.set(engineId, failures);
    if (failures >= CIRCUIT_FAILURE_THRESHOLD) {
      this.#openUntil.set(engineId, this.#now() + CIRCUIT_OPEN_MS);
      this.#failures.set(engineId, 0);
    }
  }

  #limiter(engine: TranslationEngine): RateLimiter {
    let limiter = this.#limiters.get(engine.id);
    if (!limiter) {
      limiter = new RateLimiter({
        concurrency: engine.limits.concurrency,
        minIntervalMs: engine.limits.minIntervalMs,
      });
      this.#limiters.set(engine.id, limiter);
    }
    return limiter;
  }

  async #runEngine(
    engineId: EngineId,
    pending: PendingText[],
    from: SourceLang,
    to: LangCode,
    credentials: EngineCredentials,
    cacheEnabled: boolean,
  ): Promise<Map<number, TranslateBatchItem>> {
    const results = new Map<number, TranslateBatchItem>();
    const engine = this.#deps.engines[engineId];

    const precondition = checkPreconditions(engine, credentials, to);
    if (precondition) {
      for (const { index } of pending) results.set(index, failureOf(precondition));
      return results;
    }

    const limiter = this.#limiter(engine);
    const chunks = chunkByLimits(pending, engine.limits.maxTextsPerRequest, engine.limits.maxCharsPerRequest);

    await Promise.all(
      chunks.map((chunk) =>
        limiter.run(async () => {
          try {
            const output = await this.#translateChunkWithRetry(engine, chunk, from, to, credentials);
            chunk.forEach((entry, position) => {
              const text = output[position] ?? entry.text;
              results.set(entry.index, { ok: true, text, cached: false });
              if (cacheEnabled) this.#deps.cache.set(cacheKey(engineId, from, to, entry.text), text);
            });
            this.#recordSuccess(engineId);
          } catch (error) {
            const normalized = toTranslationError(error, engineId);
            this.#recordFailure(engineId, normalized);
            for (const entry of chunk) results.set(entry.index, failureOf(normalized));
          }
        }),
      ),
    );

    return results;
  }

  async #translateChunkWithRetry(
    engine: TranslationEngine,
    chunk: PendingText[],
    from: SourceLang,
    to: LangCode,
    credentials: EngineCredentials,
  ): Promise<string[]> {
    let lastError: TranslationError | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await engine.translate(
          { texts: chunk.map((entry) => entry.text), from, to },
          { credentials, fetchImpl: this.#deps.fetchImpl ?? globalThis.fetch },
        );
        if (result.texts.length !== chunk.length) {
          throw new TranslationError('BAD_RESPONSE', `${engine.id} 返回条数不匹配`, { engineId: engine.id });
        }
        return result.texts;
      } catch (error) {
        lastError = toTranslationError(error, engine.id);
        if (!lastError.retryable || attempt === MAX_RETRIES) break;
        await sleep(backoffDelay(attempt));
      }
    }

    throw lastError ?? new TranslationError('UNKNOWN', '翻译失败', { engineId: engine.id });
  }
}

function checkPreconditions(
  engine: TranslationEngine,
  credentials: EngineCredentials,
  to: LangCode,
): TranslationError | null {
  if (!engine.hasCredentials(credentials)) {
    return new TranslationError('MISSING_CREDENTIALS', describeError('MISSING_CREDENTIALS'), { engineId: engine.id });
  }
  if (!engine.supports(to)) {
    return new TranslationError('UNSUPPORTED_LANGUAGE', describeError('UNSUPPORTED_LANGUAGE'), { engineId: engine.id });
  }
  return null;
}

function failureOf(error: TranslationError): TranslateBatchItem {
  return { ok: false, code: error.code, message: error.message || describeError(error.code) };
}

function unknownFailure(): TranslateBatchItem {
  return { ok: false, code: 'UNKNOWN', message: describeError('UNKNOWN') };
}

/**
 * 按"条数上限"和"字符预算"双约束切分批次。
 * 单条超长时独占一个批次 —— 交给引擎自己处理比在这里悄悄丢内容更安全。
 */
export function chunkByLimits(pending: PendingText[], maxTexts: number, maxChars: number): PendingText[][] {
  const chunks: PendingText[][] = [];
  let current: PendingText[] = [];
  let currentChars = 0;

  for (const entry of pending) {
    const exceedsCount = current.length >= Math.max(1, maxTexts);
    const exceedsChars = current.length > 0 && currentChars + entry.text.length > maxChars;

    if (exceedsCount || exceedsChars) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(entry);
    currentChars += entry.text.length;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}
