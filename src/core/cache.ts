import { storage } from '#imports';
import { cyrb53 } from './hash';
import type { CacheStats } from './messaging';
import type { LangCode, SourceLang } from './types';

interface CacheEntry {
  /** 译文 */
  t: string;
  /** 写入时间戳 */
  at: number;
}

type CacheRecord = Record<string, CacheEntry>;

export interface TranslationCacheOptions {
  maxEntries: number;
  ttlMs: number;
  /** 写盘防抖，避免滚动翻译时高频写 storage。 */
  persistDebounceMs?: number;
}

const STORAGE_KEY = 'local:translationCache' as const;

/** 缓存 key 必须包含引擎与语言方向，否则切引擎后会读到旧译文。 */
export function cacheKey(engineId: string, from: SourceLang, to: LangCode, text: string): string {
  return `${engineId}|${from}|${to}|${cyrb53(text)}`;
}

/**
 * 内存 LRU + storage.local 持久化。
 *
 * 只在 background 中实例化：MV3 的 service worker 会被回收，
 * 所以内存态必须能从 storage 重建，同时写盘要防抖。
 */
export class TranslationCache {
  #map = new Map<string, CacheEntry>();
  #options: Required<TranslationCacheOptions>;
  #hits = 0;
  #misses = 0;
  #loading: Promise<void> | null = null;
  #persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: TranslationCacheOptions) {
    this.#options = { persistDebounceMs: 2000, ...options };
  }

  configure(options: Partial<TranslationCacheOptions>): void {
    this.#options = { ...this.#options, ...options };
    this.#evict();
  }

  /** 幂等的懒加载，多处并发调用只会读一次 storage。 */
  async ready(): Promise<void> {
    this.#loading ??= this.#load();
    return this.#loading;
  }

  get(key: string): string | undefined {
    const entry = this.#map.get(key);
    if (!entry) {
      this.#misses += 1;
      return undefined;
    }
    if (Date.now() - entry.at > this.#options.ttlMs) {
      this.#map.delete(key);
      this.#misses += 1;
      return undefined;
    }
    // 触碰即刷新 LRU 顺序
    this.#map.delete(key);
    this.#map.set(key, entry);
    this.#hits += 1;
    return entry.t;
  }

  set(key: string, text: string): void {
    this.#map.delete(key);
    this.#map.set(key, { t: text, at: Date.now() });
    this.#evict();
    this.#schedulePersist();
  }

  stats(): CacheStats {
    return { entries: this.#map.size, hits: this.#hits, misses: this.#misses };
  }

  async clear(): Promise<void> {
    this.#map.clear();
    this.#hits = 0;
    this.#misses = 0;
    if (this.#persistTimer) {
      clearTimeout(this.#persistTimer);
      this.#persistTimer = null;
    }
    await storage.removeItem(STORAGE_KEY);
  }

  async flush(): Promise<void> {
    if (this.#persistTimer) {
      clearTimeout(this.#persistTimer);
      this.#persistTimer = null;
    }
    await this.#persist();
  }

  async #load(): Promise<void> {
    const stored = await storage.getItem<CacheRecord>(STORAGE_KEY);
    if (!stored) return;
    const now = Date.now();
    for (const [key, entry] of Object.entries(stored)) {
      if (!entry || typeof entry.t !== 'string') continue;
      if (now - entry.at > this.#options.ttlMs) continue;
      this.#map.set(key, entry);
    }
    this.#evict();
  }

  #evict(): void {
    while (this.#map.size > this.#options.maxEntries) {
      const oldest = this.#map.keys().next();
      if (oldest.done) break;
      this.#map.delete(oldest.value);
    }
  }

  #schedulePersist(): void {
    if (this.#persistTimer) return;
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = null;
      void this.#persist();
    }, this.#options.persistDebounceMs);
  }

  async #persist(): Promise<void> {
    const record: CacheRecord = {};
    for (const [key, entry] of this.#map) record[key] = entry;
    await storage.setItem(STORAGE_KEY, record);
  }
}
