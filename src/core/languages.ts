import type { LangCode, SourceLang } from './types';

export interface LanguageOption {
  code: LangCode;
  /** 中文显示名 */
  label: string;
  /** 本地语言名，下拉框里更好认 */
  native: string;
}

/**
 * 首期语言清单：覆盖三家引擎的公共交集，避免出现"选了却翻不了"。
 * 新增语言时必须同时确认 src/engines/*.ts 里的映射表。
 */
export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'zh-CN', label: '简体中文', native: '简体中文' },
  { code: 'zh-TW', label: '繁体中文', native: '繁體中文' },
  { code: 'en', label: '英语', native: 'English' },
  { code: 'ja', label: '日语', native: '日本語' },
  { code: 'ko', label: '韩语', native: '한국어' },
  { code: 'fr', label: '法语', native: 'Français' },
  { code: 'de', label: '德语', native: 'Deutsch' },
  { code: 'es', label: '西班牙语', native: 'Español' },
  { code: 'pt', label: '葡萄牙语', native: 'Português' },
  { code: 'ru', label: '俄语', native: 'Русский' },
  { code: 'it', label: '意大利语', native: 'Italiano' },
  { code: 'nl', label: '荷兰语', native: 'Nederlands' },
  { code: 'pl', label: '波兰语', native: 'Polski' },
  { code: 'tr', label: '土耳其语', native: 'Türkçe' },
  { code: 'ar', label: '阿拉伯语', native: 'العربية' },
  { code: 'th', label: '泰语', native: 'ไทย' },
  { code: 'vi', label: '越南语', native: 'Tiếng Việt' },
  { code: 'id', label: '印尼语', native: 'Bahasa Indonesia' },
  { code: 'hi', label: '印地语', native: 'हिन्दी' },
  { code: 'sv', label: '瑞典语', native: 'Svenska' },
  { code: 'da', label: '丹麦语', native: 'Dansk' },
  { code: 'fi', label: '芬兰语', native: 'Suomi' },
  { code: 'cs', label: '捷克语', native: 'Čeština' },
  { code: 'el', label: '希腊语', native: 'Ελληνικά' },
  { code: 'he', label: '希伯来语', native: 'עברית' },
  { code: 'uk', label: '乌克兰语', native: 'Українська' },
];

const LANGUAGE_CODES = new Set(LANGUAGES.map((item) => item.code.toLowerCase()));

/** 使用中日韩等表意/音节文字的语言，用于"是否已经是目标语言"的启发式判断。 */
export const CJK_LANGUAGES = new Set(['zh-cn', 'zh-tw', 'ja', 'ko']);

export function isSupportedLang(code: string): boolean {
  return LANGUAGE_CODES.has(code.toLowerCase());
}

/**
 * 把浏览器/网页给出的语言标签归一到内部代码。
 * 例：`zh`→`zh-CN`、`zh-Hant-TW`→`zh-TW`、`en-US`→`en`。
 */
export function normalizeLangCode(raw: string | null | undefined): LangCode | null {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase().replace(/_/g, '-');
  if (!lower) return null;

  if (lower === 'zh' || lower.startsWith('zh-hans') || lower === 'zh-cn' || lower === 'zh-sg') return 'zh-CN';
  if (lower.startsWith('zh-hant') || lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo') return 'zh-TW';

  if (LANGUAGE_CODES.has(lower)) {
    return LANGUAGES.find((item) => item.code.toLowerCase() === lower)?.code ?? null;
  }

  const base = lower.split('-')[0];
  if (base && LANGUAGE_CODES.has(base)) {
    return LANGUAGES.find((item) => item.code.toLowerCase() === base)?.code ?? null;
  }
  return null;
}

/** 根据浏览器 UI 语言挑一个合理的默认目标语言。 */
export function defaultTargetLang(uiLanguage: string | undefined): LangCode {
  return normalizeLangCode(uiLanguage) ?? 'zh-CN';
}

export function langLabel(code: SourceLang): string {
  if (code === 'auto') return '自动检测';
  return LANGUAGES.find((item) => item.code === code)?.label ?? code;
}
