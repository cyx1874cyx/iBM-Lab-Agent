# 上游浏览器侧栏 vs 本项目文献浏览器：可行性与取舍

> 问题：DSH 0.1.7 自带 `@deepseek-ai/dsh-client-ui-sidebar-browser`，
> 本项目自制的软件内浏览器是否可以删掉，文献获取逻辑能否搬进去？
>
> 结论基于对 0.1.7-rc.1 发行物的实测（包内 `lib/client.js`、`lib/types`、README、
> `dsh-web-app/cordis.patch.yml`）与本仓库现有采集链路代码。未做真机运行。

## 结论

**查看（阅读）层可以交给上游；文献获取逻辑不能放进去 —— 有四道各自独立的阻断。**

而且有一个反直觉的结果：**在本项目的桌面端（Tauri），上游浏览器比你现在自制的更弱**，
因为上游的桌面载体是 Electron，而 Tauri 不满足它的宿主契约。

---

## 1. 上游浏览器到底是什么

| 项 | 实测事实 | 证据 |
|---|---|---|
| 载体选择 | `const carrier = globalThis.dshDesktop; const desktop = carrier?.protocolVersion === 1 ? carrier.browser : void 0;` → `if (desktop === void 0) installFrames(ctx, () => createIframePage)` | `lib/client.js`（`apply()` 内） |
| 桌面载体 | Electron `<webview>`，需要 **`globalThis.dshDesktop.protocolVersion === 1`** 的桌面 preload 契约 | 同上 + README |
| Web 载体 | iframe，`sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"` | README |
| 默认开关 | `- id: ui-sidebar-browser` / `disabled: !!js "ctx.get('profileContext')?.name !== 'desktop'"` | `dsh-web-app/cordis.patch.yml:253-255` |
| 开放给插件的 API | 仅客户端 `ctx.sidebarRight.openTab('browser', { params: { url } })` | README + `lib/types/client/index.d.ts` |
| 模型面 | **"Model Experience: None"** —— 不注册任何 tool / prompt section / Session event | README |
| 宿主服务 | **"No companion is published."** —— 没有可供插件调用的 host 服务 | README（Runtime invariant） |
| inject 面 | `slots` / `locale` / `sidebarRight` / `sidebarRightTabs`（全是 UI 面） | `lib/client.js` |

**关键点：上游浏览器是一个纯 UI 组件。** 它没有 host 服务、没有工具、没有事件，
插件能做的只是「让它在某个 tab 里打开一个 URL」。

### 1.1 在本项目 profile 下它甚至默认是关的

上游的开关条件是 profile 名等于 `desktop`；本项目用的是 `ibm-lab` profile
（`src/ibm-lab-profile.js` `IBM_LAB_PROFILE = "ibm-lab"`），所以该行**默认 disabled**。
要用就得在自己的补丁层 override 这一行。

即便 override 打开，在 Tauri 壳里 `globalThis.dshDesktop` 不存在
（那是 DSH Electron 桌面的 preload 契约），于是**落到 iframe 载体** ——
拿不到 Electron 的原生历史与保留页。

---

## 2. 为什么文献获取放不进去：四道独立阻断

任何一道单独成立就足以否决，以下是四道。

### 阻断 1（最硬）：采集依赖扩展宿主，上游不是扩展宿主

本项目当前的采集链路（`lib/capture-handoff.js` 头注释原文）已经踩过同一个坑：

> 「Tauri WebView2 不是 Edge/Chrome 扩展宿主，Content Script 不会注入 WebView2。」

因此现有设计是：**外部 Edge**（装扩展）→ 本地 handoff 页
`http://127.0.0.1:<port>/lab/capture/?taskId=…#t=<token>` → Content Script `ARM_CAPTURE`
→ 跳转 DOI/出版社页 → 用户登录并下载 → 扩展监听 `chrome.downloads`
→ Native Messaging / PUT 上传 → `lib/manual-capture.js` 校验登记。

扩展需要的权限（`browser-extension/ibm-literature-capture/manifest.json`）：
`["downloads", "storage", "nativeMessaging"]`。

上游浏览器的两种载体**都不是 Chromium 扩展宿主**：Electron webview 不是，
sandboxed iframe 更不是。换内核不解决问题 —— **问题从来不是渲染引擎，而是扩展宿主**。

### 阻断 2：`all_frames: false` —— handoff 页必须是顶层标签

本仓库的 `manifest.json`：

```json
"content_scripts": [{
  "matches": ["http://127.0.0.1/lab/capture/*", "http://localhost/lab/capture/*"],
  "js": ["content.js"], "run_at": "document_start",
  "all_frames": false
}]
```

`all_frames: false` 意味着 Content Script **只在顶层 frame 注入**。
上游浏览器 tab 的正文是 iframe —— 那么**即使把它开在一个装了扩展的真实浏览器里，
handoff 页也拿不到 Content Script**，布防（`ARM_CAPTURE`）不可能完成。

这一条是纯静态可验证的，与内核无关。

### 阻断 3：上游明确不代理、不探测、不给下载

README 原文：

