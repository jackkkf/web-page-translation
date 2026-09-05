import { ENGINE_IDS, type EngineId } from './ids';

/**
 * 引擎的静态元数据。
 *
 * 与实现分开是为了让 popup / 选项页只导入这个文件即可渲染引擎列表，
 * 不必把 md5、请求层等实现代码打进 UI bundle。
 */
export interface EngineMeta {
  id: EngineId;
  name: string;
  /** 是否零成本可用（不需要用户自备密钥）。 */
  keyless: boolean;
  notes: string;
  docsUrl?: string;
}

export const ENGINE_META: Record<EngineId, EngineMeta> = {
  'microsoft-free': {
    id: 'microsoft-free',
    name: '微软翻译（免费）',
    keyless: true,
    notes: '走 Edge 浏览器内置的匿名 token，无需密钥，支持真批量，国内外网络都可直连。',
    docsUrl: 'https://learn.microsoft.com/azure/ai-services/translator/language-support',
  },
  'google-free': {
    id: 'google-free',
    name: '谷歌翻译（免费）',
    keyless: true,
    notes: '无需密钥，语言覆盖最广；不支持批量，且中国大陆网络通常需要代理。',
  },
  baidu: {
    id: 'baidu',
    name: '百度翻译',
    keyless: false,
    notes: '需自备 APPID/密钥。标准版不限字符量但 QPS=1；高级版需实名认证，每月 200 万字符免费。',
    docsUrl: 'https://api.fanyi.baidu.com/doc/21',
  },
};

export const ENGINE_META_LIST: readonly EngineMeta[] = ENGINE_IDS.map((id) => ENGINE_META[id]);
