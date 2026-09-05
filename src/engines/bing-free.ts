import { TranslationError } from '../core/errors';
import { normalizeLangCode } from '../core/languages';
import type { EngineTranslateInput, LangCode } from '../core/types';
import { requestJson, requestText } from './http';
import { ENGINE_META } from './meta';
import type { EngineRuntimeContext, TranslationEngine } from './types';

const PAGE_ENDPOINT = 'https://www.bing.com/translator';
const TRANSLATE_ENDPOINT = 'https://www.bing.com/ttranslatev3';
const ENGINE_ID = 'bing-free' as const;

/** 必应用的是 Azure Translator 语言代码，中文必须用 Hans/Hant 写法。 */
const LANG_MAP: Record<string, string> = {
  'zh-cn': 'zh-Hans',
  'zh-tw': 'zh-Hant',
};

function toEngineLang(code: LangCode): string {
  return LANG_MAP[code.toLowerCase()] ?? code;
}

/**
 * 必应把错误放在 HTTP 200 的响应体里，而不是状态码上。
 * 这些数字是实测得到的：token 失效 205、语言不支持 400。
 */
function errorFromStatusCode(statusCode: number): TranslationError {
  switch (statusCode) {
    case 205:
      return new TranslationError('AUTH', '必应翻译令牌已失效', { engineId: ENGINE_ID });
    case 400:
      return new TranslationError('UNSUPPORTED_LANGUAGE', '必应翻译不支持所选语言', { engineId: ENGINE_ID });
    case 429:
      return new TranslationError('RATE_LIMIT', '必应翻译请求过于频繁', { engineId: ENGINE_ID });
    default:
      return new TranslationError('BAD_RESPONSE', `必应翻译返回异常状态 ${statusCode}`, { engineId: ENGINE_ID });
  }
}

interface BingSession {
  ig: string;
  iid: string;
  key: string;
  token: string;
}

interface BingTranslateItem {
  translations?: Array<{ text?: string; to?: string }>;
  detectedLanguage?: { language?: string; score?: number };
}

/**
 * 会话凭据提供者。
 *
 * 必应网页版的翻译接口需要三样东西，全部藏在 translator 页面的内联脚本里：
 * - `IG` / `IID`：埋点标识，接口会校验
 * - `key` / `token`：防滥用令牌，有效期约 1 小时
 *
 * 与旧的 Edge 匿名 token 一样，这里也做提前过期与 in-flight 去重。
 */
export class BingAuthProvider {
  #session: BingSession | null = null;
  #expiresAt = 0;
  #inflight: Promise<BingSession> | null = null;

  async getSession(ctx: EngineRuntimeContext): Promise<BingSession> {
    if (this.#session && Date.now() < this.#expiresAt) return this.#session;
    this.#inflight ??= this.#fetchSession(ctx).finally(() => {
      this.#inflight = null;
    });
    return this.#inflight;
  }

  reset(): void {
    this.#session = null;
    this.#expiresAt = 0;
  }

  async #fetchSession(ctx: EngineRuntimeContext): Promise<BingSession> {
    const html = await requestText(PAGE_ENDPOINT, {
      fetchImpl: ctx.fetchImpl,
      engineId: ENGINE_ID,
      signal: ctx.signal,
      timeoutMs: 10_000,
    });

    const ig = html.match(/IG:"([^"]+)"/)?.[1];
    const helper = html.match(/params_AbusePreventionHelper\s*=\s*(\[[\s\S]*?\]);/)?.[1];
    if (!ig || !helper) {
      throw new TranslationError('BAD_RESPONSE', '未能从必应页面解析出翻译凭据，接口可能已变更', {
        engineId: ENGINE_ID,
      });
    }

    // 形如 [1788628984459, "token字符串", 3600000]，第三项是有效期毫秒数
    let parsed: unknown;
    try {
      parsed = JSON.parse(helper);
    } catch (error) {
      throw new TranslationError('BAD_RESPONSE', '必应翻译凭据格式无法解析', { engineId: ENGINE_ID, cause: error });
    }

    if (!Array.isArray(parsed) || parsed.length < 2) {
      throw new TranslationError('BAD_RESPONSE', '必应翻译凭据格式无法解析', { engineId: ENGINE_ID });
    }

    const ttlMs = typeof parsed[2] === 'number' ? parsed[2] : 3600_000;
    const session: BingSession = {
      ig,
      iid: html.match(/data-iid="([^"]+)"/)?.[1] ?? 'translator.5023',
      key: String(parsed[0]),
      token: String(parsed[1]),
    };

    this.#session = session;
    this.#expiresAt = Date.now() + ttlMs - 60_000;
    return session;
  }
}

