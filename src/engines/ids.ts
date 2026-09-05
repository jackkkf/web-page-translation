/**
 * 引擎标识与所需的网络域名。
 *
 * 单独成文件是为了让 `wxt.config.ts` 能直接引用域名清单生成 manifest，
 * 而不必把整个引擎实现（含 md5 等依赖）拖进构建配置。
 */

export const ENGINE_IDS = ['bing-free', 'google-free', 'baidu'] as const;

export type EngineId = (typeof ENGINE_IDS)[number];

export function isEngineId(value: unknown): value is EngineId {
  return typeof value === 'string' && (ENGINE_IDS as readonly string[]).includes(value);
}

/**
 * 扩展只需要访问这几个翻译接口域名。
 * 刻意不申请全站 host_permissions —— 网页访问权限走 activeTab / 可选权限。
 *
 * 改动这个清单时必须同步 `scripts/check-manifest.mjs` 的白名单，否则权限守卫会失败。
 */
export const ENGINE_HOST_PERMISSIONS: readonly string[] = [
  'https://www.bing.com/*',
  'https://translate.google.com/*',
  'https://fanyi-api.baidu.com/*',
];
