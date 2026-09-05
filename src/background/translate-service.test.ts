import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { TranslationCache } from '../core/cache';
import { TranslationError } from '../core/errors';
import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import type { EngineId } from '../engines/ids';
import type { EngineRegistry } from '../engines/registry';
import type { EngineTranslateInput, EngineTranslateResult } from '../core/types';
import type { EngineLimits, TranslationEngine } from '../engines/types';
import { TranslateService, chunkByLimits } from './translate-service';

interface StubOptions {
  limits?: Partial<EngineLimits>;
  keyless?: boolean;
  handler?: (input: EngineTranslateInput) => Promise<EngineTranslateResult>;
}

function stubEngine(id: EngineId, options: StubOptions = {}) {
  const calls: EngineTranslateInput[] = [];
  const engine: TranslationEngine = {
    id,
    name: id,
    keyless: options.keyless ?? true,
    notes: '',
    limits: {
      maxTextsPerRequest: 10,
      maxCharsPerRequest: 10_000,
      concurrency: 4,
      minIntervalMs: 0,
      ...options.limits,
    },
    supports: () => true,
    hasCredentials: () => options.keyless ?? true,
    async translate(input) {
      calls.push(input);
      if (options.handler) return options.handler(input);
      return { texts: input.texts.map((text) => `[${id}]${text}`) };
    },
  };
  return { engine, calls };
}

function createService(
  overrides: Partial<Settings>,
  engines: Partial<EngineRegistry>,
  now?: () => number,
): { service: TranslateService; cache: TranslationCache } {
  const fallback = stubEngine('bing-free').engine;
  const registry = {
    'bing-free': fallback,
    'google-free': fallback,
    baidu: fallback,
    ...engines,
  } as EngineRegistry;

  const cache = new TranslationCache({ maxEntries: 100, ttlMs: 60_000, persistDebounceMs: 10_000 });
  const service = new TranslateService({
    engines: registry,
    cache,
    loadSettings: async () => ({ ...DEFAULT_SETTINGS, ...overrides }),
    loadCredentials: async () => ({}),
    ...(now ? { now } : {}),
  });
  return { service, cache };
}

