import { TranslationError } from '../core/errors';
import type { EngineTranslateInput, LangCode } from '../core/types';
import { normalizeLangCode } from '../core/languages';
import { requestJson, requestText } from './http';
import { ENGINE_META } from './meta';
import type { EngineRuntimeContext, TranslationEngine } from './types';

const AUTH_ENDPOINT = 'https://edge.microsoft.com/translate/auth';
const TRANSLATE_ENDPOINT = 'https://api-edge.cognitive.microsofttranslator.com/translate';
const ENGINE_ID = 'microsoft-free' as const;

/** 微软用的是 Azure Translator 语言代码，中文必须用 Hans/Hant 写法。 */
const LANG_MAP: Record<string, string> = {
  'zh-cn': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  he: 'he',
  pt: 'pt',
};

function toEngineLang(code: LangCode): string {
  return LANG_MAP[code.toLowerCase()] ?? code;
}

interface MicrosoftTranslateItem {
  translations?: Array<{ text?: string; to?: string }>;
  detectedLanguage?: { language?: string; score?: number };
}

/** JWT 只有约 10 分钟有效期，解析 exp 缓存到真正过期为止。 */
function parseJwtExpiry(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(normalized)) as { exp?: number };
    return typeof decoded.exp === 'number' ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * 匿名 token 提供者。
 * - 提前 30s 过期，避免边界上拿到刚失效的 token
 * - 用 in-flight promise 去重，防止首屏批量请求打出 N 个 auth 请求
 */
export class EdgeAuthProvider {
  #token: string | null = null;
  #expiresAt = 0;
  #inflight: Promise<string> | null = null;

  async getToken(ctx: EngineRuntimeContext): Promise<string> {
    if (this.#token && Date.now() < this.#expiresAt) return this.#token;
    this.#inflight ??= this.#fetchToken(ctx).finally(() => {
      this.#inflight = null;
    });
    return this.#inflight;
  }

  reset(): void {
    this.#token = null;
    this.#expiresAt = 0;
  }

  async #fetchToken(ctx: EngineRuntimeContext): Promise<string> {
    const token = (
      await requestText(AUTH_ENDPOINT, {
        fetchImpl: ctx.fetchImpl,
        engineId: ENGINE_ID,
        signal: ctx.signal,
        timeoutMs: 10_000,
      })
    ).trim();

    if (!token) {
      throw new TranslationError('AUTH', '微软翻译未返回有效 token', { engineId: ENGINE_ID });
    }

    this.#token = token;
    this.#expiresAt = (parseJwtExpiry(token) ?? Date.now() + 8 * 60_000) - 30_000;
    return token;
  }
}

const authProvider = new EdgeAuthProvider();

export function createMicrosoftFreeEngine(auth: EdgeAuthProvider = authProvider): TranslationEngine {
  async function callApi(
    input: EngineTranslateInput,
    ctx: EngineRuntimeContext,
    token: string,
  ): Promise<MicrosoftTranslateItem[]> {
    const params = new URLSearchParams({
      'api-version': '3.0',
      to: toEngineLang(input.to),
      textType: 'plain',
    });
    if (input.from !== 'auto') params.set('from', toEngineLang(input.from));

    return requestJson<MicrosoftTranslateItem[]>(`${TRANSLATE_ENDPOINT}?${params.toString()}`, {
      fetchImpl: ctx.fetchImpl,
      engineId: ENGINE_ID,
      signal: ctx.signal,
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input.texts.map((text) => ({ Text: text }))),
      },
    });
  }

  const meta = ENGINE_META[ENGINE_ID];

  return {
    id: ENGINE_ID,
    name: meta.name,
    keyless: meta.keyless,
    notes: meta.notes,
    ...(meta.docsUrl ? { docsUrl: meta.docsUrl } : {}),
    limits: {
      maxTextsPerRequest: 25,
      maxCharsPerRequest: 5000,
      concurrency: 3,
      minIntervalMs: 0,
    },

    supports: () => true,
    hasCredentials: () => true,

    async translate(input, ctx) {
      if (input.texts.length === 0) return { texts: [] };

      let token = await auth.getToken(ctx);
      let payload: MicrosoftTranslateItem[];
      try {
        payload = await callApi(input, ctx, token);
      } catch (error) {
        // token 过期时接口返回 401，刷新后再试一次
        if (error instanceof TranslationError && error.code === 'AUTH') {
          auth.reset();
          token = await auth.getToken(ctx);
          payload = await callApi(input, ctx, token);
        } else {
          throw error;
        }
      }

      if (!Array.isArray(payload) || payload.length !== input.texts.length) {
        throw new TranslationError('BAD_RESPONSE', '微软翻译返回条数与请求不一致', { engineId: ENGINE_ID });
      }

      const texts = payload.map((item, index) => item.translations?.[0]?.text ?? input.texts[index] ?? '');
      const detected = normalizeLangCode(payload[0]?.detectedLanguage?.language);

      return { texts, ...(detected ? { detectedFrom: detected } : {}) };
    },
  };
}
