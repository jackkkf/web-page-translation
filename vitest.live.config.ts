import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

/**
 * 联网探活配置，跑 `npm run test:live` 才会执行，不进 CI 常规流程。
 *
 * 存在的理由：普通单测注入假 fetch，端点被下线也照样全绿 ——
 * 2026-08 微软下线 Edge 匿名 token 端点时就是这么漏过去的。
 * 这里用真实网络跑一遍生产代码路径，专门用来发现"接口没了"。
 */
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    include: ['src/**/*.live.ts'],
    testTimeout: 30_000,
    retry: 1,
  },
});
