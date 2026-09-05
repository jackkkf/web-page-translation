# ADR-0001：技术栈选型

- 状态：已采纳
- 日期：2026-09-05

## 背景

新建一个跨 Chrome / Edge / Firefox 的网页翻译扩展，需要在 2026 年的生态里选一套框架与工程栈。约束：

- 一套代码出三个商店产物（Chrome MV3、Edge MV3、Firefox）
- 需要长期维护，框架自身不能是风险点
- 大量代码由 AI 辅助生成，工程栈必须能快速给出确定性反馈（类型、lint、测试）

## 决策

**WXT 0.21 + React 19 + TypeScript（strict）+ Vitest + ESLint 9 + Prettier**

## 框架选型对比

| 维度           | WXT           | Plasmo         | CRXJS          | 手写 MV3     |
| -------------- | ------------- | -------------- | -------------- | ------------ |
| 构建器         | Vite          | Parcel（定制） | Vite           | 自己搭       |
| 跨浏览器构建   | **一等公民**  | 以 Chrome 为主 | 以 Chrome 为主 | 全手工       |
| MV3 → MV2 转换 | **自动**      | 不支持         | 不支持         | 手工维护两份 |
| 维护活跃度     | 活跃          | 放缓           | 不确定         | —            |
| 产物体积       | 最小          | 约 2 倍        | 中             | 取决于实现   |
| UI 框架绑定    | 无（都支持）  | React 优先     | 无             | 无           |
| 学习曲线       | 中（类 Nuxt） | 低             | 中             | 高           |

**选 WXT 的决定性理由**：需求第 2 条要求支持火狐。WXT 能用同一份 MV3 源码自动产出 Firefox 的 MV2 manifest（`action → browser_action`、`host_permissions` 合并进 `permissions`），这件事其他方案都要手工维护两套配置。已验证：`npm run build:all` 产出三份 manifest，权限差异全部由 `wxt.config.ts` 里一个函数表达。

**没选 Plasmo**：它唯一的独门优势是 CSUI（往页面注入 React 组件 + Shadow DOM）。我们的译文是直接插入页面 DOM 的轻量 `<span>`，不需要 React 也不需要样式隔离，用不上这个优势；而它的维护放缓和产物体积是实打实的成本。

**没选手写 MV3**：省下的是抽象层，付出的是三套 manifest、HMR、打包配置的长期维护，不划算。

## 其他决策及理由

| 选择                                           | 理由                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| React 19                                       | 生态与 AI 训练数据最充分；UI 只有 popup 和选项页两个页面，框架成本可控                     |
| TypeScript strict + `noUncheckedIndexedAccess` | 解析外部接口响应时数组下标必然可能越界，让类型系统强制处理，而不是靠人记得                 |
| `@webext-core/messaging`                       | 类型安全的消息通道，protocol map 一处定义，收发两端都有类型；WXT 官方推荐                  |
| Vitest + `WxtVitest`                           | 自带内存版 `browser` API（`fakeBrowser`），存储、消息都不用手写 mock                       |
| jsdom                                          | DOM 遍历与译文注入是本项目最容易出错的部分，必须能在单测里跑真实 DOM                       |
| 自己实现 LRU 缓存                              | 需要"内存 LRU + 防抖持久化到 storage.local"这套特定组合，现成库都不完全匹配，且要控制体积  |
| `js-md5`                                       | 百度签名需要 MD5，Web Crypto 不提供；成熟零依赖库比手写摘要算法安全                        |
| 不用 CSS 框架                                  | 两个小页面，原生 CSS + 变量足够，还能顺手支持深色模式；引 Tailwind 反而要处理 rem 隔离问题 |

## 后果

**好处**

- 一条命令出三份商店产物，权限差异集中在一处表达
- 引擎层可在 Node 环境完整单测（注入假 fetch），不需要真发网络请求
- AI 改动有三道确定性关卡：`tsc` → `eslint` → `vitest`

**代价与风险**

- 绑定 WXT 的目录约定与虚拟模块（`#imports`）；若 WXT 停止维护，迁移成本主要在 entrypoints 和构建配置，`src/` 下的核心逻辑不受影响（这也是把逻辑放 `src/` 而不是塞进 entrypoints 的原因）
- Firefox 走 MV2：AMO 仍接受，但需关注 Mozilla 的 MV3 迁移时间表（见 ADR-0003）

## 参考

- WXT 文档：https://wxt.dev
- 2026 年扩展框架对比：https://blog.extenshi.io/posts/extension-frameworks-compared-2026/
- KISS Translator（开源同类实现）：https://github.com/fishjar/kiss-translator
