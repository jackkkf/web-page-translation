import type { DisplayMode, TranslationStyle } from '../core/types';
import { MARKER_ATTR, type TranslationUnit } from './dom-walker';

export interface RendererOptions {
  displayMode: DisplayMode;
  style: TranslationStyle;
}

/**
 * 负责把译文写进页面，并且能完整还原。
 *
 * 所有插入的节点都带 `data-litetrans` 标记：
 * 既是还原时的抓手，也让 dom-walker 能跳过它们。
 */
export class TranslationRenderer {
  #options: RendererOptions;
  #holders = new Map<string, HTMLElement>();
  /** replace 模式下被改写的文本节点原值。 */
  #originals = new Map<Text, string>();
  #resolved = new Set<string>();

  constructor(options: RendererOptions) {
    this.#options = options;
  }

  get resolvedCount(): number {
    return this.#resolved.size;
  }

  setOptions(options: RendererOptions): void {
    const styleChanged = options.style !== this.#options.style;
    const modeChanged = options.displayMode !== this.#options.displayMode;
    this.#options = options;

    // 改样式可以就地更新；改展示模式涉及原文增删，必须重新翻译
    if (styleChanged && !modeChanged) {
      for (const holder of this.#holders.values()) {
        this.#applyClasses(holder, holder.classList.contains('litetrans-block'));
      }
    }
  }

  markPending(unit: TranslationUnit): void {
    if (this.#options.displayMode === 'replace') return;
    const holder = this.#holderFor(unit);
    holder.textContent = '';
    holder.classList.add('litetrans-pending');
    holder.classList.remove('litetrans-failed');
  }

  resolve(unit: TranslationUnit, translated: string): void {
    const text = translated.trim();
    if (!text || text === unit.text) {
      this.#discard(unit);
      return;
    }

    if (this.#options.displayMode === 'replace') {
      unit.nodes.forEach((node, index) => {
        if (!this.#originals.has(node)) this.#originals.set(node, node.nodeValue ?? '');
        // 整段译文放在第一个节点上，其余清空，避免文本被切碎
        node.nodeValue = index === 0 ? text : '';
      });
      this.#discard(unit);
    } else {
      const holder = this.#holderFor(unit);
      holder.classList.remove('litetrans-pending', 'litetrans-failed');
      holder.textContent = text;
    }
    this.#resolved.add(unit.id);
  }

  reject(unit: TranslationUnit, message: string): void {
    if (this.#options.displayMode === 'replace') return;
    const holder = this.#holderFor(unit);
    holder.classList.remove('litetrans-pending');
    holder.classList.add('litetrans-failed');
    holder.textContent = `⚠ ${message}`;
  }

  /** 还原页面：删掉所有插入节点，恢复被改写的文本。 */
  restoreAll(): void {
    for (const holder of this.#holders.values()) holder.remove();
    this.#holders.clear();

    for (const [node, original] of this.#originals) {
      if (node.isConnected) node.nodeValue = original;
    }
    this.#originals.clear();
    this.#resolved.clear();
  }

  #discard(unit: TranslationUnit): void {
    this.#holders.get(unit.id)?.remove();
    this.#holders.delete(unit.id);
  }

  #holderFor(unit: TranslationUnit): HTMLElement {
    const existing = this.#holders.get(unit.id);
    if (existing?.isConnected) return existing;

    // 用 span + display:block 而不是 div，避免在 <p> 里产生非法嵌套
    const holder = unit.container.ownerDocument.createElement('span');
    holder.setAttribute(MARKER_ATTR, unit.id);
    this.#applyClasses(holder, unit.isBlock);

    const anchor = unit.nodes[unit.nodes.length - 1];
    if (anchor?.parentNode) {
      anchor.parentNode.insertBefore(holder, anchor.nextSibling);
    } else {
      unit.container.append(holder);
    }

    this.#holders.set(unit.id, holder);
    return holder;
  }

  #applyClasses(holder: HTMLElement, isBlock: boolean): void {
    holder.className = [
      'litetrans-text',
      isBlock ? 'litetrans-block' : 'litetrans-inline',
      this.#options.style === 'none' ? '' : `litetrans-style-${this.#options.style}`,
    ]
      .filter(Boolean)
      .join(' ');
  }
}
