const STYLE_ID = 'litetrans-style';

/**
 * 译文样式以字符串形式内联注入，而不是走 manifest 的 content_scripts.css。
 * 原因：内容脚本是按需用 scripting.executeScript 注入的，
 * 单独的 CSS 文件在这种模式下不会被自动应用。
 */
export const CONTENT_STYLE = `
[data-litetrans] {
  color: inherit;
  font-family: inherit;
  line-height: 1.6;
}

[data-litetrans].litetrans-block {
  display: block;
  margin: 0.25em 0 0.4em;
}

[data-litetrans].litetrans-inline {
  display: inline;
  margin-inline-start: 0.35em;
}

[data-litetrans].litetrans-pending {
  opacity: 0.45;
}

[data-litetrans].litetrans-pending::after {
  content: '翻译中…';
  font-size: 0.85em;
}

[data-litetrans].litetrans-failed {
  color: #c0392b;
  font-size: 0.85em;
  opacity: 0.85;
}

[data-litetrans].litetrans-style-underline {
  text-decoration: underline;
  text-decoration-color: rgba(37, 99, 235, 0.5);
  text-underline-offset: 3px;
}

[data-litetrans].litetrans-style-dashed {
  border-bottom: 1px dashed rgba(37, 99, 235, 0.45);
}

[data-litetrans].litetrans-style-highlight {
  background: rgba(37, 99, 235, 0.08);
  border-radius: 3px;
  padding: 0 2px;
}

[data-litetrans].litetrans-style-card {
  background: rgba(37, 99, 235, 0.06);
  border-inline-start: 3px solid rgba(37, 99, 235, 0.5);
  border-radius: 4px;
  padding: 0.3em 0.6em;
}
`;

/** 幂等注入：内容脚本可能被重复执行。 */
export function injectContentStyle(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CONTENT_STYLE;
  (doc.head ?? doc.documentElement).append(style);
}

export function removeContentStyle(doc: Document = document): void {
  doc.getElementById(STYLE_ID)?.remove();
}
