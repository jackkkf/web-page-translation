import { describe, expect, it } from 'vitest';
import { RateLimiter, backoffDelay } from './limiter';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('RateLimiter', () => {
  it('并发数不超过上限', async () => {
    const limiter = new RateLimiter({ concurrency: 2, minIntervalMs: 0 });
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    let active = 0;
    let peak = 0;

    const tasks = gates.map((gate) =>
      limiter.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
      }),
    );

    // 让前两个任务真正开始执行
    await Promise.resolve();
    await Promise.resolve();
    expect(peak).toBe(2);

    gates.forEach((gate) => gate.resolve());
    await Promise.all(tasks);
    expect(peak).toBe(2);
  });

  it('minIntervalMs 强制拉开两次任务的启动时间（满足 QPS=1）', async () => {
    const limiter = new RateLimiter({ concurrency: 1, minIntervalMs: 60 });
    const startedAt: number[] = [];

    await Promise.all(
      [0, 1].map(() =>
        limiter.run(async () => {
          startedAt.push(Date.now());
        }),
      ),
    );

    expect(startedAt).toHaveLength(2);
    expect(startedAt[1]! - startedAt[0]!).toBeGreaterThanOrEqual(50);
  });

  it('任务抛错也会释放并发槽位', async () => {
    const limiter = new RateLimiter({ concurrency: 1, minIntervalMs: 0 });

    await expect(
      limiter.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('backoffDelay', () => {
  it('随重试次数指数增长，并带抖动', () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const delay = backoffDelay(attempt, 400, 8000);
      const ceiling = Math.min(8000, 400 * 2 ** attempt);
      expect(delay).toBeGreaterThanOrEqual(Math.floor(ceiling * 0.5));
      expect(delay).toBeLessThanOrEqual(ceiling);
    }
  });
});
