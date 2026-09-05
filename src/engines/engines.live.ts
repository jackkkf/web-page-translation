import { describe, expect, it } from 'vitest';
import type { EngineRuntimeContext } from './types';
import { createBaiduEngine } from './baidu';
import { createBingFreeEngine } from './bing-free';
import { createGoogleFreeEngine } from './google-free';

/**
 * 联网探活：确认免费接口现在还活着，且我们的解析逻辑与真实响应对得上。
 *
 * 用 `npm run test:live` 手动跑，不进 CI。失败通常不是代码回归，
 * 而是上游端点变更 —— 这时要改的是引擎实现，并同步引擎调研文档。
 */

/**
 * 必应会用 User-Agent 拦截非浏览器请求：Node 默认 UA 会拿到
 * `401 {"ShowCaptcha":false}`，浏览器 UA 才返回 200。
 *
 * 扩展里不需要处理这件事 —— background 的 fetch 自带真实浏览器 UA，
 * 而且 `User-Agent` 属于禁止改写的 header，本来也设不了。
 * 只有在 Node 里跑探活时要把它补上，否则测的不是接口而是 UA 拦截。
 */
const browserFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    headers: {
      ...init?.headers,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    },
  });

const ctx: EngineRuntimeContext = { credentials: {}, fetchImpl: browserFetch };

describe('必应免费引擎（真实网络）', () => {
  it('单段翻译可用', async () => {
    const result = await createBingFreeEngine().translate(
      { texts: ['Hello world, nice to meet you.'], from: 'auto', to: 'zh-CN' },
      ctx,
    );

    expect(result.texts).toHaveLength(1);
    expect(result.texts[0]).toMatch(/[\u4e00-\u9fa5]/);
    expect(result.detectedFrom).toBe('en');
    console.info('  必应单段:', result.texts[0]);
  });

  it('换行伪批量的行数与请求段数一致', async () => {
    const texts = [
      'Installation',
      'Run the following command in your terminal.',
      'Note that this feature requires Node.js version 20 or later.',
      'Pull requests are welcome.',
      'License',
    ];

    const result = await createBingFreeEngine().translate({ texts, from: 'en', to: 'zh-CN' }, ctx);

    // 行数不一致会被引擎抛 BAD_RESPONSE，能走到这里说明伪批量成立
    expect(result.texts).toHaveLength(texts.length);
    for (const text of result.texts) expect(text.trim()).not.toBe('');
    console.info('  必应批量:', result.texts.join(' | '));
  });
});

describe('谷歌免费引擎（真实网络）', () => {
  it('单段翻译可用', async () => {
    const result = await createGoogleFreeEngine().translate(
      { texts: ['Hello world, nice to meet you.'], from: 'auto', to: 'zh-CN' },
      ctx,
    );

    expect(result.texts).toHaveLength(1);
    expect(result.texts[0]).toMatch(/[\u4e00-\u9fa5]/);
    console.info('  谷歌单段:', result.texts[0]);
  });
});

describe('百度引擎（真实网络）', () => {
  const appid = process.env.BAIDU_APPID;
  const key = process.env.BAIDU_KEY;

  it.skipIf(!appid || !key)('批量翻译可用', async () => {
    const result = await createBaiduEngine().translate(
      { texts: ['Hello', 'World'], from: 'en', to: 'zh-CN' },
      { credentials: { baidu: { appid: appid ?? '', key: key ?? '' } }, fetchImpl: browserFetch },
    );

    expect(result.texts).toHaveLength(2);
    console.info('  百度批量:', result.texts.join(' | '));
  });
});
