import { storage } from '#imports';
import { isEngineId, type EngineId } from '../engines/ids';
import { defaultTargetLang } from './languages';
import type { DisplayMode, LangCode, SourceLang, TranslationStyle } from './types';

/** 站点级规则：命中后覆盖全局的自动翻译开关。 */
export interface SiteRule {
  /** 主机名，支持 `*.` 前缀，例如 `*.github.com`。 */
  pattern: string;
  action: 'always' | 'never';
}

export interface Settings {
  engineId: EngineId;
  /** 主引擎失败时自动降级到的引擎；null 表示不降级。 */
  fallbackEngineId: EngineId | null;
  targetLang: LangCode;
  sourceLang: SourceLang;
  displayMode: DisplayMode;
  translationStyle: TranslationStyle;
  /** 打开页面即自动翻译。开启需要用户额外授予全站（all_urls）可选权限。 */
  autoTranslate: boolean;
  siteRules: SiteRule[];
  cacheEnabled: boolean;
  cacheMaxEntries: number;
  cacheTtlHours: number;
}

/** 密钥单独存放，且只放 storage.local（不参与浏览器账号同步）。 */
export interface EngineCredentials {
  baidu?: {
    appid: string;
    key: string;
  };
}

function browserUiLanguage(): string | undefined {
  try {
    return navigator.language;
  } catch {
    return undefined;
  }
}

export const DEFAULT_SETTINGS: Settings = {
  engineId: 'bing-free',
  fallbackEngineId: 'google-free',
  targetLang: defaultTargetLang(browserUiLanguage()),
  sourceLang: 'auto',
  displayMode: 'bilingual',
  translationStyle: 'dashed',
  autoTranslate: false,
  siteRules: [],
  cacheEnabled: true,
  cacheMaxEntries: 3000,
  cacheTtlHours: 24 * 14,
};

/** 迁移函数拿到的是旧版本的数据，引擎 ID 可能是已经不存在的取值，所以要放宽类型。 */
type LegacySettings = Omit<Settings, 'engineId' | 'fallbackEngineId'> & {
  engineId?: string;
  fallbackEngineId?: string | null;
};

/** 已下线引擎 → 替代引擎。 */
const RETIRED_ENGINES: Record<string, EngineId> = {
  // 微软在 2026 年 7 月底下线了 Edge 匿名 token 端点，免费微软翻译不再可用
  'microsoft-free': 'bing-free',
};

function migrateEngineId(value: string | null | undefined, fallback: EngineId | null): EngineId | null {
  if (!value) return fallback;
  const replacement = RETIRED_ENGINES[value];
  if (replacement) return replacement;
  return isEngineId(value) ? value : fallback;
}

export const settingsStorage = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
  version: 2,
  migrations: {
    2: (settings: LegacySettings): Settings => ({
      ...settings,
      engineId: migrateEngineId(settings.engineId, DEFAULT_SETTINGS.engineId) ?? DEFAULT_SETTINGS.engineId,
      fallbackEngineId: migrateEngineId(settings.fallbackEngineId, DEFAULT_SETTINGS.fallbackEngineId),
    }),
  },
});

export const credentialsStorage = storage.defineItem<EngineCredentials>('local:credentials', {
  fallback: {},
  version: 1,
});

/** 读设置时补齐缺失字段，避免版本升级后出现 undefined。 */
export async function loadSettings(): Promise<Settings> {
  const stored = await settingsStorage.getValue();
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await settingsStorage.setValue(next);
  return next;
}

export async function loadCredentials(): Promise<EngineCredentials> {
  return (await credentialsStorage.getValue()) ?? {};
}

/**
 * 站点规则匹配。返回 null 表示无规则命中，交给全局开关决定。
 */
export function resolveSiteAction(hostname: string, rules: SiteRule[]): SiteRule['action'] | null {
  const host = hostname.toLowerCase();
  let matched: SiteRule | null = null;
  let matchedLength = -1;

  for (const rule of rules) {
    const pattern = rule.pattern.trim().toLowerCase();
    if (!pattern) continue;

    const isWildcard = pattern.startsWith('*.');
    const bare = isWildcard ? pattern.slice(2) : pattern;
    const hit = isWildcard ? host === bare || host.endsWith(`.${bare}`) : host === bare;

    // 更精确（更长）的规则优先，让 `*.example.com` 能被 `docs.example.com` 覆盖
    if (hit && bare.length > matchedLength) {
      matched = rule;
      matchedLength = bare.length;
    }
  }

  return matched?.action ?? null;
}

/** 综合全局开关与站点规则，判断是否应该自动翻译。 */
export function shouldAutoTranslate(hostname: string, settings: Settings): boolean {
  const action = resolveSiteAction(hostname, settings.siteRules);
  if (action === 'always') return true;
  if (action === 'never') return false;
  return settings.autoTranslate;
}
