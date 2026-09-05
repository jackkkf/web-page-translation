import { createBaiduEngine } from './baidu';
import { createGoogleFreeEngine } from './google-free';
import type { EngineId } from './ids';
import { createMicrosoftFreeEngine } from './microsoft-free';
import type { TranslationEngine } from './types';

export type EngineRegistry = Record<EngineId, TranslationEngine>;

/**
 * 新增引擎的步骤：
 * 1. 在 `ids.ts` 登记 ID 与所需域名（域名会被 wxt.config.ts 用于生成 manifest）
 * 2. 在 `meta.ts` 补充展示用元数据
 * 3. 实现 `TranslationEngine`
 * 4. 在这里注册
 * 其他层（UI、缓存、限流、降级、熔断）无需改动。
 */
export function createEngineRegistry(): EngineRegistry {
  return {
    'microsoft-free': createMicrosoftFreeEngine(),
    'google-free': createGoogleFreeEngine(),
    baidu: createBaiduEngine(),
  };
}
