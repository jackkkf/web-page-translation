# AGENTS.md

轻译 LiteTrans —— 跨浏览器网页双语对照翻译扩展。WXT + React 19 + TypeScript(strict)。

## 命令

```bash
npm install            # 会自动跑 wxt prepare 生成类型
npm run dev            # Chrome 开发模式；dev:firefox / dev:edge 同理
npm run compile        # tsc --noEmit
npm run lint           # eslint .
npm run test           # vitest run
npm run test:live      # 打真实翻译接口探活（需联网，不进 CI）
npm run build:all      # 产出 chrome-mv3 / firefox-mv2 / edge-mv3
npm run verify         # 提交前必须跑通：format + lint + compile + test + build:all + check:manifest
```

## 结构

- `entrypoints/` 扩展入口，WXT 按文件名生成 manifest。只放胶水代码。
- `src/core/` 通用能力：类型、错误、设置、消息协议、缓存、限流。
- `src/engines/` 翻译引擎适配层，一个引擎一个文件。
- `src/background/` 编排与注入逻辑。
- `src/content/` DOM 遍历、译文渲染、页面状态机。
- `docs/` 调研、决策记录（ADR）、规划、上架材料。

改动前先读：`docs/architecture.md`；涉及权限的先读 `docs/decisions/0002-permission-model.md`。

## 绝对不能做

- **不要在 manifest 里加 `content_scripts` 或把 `<all_urls>` 写进 `host_permissions`。** 最小权限是产品卖点，见 ADR-0002。内容脚本用 `registration: 'runtime'` 且**不写 `matches`**（写了 WXT 会自动加 host 权限）。
- **不要在内容脚本或扩展页面里直接 `fetch` 翻译接口。** 所有网络请求经 background，理由见架构文档第 1 节。
- **不要把密钥写进 `storage.sync`。** 只能进 `local:credentials`。
- **不要引入任何统计、埋点、遥测、崩溃上报。** 隐私承诺是产品定位。
- **不要新增自建服务器依赖。**
- **不要吞掉错误。** 一律转成 `TranslationError` 并让用户看到可读原因。
- **注释里不要出现 `*/` 字符序列**（例如 match pattern `*://*/*`），会提前终止块注释。改写成"全站权限"之类的说法。
- 不要用 `console.log`（lint 会报警），需要日志用 `console.warn` / `console.error`。

## 约定

- 严格 TS：`strict` + `noUncheckedIndexedAccess`。数组下标返回 `T | undefined`，必须显式处理，不要用 `!` 绕过。
- 类型导入用 `import type`（`verbatimModuleSyntax` 已开）。
- 扩展 API 从 `#imports` 导入 `browser` / `storage`，不要用全局 `chrome`。
- 新增引擎必须同时改 4 个文件（`ids.ts` / `meta.ts` / 实现 / `registry.ts`）并补单测，规范见 `docs/research/translation-engines.md` 第 4 节。
- 引擎只负责"一次请求怎么发、响应怎么解析"；缓存、分批、限流、重试、降级、熔断都在 `TranslateService`，不要在引擎里重复实现。
- 引擎必须校验"返回条数 == 请求条数"，不一致抛 `BAD_RESPONSE`。译文错位比翻译失败更糟。
- MV2/MV3 差异用 `import.meta.env.MANIFEST_VERSION` 判断，并把分支收敛在 `injector.ts` / `auto-translate.ts` 里。
- 内容脚本的初始化必须幂等（可能被重复注入）。
- 修改设置结构要同步升级 `settingsStorage` 的 `version` 并提供迁移。

## 测试要求

- 纯逻辑（引擎、编排、DOM 遍历、渲染、限流、规则匹配）必须有单测，测试与源码同目录，命名 `*.test.ts`。
- 引擎测试用 `src/testing/fake-fetch.ts` 注入假 fetch，**不要发真实网络请求**。
- 但假 fetch 有个盲区：**端点被下线了单测照样全绿**（已经发生过一次）。因此改引擎必须另外跑 `npm run test:live`，它打真实接口，用例写在 `src/engines/*.live.ts`。
- DOM 相关测试跑在 jsdom 下，用真实 DOM 断言，不要 mock DOM。
- 修 bug 时先写能复现的测试，再改实现。

## 提交与 PR

- Conventional Commits，scope 取值见 `commitlint.config.js`，例：`feat(engines): 接入 DeepL 引擎`。
- 提交前 `npm run verify` 必须全绿；pre-commit 钩子会跑 lint-staged。
- 改了权限、引擎清单、存储结构，必须在同一个 PR 里更新对应文档（ADR / 架构 / 引擎调研）。
- 重大技术选择写成 `docs/decisions/NNNN-*.md`，不要只写在 PR 描述里。
