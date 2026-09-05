# 架构说明

## 1. 三个运行上下文

浏览器扩展的一切设计都受这三个上下文的能力差异约束：

```
┌─────────────────────┐   ┌──────────────────────┐   ┌────────────────────┐
│ 内容脚本            │   │ background           │   │ 扩展页面           │
│ (页面 DOM 上下文)   │   │ (SW / 事件页)        │   │ (popup / 选项页)   │
├─────────────────────┤   ├──────────────────────┤   ├────────────────────┤
│ 能操作 DOM          │   │ 不能碰 DOM           │   │ 独立的自有页面     │
│ 受页面 CORS 限制    │   │ 有 host 权限，无 CORS │   │ 有扩展 API         │
│ 按需注入            │   │ 随时可能被回收       │   │ 用户打开时才存在   │
└─────────────────────┘   └──────────────────────┘   └────────────────────┘
        │                          ▲                          │
        │  translateBatch          │                          │
        └──────────────────────────┤                          │
                                   │  ensureContentScript     │
                                   └──────────────────────────┘
                                   │  runPageCommand (带 tabId)
        ◄──────────────────────────────────────────────────────┘
```

**三条硬性约束**，代码里的很多写法都是为了满足它们：

1. **所有网络请求只在 background 发起。** 内容脚本受 CORS 限制且不该接触密钥。
2. **MV3 的 service worker 随时被回收。** 消息监听器必须在顶层同步注册；任何内存态（缓存、token）都要能从 storage 重建。
3. **内容脚本可能被重复注入。** 所有初始化必须幂等（`entrypoints/translate.content.ts` 里的 `INJECTED_FLAG`、`injectContentStyle` 的 id 检查）。

## 2. 目录结构

```
entrypoints/                  扩展入口（WXT 按文件名生成 manifest）
  background.ts               消息路由、右键菜单、快捷键、动态注册
  translate.content.ts        内容脚本入口（registration: 'runtime'，不写进 manifest）
  popup/                      点击图标的弹窗（React）
  options/                    选项页（React）

src/
  core/                       与浏览器 API 弱耦合的通用能力
    types.ts                  领域类型
    errors.ts                 TranslationError + 错误码 → 是否可重试/可降级/用户文案
    languages.ts              语言清单与代码归一化
    settings.ts               设置与密钥的存储 schema、站点规则匹配
    messaging.ts              类型安全的消息 protocol map（收发两端唯一真相）
    cache.ts                  内存 LRU + 防抖持久化
    limiter.ts                并发 + 最小间隔限流、指数退避
    hash.ts                   cyrb53（仅用于缓存 key）
  engines/                    翻译引擎适配层
    ids.ts                    EngineId + 所需域名（wxt.config.ts 也读这个文件）
    meta.ts                   展示用元数据（UI 只导入这个，不拖进实现）
    types.ts                  TranslationEngine 接口与限流约束
    http.ts                   统一请求封装：超时、状态码 → 错误码
    bing-free.ts / google-free.ts / baidu.ts
    registry.ts               引擎注册表
  background/
    translate-service.ts      编排：缓存 → 分批 → 限流 → 重试 → 降级 → 熔断
    injector.ts               按需注入内容脚本（MV2/MV3 分支）
    auto-translate.ts         自动翻译的动态脚本注册
  content/
    dom-walker.ts             收集可翻译段落
    renderer.ts               译文注入与还原
    styles.ts                 内联样式字符串
    page-translator.ts        页面翻译状态机（视口调度 + 变更监听）
  ui/hooks.ts                 React 侧的设置读写
  testing/fake-fetch.ts       测试用假 fetch

docs/                         调研、决策记录、规划、上架材料
```

**分层原则**：`src/` 里的逻辑不依赖 WXT 的入口约定，只有 `entrypoints/` 依赖。这样即使将来换构建框架，核心逻辑不用重写。

## 3. 一次整页翻译的完整链路

```
用户点击图标
  → popup 打开（此刻 activeTab 权限生效）
  → popup 发 ensureContentScript → background 先 ping，未响应则 executeScript 注入
  → popup 发 runPageCommand{toggle} 到该 tab
  → PageTranslator#start
      ├─ 读设置、注入样式、建 renderer
      ├─ collectUnits(document.body) 收集段落
      ├─ IntersectionObserver 观察每个段落容器（rootMargin 600px）
      └─ MutationObserver 监听后续 DOM 变更
  → 段落进入视口
      → 入队，60ms 合批，每批最多 20 段
      → 标记「翻译中…」占位
      → sendMessage translateBatch → background
          ├─ 逐条查缓存，命中的直接返回
          ├─ chunkByLimits 按引擎的条数/字符上限切批
          ├─ RateLimiter 控并发与最小间隔
          ├─ 引擎请求，可重试错误退避重试（最多 3 次尝试）
          ├─ 失败的部分交给降级引擎再试一轮
          └─ 成功结果写缓存
      → 逐段 resolve（插入译文）或 reject（原位显示原因）
  → 队列清空 → phase = 'translated'
```

