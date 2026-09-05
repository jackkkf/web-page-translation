# 轻译 LiteTrans

开源、免费、**默认不索取任何网站访问权限**的浏览器网页翻译扩展。支持 Chrome / Edge / Firefox。

## 特点

- **双语对照**：译文插在原文下方，原文始终可核对
- **多引擎切换**：必应（免费、默认）、谷歌（免费）、百度（自备密钥），主引擎失败自动降级
- **最小权限**：manifest 里没有 `content_scripts`，也没有 `<all_urls>`。安装时不会出现「读取您在所有网站上的数据」提示
- **视口内懒翻译**：长页面首屏只翻可见区域，请求数与页面长度无关
- **零数据收集**：没有服务器、没有埋点。页面文本只发往你选择的翻译服务

## 快速开始

```bash
npm install
npm run dev          # Chrome；dev:firefox / dev:edge 同理
```

手动加载产物：

```bash
npm run build
# Chrome/Edge: chrome://extensions → 开发者模式 → 加载已解压的扩展 → .output/chrome-mv3
# Firefox: about:debugging → 临时载入附加组件 → .output/firefox-mv2/manifest.json
```

## 常用命令

| 命令                     | 说明                                                      |
| ------------------------ | --------------------------------------------------------- |
| `npm run dev`            | 开发模式（热更新）                                        |
| `npm run build:all`      | 产出 Chrome / Firefox / Edge 三份产物                     |
| `npm run zip:all`        | 产出三个商店的提交包                                      |
| `npm run test`           | 单元测试                                                  |
| `npm run test:live`      | 打真实翻译接口探活，确认上游端点没有变更                  |
| `npm run check:manifest` | 权限守卫：检查构建产物是否越权                            |
| `npm run verify`         | 提交前全量校验（格式 + lint + 类型 + 测试 + 构建 + 权限） |

## 文档

| 文档                                                                           | 内容                           |
| ------------------------------------------------------------------------------ | ------------------------------ |
| [AGENTS.md](AGENTS.md)                                                         | 开发约定与红线（人和 AI 都读） |
| [docs/prd.md](docs/prd.md)                                                     | 产品需求与功能范围             |
| [docs/architecture.md](docs/architecture.md)                                   | 架构、链路、关键取舍           |
| [docs/roadmap.md](docs/roadmap.md)                                             | 路线图与明确不做的事           |
| [docs/research/competitive-analysis.md](docs/research/competitive-analysis.md) | 竞品调研与差异化切口           |
| [docs/research/translation-engines.md](docs/research/translation-engines.md)   | 翻译引擎调研与接入规范         |
| [docs/decisions/](docs/decisions/)                                             | 架构决策记录（ADR）            |
| [docs/engineering/ai-workflow.md](docs/engineering/ai-workflow.md)             | AI 辅助开发工作流              |
| [docs/store/](docs/store/)                                                     | 上架清单与隐私政策             |
| [docs/testing/manual-checklist.md](docs/testing/manual-checklist.md)           | 人工验收清单                   |

## 技术栈

WXT 0.21 · React 19 · TypeScript (strict) · Vitest。选型理由见 [ADR-0001](docs/decisions/0001-tech-stack.md)。

## 许可

MIT
