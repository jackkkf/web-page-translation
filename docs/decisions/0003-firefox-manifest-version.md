# ADR-0003：Firefox 使用 MV2

- 状态：已采纳（需在 2027 年前复审）
- 日期：2026-09-05

## 背景

Chrome / Edge 只接受 MV3。Firefox 同时支持 MV2 和 MV3，需要选一个。

关键差异：**Firefox MV3 把 `host_permissions` 当作可选权限**，安装时不授予，用户要在权限面板里逐项开启。而我们的 `host_permissions` 里放的是翻译接口域名 —— 如果安装后没有被授予，扩展会直接不可用，而用户完全不知道要去哪里开。

Firefox MV2 则把 host 权限合并进 `permissions`，安装时一次性授予。

## 决策

Firefox 目标产物为 **MV2**（WXT 的默认行为），Chrome / Edge 为 **MV3**。

源码统一按 MV3 风格写，由 WXT 自动转换：`action → browser_action`、`host_permissions` 合并进 `permissions`、`optional_host_permissions → optional_permissions`、service worker → 背景脚本。

代码里需要区分的地方通过 `import.meta.env.MANIFEST_VERSION` 判断，目前只有两处：

| 能力         | MV3                                | MV2                       |
| ------------ | ---------------------------------- | ------------------------- |
| 按需注入脚本 | `scripting.executeScript`          | `tabs.executeScript`      |
| 动态注册脚本 | `scripting.registerContentScripts` | `contentScripts.register` |

## 后果

**好处**：Firefox 上开箱可用，不会出现"装了但翻译不了"且无从排查的状况。

**代价与风险**

- 维护两套注入 API 分支（已封装在 `injector.ts` 与 `auto-translate.ts`，共约 30 行）
- MV2 背景页常驻，内存占用略高于 service worker
- **主要风险**：Mozilla 未来终止 MV2 支持。届时需要为 Firefox MV3 设计权限引导流程（首次使用时引导用户授予接口域名权限）

## 复审触发条件

出现以下任一情况就重新评估：

1. Mozilla 公布 MV2 的终止时间表
2. Firefox MV3 改为安装时授予 `host_permissions`
3. AMO 开始对新提交的 MV2 扩展设限
