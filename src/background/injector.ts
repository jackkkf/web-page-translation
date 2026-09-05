import { browser } from '#imports';
import { sendMessage } from '../core/messaging';

/** WXT 把 `entrypoints/translate.content.ts` 编译到这个路径。 */
export const CONTENT_SCRIPT_FILE = '/content-scripts/translate.js';

/** MV2（Firefox）没有 scripting API，只能用旧的 tabs.executeScript。 */
interface Mv2TabsApi {
  executeScript(tabId: number, details: { file: string; runAt?: string }): Promise<unknown>;
}

/**
 * 幂等地确保目标标签页里有内容脚本。
 *
 * 这是"最小权限"方案的核心：内容脚本不写进 manifest，
 * 用户点击扩展图标时靠 activeTab 临时授权注入，
 * 因此安装时无需申请 `<all_urls>`。
 */
export async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    await sendMessage('ping', undefined, tabId);
    return true;
  } catch {
    // 收不到 pong 说明还没注入，继续往下走
  }

  try {
    if (import.meta.env.MANIFEST_VERSION === 3) {
      await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
    } else {
      await (browser.tabs as unknown as Mv2TabsApi).executeScript(tabId, {
        file: CONTENT_SCRIPT_FILE,
        runAt: 'document_idle',
      });
    }
    return true;
  } catch (error) {
    // 商店页、about: 等特权页面注入必然失败，这是预期行为
    console.warn('[litetrans] 无法注入内容脚本', error);
    return false;
  }
}

export async function getActiveTabId(): Promise<number | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}
