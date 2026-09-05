import { describe, expect, it } from 'vitest';
import { createSequenceFetch, jsonResponse } from '../testing/fake-fetch';
import { createGoogleFreeEngine } from './google-free';

describe('google-free 引擎', () => {
  it('把被切分的 sentences 按序拼回完整译文', async () => {
    const fake = createSequenceFetch([
      jsonResponse({
        sentences: [{ trans: '你好，' }, { trans: '世界。' }],
        src: 'en',
      }),
    ]);
    const engine = createGoogleFreeEngine();

    const result = await engine.translate(
      { texts: ['Hello, world.'], from: 'auto', to: 'zh-CN' },
      { credentials: {}, fetchImpl: fake.fetch },
    );

    expect(result.texts).toEqual(['你好，世界。']);
    expect(result.detectedFrom).toBe('en');
    expect(fake.calls[0]?.url).toContain('dj=1');
    expect(fake.calls[0]?.url).toContain('tl=zh-CN');
  });

  it('希伯来语映射到谷歌的历史代码 iw', async () => {
    const fake = createSequenceFetch([jsonResponse({ sentences: [{ trans: 'שלום' }], src: 'en' })]);
    const engine = createGoogleFreeEngine();

    await engine.translate({ texts: ['hello'], from: 'auto', to: 'he' }, { credentials: {}, fetchImpl: fake.fetch });

    expect(fake.calls[0]?.url).toContain('tl=iw');
  });

  it('声明的批量上限是 1，传多条时拒绝而不是静默丢弃', async () => {
    const engine = createGoogleFreeEngine();
    expect(engine.limits.maxTextsPerRequest).toBe(1);

    const fake = createSequenceFetch([]);
    await expect(
      engine.translate({ texts: ['a', 'b'], from: 'auto', to: 'zh-CN' }, { credentials: {}, fetchImpl: fake.fetch }),
    ).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('结构异常时报 BAD_RESPONSE', async () => {
    const fake = createSequenceFetch([jsonResponse({ unexpected: true })]);
    const engine = createGoogleFreeEngine();

    await expect(
      engine.translate({ texts: ['hello'], from: 'auto', to: 'zh-CN' }, { credentials: {}, fetchImpl: fake.fetch }),
    ).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });
});
