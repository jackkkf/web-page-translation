# 翻译引擎调研

> 最后核实：2026-09-06，用 `npm run test:live` 打真实端点验证过。
>
> 免费接口都是非官方端点，**随时可能变更或下线**。这是选型前提，不是意外 ——
> 第 2 节记录的两个"已下线"就是本项目开发首日踩到的。改动引擎前先跑一遍 `npm run test:live`。

## 1. 首期接入的三个引擎

| 引擎                   | 需密钥 | 批量        | 免费额度            | 中国大陆直连  | 首期角色 |
| ---------------------- | ------ | ----------- | ------------------- | ------------- | -------- |
| 必应翻译（网页版免费） | 否     | ✅ 换行分段 | 未公开，无硬额度    | ✅            | 默认引擎 |
| 谷歌翻译（免费端点）   | 否     | ❌ 一次一段 | 未公开，无硬额度    | ❌ 通常需代理 | 降级引擎 |
| 百度翻译（官方 API）   | 是     | ✅ 换行分段 | 标准版不限量，QPS=1 | ✅            | 可选     |

### 1.1 必应翻译（默认引擎）

必应翻译网页版用的接口。凭据藏在 translator 页面的内联脚本里，所以要先抓页面再翻译：

```
GET  https://www.bing.com/translator
     → 从 HTML 正则提取三样东西：
       IG:"..."                                         埋点标识，接口会校验
       data-iid="translator.5023"                       埋点标识
       params_AbusePreventionHelper = [key, token, ttl]  防滥用令牌，ttl 实测 3600000（1 小时）

POST https://www.bing.com/ttranslatev3?isVertical=1&IG=<ig>&IID=<iid>
     Content-Type: application/x-www-form-urlencoded
     fromLang=auto-detect&text=hello%0Aworld&to=zh-Hans&token=<token>&key=<key>
     → [{"translations":[{"text":"你好\n世界","to":"zh-Hans","transliteration":{…}}],
         "usedLLM":true,"detectedLanguage":{"language":"en","score":1}}]
```

**选它当默认引擎的理由**：国内外网络都能直连、无需密钥、支持伪批量，而且在微软下线 Edge 匿名 token 端点后它仍然活着。

**三个必须知道的坑**，都由实测确认，对应的断言在 `bing-free.test.ts`：

1. **错误不在 HTTP 状态码上，而在 200 响应体里。** 令牌失效返回 `200 {"statusCode":205}`，语言不支持返回 `200 {"statusCode":400}`。只看状态码会把鉴权失败误判成"返回结构异常"，于是傻等重试而不是去刷新令牌。成功响应是数组、失败是对象，靠这个区分。

2. **翻译请求的 User-Agent 会被校验。** 非浏览器 UA 直接拿到 `401 {"ShowCaptcha":false}`；有意思的是抓页面那一步的 UA 反而不影响。扩展里无需处理 —— background 的 fetch 自带真实浏览器 UA，且 `User-Agent` 本就是禁止改写的 header。但在 Node 里跑探活必须手动补上，否则测的是 UA 拦截而不是接口本身。

3. **批量是"换行拼接"的伪批量，不是接口契约。** 传多个 `text` 字段只会返回第一个的结果。用 `\n` 拼接则换行会被保留（实测 3/5/8/12 段各 3 轮，行数全部一致），但这是模型行为而非承诺，随时可能变。因此 `maxTextsPerRequest` 保守取 10，并且**必须校验行数**，不一致抛 `BAD_RESPONSE` 交给编排层重试或降级。

**其他实现要点**（`src/engines/bing-free.ts`）：凭据按 `ttl - 60s` 缓存并做 in-flight 去重；令牌失效（205）时重新抓页面重试一次；语言代码映射 `zh-CN → zh-Hans`、`zh-TW → zh-Hant`。

### 1.2 谷歌翻译（降级引擎）

谷歌翻译网页版使用的端点，加 `dj=1` 可以拿到结构化 JSON 而不是嵌套数组：

```
GET https://translate.google.com/translate_a/single?client=gtx&dj=1&dt=t&sl=auto&tl=zh-CN&q=hello
    → {"sentences":[{"trans":"你好","orig":"hello"}],"src":"en"}
```

**注意 host 是 `translate.google.com`，不是 `translate.googleapis.com`。** 后者下的同一路径现在返回 404（2026-09-06 实测），网上多数教程还写着旧域名。

**限制**（决定了它只能当降级）：

- 无批量能力，一次一段，段落多时请求数爆炸
- GET 传参，URL 长度受限，字符预算只能给到 ~1500
- 中国大陆网络通常不可直连
- 请求过快会 302 到 `google.com/sorry` 触发验证码，必须限并发

**实现要点**：长文本会被拆成多个 `sentences`，必须按序拼回；`he → iw` 等历史语言代码要映射。

### 1.3 百度翻译（可选，需用户自备密钥）

唯一有官方文档和 SLA 的选项，适合国内网络且介意稳定性的用户。

```
POST https://fanyi-api.baidu.com/api/trans/vip/translate
     appid, q, from, to, salt, sign
     sign = md5(appid + q + salt + 密钥)
```

**版本与额度**（截至 2026-09）：

