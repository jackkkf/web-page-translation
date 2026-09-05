import { md5 } from 'js-md5';
import { describe, expect, it } from 'vitest';
import { createSequenceFetch, jsonResponse } from '../testing/fake-fetch';
import { createBaiduEngine } from './baidu';

const CREDENTIALS = { baidu: { appid: 'app-1', key: 'secret' } };

describe('baidu 引擎', () => {
  it('把多段拼成换行分隔的 q，并按行还原译文', async () => {
    const fake = createSequenceFetch([
      jsonResponse({
        from: 'en',
        to: 'zh',
        trans_result: [
          { src: 'hello', dst: '你好' },
          { src: 'world', dst: '世界' },
        ],
      }),
    ]);
    const engine = createBaiduEngine();

    const result = await engine.translate(
      { texts: ['hello', 'world'], from: 'auto', to: 'zh-CN' },
      { credentials: CREDENTIALS, fetchImpl: fake.fetch },
    );

    expect(result.texts).toEqual(['你好', '世界']);
    expect(result.detectedFrom).toBe('en');

    const body = new URLSearchParams(String(fake.calls[0]?.init?.body));
    expect(body.get('q')).toBe('hello\nworld');
    // zh-CN 必须映射成百度的 zh
    expect(body.get('to')).toBe('zh');
  });

  it('签名为 md5(appid + q + salt + key)', async () => {
    const fake = createSequenceFetch([jsonResponse({ trans_result: [{ dst: '你好' }] })]);
    const engine = createBaiduEngine();

    await engine.translate(
      { texts: ['hello'], from: 'en', to: 'zh-CN' },
      { credentials: CREDENTIALS, fetchImpl: fake.fetch },
    );

    const body = new URLSearchParams(String(fake.calls[0]?.init?.body));
    const salt = body.get('salt') ?? '';
    expect(body.get('sign')).toBe(md5(`app-1hello${salt}secret`));
  });

  it('段内换行被压成空格，防止行数错位导致译文串段', async () => {
    const fake = createSequenceFetch([jsonResponse({ trans_result: [{ dst: '第一段' }, { dst: '第二段' }] })]);
    const engine = createBaiduEngine();

    await engine.translate(
      { texts: ['first\nline', 'second'], from: 'en', to: 'zh-CN' },
      { credentials: CREDENTIALS, fetchImpl: fake.fetch },
    );

    const body = new URLSearchParams(String(fake.calls[0]?.init?.body));
    expect(body.get('q')).toBe('first line\nsecond');
  });

  it('没配密钥时直接报 MISSING_CREDENTIALS，不发请求', async () => {
    const fake = createSequenceFetch([]);
    const engine = createBaiduEngine();

    await expect(
      engine.translate({ texts: ['hello'], from: 'en', to: 'zh-CN' }, { credentials: {}, fetchImpl: fake.fetch }),
    ).rejects.toMatchObject({ code: 'MISSING_CREDENTIALS' });
    expect(fake.calls).toHaveLength(0);
  });

  it.each([
    ['54003', 'RATE_LIMIT'],
    ['54004', 'QUOTA'],
    ['54001', 'AUTH'],
    ['58001', 'UNSUPPORTED_LANGUAGE'],
    ['52001', 'TIMEOUT'],
  ])('错误码 %s 映射为 %s', async (errorCode, expected) => {
    const fake = createSequenceFetch([jsonResponse({ error_code: errorCode, error_msg: 'boom' })]);
    const engine = createBaiduEngine();

    await expect(
      engine.translate(
        { texts: ['hello'], from: 'en', to: 'zh-CN' },
        { credentials: CREDENTIALS, fetchImpl: fake.fetch },
      ),
    ).rejects.toMatchObject({ code: expected });
  });

  it('行数不匹配时报错而不是硬对齐', async () => {
    const fake = createSequenceFetch([jsonResponse({ trans_result: [{ dst: '你好' }] })]);
    const engine = createBaiduEngine();

    await expect(
      engine.translate(
        { texts: ['hello', 'world'], from: 'en', to: 'zh-CN' },
        { credentials: CREDENTIALS, fetchImpl: fake.fetch },
      ),
    ).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });
});
