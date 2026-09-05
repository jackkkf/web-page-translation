import { describe, expect, it } from 'vitest';
import { TranslationError } from '../core/errors';
import { createRoutedFetch, createSequenceFetch, fakeJwt, jsonResponse, textResponse } from '../testing/fake-fetch';
import { EdgeAuthProvider, createMicrosoftFreeEngine } from './microsoft-free';

const AUTH = /edge\.microsoft\.com\/translate\/auth/;
const TRANSLATE = /api-edge\.cognitive\.microsofttranslator\.com/;

function translationPayload(texts: string[], detected = 'en') {
  return texts.map((text) => ({
    translations: [{ text, to: 'zh-Hans' }],
    detectedLanguage: { language: detected, score: 1 },
  }));
}

describe('microsoft-free 引擎', () => {
  it('一次请求翻译整批文本，并把语言代码映射成 Azure 写法', async () => {
    const fake = createSequenceFetch([textResponse(fakeJwt(600)), jsonResponse(translationPayload(['你好', '世界']))]);
    const engine = createMicrosoftFreeEngine(new EdgeAuthProvider());

    const result = await engine.translate(
      { texts: ['hello', 'world'], from: 'auto', to: 'zh-CN' },
      { credentials: {}, fetchImpl: fake.fetch },
    );

    expect(result.texts).toEqual(['你好', '世界']);
    expect(result.detectedFrom).toBe('en');

    // 批量：两条文本只发一次翻译请求
    const translateCalls = fake.calls.filter((call) => TRANSLATE.test(call.url));
    expect(translateCalls).toHaveLength(1);
    expect(translateCalls[0]?.url).toContain('to=zh-Hans');
    // from=auto 时不应该带 from 参数，交给接口自动识别
    expect(translateCalls[0]?.url).not.toContain('from=');
    expect(translateCalls[0]?.init?.body).toBe(JSON.stringify([{ Text: 'hello' }, { Text: 'world' }]));
  });

  it('token 在有效期内复用，不重复请求 auth 接口', async () => {
    const fake = createRoutedFetch([
      [AUTH, () => textResponse(fakeJwt(600))],
      [TRANSLATE, () => jsonResponse(translationPayload(['你好']))],
    ]);
    const engine = createMicrosoftFreeEngine(new EdgeAuthProvider());
    const ctx = { credentials: {}, fetchImpl: fake.fetch };

    await engine.translate({ texts: ['hello'], from: 'auto', to: 'zh-CN' }, ctx);
    await engine.translate({ texts: ['hello'], from: 'auto', to: 'zh-CN' }, ctx);

    expect(fake.calls.filter((call) => AUTH.test(call.url))).toHaveLength(1);
  });

  it('并发请求只触发一次 auth（in-flight 去重）', async () => {
    const fake = createRoutedFetch([
      [AUTH, () => textResponse(fakeJwt(600))],
      [TRANSLATE, () => jsonResponse(translationPayload(['你好']))],
    ]);
    const engine = createMicrosoftFreeEngine(new EdgeAuthProvider());
    const ctx = { credentials: {}, fetchImpl: fake.fetch };

    await Promise.all([
      engine.translate({ texts: ['a'], from: 'auto', to: 'zh-CN' }, ctx),
      engine.translate({ texts: ['b'], from: 'auto', to: 'zh-CN' }, ctx),
      engine.translate({ texts: ['c'], from: 'auto', to: 'zh-CN' }, ctx),
    ]);

    expect(fake.calls.filter((call) => AUTH.test(call.url))).toHaveLength(1);
  });

  it('遇到 401 时刷新 token 并重试一次', async () => {
    const fake = createSequenceFetch([
      textResponse(fakeJwt(600)),
      textResponse('unauthorized', 401),
      textResponse(fakeJwt(600)),
      jsonResponse(translationPayload(['你好'])),
    ]);
    const engine = createMicrosoftFreeEngine(new EdgeAuthProvider());

    const result = await engine.translate(
      { texts: ['hello'], from: 'auto', to: 'zh-CN' },
      { credentials: {}, fetchImpl: fake.fetch },
    );

    expect(result.texts).toEqual(['你好']);
    expect(fake.calls.filter((call) => AUTH.test(call.url))).toHaveLength(2);
  });

  it('返回条数与请求不一致时报 BAD_RESPONSE，避免译文错位', async () => {
    const fake = createSequenceFetch([textResponse(fakeJwt(600)), jsonResponse(translationPayload(['你好']))]);
    const engine = createMicrosoftFreeEngine(new EdgeAuthProvider());

    await expect(
      engine.translate(
        { texts: ['hello', 'world'], from: 'auto', to: 'zh-CN' },
        { credentials: {}, fetchImpl: fake.fetch },
      ),
    ).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('429 被识别为可重试的限流错误', async () => {
    const fake = createSequenceFetch([textResponse(fakeJwt(600)), textResponse('slow down', 429)]);
    const engine = createMicrosoftFreeEngine(new EdgeAuthProvider());

    const error = await engine
      .translate({ texts: ['hello'], from: 'auto', to: 'zh-CN' }, { credentials: {}, fetchImpl: fake.fetch })
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(TranslationError);
    expect((error as TranslationError).code).toBe('RATE_LIMIT');
    expect((error as TranslationError).retryable).toBe(true);
  });
});