## 4. 关键设计取舍

### 4.1 为什么按「块级容器」而不是「文本节点」分组

`<p>Hello <b>brave</b> <i>world</i>!</p>` 有 5 个文本节点。逐节点翻译会得到 5 段无上下文的碎片，译文质量差且插入位置混乱。

做法：向上找到最近的非行内祖先作为容器，把同容器下连续的文本节点合并成一个单元，拼接时**不补空格**（文本节点自带的空白就是用户看到的间距），并保留标点和纯空白节点 —— 丢掉空白会把 `<b>brave</b> <i>world</i>` 粘成 `braveworld`。

单元字符数上限 1200，超出就在文本节点边界处拆开，保证批次可控。

### 4.2 为什么译文用 `<span>` + `display: block`

在 `<p>` 里插 `<div>` 是非法嵌套，虽然浏览器容错，但会影响某些站点的 CSS 选择器和布局。统一用 `<span>`，靠 class 控制 `display`。

所有插入节点带 `data-litetrans` 属性：既是还原时的抓手，也让 `dom-walker` 能跳过它们，避免翻译自己的译文。

### 4.3 为什么缓存 key 必须包含引擎 ID

否则切换引擎后会读到上一个引擎的译文，用户会以为切换没生效。代价是切引擎后缓存需要重建，这是正确的行为（有单测覆盖）。

### 4.4 为什么需要熔断而不只是降级

只有降级的话，主引擎不可用时每一批都要先失败一轮（含 2 次退避重试）再降级，用户感受到的是"很慢"。连续失败 3 次后熔断 60 秒，期间直接走降级，窗口过后放行一次探测请求。

### 4.5 为什么引擎要声明 `limits` 而不是统一批大小

三个引擎的约束完全不同：微软支持 25 条真批量；谷歌一次只能一条且 URL 长度受限；百度标准版 QPS=1 但不限字符量。让引擎自己声明约束，`TranslateService` 按声明切批和限流，新增引擎时上层不用改。

### 4.6 错误处理的分类

`TranslationError` 的错误码同时决定三件事：

| 错误码                 | 可重试 | 可降级 | 用户文案                   |
| ---------------------- | ------ | ------ | -------------------------- |
| `NETWORK` `TIMEOUT`    | ✅     | ✅     | 网络请求失败 / 请求超时    |
| `RATE_LIMIT`           | ✅     | ✅     | 请求过于频繁，已被引擎限流 |
| `BAD_RESPONSE`         | ✅     | ✅     | 引擎返回了无法解析的内容   |
| `AUTH` `QUOTA`         | ❌     | ✅     | 鉴权失败 / 免费额度已用尽  |
| `MISSING_CREDENTIALS`  | ❌     | ✅     | 该引擎需要先填写密钥       |
| `UNSUPPORTED_LANGUAGE` | ❌     | ✅     | 不支持所选语言方向         |
| `ABORTED`              | ❌     | ❌     | 翻译已取消（不计入熔断）   |

原则：**错误绝不静默吞掉**。失败的段落在原位显示原因，popup 同步展示。

## 5. 数据存储

| Key                      | 区域          | 内容                                 | 说明                   |
| ------------------------ | ------------- | ------------------------------------ | ---------------------- |
| `local:settings`         | storage.local | 引擎、语言、样式、站点规则、缓存配置 | 带 version，支持迁移   |
| `local:credentials`      | storage.local | 百度 APPID/密钥                      | **绝不放 sync**        |
| `local:translationCache` | storage.local | 译文缓存                             | 防抖 2s 写盘，LRU 淘汰 |

密钥放 `local` 而非 `sync` 是刻意的：`storage.sync` 会同步到浏览器账号，等于把密钥交给第三方同步链路。

## 6. 已知限制

| 限制                                     | 说明与后续计划                                 |
| ---------------------------------------- | ---------------------------------------------- |
| 不翻译 iframe 内的内容                   | 需要 `allFrames` 注入，v0.2 处理               |
| 不翻译 `title` / `alt` / `placeholder`   | v0.2 处理                                      |
| 不处理 Shadow DOM 内的内容               | 需要递归穿透 shadow root，v0.2 处理            |
| 「仅显示译文」模式下不保留富文本结构     | 整段译文写入首个文本节点，行内标签的样式会丢失 |
| CJK 语言检测是字符集启发式，无法区分简繁 | 简繁互译需要显式指定源语言                     |
| 浏览器特权页无法翻译                     | 平台限制，UI 已给出提示                        |
