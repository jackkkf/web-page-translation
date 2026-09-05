import { browser } from '#imports';
import { useCallback, useEffect, useState } from 'react';
import { LANGUAGES } from '@/src/core/languages';
import { sendMessage, type PageStatus } from '@/src/core/messaging';
import type { DisplayMode, TranslationStyle } from '@/src/core/types';
import { ENGINE_META, ENGINE_META_LIST } from '@/src/engines/meta';
import { isEngineId } from '@/src/engines/ids';
import { useSettings } from '@/src/ui/hooks';
import './App.css';

const STYLE_OPTIONS: Array<{ value: TranslationStyle; label: string }> = [
  { value: 'dashed', label: '虚线下划线' },
  { value: 'underline', label: '实线下划线' },
  { value: 'highlight', label: '浅色高亮' },
  { value: 'card', label: '引用卡片' },
  { value: 'none', label: '无标记' },
];

const MODE_OPTIONS: Array<{ value: DisplayMode; label: string }> = [
  { value: 'bilingual', label: '双语对照' },
  { value: 'replace', label: '仅显示译文' },
];

export default function App() {
  const { settings, update } = useSettings();
  const [tabId, setTabId] = useState<number | null>(null);
  const [status, setStatus] = useState<PageStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 打开 popup 就算一次用户手势，此时 activeTab 权限生效，可以注入内容脚本
  useEffect(() => {
    let active = true;
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!active || tab?.id === undefined) {
        if (active) setNotice('当前页面不支持翻译');
        return;
      }
      setTabId(tab.id);
      const injected = await sendMessage('ensureContentScript', { tabId: tab.id });
      if (!active) return;
      if (!injected) {
        setNotice('浏览器内置页面（如商店、设置页）不允许扩展运行');
        return;
      }
      setStatus(await sendMessage('getPageStatus', undefined, tab.id));
    })();
    return () => {
      active = false;
    };
  }, []);

  // 翻译是流式渲染的，轮询让进度可见
  useEffect(() => {
    if (tabId === null || status === null) return;
    if (status.phase !== 'translating') return;
    const timer = setInterval(() => {
      void sendMessage('getPageStatus', undefined, tabId)
        .then(setStatus)
        .catch(() => undefined);
    }, 600);
    return () => clearInterval(timer);
  }, [tabId, status]);

  const runCommand = useCallback(
    async (command: 'toggle' | 'refresh') => {
      if (tabId === null) return;
      setBusy(true);
      try {
        setStatus(await sendMessage('runPageCommand', { command }, tabId));
      } catch {
        setNotice('内容脚本未响应，请刷新页面后重试');
      } finally {
        setBusy(false);
      }
    },
    [tabId],
  );

  if (!settings) return <div className="popup popup--loading">加载中…</div>;

  const translated = status?.phase === 'translated' || status?.phase === 'translating';
  const engineMeta = ENGINE_META[settings.engineId];
  const needsKey = !engineMeta.keyless;

  return (
    <div className="popup">
      <header className="popup__header">
        <span className="popup__logo">轻译</span>
        <button className="popup__link" onClick={() => void browser.runtime.openOptionsPage()}>
          设置
        </button>
      </header>

      <button
        className={`popup__action ${translated ? 'popup__action--active' : ''}`}
        disabled={busy || tabId === null}
        onClick={() => void runCommand('toggle')}
      >
        {translated ? '显示原文' : '翻译此页面'}
      </button>

      {status?.phase === 'translating' && (
        <p className="popup__progress">
          翻译中… {status.translatedUnits}/{status.totalUnits} 段
        </p>
      )}
      {status?.error && <p className="popup__error">{status.error}</p>}
      {notice && <p className="popup__error">{notice}</p>}

      <label className="popup__field">
        <span>翻译引擎</span>
        <select
          value={settings.engineId}
          onChange={(event) => {
            const value = event.target.value;
            if (isEngineId(value)) void update({ engineId: value });
          }}
        >
          {ENGINE_META_LIST.map((engine) => (
            <option key={engine.id} value={engine.id}>
              {engine.name}
              {engine.keyless ? '' : '（需密钥）'}
            </option>
          ))}
        </select>
      </label>

      {needsKey && (
        <p className="popup__hint">
          该引擎需要密钥，
          <button className="popup__link popup__link--inline" onClick={() => void browser.runtime.openOptionsPage()}>
            前往设置
          </button>
        </p>
      )}

      <div className="popup__row">
        <label className="popup__field">
          <span>原文语言</span>
          <select value={settings.sourceLang} onChange={(event) => void update({ sourceLang: event.target.value })}>
            <option value="auto">自动检测</option>
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>
        </label>

        <label className="popup__field">
          <span>译文语言</span>
          <select value={settings.targetLang} onChange={(event) => void update({ targetLang: event.target.value })}>
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="popup__row">
        <label className="popup__field">
          <span>展示方式</span>
          <select
            value={settings.displayMode}
            onChange={(event) => void update({ displayMode: event.target.value as DisplayMode })}
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="popup__field">
          <span>译文样式</span>
          <select
            value={settings.translationStyle}
            onChange={(event) => void update({ translationStyle: event.target.value as TranslationStyle })}
          >
            {STYLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <footer className="popup__footer">
        <span>切换设置后点「重新翻译」生效</span>
        <button className="popup__link" disabled={busy || !translated} onClick={() => void runCommand('refresh')}>
          重新翻译
        </button>
      </footer>
    </div>
  );
}
