import { md5 } from 'js-md5';
import { TranslationError } from '../core/errors';
import { normalizeLangCode } from '../core/languages';
import type { EngineCredentials } from '../core/settings';
import type { LangCode } from '../core/types';
import { requestJson } from './http';
import { ENGINE_META } from './meta';
import type { TranslationEngine } from './types';

const ENDPOINT = 'https://fanyi-api.baidu.com/api/trans/vip/translate';
const ENGINE_ID = 'baidu' as const;

/** 百度用的是自有语言代码表。 */
const LANG_MAP: Record<string, string> = {
  'zh-cn': 'zh',
  'zh-tw': 'cht',
  ja: 'jp',
  ko: 'kor',
  fr: 'fra',
  es: 'spa',
  ar: 'ara',
  he: 'heb',
  vi: 'vie',
  th: 'th',
  id: 'id',
  da: 'dan',
  fi: 'fin',
  sv: 'swe',
  uk: 'ukr',
  cs: 'cs',
  el: 'el',
  hi: 'hi',
};

const REVERSE_LANG_MAP = new Map(Object.entries(LANG_MAP).map(([internal, baidu]) => [baidu, internal]));

function toEngineLang(code: LangCode): string {
  return LANG_MAP[code.toLowerCase()] ?? code.toLowerCase();
}

interface BaiduResponse {
  from?: string;
  to?: string;
  trans_result?: Array<{ src?: string; dst?: string }>;
  error_code?: string | number;
  error_msg?: string;
}

/** 百度错误码 → 内部错误码。文档：https://api.fanyi.baidu.com/doc/21 */
function mapErrorCode(code: string): TranslationError {
  const message = `百度翻译错误 ${code}`;
  switch (code) {
    case '52001':
      return new TranslationError('TIMEOUT', `${message}：请求超时`, { engineId: ENGINE_ID });
    case '52002':
      return new TranslationError('NETWORK', `${message}：系统错误`, { engineId: ENGINE_ID });
    case '52003':
    case '54001':
      return new TranslationError('AUTH', `${message}：APPID 或签名无效`, { engineId: ENGINE_ID });
    case '54003':
    case '54005':
      return new TranslationError('RATE_LIMIT', `${message}：访问频率受限`, { engineId: ENGINE_ID });
    case '54004':
      return new TranslationError('QUOTA', `${message}：账户余额不足`, { engineId: ENGINE_ID });
    case '58001':
      return new TranslationError('UNSUPPORTED_LANGUAGE', `${message}：不支持该语言方向`, { engineId: ENGINE_ID });
    case '58002':
      return new TranslationError('AUTH', `${message}：服务已关闭`, { engineId: ENGINE_ID });
    case '58003':
      return new TranslationError('AUTH', `${message}：IP 被封禁`, { engineId: ENGINE_ID });
    default:
      return new TranslationError('UNKNOWN', message, { engineId: ENGINE_ID });
  }
}

/**
 * 百度通用文本翻译。
 *
 * 批量机制是把多段用 `\n` 拼成一个 `q`，接口按行返回 `trans_result`，
 * 所以必须先把段内换行压成空格，否则行数错位、译文会串段。
 */
export function createBaiduEngine(): TranslationEngine {
  const meta = ENGINE_META[ENGINE_ID];

  return {
    id: ENGINE_ID,
    name: meta.name,
    keyless: meta.keyless,
    notes: meta.notes,
    ...(meta.docsUrl ? { docsUrl: meta.docsUrl } : {}),
    limits: {
      maxTextsPerRequest: 20,
      maxCharsPerRequest: 4000,
      concurrency: 1,
      // 标准版 QPS=1，留 100ms 余量
      minIntervalMs: 1100,
    },

    supports: () => true,

    hasCredentials(credentials: EngineCredentials) {
      return Boolean(credentials.baidu?.appid && credentials.baidu.key);
    },

    async translate(input, ctx) {
      if (input.texts.length === 0) return { texts: [] };

      const creds = ctx.credentials.baidu;
      if (!creds?.appid || !creds.key) {
        throw new TranslationError('MISSING_CREDENTIALS', '请先在设置中填写百度翻译 APPID 与密钥', {
          engineId: ENGINE_ID,
        });
      }

      const sanitized = input.texts.map((text) => text.replace(/\r?\n/g, ' '));
      const query = sanitized.join('\n');
      const salt = String(Date.now());
      const sign = md5(creds.appid + query + salt + creds.key);

      const body = new URLSearchParams({
        q: query,
        from: input.from === 'auto' ? 'auto' : toEngineLang(input.from),
        to: toEngineLang(input.to),
        appid: creds.appid,
        salt,
        sign,
      });

      const payload = await requestJson<BaiduResponse>(ENDPOINT, {
        fetchImpl: ctx.fetchImpl,
        engineId: ENGINE_ID,
        signal: ctx.signal,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        },
      });

      if (payload.error_code !== undefined && String(payload.error_code) !== '52000') {
        throw mapErrorCode(String(payload.error_code));
      }

      const results = payload.trans_result;
      if (!Array.isArray(results) || results.length !== sanitized.length) {
        throw new TranslationError('BAD_RESPONSE', '百度翻译返回行数与请求不一致', { engineId: ENGINE_ID });
      }

      const texts = results.map((item, index) => item.dst ?? sanitized[index] ?? '');
      const detectedRaw = payload.from ? (REVERSE_LANG_MAP.get(payload.from) ?? payload.from) : undefined;
      const detected = normalizeLangCode(detectedRaw);

      return { texts, ...(detected ? { detectedFrom: detected } : {}) };
    },
  };
}
