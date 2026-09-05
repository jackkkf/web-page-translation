import { browser } from '#imports';
import { useCallback, useEffect, useState } from 'react';
import { LANGUAGES } from '@/src/core/languages';
import { sendMessage, type CacheStats } from '@/src/core/messaging';
import type { SiteRule } from '@/src/core/settings';
import { isEngineId } from '@/src/engines/ids';
import { ENGINE_META, ENGINE_META_LIST } from '@/src/engines/meta';
import { useCredentials, useSettings } from '@/src/ui/hooks';

const ALL_URLS = '*://*/*';

export default function App() {
  const { settings, update } = useSettings();
  const { credentials, update: updateCredentials } = useCredentials();
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [rulePattern, setRulePattern] = useState('');
  const [ruleAction, setRuleAction] = useState<SiteRule['action']>('always');
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const refreshCacheStats = useCallback(async () => {
    setCacheStats(await sendMessage('getCacheStats', undefined));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void sendMessage('getCacheStats', undefined).then((stats) => {
      if (!cancelled) setCacheStats(stats);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleAutoTranslate = useCallback(
    async (enabled: boolean) => {
      if (!enabled) {
        await update({ autoTranslate: false });
        // 关闭后主动交回权限，符合"不留多余权限"的原则
        await browser.permissions.remove({ origins: [ALL_URLS] }).catch(() => false);
        setMessage({ text: '已关闭自动翻译，并撤回全站访问权限' });
        return;
      }
      const granted = await browser.permissions.request({ origins: [ALL_URLS] }).catch(() => false);
      if (!granted) {
        setMessage({ text: '未获得全站访问权限，自动翻译无法开启', error: true });
        return;
      }
      await update({ autoTranslate: true });
      setMessage({ text: '已开启自动翻译' });
    },
    [update],
  );

  const addRule = useCallback(async () => {
    if (!settings) return;
    const pattern = rulePattern.trim().toLowerCase();
    if (!pattern) return;
    if (settings.siteRules.some((rule) => rule.pattern === pattern)) {
      setMessage({ text: '该域名已有规则', error: true });
      return;
    }
    if (ruleAction === 'always') {
      const origin = `*://${pattern}/*`;
      const granted = await browser.permissions.request({ origins: [origin] }).catch(() => false);
      if (!granted) {
        setMessage({ text: `未获得 ${pattern} 的访问权限，规则不会生效`, error: true });
        return;
      }
    }
    await update({ siteRules: [...settings.siteRules, { pattern, action: ruleAction }] });
    setRulePattern('');
    setMessage({ text: '规则已保存' });
  }, [rulePattern, ruleAction, settings, update]);

  const removeRule = useCallback(
    async (pattern: string) => {
      if (!settings) return;
      await update({ siteRules: settings.siteRules.filter((rule) => rule.pattern !== pattern) });
    },
    [settings, update],
  );

  if (!settings) return <div className="options">加载中…</div>;

  const primaryMeta = ENGINE_META[settings.engineId];
  const baidu = credentials?.baidu ?? { appid: '', key: '' };

  return (
    <div className="options">
      <h1>轻译 · 设置</h1>
      <p className="options__subtitle">
        所有配置只保存在本机浏览器存储中，扩展不会上传任何页面内容或配置到我们的服务器。
      </p>

      <section className="card">
        <h2>翻译引擎</h2>
        <p className="card__desc">
          主引擎失败（网络不通、限流、额度耗尽）时会自动切换到降级引擎；同一引擎连续失败 3 次会被短路 60 秒。
        </p>

        <label className="field">
          <span>主引擎</span>
          <select
            value={settings.engineId}
            onChange={(event) => {
              if (isEngineId(event.target.value)) void update({ engineId: event.target.value });
            }}
          >
            {ENGINE_META_LIST.map((engine) => (
              <option key={engine.id} value={engine.id}>
                {engine.name}
              </option>
            ))}
          </select>
        </label>
        <p className="engine-note">{primaryMeta.notes}</p>

        <label className="field">
          <span>降级引擎</span>
          <select
            value={settings.fallbackEngineId ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              void update({ fallbackEngineId: isEngineId(value) ? value : null });
            }}
          >
            <option value="">不降级</option>
            {ENGINE_META_LIST.filter((engine) => engine.id !== settings.engineId).map((engine) => (
              <option key={engine.id} value={engine.id}>
                {engine.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="card">
        <h2>百度翻译密钥</h2>
        <p className="card__desc">
          在
          <a href="https://fanyi-api.baidu.com/manage/developer" target="_blank" rel="noreferrer">
            {' '}
            百度翻译开放平台{' '}
          </a>
          创建「通用文本翻译」应用后获取。密钥仅存放于本机 <code>storage.local</code>，不参与浏览器账号同步。
        </p>

        <label className="field">
          <span>APP ID</span>
          <input
            value={baidu.appid}
            onChange={(event) => void updateCredentials({ baidu: { ...baidu, appid: event.target.value.trim() } })}
            placeholder="例如 20260101001234567"
          />
        </label>
        <label className="field">
          <span>密钥</span>
          <input
            type="password"
            value={baidu.key}
            onChange={(event) => void updateCredentials({ baidu: { ...baidu, key: event.target.value.trim() } })}
            placeholder="Secret Key"
          />
        </label>
      </section>

      <section className="card">
        <h2>自动翻译</h2>
        <p className="card__desc">
          默认关闭。开启需要额外授予「访问所有网站」权限；关闭时扩展只在你点击图标或按快捷键后才读取页面内容。
        </p>

        <label className="field field--checkbox">
          <input
            type="checkbox"
            checked={settings.autoTranslate}
            onChange={(event) => void toggleAutoTranslate(event.target.checked)}
          />
          <div>
            打开任意页面即自动翻译
            <small>快捷键 Alt+A 可随时切换译文与原文</small>
          </div>
        </label>

        <h2 style={{ marginTop: 20 }}>站点规则</h2>
        <p className="card__desc">规则优先级高于全局开关，更精确的域名覆盖泛域名规则。</p>

        <div className="rules">
          {settings.siteRules.length === 0 && <p className="status">暂无规则</p>}
          {settings.siteRules.map((rule) => (
            <div className="rule" key={rule.pattern}>
              <code>{rule.pattern}</code>
              <span>{rule.action === 'always' ? '始终翻译' : '从不翻译'}</span>
              <button className="button button--danger" onClick={() => void removeRule(rule.pattern)}>
                删除
              </button>
            </div>
          ))}
        </div>

        <div className="row">
          <input
            value={rulePattern}
            onChange={(event) => setRulePattern(event.target.value)}
            placeholder="域名，如 news.ycombinator.com 或 *.github.com"
          />
          <select value={ruleAction} onChange={(event) => setRuleAction(event.target.value as SiteRule['action'])}>
            <option value="always">始终翻译</option>
            <option value="never">从不翻译</option>
          </select>
          <button className="button button--primary" onClick={() => void addRule()}>
            添加
          </button>
        </div>
      </section>

      <section className="card">
        <h2>默认语言</h2>
        <label className="field">
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
        <label className="field">
          <span>译文语言</span>
          <select value={settings.targetLang} onChange={(event) => void update({ targetLang: event.target.value })}>
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="card">
        <h2>翻译缓存</h2>
        <p className="card__desc">相同引擎、相同语言方向、相同原文的结果会被缓存，减少重复请求与配额消耗。</p>

        <label className="field field--checkbox">
          <input
            type="checkbox"
            checked={settings.cacheEnabled}
            onChange={(event) => void update({ cacheEnabled: event.target.checked })}
          />
          <div>启用缓存</div>
        </label>

        <label className="field">
          <span>最多条数</span>
          <input
            type="number"
            min={100}
            max={20000}
            step={100}
            value={settings.cacheMaxEntries}
            onChange={(event) => void update({ cacheMaxEntries: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span>过期时间（小时）</span>
          <input
            type="number"
            min={1}
            max={8760}
            value={settings.cacheTtlHours}
            onChange={(event) => void update({ cacheTtlHours: Number(event.target.value) })}
          />
        </label>

        <div className="row">
          <button
            className="button"
            onClick={() => {
              void sendMessage('clearCache', undefined).then(refreshCacheStats);
              setMessage({ text: '缓存已清空' });
            }}
          >
            清空缓存
          </button>
          {cacheStats && (
            <span className="status">
              当前 {cacheStats.entries} 条 · 命中 {cacheStats.hits} 次 / 未命中 {cacheStats.misses} 次
            </span>
          )}
        </div>
      </section>

      {message && <p className={`status ${message.error ? 'status--error' : ''}`}>{message.text}</p>}
    </div>
  );
}
