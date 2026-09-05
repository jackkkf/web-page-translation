import type { ContentScriptContext } from '#imports';
import { describeError } from '../core/errors';
import { sendMessage, type PageCommand, type PageStatus } from '../core/messaging';
import { loadSettings, shouldAutoTranslate, type Settings } from '../core/settings';
import type { EngineId } from '../engines/ids';
import { collectUnits, type TranslationUnit } from './dom-walker';
import { TranslationRenderer } from './renderer';
import { injectContentStyle } from './styles';

/** 一次消息最多带多少个段落；背景页会按引擎限制再细分。 */
const BATCH_SIZE = 20;
/** 队列合批的等待时间，避免滚动时一个段落发一次请求。 */
const FLUSH_DELAY_MS = 60;
/** 视口外提前多少像素开始翻译。 */
const VIEWPORT_MARGIN = '600px';
const MUTATION_DEBOUNCE_MS = 500;

/**
 * 页面翻译状态机。
 *
 * 关键设计：
 * - 只翻译"接近视口"的段落（IntersectionObserver），长页面首屏成本恒定
 * - MutationObserver 兜住 SPA / 无限滚动的新增内容
 * - 所有网络请求都发给 background，内容脚本不直接触碰翻译接口
 */
export class PageTranslator {
  #ctx: ContentScriptContext;
  #settings: Settings | null = null;
  #renderer: TranslationRenderer | null = null;
  #phase: PageStatus['phase'] = 'idle';
  #engineId: EngineId | null = null;
  #error: string | undefined;

  #seen = new WeakSet<Text>();
  #unitsByContainer = new Map<Element, TranslationUnit[]>();
  #queue: TranslationUnit[] = [];
  #discovered = 0;
  #inFlight = 0;

  #intersection: IntersectionObserver | null = null;
  #mutation: MutationObserver | null = null;
  // ctx.setTimeout 返回浏览器的 number 句柄，且在上下文失效时自动停掉
  #flushTimer: number | null = null;
  #rescanTimer: number | null = null;

