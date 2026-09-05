import { TranslationError } from '../core/errors';
import { normalizeLangCode } from '../core/languages';
import type { LangCode } from '../core/types';
import { requestJson } from './http';
import { ENGINE_META } from './meta';
import type { TranslationEngine } from './types';

// 注意不是 translate.googleapis.com —— 那个域名下的该路径已返回 404
const ENDPOINT = 'https://translate.google.com/translate_a/single';
const ENGINE_ID = 'google-free' as const;

/** 谷歌沿用了几个历史代码（希伯来语 iw、爪哇语 jw）。 */
const LANG_MAP: Record<string, string> = {
  'zh-cn': 'zh-CN',
  'zh-tw': 'zh-TW',
  he: 'iw',
};

function toEngineLang(code: LangCode): string {
  return LANG_MAP[code.toLowerCase()] ?? code;
}

interface GoogleResponse {
  sentences?: Array<{ trans?: string; orig?: string }>;
  src?: string;
}

/**
 * 谷歌网页版翻译使用的非官方接口，免费且无需密钥。
 *
 * 已知限制：
 * - 一次只能翻一段（无批量），所以 maxTextsPerRequest = 1
 * - 走 GET，URL 长度受限，字符预算保守设置
 * - 中国大陆网络通常不可直连，因此默认引擎用必应，这里作为降级/备选
 */
export function createGoogleFreeEngine(): TranslationEngine {
  const meta = ENGINE_META[ENGINE_ID];

  return {
    id: ENGINE_ID,
    name: meta.name,
    keyless: meta.keyless,
    notes: meta.notes,
    limits: {
      maxTextsPerRequest: 1,
      maxCharsPerRequest: 1500,
      concurrency: 4,
      minIntervalMs: 0,
    },

    supports: () => true,
    hasCredentials: () => true,

    async translate(input, ctx) {
      const text = input.texts[0];
      if (text === undefined) return { texts: [] };
      if (input.texts.length > 1) {
        throw new TranslationError('BAD_RESPONSE', '谷歌免费接口不支持批量请求', { engineId: ENGINE_ID });
      }

      const params = new URLSearchParams({
        client: 'gtx',
        dj: '1', // 让接口返回结构化 JSON 而不是嵌套数组
        sl: input.from === 'auto' ? 'auto' : toEngineLang(input.from),
        tl: toEngineLang(input.to),
        q: text,
      });
      params.append('dt', 't');

      const payload = await requestJson<GoogleResponse>(`${ENDPOINT}?${params.toString()}`, {
        fetchImpl: ctx.fetchImpl,
        engineId: ENGINE_ID,
        signal: ctx.signal,
      });

      if (!Array.isArray(payload.sentences)) {
        throw new TranslationError('BAD_RESPONSE', '谷歌翻译返回结构异常', { engineId: ENGINE_ID });
      }

      // 长文本会被拆成多个 sentence，需要按顺序拼回来
      const translated = payload.sentences.map((item) => item.trans ?? '').join('');
      const detected = normalizeLangCode(payload.src);

      return { texts: [translated], ...(detected ? { detectedFrom: detected } : {}) };
    },
  };
}
