import { describe, expect, it } from 'vitest';
import { TranslationError } from '../core/errors';
import { createRoutedFetch, createSequenceFetch, jsonResponse, textResponse } from '../testing/fake-fetch';
import { BingAuthProvider, createBingFreeEngine } from './bing-free';

const PAGE = /www\.bing\.com\/translator/;
const TRANSLATE = /ttranslatev3/;

/** 仿造 translator 页面里承载凭据的那几段内联脚本。 */
function pageHtml(token = 'tok-1', ttlMs = 3600_000): string {
  return `<!doctype html><html><body>
    <div data-iid="translator.5023"></div>
    <script>var _G = {IG:"ABCDEF0123456789"};</script>
    <script>var params_AbusePreventionHelper = [1788628984459,"${token}",${ttlMs}];</script>
  </body></html>`;
}

/** 真实响应形状（含实测存在的 transliteration / usedLLM 字段）。 */
function translated(text: string, detected = 'en') {
  return [
    {
      translations: [{ text, to: 'zh-Hans', transliteration: { text: 'pinyin', script: 'Latn' } }],
      usedLLM: true,
      detectedLanguage: { language: detected, score: 1 },
    },
  ];
}

describe('bing-free 引擎', () => {
  it('多段用换行拼成一次请求，并按行还原', async () => {
    const fake = createSequenceFetch([textResponse(pageHtml()), jsonResponse(translated('你好\n世界'))]);
    const engine = createBingFreeEngine(new BingAuthProvider());

    const result = await engine.translate(
      { texts: ['hello', 'world'], from: 'auto', to: 'zh-CN' },
      { credentials: {}, fetchImpl: fake.fetch },
    );

    expect(result.texts).toEqual(['你好', '世界']);
    expect(result.detectedFrom).toBe('en');

    const translateCalls = fake.calls.filter((call) => TRANSLATE.test(call.url));
    expect(translateCalls).toHaveLength(1);

    const body = new URLSearchParams(String(translateCalls[0]?.init?.body));
    expect(body.get('text')).toBe('hello\nworld');
    expect(body.get('to')).toBe('zh-Hans'); // zh-CN 必须映射成 Azure 写法
    expect(body.get('fromLang')).toBe('auto-detect');
    expect(body.get('token')).toBe('tok-1');
    expect(body.get('key')).toBe('1788628984459');
    expect(translateCalls[0]?.url).toContain('IG=ABCDEF0123456789');
    expect(translateCalls[0]?.url).toContain('IID=translator.5023');
  });

  it('段内换行被压成空格，防止行数错位导致译文串段', async () => {
    const fake = createSequenceFetch([textResponse(pageHtml()), jsonResponse(translated('第一段\n第二段'))]);
    const engine = createBingFreeEngine(new BingAuthProvider());

    await engine.translate(
      { texts: ['first\nline', 'second'], from: 'en', to: 'zh-CN' },
      { credentials: {}, fetchImpl: fake.fetch },
    );

    const call = fake.calls.find((item) => TRANSLATE.test(item.url));
    expect(new URLSearchParams(String(call?.init?.body)).get('text')).toBe('first line\nsecond');
  });

  it('凭据在有效期内复用，不重复抓取页面', async () => {
    const fake = createRoutedFetch([
      [PAGE, () => textResponse(pageHtml())],
      [TRANSLATE, () => jsonResponse(translated('你好'))],
    ]);
    const engine = createBingFreeEngine(new BingAuthProvider());
    const ctx = { credentials: {}, fetchImpl: fake.fetch };

    await engine.translate({ texts: ['hello'], from: 'auto', to: 'zh-CN' }, ctx);
    await engine.translate({ texts: ['hello'], from: 'auto', to: 'zh-CN' }, ctx);

    expect(fake.calls.filter((call) => PAGE.test(call.url))).toHaveLength(1);
  });

  it('并发请求只抓取一次页面（in-flight 去重）', async () => {
    const fake = createRoutedFetch([
      [PAGE, () => textResponse(pageHtml())],
      [TRANSLATE, () => jsonResponse(translated('你好'))],
    ]);
    const engine = createBingFreeEngine(new BingAuthProvider());
    const ctx = { credentials: {}, fetchImpl: fake.fetch };

    await Promise.all([
      engine.translate({ texts: ['a'], from: 'auto', to: 'zh-CN' }, ctx),
      engine.translate({ texts: ['b'], from: 'auto', to: 'zh-CN' }, ctx),
      engine.translate({ texts: ['c'], from: 'auto', to: 'zh-CN' }, ctx),
    ]);

    expect(fake.calls.filter((call) => PAGE.test(call.url))).toHaveLength(1);
  });

  it('令牌失效（statusCode 205）时换凭据重试一次', async () => {
    const fake = createSequenceFetch([
      textResponse(pageHtml('stale')),
      // 必应把错误放在 HTTP 200 的响应体里，不是状态码上
      jsonResponse({ statusCode: 205, errorMessage: '' }),
      textResponse(pageHtml('fresh')),
      jsonResponse(translated('你好')),
    ]);
    const engine = createBingFreeEngine(new BingAuthProvider());

    const result = await engine.translate(
      { texts: ['hello'], from: 'auto', to: 'zh-CN' },
      { credentials: {}, fetchImpl: fake.fetch },
    );

    expect(result.texts).toEqual(['你好']);
    expect(fake.calls.filter((call) => PAGE.test(call.url))).toHaveLength(2);
    const lastBody = new URLSearchParams(String(fake.calls.at(-1)?.init?.body));
    expect(lastBody.get('token')).toBe('fresh');
  });

  it('HTTP 200 但 statusCode 400 映射为语言不支持', async () => {
    const fake = createSequenceFetch([textResponse(pageHtml()), jsonResponse({ statusCode: 400, errorMessage: '' })]);
    const engine = createBingFreeEngine(new BingAuthProvider());

    await expect(
      engine.translate({ texts: ['hello'], from: 'auto', to: 'xx' }, { credentials: {}, fetchImpl: fake.fetch }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_LANGUAGE' });
  });

  it('返回行数与请求段数不一致时报 BAD_RESPONSE，避免译文错位', async () => {
    const fake = createSequenceFetch([textResponse(pageHtml()), jsonResponse(translated('只有一行'))]);
    const engine = createBingFreeEngine(new BingAuthProvider());

    await expect(
      engine.translate(
        { texts: ['hello', 'world'], from: 'auto', to: 'zh-CN' },
        { credentials: {}, fetchImpl: fake.fetch },
      ),
    ).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('页面结构变化解析不到凭据时给出可诊断的错误', async () => {
    const fake = createSequenceFetch([textResponse('<html><body>改版了</body></html>')]);
    const engine = createBingFreeEngine(new BingAuthProvider());

    const error = await engine
      .translate({ texts: ['hello'], from: 'auto', to: 'zh-CN' }, { credentials: {}, fetchImpl: fake.fetch })
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(TranslationError);
    expect((error as TranslationError).code).toBe('BAD_RESPONSE');
    expect((error as TranslationError).message).toContain('接口可能已变更');
  });

  it('页面请求 429 被识别为可重试的限流错误', async () => {
    const fake = createSequenceFetch([textResponse('slow down', 429)]);
    const engine = createBingFreeEngine(new BingAuthProvider());

    const error = await engine
      .translate({ texts: ['hello'], from: 'auto', to: 'zh-CN' }, { credentials: {}, fetchImpl: fake.fetch })
      .catch((value: unknown) => value);

    expect((error as TranslationError).code).toBe('RATE_LIMIT');
    expect((error as TranslationError).retryable).toBe(true);
  });
});