const authProvider = new BingAuthProvider();

/**
 * 必应网页版翻译，免费且无需密钥，是默认引擎。
 *
 * 批量方式与百度相同：多段用 `\n` 拼成一次请求，按行还原。
 * 实测行数保真，但这是模型行为而非契约，所以必须校验行数
 * （不一致抛 BAD_RESPONSE，由编排层重试或降级）。
 */
export function createBingFreeEngine(auth: BingAuthProvider = authProvider): TranslationEngine {
  /** 检测到的源语言随结果一起返回，不要存在闭包里 —— 并发批次会互相覆盖。 */
  async function callApi(
    input: EngineTranslateInput,
    ctx: EngineRuntimeContext,
    session: BingSession,
  ): Promise<{ text: string; detected: LangCode | null }> {
    const body = new URLSearchParams({
      // 段内换行必须压成空格，否则行数错位会让译文整体串段
      fromLang: input.from === 'auto' ? 'auto-detect' : toEngineLang(input.from),
      text: input.texts.map((text) => text.replace(/\s*\n\s*/g, ' ')).join('\n'),
      to: toEngineLang(input.to),
      token: session.token,
      key: session.key,
    });

    const url = `${TRANSLATE_ENDPOINT}?isVertical=1&IG=${encodeURIComponent(session.ig)}&IID=${encodeURIComponent(session.iid)}`;
    const payload = await requestJson<BingTranslateItem[] | { statusCode?: number }>(url, {
      fetchImpl: ctx.fetchImpl,
      engineId: ENGINE_ID,
      signal: ctx.signal,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    });

    // 成功是数组，失败是带 statusCode 的对象
    if (!Array.isArray(payload)) {
      throw errorFromStatusCode(typeof payload.statusCode === 'number' ? payload.statusCode : -1);
    }

    const first = payload[0];
    const translated = first?.translations?.[0]?.text;
    if (typeof translated !== 'string') {
      throw new TranslationError('BAD_RESPONSE', '必应翻译返回结构异常', { engineId: ENGINE_ID });
    }

    return { text: translated, detected: normalizeLangCode(first?.detectedLanguage?.language) };
  }

  const meta = ENGINE_META[ENGINE_ID];

  return {
    id: ENGINE_ID,
    name: meta.name,
    keyless: meta.keyless,
    notes: meta.notes,
    ...(meta.docsUrl ? { docsUrl: meta.docsUrl } : {}),
    limits: {
      // 保守取 10：实测行数保真，但批越大模型合并行的风险越高
      maxTextsPerRequest: 10,
      maxCharsPerRequest: 3000,
      concurrency: 3,
      minIntervalMs: 0,
    },

    supports: () => true,
    hasCredentials: () => true,

    async translate(input, ctx) {
      if (input.texts.length === 0) return { texts: [] };

      let session = await auth.getSession(ctx);
      let result: { text: string; detected: LangCode | null };
      try {
        result = await callApi(input, ctx, session);
      } catch (error) {
        // 令牌过期（statusCode 205）时换一份凭据重试一次
        if (error instanceof TranslationError && error.code === 'AUTH') {
          auth.reset();
          session = await auth.getSession(ctx);
          result = await callApi(input, ctx, session);
        } else {
          throw error;
        }
      }

      const lines = result.text.split('\n');
      if (lines.length !== input.texts.length) {
        throw new TranslationError(
          'BAD_RESPONSE',
          `必应翻译返回 ${lines.length} 段，与请求的 ${input.texts.length} 段不一致`,
          { engineId: ENGINE_ID },
        );
      }

      return { texts: lines, ...(result.detected ? { detectedFrom: result.detected } : {}) };
    },
  };
}
