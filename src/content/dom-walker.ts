import type { LangCode } from '../core/types';

/** 打在扩展自己插入的节点上，用于遍历时跳过，避免"翻译译文"。 */
export const MARKER_ATTR = 'data-litetrans';

/** 内容不属于自然语言，或者改动会破坏页面功能的标签。 */
export const SKIPPED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'CODE',
  'PRE',
  'KBD',
  'SAMP',
  'VAR',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'OPTION',
  'OPTGROUP',
  'BUTTON',
  'SVG',
  'MATH',
  'CANVAS',
  'VIDEO',
  'AUDIO',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'IMG',
  'PICTURE',
  'AREA',
  'MAP',
  'TRACK',
  'SOURCE',
]);

/**
 * 行内标签：遍历时要一路上溯到最近的块级容器，
 * 才能把 `<p>Hello <b>world</b>!</p>` 当成一句完整的话来翻译。
 */
export const INLINE_TAGS = new Set([
  'A',
  'ABBR',
  'B',
  'BDI',
  'BDO',
  'BIG',
  'CITE',
  'DATA',
  'DEL',
  'DFN',
  'EM',
  'FONT',
  'I',
  'INS',
  'LABEL',
  'MARK',
  'Q',
  'RP',
  'RT',
  'RUBY',
  'S',
  'SMALL',
  'SPAN',
  'STRIKE',
  'STRONG',
  'SUB',
  'SUP',
  'TIME',
  'TT',
  'U',
  'WBR',
]);

/** 单个翻译单元的字符上限：超过就在文本节点边界处拆开，保证批次可控。 */
export const MAX_UNIT_CHARS = 1200;
export const MIN_UNIT_CHARS = 2;

export interface TranslationUnit {
  id: string;
  /** 最近的块级祖先，用于 IntersectionObserver 观察可见性。 */
  container: HTMLElement;
  nodes: Text[];
  /** 归一化空白后的待译文本。 */
  text: string;
  /** 容器是块级时译文独占一行，否则跟在原文后面。 */
  isBlock: boolean;
}

export interface CollectOptions {
  targetLang: LangCode;
  /** 已入队过的文本节点，动态内容重扫时用于去重。 */
  seen: WeakSet<Text>;
}

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const KANA = /[\u3040-\u30ff]/u;
const HANGUL = /[\u1100-\u11ff\uac00-\ud7af]/u;
const LETTER = /\p{L}/u;

let sequence = 0;

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 纯数字、纯标点、纯 emoji 之类的内容没有翻译价值。 */
export function hasTranslatableText(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  return normalized.length >= MIN_UNIT_CHARS && LETTER.test(normalized);
}

function ratioOf(text: string, pattern: RegExp): number {
  let hits = 0;
  for (const char of text) if (pattern.test(char)) hits += 1;
  return text.length === 0 ? 0 : hits / text.length;
}

/**
 * 启发式判断"这段文本已经是目标语言了"，避免中文页面被再翻一遍。
 *
 * 只对 CJK 目标语言生效：拉丁字母语言之间无法靠字符集区分，
 * 那种情况交给引擎的自动语言检测处理。
 */
export function isLikelyTargetLang(text: string, targetLang: LangCode): boolean {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return true;
  const target = targetLang.toLowerCase();

  if (target === 'zh-cn' || target === 'zh-tw') {
    // 含假名说明是日文，仍需翻译
    if (KANA.test(normalized)) return false;
    return ratioOf(normalized, HAN) > 0.5;
  }
  if (target === 'ja') return ratioOf(normalized, KANA) > 0.2;
  if (target === 'ko') return ratioOf(normalized, HANGUL) > 0.3;
  return false;
}

function isSkippedElement(element: Element): boolean {
  if (SKIPPED_TAGS.has(element.tagName)) return true;
  if (element.hasAttribute(MARKER_ATTR)) return true;
  if (element.getAttribute('translate') === 'no') return true;
  if (element.classList.contains('notranslate')) return true;
  if (element.getAttribute('aria-hidden') === 'true') return true;
  const editable = element.getAttribute('contenteditable');
  return editable === '' || editable === 'true';
}

/** 从文本节点向上检查所有祖先，任一命中跳过规则就整棵子树都不翻。 */
function isInSkippedSubtree(node: Text): boolean {
  let current: Element | null = node.parentElement;
  while (current) {
    if (isSkippedElement(current)) return true;
    current = current.parentElement;
  }
  return false;
}

function nearestBlockContainer(node: Text): HTMLElement | null {
  let element = node.parentElement;
  while (element && INLINE_TAGS.has(element.tagName) && element.parentElement) {
    element = element.parentElement;
  }
  return element;
}

/**
 * 收集页面中可翻译的段落。
 *
 * 分组策略：同一个块级容器下连续的文本节点合并成一个翻译单元，
 * 这样译文的插入位置和上下文都以"一段话"为粒度，比逐节点翻译自然得多。
 */
export function collectUnits(root: Node, options: CollectOptions): TranslationUnit[] {
  const ownerDocument = root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : root.ownerDocument;
  if (!ownerDocument) return [];

  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      const textNode = node as Text;
      if (options.seen.has(textNode)) return NodeFilter.FILTER_REJECT;
      // 标点、数字、纯空白片段都要留下：
      // 空白是词间分隔（丢了会把 `<b>brave</b> <i>world</i>` 粘成一个词），
      // 标点是句子的一部分。是否值得翻译在 commit 时按整段判断。
      if (!textNode.nodeValue) return NodeFilter.FILTER_REJECT;
      if (isInSkippedSubtree(textNode)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const units: TranslationUnit[] = [];
  let currentContainer: HTMLElement | null = null;
  let currentNodes: Text[] = [];
  let currentLength = 0;

  const commit = () => {
    if (!currentContainer || currentNodes.length === 0) return;
    // 直接拼接而不是补空格：文本节点自带的空白就是用户实际看到的间距
    const text = normalizeWhitespace(currentNodes.map((node) => node.nodeValue ?? '').join(''));
    const container = currentContainer;
    const nodes = currentNodes;
    currentNodes = [];
    currentLength = 0;

    if (!hasTranslatableText(text)) return;
    if (isLikelyTargetLang(text, options.targetLang)) return;

    sequence += 1;
    units.push({
      id: `u${sequence}`,
      container,
      nodes,
      text,
      isBlock: !INLINE_TAGS.has(container.tagName),
    });
  };

  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    options.seen.add(textNode);

    const container = nearestBlockContainer(textNode);
    if (container) {
      const length = normalizeWhitespace(textNode.nodeValue ?? '').length;
      // 换了容器，或者当前单元已经太长，就先结算掉
      if (container !== currentContainer || currentLength + length > MAX_UNIT_CHARS) {
        commit();
        currentContainer = container;
      }
      currentNodes.push(textNode);
      currentLength += length;
    }
    node = walker.nextNode();
  }
  commit();

  return units;
}
