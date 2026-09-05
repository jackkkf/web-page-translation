/**
 * 引擎标识与所需的网络域名。
 *
 * 单独成文件是为了让 `wxt.config.ts` 能直接引用域名清单生成 manifest，
 * 而不必把整个引擎实现（含 md5 等依赖）拖进构建配置。
 */

export const ENGINE_IDS = ['microsoft-free', 'google-free', 'baidu'] as const;

export type EngineId = (typeof ENGINE_IDS)[number];

export function isEngineId(value: unknown): value is EngineId {
  return typeof value === 'string' && (ENGINE_IDS as readonly string[]).includes(value);
}

/**
 * 扩展只需要访问这几个翻译接口域名。
 * 刻意不申请 `<all_urls>` 的 host_permissions —— 网页访问权限走 activeTab / 可选权限。
 */
export const ENGINE_HOST_PERMISSIONS: readonly string[] = [
  'https://edge.microsoft.com/*',
  'https://api-edge.cognitive.microsofttranslator.com/*',
  'https://translate.googleapis.com/*',
  'https://fanyi-api.baidu.com/*',
];
