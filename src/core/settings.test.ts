import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, resolveSiteAction, shouldAutoTranslate, type SiteRule } from './settings';

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
