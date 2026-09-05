import { createBaiduEngine } from './baidu';
import { createBingFreeEngine } from './bing-free';
import { createGoogleFreeEngine } from './google-free';
import type { EngineId } from './ids';
import type { TranslationEngine } from './types';

export type EngineRegistry = Record<EngineId, TranslationEngine>;

/**
 * 新增引擎的步骤：
 * 1. 在 `ids.ts` 登记 ID 与所需域名（域名会被 wxt.config.ts 用于生成 manifest）
 * 2. 在 `scripts/check-manifest.mjs` 同步域名白名单
 * 3. 在 `meta.ts` 补充展示用元数据
 * 4. 实现 `TranslationEngine`
 * 5. 在这里注册
 * 其他层（UI、缓存、限流、降级、熔断）无需改动。
 */
export function createEngineRegistry(): EngineRegistry {
  return {
    'bing-free': createBingFreeEngine(),
    'google-free': createGoogleFreeEngine(),
    baidu: createBaiduEngine(),
  };
}
