import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  resolveSiteAction,
  settingsStorage,
  shouldAutoTranslate,
  type SiteRule,
} from './settings';

describe('resolveSiteAction', () => {
  it('精确域名匹配', () => {
    const rules: SiteRule[] = [{ pattern: 'news.ycombinator.com', action: 'always' }];
    expect(resolveSiteAction('news.ycombinator.com', rules)).toBe('always');
    expect(resolveSiteAction('ycombinator.com', rules)).toBeNull();
  });

  it('*. 前缀同时匹配裸域名与子域名', () => {
    const rules: SiteRule[] = [{ pattern: '*.github.com', action: 'never' }];
    expect(resolveSiteAction('github.com', rules)).toBe('never');
    expect(resolveSiteAction('docs.github.com', rules)).toBe('never');
    expect(resolveSiteAction('notgithub.com', rules)).toBeNull();
  });

  it('更精确的规则覆盖泛域名规则', () => {
    const rules: SiteRule[] = [
      { pattern: '*.example.com', action: 'never' },
      { pattern: 'docs.example.com', action: 'always' },
    ];
    expect(resolveSiteAction('docs.example.com', rules)).toBe('always');
    expect(resolveSiteAction('www.example.com', rules)).toBe('never');
  });

  it('忽略大小写与空白', () => {
    const rules: SiteRule[] = [{ pattern: '  Example.COM ', action: 'always' }];
    expect(resolveSiteAction('example.com', rules)).toBe('always');
  });
});

describe('设置迁移', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('把已下线的 microsoft-free 换成 bing-free', async () => {
    // 模拟 v1 时期存下来的设置
    await fakeBrowser.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, engineId: 'microsoft-free', fallbackEngineId: 'microsoft-free' },
      settings$: { v: 1 },
    });

    await settingsStorage.migrate();
    const settings = await loadSettings();

    expect(settings.engineId).toBe('bing-free');
    expect(settings.fallbackEngineId).toBe('bing-free');
  });

  it('迁移不会动用户选的其他引擎', async () => {
    await fakeBrowser.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, engineId: 'baidu', fallbackEngineId: 'google-free' },
      settings$: { v: 1 },
    });

    await settingsStorage.migrate();
    const settings = await loadSettings();

    expect(settings.engineId).toBe('baidu');
    expect(settings.fallbackEngineId).toBe('google-free');
  });

  it('遇到无法识别的引擎 ID 回落到默认值，而不是留下坏数据', async () => {
    await fakeBrowser.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, engineId: 'some-removed-engine', fallbackEngineId: 'also-gone' },
      settings$: { v: 1 },
    });

    await settingsStorage.migrate();
    const settings = await loadSettings();

    expect(settings.engineId).toBe(DEFAULT_SETTINGS.engineId);
    expect(settings.fallbackEngineId).toBe(DEFAULT_SETTINGS.fallbackEngineId);
  });
});

describe('shouldAutoTranslate', () => {
  it('无规则时跟随全局开关', () => {
    expect(shouldAutoTranslate('example.com', { ...DEFAULT_SETTINGS, autoTranslate: true })).toBe(true);
    expect(shouldAutoTranslate('example.com', { ...DEFAULT_SETTINGS, autoTranslate: false })).toBe(false);
  });

  it('站点规则优先级高于全局开关', () => {
    expect(
      shouldAutoTranslate('example.com', {
        ...DEFAULT_SETTINGS,
        autoTranslate: false,
        siteRules: [{ pattern: 'example.com', action: 'always' }],
      }),
    ).toBe(true);

    expect(
      shouldAutoTranslate('example.com', {
        ...DEFAULT_SETTINGS,
        autoTranslate: true,
        siteRules: [{ pattern: 'example.com', action: 'never' }],
      }),
    ).toBe(false);
  });
});