- **"The package does not proxy or probe remote pages."** → WebVPN / iWAN 无从接入。
- 默认 sandbox **"has no direct download or top-navigation flag"**。
- Desktop：**"Guest permissions, downloads and native popups are denied"**。
- **"a later iframe load reveals that navigation occurred but not the new cross-origin URL"**
  → **读不到用户落在了哪个页面**，而 capture handoff 的下一步（对齐 DOI/出版社页）正需要它。
- **"Many sites refuse iframe embedding"** —— 出版社站点普遍 `X-Frame-Options` / CSP
  `frame-ancestors`，也就是 WebVPN 之后真正要看的那类站点，恰恰是最嵌不进来的。

### 阻断 4：没有模型面，Agent 无法驱动

采集流程里 Agent 要创建任务、读状态、推进状态机（`lib/manual-capture.js` 的
`armed → downloading → archived`）。上游浏览器 "register no tool, prompt section,
or Session event"，Agent 对它既看不见也控制不了。

> **注：** 取消 sandbox 的 tab 确实能用下载（README 承认），但这不改变结论 ——
> 页面无法观察自己的下载，跨域 iframe 也读不到对方 DOM，而真正做观察的扩展
> 又被阻断 1、2 挡住。

---

## 3. 可以删什么、必须留什么

### 可以交给上游（查看层）

| 现有实现 | 处理 |
|---|---|
| `client/src/webvpn-tab.js` 的 tab 类型注册与 guide 条目 | 可删（上游已提供 `browser` 类型） |
| `client/src/webvpn-bridge.js` 的**矩形上报**部分 | 可删（上游自己管 DOM 摆放） |
| Rust 侧「量矩形 → `postMessage` → `set_bounds`」几何链路 | 可删 |
| `webvpn_set_policy` 等载体策略桥 | 视情况 |

**但仅限**：站点允许 iframe、且只需要「看」。桌面端若还依赖
WebView2 专属 profile 的**登录态跨重启保持**，上游做不到
（README：Desktop "Cookies and Web storage do not survive application restart"）。

### 必须保留（采集层，与浏览器选型无关）

| 组件 | 作用 |
|---|---|
| `browser-extension/ibm-literature-capture/` | 扩展本体：`downloads` / `nativeMessaging` |
| `lib/capture-handoff.js` | handoff 页、一次性 token（URL fragment）、loopback 限定、Origin 校验 |
| `lib/manual-capture.js` | `PUT /api/lab-capture-upload`、`chrome-extension://` CORS 白名单、任务状态机 |
| `desktop/src-tauri/src/runtime/bridge.rs` | Native Messaging 宿主 |
| 外部 Edge 启动（`open_in_edge`） | 扩展宿主 |
| Rust 的 WebView2 专属 profile | 登录态保持 |

---

## 4. 分形态建议

| 形态 | 建议 |
|---|---|
| **Windows 桌面（Tauri）** | **保留自制的原生子 WebView** 作为「已认证的出版社/WebVPN 阅读面」。把上游浏览器 override 打开只会得到一个 sandboxed iframe，**是降级**。若想要通用网页查看，可**并存**：上游 `browser` tab 给普通公网页面，自制 tab 给 WebVPN/出版社。 |
| **Linux / 纯 Web** | 上游 iframe **是净增能力** —— 现在这里根本没有软件内浏览器（`webvpn-tab.js:94` 的文案就是「网页版请在新标签页打开」）。这里可以放心接入。 |
| **采集链路** | **完全不动**，继续走外部 Edge + 扩展 + handoff + Native Messaging。 |

### 要接入上游浏览器，最小改动

在自己的补丁层 override 那一行（否则在 `ibm-lab` profile 下是关的）：

```yaml
- id: ui-sidebar-browser
  name: '@deepseek-ai/dsh-client-ui-sidebar-browser'
  disabled: false
```

打开后由客户端调 `ctx.sidebarRight.openTab('browser', { params: { url } })`。

> 与迁移成本的关系：若只是「多一个可用 tab 类型」而不 import 它，
> 不影响 `check-preset-exports.mjs` 与 `build-client.mjs`；
> 若要在自己的客户端代码里复用它的 tab 类型/状态，则会给
> `package.json` 的 `dsh.client.inject` 增加一个依赖
> （参见 `DSH_0.1.7_RC1_MIGRATION_ASSESSMENT.md` §5/§6）。

---

## 5. 未验证项

1. **没有在 Tauri 壳里真机试过上游浏览器**。「Tauri 下落到 iframe」是从
   `globalThis.dshDesktop` 契约静态推出的，未运行验证。
2. 未验证 `profileContext.name` 在本项目 profile 下的实际取值
   （推断为 `ibm-lab`，故 `!== 'desktop'` 成立 → disabled）。
3. 未验证上游 iframe 在**已登录 WebVPN 的用户浏览器**里对出版社站点的实际嵌入成功率
   （README 只说「很多站点拒绝」，未给比例）。
4. 未评估「取消 sandbox」的 tab 在本项目场景下的实际可用性
   （README 自己警告未 sandbox 的页面可导航顶层应用）。
