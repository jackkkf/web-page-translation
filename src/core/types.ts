/**
 * 领域基础类型。这一层不依赖任何浏览器 API，便于单测。
 */

/** 内部统一使用 BCP-47 风格代码（如 `zh-CN`、`en`、`pt-BR`），各引擎自行做映射。 */
export type LangCode = string;

/** 源语言，`auto` 表示交由引擎自动识别。 */
export type SourceLang = 'auto' | LangCode;

/** 译文展示方式。 */
export type DisplayMode = 'bilingual' | 'replace';

/** 双语对照时译文的视觉标记。 */
export type TranslationStyle = 'none' | 'underline' | 'dashed' | 'highlight' | 'card';

export interface EngineTranslateInput {
  texts: string[];
  from: SourceLang;
  to: LangCode;
}

export interface EngineTranslateResult {
  /** 与入参 `texts` 一一对应，长度必须相等。 */
  texts: string[];
  detectedFrom?: LangCode;
}