describe('chunkByLimits', () => {
  it('按条数上限切分', () => {
    const pending = ['a', 'b', 'c', 'd', 'e'].map((text, index) => ({ index, text }));
    expect(chunkByLimits(pending, 2, 1000).map((chunk) => chunk.length)).toEqual([2, 2, 1]);
  });

  it('按字符预算切分', () => {
    const pending = [
      { index: 0, text: 'x'.repeat(60) },
      { index: 1, text: 'y'.repeat(60) },
      { index: 2, text: 'z'.repeat(10) },
    ];
    expect(chunkByLimits(pending, 10, 100).map((chunk) => chunk.length)).toEqual([1, 2]);
  });

  it('单条超长时独占一批而不是被丢掉', () => {
    const pending = [{ index: 0, text: 'x'.repeat(500) }];
    const chunks = chunkByLimits(pending, 10, 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(1);
  });
});

describe('TranslateService', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('按引擎的批量上限切分请求', async () => {
    const primary = stubEngine('bing-free', { limits: { maxTextsPerRequest: 2 } });
    const { service } = createService(
      { engineId: 'bing-free', fallbackEngineId: null, cacheEnabled: false },
      { 'bing-free': primary.engine },
    );

    const response = await service.translateBatch({ texts: ['a', 'b', 'c'], from: 'auto', to: 'zh-CN' });

    expect(primary.calls.map((call) => call.texts)).toEqual([['a', 'b'], ['c']]);
    expect(response.items).toEqual([
      { ok: true, text: '[bing-free]a', cached: false },
      { ok: true, text: '[bing-free]b', cached: false },
      { ok: true, text: '[bing-free]c', cached: false },
    ]);
  });

  it('命中缓存的文本不再请求引擎', async () => {
    const primary = stubEngine('bing-free');
    const { service } = createService(
      { engineId: 'bing-free', fallbackEngineId: null, cacheEnabled: true },
      { 'bing-free': primary.engine },
    );

    await service.translateBatch({ texts: ['a'], from: 'auto', to: 'zh-CN' });
    const second = await service.translateBatch({ texts: ['a', 'b'], from: 'auto', to: 'zh-CN' });

    expect(second.items[0]).toEqual({ ok: true, text: '[bing-free]a', cached: true });
    expect(primary.calls.map((call) => call.texts)).toEqual([['a'], ['b']]);
  });

  it('切换引擎后不会读到上一个引擎的缓存', async () => {
    const primary = stubEngine('bing-free');
    const other = stubEngine('google-free');
    const { service } = createService(
      { engineId: 'bing-free', fallbackEngineId: null, cacheEnabled: true },
      { 'bing-free': primary.engine, 'google-free': other.engine },
    );

    await service.translateBatch({ texts: ['a'], from: 'auto', to: 'zh-CN' });
    const response = await service.translateBatch({ texts: ['a'], from: 'auto', to: 'zh-CN', engineId: 'google-free' });

    expect(response.items[0]).toEqual({ ok: true, text: '[google-free]a', cached: false });
  });

  it('主引擎失败时降级到备用引擎', async () => {
    const failing = stubEngine('bing-free', {
      handler: async () => {
        throw new TranslationError('AUTH', 'token 失效');
      },
    });
    const backup = stubEngine('google-free');
    const { service } = createService(
      { engineId: 'bing-free', fallbackEngineId: 'google-free', cacheEnabled: false },
      { 'bing-free': failing.engine, 'google-free': backup.engine },
    );

    const response = await service.translateBatch({ texts: ['a'], from: 'auto', to: 'zh-CN' });

    expect(response.usedFallback).toBe(true);
    expect(response.items[0]).toEqual({ ok: true, text: '[google-free]a', cached: false });
  });

  it('可重试的错误会退避后重试，最多 3 次尝试', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const flaky = stubEngine('bing-free', {
      handler: async (input) => {
        attempts += 1;
        if (attempts < 3) throw new TranslationError('NETWORK', '网络抖动');
        return { texts: input.texts.map((text) => `ok:${text}`) };
      },
    });
    const { service } = createService(
      { engineId: 'bing-free', fallbackEngineId: null, cacheEnabled: false },
      { 'bing-free': flaky.engine },
    );

    const promise = service.translateBatch({ texts: ['a'], from: 'auto', to: 'zh-CN' });
    await vi.runAllTimersAsync();
    const response = await promise;
    vi.useRealTimers();

    expect(attempts).toBe(3);
    expect(response.items[0]).toEqual({ ok: true, text: 'ok:a', cached: false });
  });

  it('不可重试的错误不做重试', async () => {
    let attempts = 0;
    const failing = stubEngine('bing-free', {
      handler: async () => {
        attempts += 1;
        throw new TranslationError('MISSING_CREDENTIALS', '缺少密钥');
      },
    });
    const { service } = createService(
      { engineId: 'bing-free', fallbackEngineId: null, cacheEnabled: false },
      { 'bing-free': failing.engine },
    );

    const response = await service.translateBatch({ texts: ['a'], from: 'auto', to: 'zh-CN' });

    expect(attempts).toBe(1);
    expect(response.items[0]).toMatchObject({ ok: false, code: 'MISSING_CREDENTIALS' });
  });

  it('缺少密钥的引擎直接失败，不发请求', async () => {
    const needsKey = stubEngine('baidu', { keyless: false });
    const { service } = createService(
      { engineId: 'baidu', fallbackEngineId: null, cacheEnabled: false },
      { baidu: needsKey.engine },
    );

    const response = await service.translateBatch({ texts: ['a'], from: 'auto', to: 'zh-CN' });

    expect(needsKey.calls).toHaveLength(0);
    expect(response.items[0]).toMatchObject({ ok: false, code: 'MISSING_CREDENTIALS' });
  });

  it('连续失败达到阈值后短路主引擎，直接走降级', async () => {
    let clock = 0;
    const failing = stubEngine('bing-free', {
      handler: async () => {
        throw new TranslationError('AUTH', '不可用');
      },
    });
    const backup = stubEngine('google-free');
    const { service } = createService(
      { engineId: 'bing-free', fallbackEngineId: 'google-free', cacheEnabled: false },
      { 'bing-free': failing.engine, 'google-free': backup.engine },
      () => clock,
    );

    for (let i = 0; i < 3; i++) {
      await service.translateBatch({ texts: [`t${i}`], from: 'auto', to: 'zh-CN' });
    }
    const callsBeforeCircuitOpens = failing.calls.length;

    await service.translateBatch({ texts: ['after'], from: 'auto', to: 'zh-CN' });
    expect(failing.calls.length).toBe(callsBeforeCircuitOpens);

    // 熔断窗口过去后重新放行探测请求
    clock += 61_000;
    await service.translateBatch({ texts: ['later'], from: 'auto', to: 'zh-CN' });
    expect(failing.calls.length).toBe(callsBeforeCircuitOpens + 1);
  });
});
