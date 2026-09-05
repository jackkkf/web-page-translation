import { defineContentScript } from '#imports';
import { onMessage } from '@/src/core/messaging';
import { PageTranslator } from '@/src/content/page-translator';

const INJECTED_FLAG = '__litetransInjected';

export default defineContentScript({
  // 不写进 manifest：由 background 在用户操作时按需注入，
  // 从而避免安装即申请 `<all_urls>` 权限。
  registration: 'runtime',

  async main(ctx) {
    // executeScript 有可能被并发调用两次，重复注册监听器会导致响应混乱
    const scope = window as unknown as Record<string, boolean>;
    if (scope[INJECTED_FLAG]) return;
    scope[INJECTED_FLAG] = true;

    const translator = new PageTranslator(ctx);

    onMessage('ping', () => true);
    onMessage('getPageStatus', () => translator.getStatus());
    onMessage('runPageCommand', ({ data }) => translator.run(data.command));

    await translator.maybeAutoTranslate();
  },
});