| 版本   | 认证要求 | QPS | 额度                                 |
| ------ | -------- | --- | ------------------------------------ |
| 标准版 | 无       | 1   | 不限字符量，免费                     |
| 高级版 | 个人认证 | 10  | 每月 200 万字符免费，超出 49 元/百万 |
| 尊享版 | 企业认证 | 100 | 同上                                 |

**实现要点**（`src/engines/baidu.ts`）：

- 批量机制是把多段用 `\n` 拼进一个 `q`，接口按行返回 `trans_result`
- **必须先把段内换行压成空格**，否则行数错位，译文会串段（已有单测覆盖）
- 标准版 QPS=1 → 限流器设 `concurrency: 1, minIntervalMs: 1100`
- 错误码要映射成语义化错误：`54003` 限流、`54004` 余额不足、`54001` 签名错误、`58001` 语言不支持
- 密钥只存 `storage.local`，不进浏览器账号同步

## 2. 已下线的端点（不要再用）

| 端点                                                           | 状态            | 说明                                                                                                                                  |
| -------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `https://edge.microsoft.com/translate/auth`                    | **404，已下线** | 微软在 2026-07-30 起停止对 Edge 136 以下版本的翻译支持，同时撤下了这个匿名 token 端点。曾是本项目的默认引擎，现已替换为必应网页版接口 |
| `https://api-edge.cognitive.microsofttranslator.com/translate` | 存活但要密钥    | 无 token 返回 `401001`。等价能力现在只能走官方 Azure Translator（需订阅密钥 + 区域）                                                  |
| `https://translate.googleapis.com/translate_a/single`          | **404，已下线** | 换用 `translate.google.com` 下的同一路径                                                                                              |

同期受影响的开源项目（可作为端点变更的预警信号）：`bing-translate-api`、`Ebook-Translator-Calibre-Plugin`、`TranslationPlugin`。

**教训**：普通单测注入假 fetch，端点死了照样全绿。因此加了 `npm run test:live` 打真实端点，改引擎前后都要跑。

## 3. 评估过但首期不接的引擎

| 引擎                    | 不接的原因                                                                |
| ----------------------- | ------------------------------------------------------------------------- |
| Azure Translator 官方版 | 需订阅密钥；作为必应免费接口失效后的兜底方案，优先级见路线图 v0.3         |
| DeepL 免费 API          | 需密钥且要绑卡；免费版 50 万字符/月；非官方端点风险高。放 v0.3 让用户自填 |
| 腾讯 / 阿里 / 火山      | 均需密钥 + 实名，签名比百度复杂（HMAC-SHA256 + 规范化请求），收益不成正比 |
| 有道                    | 需密钥，额度小                                                            |
| OpenAI / Gemini 等      | 质量最好但需用户自备 Key 且按量付费；属于 v0.3「自定义 API」的一部分      |
| MyMemory                | 免费但限流严格、质量差，不值得占一个引擎位                                |
| LibreTranslate          | 可自托管，质量偏弱；作为 v0.3 自定义 API 的一个示例配置即可               |

## 4. 依赖非官方接口的风险与对策

这是本项目最大的技术风险，必须显式管理：

| 风险                       | 对策                                                                           |
| -------------------------- | ------------------------------------------------------------------------------ |
| 端点变更或下线             | 引擎适配层隔离，改一个文件即可；`npm run test:live` 负责及早发现               |
| 触发限流 / IP 封禁         | 按引擎的 `concurrency` + `minIntervalMs` 限流；翻译缓存减少重复请求            |
| 单引擎不可用               | 主引擎失败自动降级到备用引擎；连续失败 3 次熔断 60 秒，避免每次都白等一轮      |
| 无声失败                   | 错误不吞：在段落原位显示可读原因，popup 同步展示                               |
| 商店以"依赖未公开接口"质疑 | 商店文案说明"使用浏览器厂商公开可访问的翻译服务"，并提供自备密钥的官方引擎选项 |

**必须避免的做法**：不自建中转服务器。一旦经过我们的服务器，就从"不接触用户数据"变成"需要隐私政策承诺 + 承担合规责任"，且服务器会成为被封禁的单点。

## 5. 引擎接入规范

新增引擎只改这几个地方，其他层不动：

1. `src/engines/ids.ts` —— 登记 `EngineId` 与所需域名（域名会被 `wxt.config.ts` 用于生成 `host_permissions`）
2. `scripts/check-manifest.mjs` —— 同步域名白名单，否则权限守卫会失败
3. `src/engines/meta.ts` —— 补充展示用元数据
4. `src/engines/<name>.ts` —— 实现 `TranslationEngine`
5. `src/engines/registry.ts` —— 注册

必须同时提供的单测（参考 `bing-free.test.ts`）：

- 正常批量翻译，断言请求 URL / body 与语言代码映射
- 返回条数与请求不一致时抛 `BAD_RESPONSE`（防译文错位）
- 该引擎特有错误码 → 内部错误码的映射，**包括藏在 200 响应体里的错误**
- 需要密钥的引擎：缺密钥时不发请求
- 上游改版导致解析失败时，错误信息要能指出"接口可能已变更"

另外在 `src/engines/engines.live.ts` 补一条真实网络的探活用例。
