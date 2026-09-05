import { beforeEach, describe, expect, it } from 'vitest';
import { MARKER_ATTR, collectUnits } from './dom-walker';
import { TranslationRenderer } from './renderer';

function unitsOf(html: string) {
  document.body.innerHTML = html;
  return collectUnits(document.body, { targetLang: 'zh-CN', seen: new WeakSet<Text>() });
}

describe('TranslationRenderer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('双语模式下把译文插在原文之后，原文保持不变', () => {
    const [unit] = unitsOf('<p>Hello world</p>');
    const renderer = new TranslationRenderer({ displayMode: 'bilingual', style: 'dashed' });

    renderer.resolve(unit!, '你好，世界');

    const paragraph = document.querySelector('p');
    expect(paragraph?.textContent).toBe('Hello world你好，世界');
    const holder = paragraph?.querySelector(`[${MARKER_ATTR}]`);
    expect(holder?.textContent).toBe('你好，世界');
    expect(holder?.className).toContain('litetrans-style-dashed');
    expect(holder?.className).toContain('litetrans-block');
  });

  it('仅显示译文模式会改写原文，还原后恢复原样', () => {
    const [unit] = unitsOf('<p>Hello world</p>');
    const renderer = new TranslationRenderer({ displayMode: 'replace', style: 'none' });

    renderer.resolve(unit!, '你好，世界');
    expect(document.querySelector('p')?.textContent).toBe('你好，世界');

    renderer.restoreAll();
    expect(document.querySelector('p')?.textContent).toBe('Hello world');
  });

  it('还原会清掉所有插入节点', () => {
    const units = unitsOf('<p>First one</p><p>Second one</p>');
    const renderer = new TranslationRenderer({ displayMode: 'bilingual', style: 'card' });

    units.forEach((unit, index) => renderer.resolve(unit, `译文${index}`));
    expect(document.querySelectorAll(`[${MARKER_ATTR}]`)).toHaveLength(2);

    renderer.restoreAll();
    expect(document.querySelectorAll(`[${MARKER_ATTR}]`)).toHaveLength(0);
    expect(document.body.textContent).toBe('First oneSecond one');
  });

  it('译文与原文相同时不插入冗余节点', () => {
    const [unit] = unitsOf('<p>Hello world</p>');
    const renderer = new TranslationRenderer({ displayMode: 'bilingual', style: 'none' });

    renderer.markPending(unit!);
    renderer.resolve(unit!, 'Hello world');

    expect(document.querySelectorAll(`[${MARKER_ATTR}]`)).toHaveLength(0);
    expect(renderer.resolvedCount).toBe(0);
  });

  it('失败时在原位提示错误，而不是留一个空白占位', () => {
    const [unit] = unitsOf('<p>Hello world</p>');
    const renderer = new TranslationRenderer({ displayMode: 'bilingual', style: 'none' });

    renderer.markPending(unit!);
    renderer.reject(unit!, '网络请求失败');

    const holder = document.querySelector(`[${MARKER_ATTR}]`);
    expect(holder?.className).toContain('litetrans-failed');
    expect(holder?.textContent).toContain('网络请求失败');
  });

  it('重复 resolve 同一单元不会插入第二个节点', () => {
    const [unit] = unitsOf('<p>Hello world</p>');
    const renderer = new TranslationRenderer({ displayMode: 'bilingual', style: 'none' });

    renderer.resolve(unit!, '第一次');
    renderer.resolve(unit!, '第二次');

    expect(document.querySelectorAll(`[${MARKER_ATTR}]`)).toHaveLength(1);
    expect(document.querySelector(`[${MARKER_ATTR}]`)?.textContent).toBe('第二次');
  });
});
