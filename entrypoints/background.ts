import { browser, defineBackground } from '#imports';
import { syncAutoTranslateRegistration } from '@/src/background/auto-translate';
import { ensureContentScript, getActiveTabId } from '@/src/background/injector';
import { TranslateService } from '@/src/background/translate-service';
import { TranslationCache } from '@/src/core/cache';
import { onMessage, sendMessage } from '@/src/core/messaging';
import { DEFAULT_SETTINGS, loadCredentials, loadSettings, settingsStorage } from '@/src/core/settings';
import { createEngineRegistry } from '@/src/engines/registry';

const CONTEXT_MENU_ID = 'litetrans-toggle';

export default defineBackground(() => {
  const cache = new TranslationCache({
    maxEntries: DEFAULT_SETTINGS.cacheMaxEntries,
    ttlMs: DEFAULT_SETTINGS.cacheTtlHours * 3600_000,
  });

  const service = new TranslateService({
    engines: createEngineRegistry(),
    cache,
    loadSettings,
    loadCredentials,
  });

  // MV3 的 service worker 随时会被回收，监听器必须在顶层同步注册
  onMessage('translateBatch', ({ data }) => service.translateBatch(data));
  onMessage('ensureContentScript', ({ data }) => ensureContentScript(data.tabId));
  onMessage('clearCache', () => cache.clear());
  onMessage('getCacheStats', () => cache.stats());

  // 自动翻译靠动态注册的内容脚本实现，设置或授权变化时都要重新对齐
  settingsStorage.watch(() => void syncAutoTranslateRegistration());
  browser.permissions.onAdded?.addListener(() => void syncAutoTranslateRegistration());
  browser.permissions.onRemoved?.addListener(() => void syncAutoTranslateRegistration());
  browser.runtime.onStartup.addListener(() => void syncAutoTranslateRegistration());

  browser.runtime.onInstalled.addListener(() => {
    void syncAutoTranslateRegistration();
    browser.contextMenus.create(
      {
        id: CONTEXT_MENU_ID,
        title: '翻译/还原此页面',
        contexts: ['page', 'selection'],
      },
      // 重复创建会报错，这里主动吞掉
      () => void browser.runtime.lastError,
    );
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === CONTEXT_MENU_ID && tab?.id !== undefined) void toggleTab(tab.id);
  });

  browser.commands.onCommand.addListener((command) => {
    if (command !== 'toggle-translate') return;
    void getActiveTabId().then((tabId) => {
      if (tabId !== null) void toggleTab(tabId);
    });
  });
});

async function toggleTab(tabId: number): Promise<void> {
  const injected = await ensureContentScript(tabId);
  if (!injected) return;
  await sendMessage('runPageCommand', { command: 'toggle' }, tabId);
}
