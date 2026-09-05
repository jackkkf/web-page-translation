import { browser } from '#imports';
import { loadSettings, type Settings } from '../core/settings';
import { CONTENT_SCRIPT_FILE } from './injector';

const SCRIPT_ID = 'litetrans-auto';
const ALL_URLS = '*://*/*';

/** MV2（Firefox）用的动态内容脚本注册 API。 */
interface Mv2ContentScriptsApi {
  register(options: {
    matches: string[];
    js: Array<{ file: string }>;
    runAt?: string;
  }): Promise<{ unregister(): void }>;
}

let mv2Registration: { unregister(): void } | null = null;

/** `*.example.com` → `*://*.example.com/*`；`example.com` → `*://example.com/*` */
export function siteRuleToMatchPattern(pattern: string): string | null {
  const host = pattern.trim().toLowerCase();
  if (!host || host.includes('/') || host.includes(':')) return null;
  return `*://${host}/*`;
}

/**
 * 自动翻译需要哪些 match pattern。
 * 全局开关打开就要全站权限；否则只要 `always` 站点规则涉及的域名。
 */
export function autoTranslateMatches(settings: Settings): string[] {
  if (settings.autoTranslate) return [ALL_URLS];
  return settings.siteRules
    .filter((rule) => rule.action === 'always')
    .map((rule) => siteRuleToMatchPattern(rule.pattern))
    .filter((pattern): pattern is string => pattern !== null);
}

export async function hasPermissionFor(matches: string[]): Promise<boolean> {
  if (matches.length === 0) return true;
  try {
    return await browser.permissions.contains({ origins: matches });
  } catch {
    return false;
  }
}

/**
 * 把"自动翻译"设置同步成实际的动态内容脚本注册。
 *
 * 只有在用户显式授予对应站点权限后才注册 —— 权限没给就静默跳过，
 * 由选项页提示用户去授权，而不是偷偷申请。
 */
export async function syncAutoTranslateRegistration(): Promise<void> {
  const settings = await loadSettings();
  const matches = autoTranslateMatches(settings);
  const wanted = matches.length > 0 && (await hasPermissionFor(matches));

  if (import.meta.env.MANIFEST_VERSION === 3) {
    const existing = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }).catch(() => []);
    if (existing.length > 0) await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    if (wanted) {
      await browser.scripting.registerContentScripts([
        {
          id: SCRIPT_ID,
          matches,
          js: [CONTENT_SCRIPT_FILE.replace(/^\//, '')],
          runAt: 'document_idle',
          persistAcrossSessions: true,
        },
      ]);
    }
    return;
  }

  mv2Registration?.unregister();
  mv2Registration = null;
  if (!wanted) return;

  const contentScripts = (browser as unknown as { contentScripts?: Mv2ContentScriptsApi }).contentScripts;
  if (!contentScripts) return;
  mv2Registration = await contentScripts.register({
    matches,
    js: [{ file: CONTENT_SCRIPT_FILE }],
    runAt: 'document_idle',
  });
}