  constructor(ctx: ContentScriptContext) {
    this.#ctx = ctx;
    // SPA 路由切换不会重新执行内容脚本，需要自己监听
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      if (this.#phase === 'translated' || this.#phase === 'translating') this.#scheduleRescan();
    });
  }

  getStatus(): PageStatus {
    return {
      phase: this.#phase,
      engineId: this.#engineId,
      targetLang: this.#settings?.targetLang ?? '',
      translatedUnits: this.#renderer?.resolvedCount ?? 0,
      totalUnits: this.#discovered,
      ...(this.#error ? { error: this.#error } : {}),
    };
  }

  async run(command: PageCommand): Promise<PageStatus> {
    switch (command) {
      case 'translate':
        await this.#start();
        break;
      case 'restore':
        this.#stop();
        break;
      case 'toggle':
        if (this.#phase === 'idle' || this.#phase === 'error') await this.#start();
        else this.#stop();
        break;
      case 'refresh':
        this.#stop();
        await this.#start();
        break;
    }
    return this.getStatus();
  }

  /** 按设置与站点规则决定是否自动翻译。 */
  async maybeAutoTranslate(): Promise<void> {
    const settings = await loadSettings();
    if (shouldAutoTranslate(location.hostname, settings)) await this.#start();
  }

  async #start(): Promise<void> {
    if (this.#phase === 'translating' || this.#phase === 'translated') return;

    this.#settings = await loadSettings();
    this.#error = undefined;
    this.#engineId = this.#settings.engineId;
    this.#phase = 'translating';

    injectContentStyle();
    this.#renderer = new TranslationRenderer({
      displayMode: this.#settings.displayMode,
      style: this.#settings.translationStyle,
    });

    this.#observeViewport();
    this.#scan(document.body);
    this.#observeMutations();
    this.#settleIfDone();
  }

  #stop(): void {
    this.#intersection?.disconnect();
    this.#intersection = null;
    this.#mutation?.disconnect();
    this.#mutation = null;
    if (this.#flushTimer) clearTimeout(this.#flushTimer);
    if (this.#rescanTimer) clearTimeout(this.#rescanTimer);
    this.#flushTimer = null;
    this.#rescanTimer = null;

    this.#renderer?.restoreAll();
    this.#renderer = null;
    this.#queue = [];
    this.#unitsByContainer.clear();
    this.#seen = new WeakSet<Text>();
    this.#discovered = 0;
    this.#inFlight = 0;
    this.#phase = 'idle';
    this.#error = undefined;
  }

  #observeViewport(): void {
    if (this.#intersection || typeof IntersectionObserver === 'undefined') return;
    this.#intersection = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const units = this.#unitsByContainer.get(entry.target);
          this.#intersection?.unobserve(entry.target);
          this.#unitsByContainer.delete(entry.target);
          if (units?.length) this.#enqueue(units);
        }
      },
      { rootMargin: VIEWPORT_MARGIN },
    );
  }

  #observeMutations(): void {
    if (this.#mutation) return;
    this.#mutation = new MutationObserver((records) => {
      const hasContentChange = records.some(
        (record) => record.type === 'characterData' || record.addedNodes.length > 0,
      );
      if (hasContentChange) this.#scheduleRescan();
    });
    this.#mutation.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  #scheduleRescan(): void {
    if (this.#rescanTimer) return;
    this.#rescanTimer = this.#ctx.setTimeout(() => {
      this.#rescanTimer = null;
      if (this.#phase === 'idle') return;
      this.#scan(document.body);
      this.#settleIfDone();
    }, MUTATION_DEBOUNCE_MS);
  }

  #scan(root: Node): void {
    if (!this.#settings) return;
    const units = collectUnits(root, { targetLang: this.#settings.targetLang, seen: this.#seen });
    if (units.length === 0) return;

    this.#discovered += units.length;

    if (!this.#intersection) {
      this.#enqueue(units);
      return;
    }

    for (const unit of units) {
      const existing = this.#unitsByContainer.get(unit.container);
      if (existing) {
        existing.push(unit);
      } else {
        this.#unitsByContainer.set(unit.container, [unit]);
        this.#intersection.observe(unit.container);
      }
    }
  }

  #enqueue(units: TranslationUnit[]): void {
    this.#queue.push(...units);
    if (this.#phase === 'translated') this.#phase = 'translating';
    if (this.#flushTimer) return;
    this.#flushTimer = this.#ctx.setTimeout(() => {
      this.#flushTimer = null;
      void this.#flush();
    }, FLUSH_DELAY_MS);
  }

  async #flush(): Promise<void> {
    const renderer = this.#renderer;
    const settings = this.#settings;
    if (!renderer || !settings) return;

    while (this.#queue.length > 0) {
      const batch = this.#queue.splice(0, BATCH_SIZE).filter((unit) => unit.container.isConnected);
      if (batch.length === 0) continue;

      for (const unit of batch) renderer.markPending(unit);
      this.#inFlight += 1;

      try {
        const response = await sendMessage('translateBatch', {
          texts: batch.map((unit) => unit.text),
          from: settings.sourceLang,
          to: settings.targetLang,
        });
        this.#engineId = response.engineId;

        batch.forEach((unit, index) => {
          const item = response.items[index];
          if (!item) {
            renderer.reject(unit, describeError('UNKNOWN'));
            return;
          }
          if (item.ok) renderer.resolve(unit, item.text);
          else renderer.reject(unit, item.message);
        });

        const firstFailure = response.items.find((item) => !item.ok);
        this.#error = firstFailure && !firstFailure.ok ? firstFailure.message : undefined;
      } catch (error) {
        // background 不可达（例如扩展刚更新）时给出可读提示
        const message = error instanceof Error ? error.message : describeError('UNKNOWN');
        this.#error = message;
        for (const unit of batch) renderer.reject(unit, message);
      } finally {
        this.#inFlight -= 1;
      }
    }

    this.#settleIfDone();
  }

  #settleIfDone(): void {
    if (this.#phase === 'idle') return;
    if (this.#queue.length > 0 || this.#inFlight > 0) return;
    // 有译文就算成功；一个都没出来且有错误，才算失败
    this.#phase = this.#error && (this.#renderer?.resolvedCount ?? 0) === 0 ? 'error' : 'translated';
  }
}
