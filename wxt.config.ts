import { defineConfig } from 'wxt';
import { ENGINE_HOST_PERMISSIONS } from './src/engines/ids';

// 文档：https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  manifest: ({ manifestVersion }) => ({
    name: '轻译 LiteTrans - 网页双语对照翻译',
    short_name: '轻译',
    description: '免费、隐私优先的网页双语对照翻译扩展，支持微软 / 谷歌 / 百度多引擎一键切换。',

    // 刻意保持最小：
    // - activeTab：用户点击图标时临时获得当前页访问权，替代 <all_urls>
    // - scripting：MV3 下按需注入内容脚本
    // - host_permissions 只含翻译接口域名，不含任何网页域名
    permissions:
      manifestVersion === 3
        ? ['storage', 'activeTab', 'scripting', 'contextMenus']
        : ['storage', 'activeTab', 'contextMenus'],

    host_permissions: [...ENGINE_HOST_PERMISSIONS],

    // 自动翻译是可选功能，全站权限在用户开启时才申请
    ...(manifestVersion === 3 ? { optional_host_permissions: ['*://*/*'] } : { optional_permissions: ['*://*/*'] }),

    commands: {
      'toggle-translate': {
        suggested_key: { default: 'Alt+A' },
        description: '翻译 / 还原当前页面',
      },
    },

    ...(manifestVersion === 2
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'litetrans@example.com',
              strict_min_version: '115.0',
            },
          },
        }
      : {}),
  }),
});
