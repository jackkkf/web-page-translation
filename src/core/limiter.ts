export interface RateLimiterOptions {
  /** 同时进行的任务数上限。 */
  concurrency: number;
  /** 两个任务开始时间的最小间隔（毫秒），用于满足 QPS 限制。 */
  minIntervalMs: number;
}

type Waiter = () => void;

/**
 * 并发 + 最小间隔双重限流。
 *
 * 百度标准版 QPS=1，必须靠 `minIntervalMs` 兜住；
 * 免费的微软/谷歌接口没有公开配额，靠 `concurrency` 控制以免触发 IP 封禁。
 */
export class RateLimiter {
  #options: RateLimiterOptions;
  #active = 0;
  #lastStartedAt = 0;
  #waiters: Waiter[] = [];

  constructor(options: RateLimiterOptions) {
    this.#options = {
      concurrency: Math.max(1, options.concurrency),
      minIntervalMs: Math.max(0, options.minIntervalMs),
    };
  }

  get pending(): number {
    return this.#waiters.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.#acquire();
    try {
      return await task();
    } finally {
      this.#release();
    }
  }

  async #acquire(): Promise<void> {
    if (this.#active >= this.#options.concurrency) {
      await new Promise<void>((resolve) => {
        this.#waiters.push(resolve);
      });
    }
    this.#active += 1;

    const wait = this.#lastStartedAt + this.#options.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.#lastStartedAt = Date.now();
  }

  #release(): void {
    this.#active -= 1;
    const next = this.#waiters.shift();
    if (next) next();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 指数退避 + 抖动，避免多个批次在限流后同时重试。 */
export function backoffDelay(attempt: number, baseMs = 400, maxMs = 8000): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}
