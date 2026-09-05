import { beforeEach, describe, expect, it } from 'vitest';
import { MARKER_ATTR, collectUnits, hasTranslatableText, isLikelyTargetLang } from './dom-walker';

function collect(html: string, targetLang = 'zh-CN') {
  document.body.innerHTML = html;
  return collectUnits(document.body, { targetLang, seen: new WeakSet<Text>() });
}

describe('hasTranslatableText', () => {
  it.each(['123', '  ', '···', '—', '42%'])('%s 不需要翻译', (text) => {
    expect(hasTranslatableText(text)).toBe(false);
  });

  it.each(['hi', 'Hello world', 'a b'])('%s 需要翻译', (text) => {
    expect(hasTranslatableText(text)).toBe(true);
  });
});

describe('isLikelyTargetLang', () => {
  it('中文目标语言下，中文段落被判定为无需翻译', () => {
    expect(isLikelyTargetLang('这是一段中文内容。', 'zh-CN')).toBe(true);
  });

  it('含假名的日文不会被误判成中文', () => {
    expect(isLikelyTargetLang('これは日本語の文章です', 'zh-CN')).toBe(false);
  });

  it('英文段落需要翻译', () => {
    expect(isLikelyTargetLang('This is english text', 'zh-CN')).toBe(false);
  });

  it('拉丁语系目标语言不做字符集猜测，交给引擎检测', () => {
    expect(isLikelyTargetLang('This is english text', 'en')).toBe(false);
  });
});

describe('collectUnits', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('把块级容器内的行内片段合并成一个翻译单元', () => {
    const units = collect('<p>Hello <b>brave</b> <i>world</i>!</p>');

    expect(units).toHaveLength(1);
    // 标点也要带上，且不能凭空补空格
    expect(units[0]?.text).toBe('Hello brave world!');
    expect(units[0]?.container.tagName).toBe('P');
    expect(units[0]?.isBlock).toBe(true);
  });

  it('不同块级容器拆成多个单元', () => {
    const units = collect('<div><p>First paragraph</p><p>Second paragraph</p></div>');

    expect(units.map((unit) => unit.text)).toEqual(['First paragraph', 'Second paragraph']);
  });

  it('跳过脚本、样式与代码块', () => {
    const units = collect(`
      <script>const secret = 'do not translate';</script>
      <style>.a { color: red }</style>
      <pre>const code = 'keep me';</pre>
      <code>inline code here</code>
      <p>Translate this sentence</p>
    `);

    expect(units.map((unit) => unit.text)).toEqual(['Translate this sentence']);
  });

  it('尊重 translate="no"、.notranslate 与 contenteditable', () => {
    const units = collect(`
      <p translate="no">Do not translate this</p>
      <p class="notranslate">Skip this one too</p>
      <div contenteditable="true">User is editing here</div>
      <p>But translate this one</p>
    `);

    expect(units.map((unit) => unit.text)).toEqual(['But translate this one']);
  });

  it('跳过扩展自己插入的译文节点，避免二次翻译', () => {
    const units = collect(`<p>Original text<span ${MARKER_ATTR}="u1">已插入的译文</span></p>`);

    expect(units.map((unit) => unit.text)).toEqual(['Original text']);
  });

  it('已经是目标语言的段落不入队', () => {
    const units = collect('<p>这是中文，不需要翻译。</p><p>This needs translation</p>');

    expect(units.map((unit) => unit.text)).toEqual(['This needs translation']);
  });

  it('同一批 seen 集合内不会重复产出同一个文本节点', () => {
    document.body.innerHTML = '<p>Hello world</p>';
    const seen = new WeakSet<Text>();

    expect(collectUnits(document.body, { targetLang: 'zh-CN', seen })).toHaveLength(1);
    expect(collectUnits(document.body, { targetLang: 'zh-CN', seen })).toHaveLength(0);
  });

  it('超长段落在文本节点边界处被拆成多个单元', () => {
    const chunk = 'word '.repeat(60); // 每段约 300 字符
    document.body.innerHTML = `<p>${Array.from({ length: 6 }, (_, i) => `<span>${chunk}${i}</span>`).join('')}</p>`;

    const units = collectUnits(document.body, { targetLang: 'zh-CN', seen: new WeakSet<Text>() });

    expect(units.length).toBeGreaterThan(1);
    for (const unit of units) expect(unit.text.length).toBeLessThanOrEqual(1500);
  });

  it('行内容器的单元被标记为非块级，译文跟在原文后面', () => {
    document.body.innerHTML = 'Bare text in body';
    const units = collectUnits(document.body, { targetLang: 'zh-CN', seen: new WeakSet<Text>() });

    expect(units).toHaveLength(1);
    expect(units[0]?.container.tagName).toBe('BODY');
  });
});
