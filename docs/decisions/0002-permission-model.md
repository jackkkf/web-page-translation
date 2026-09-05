# ADR-0002：最小权限模型

- 状态：已采纳
- 日期：2026-09-05

## 背景

网页翻译扩展天然需要读取任意网页的内容。行业惯例是在 manifest 里静态声明：

```json
"content_scripts": [{ "matches": ["<all_urls>"], "js": ["content.js"] }]
```

这带来三个问题：

1. **安装劝退**：Chrome 安装时提示"读取和更改您在所访问网站上的所有数据"，是转化率的主要流失点
2. **审查变慢**：Chrome Web Store 对广泛 host 权限会触发深度人工审查，从数天变成数周
3. **隐私叙事不可信**：即便我们不上传任何数据，用户和审查员也只能靠"相信"

## 决策

**默认零网页权限**：内容脚本不写进 manifest，靠 `activeTab` 在用户操作时按需注入；自动翻译作为可选功能，全站权限在用户开启时才申请，关闭时主动撤回。

### 权限清单

```
permissions:            storage, activeTab, scripting, contextMenus   （MV2 无 scripting）
host_permissions:       仅 4 个翻译接口域名，不含任何网页域名
optional_host_permissions: *://*/*   （仅自动翻译使用；MV2 为 optional_permissions）
content_scripts:        无
```

### 三条注入路径

| 场景                     | 机制                                                  | 需要的权限          |
| ------------------------ | ----------------------------------------------------- | ------------------- |
| 点击图标 / 快捷键 / 右键 | `scripting.executeScript` 注入内容脚本                | `activeTab`（临时） |
| 开启全局自动翻译         | `scripting.registerContentScripts` 动态注册 `*://*/*` | 用户授予的可选权限  |
| 站点规则「始终翻译」     | 同上，但 `matches` 只含该域名                         | 该域名的可选权限    |

实现见 `src/background/injector.ts`（按需注入）与 `src/background/auto-translate.ts`（动态注册）。

WXT 上的关键细节：内容脚本声明为 `registration: 'runtime'` **且不写 `matches`**。如果写了 `matches`，WXT 会把它加进 `host_permissions`，最小权限就白做了。

### 为什么所有网络请求都走 background

不只是架构洁癖，是权限模型的必然结果：

- 内容脚本运行在页面源下，跨域请求受 CORS 约束；翻译接口不一定给我们放开 CORS
- background 拿到 `host_permissions` 后不受 CORS 限制
- 密钥只存在于 background，永不进入页面上下文，页面脚本无法窃取

## 后果

**好处**

- 安装时无"读取所有网站数据"提示
- 商店审查里"为什么需要这个权限"的回答非常干净：默认不需要，用户主动开启才申请
- 隐私承诺可验证：manifest 里就没有网页域名

**代价**

- 不能在页面加载瞬间就翻译（除非用户开了自动翻译），首次翻译多一次注入延迟（约 50–150ms）
- 注入与动态注册两条路径都要维护，MV2/MV3 API 不同（`tabs.executeScript` vs `scripting`）
- 浏览器特权页（商店、`about:`、`chrome://`）注入必然失败，需要在 UI 里给出明确提示而不是静默失败
- 自动翻译的权限请求必须由用户手势触发，只能放在选项页的开关上，不能在 popup 里顺手申请

## 商店权限说明（提交时直接使用）

- **activeTab**：用户点击扩展图标、使用快捷键或右键菜单时，才读取当前标签页的文本内容用于翻译。未触发时扩展不在任何页面运行、不读取任何数据。
- **scripting**：用于在上述用户操作后向当前标签页注入翻译脚本。
- **storage**：保存用户的引擎、语言、样式偏好、站点规则与本地翻译缓存。全部保存在本机，不上传。
- **contextMenus**：提供右键菜单「翻译/还原此页面」。
- **host_permissions**（4 个翻译服务域名）：向所选翻译服务发送待翻译文本并接收译文。这是扩展唯一的对外网络请求目标。
- **optional_host_permissions**：仅当用户主动开启「自动翻译」或添加「始终翻译」站点规则时才请求；关闭开关会主动撤回。
