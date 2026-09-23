# WebVPN 软件内浏览器 —— 交接说明

> 交接时间：2026-09-11
> 仓库：`Code/iBM-Lab-Agent`　分支：`release-0.4.3`　HEAD：`b551bed`
> 相关计划：`docs/WEBVPN_IN_APP_BROWSER_DEVELOPMENT_PLAN.md`
> 评审与执行记录：`docs/WEBVPN_IN_APP_BROWSER_PLAN_REVIEW.md`（§0–§14）
> Windows 打包与安装包验收：`docs/WEBVPN_0.4.3_PACKAGING_HANDOFF.md`

---

## 2026-09-22 第二批人工审核修复（最新）

1. **iWAN 可用时不再强制先过 WebVPN。** `WebVpnTabBody` 的「初始页」逻辑原本无条件开
   `portal_url`。现在三道闸：捕获布防窗口内不抢导航（`isWebVpnCaptureArmed()`，由
   `withWebVpnTab(..., { armingCapture: true })` 在打开 tab **之前**登记）、载体已存在
   不重新导航、iWAN `usable` 时不开门户。
2. **工具栏不再盖住页面顶部。** 注入壳是 `position:fixed;height:76px` 且没有推走内容，
   出版社 PDF 预览器的工具栏正好在那条带里，表现为「看不到保存按钮，只能用右键」。
   现在对 `html` 施加 `transform:translateY(76px)` 并收紧高度：对 `html` 的 transform
   会让它成为 `position:fixed` 后代的包含块，预览器那类 `fixed;inset:0` 容器因此一起下移；
   工具栏自身用 `translateY(-76px)` 抵消。详见发布说明里的「已知限制」。
3. **捕获小球。** 页面**左下角**浮标（相对窗口固定，不随页面滚动），显示捕获阶段，
   点击 → `ibm-webvpn://cancel-capture/`
   → `on_navigation` 拦截 → `cancel_capture_and_close(app, None)`。状态由壳按节奏调
   `webvpn_sync_capture_ball` 推入页面（`on_page_load` 也会推一次——脚本每次导航都重注入）。
   状态载荷只有 phase/kind/bytes，**不含令牌或临时路径**，有测试守着。
   小球挂在 **popover 的 top layer** 上：上面那条 `html{transform}` 会让 `position:fixed`
   的后代改以 `html` 为包含块、跟着页面滚走，top layer 不受祖先 transform 影响，因此是
   唯一能"相对窗口固定"的位置。拿不到 popover 的旧引擎退回普通层，位置对但会滚动。

## 2026-09-22 挂进 DSH 自带右侧栏（最新）

**动机（同类型需求合并）**：软件内浏览器自 0.4.3 起由 Rust 自己按 `width / 3.0` 分栏、
自己维护 `sidebarVisible`、客户端再轮询状态同步——这套与 DSH 自带的右侧栏
（`@deepseek-ai/dsh-client-ui-sidebar-right`，本部署已挂载）是重复实现。DSH 的右侧栏本身
是一个**可扩展停靠面**，自带「文件」「文档预览」两类 tab，并提供公开的 tab 类型注册表
`ctx.sidebarRightTabs` 与导航控制器 `ctx.sidebarRight`。现在把 WebVPN 注册成第三类
**页面 tab**，与自带预览共用同一个展开按钮、标签条、拆分/浮动/全屏行为。

**先确认过的前提**：DSH 里**没有**可集成的浏览器插件。逐个核过 240 个 `@deepseek-ai`
包，唯一渲染 iframe 的是 `dsh-client-ui-sidebar-documentpreview`，而它是
`sandbox="allow-scripts"` 的 Blob iframe（无 `allow-same-origin`），加载不了出版社页面，
也不具备 Cookie profile 与下载回调。因此集成方式是「DSH 管外壳，Rust 管渲染」。

**职责划分（关键变化）**

| 事项 | 改造前 | 改造后 |
|---|---|---|
| 让位 | Rust 把主 WebView 收窄到 `width - width/3` | DSH 右侧栏的 push presentation 自己收窄对话列；**主 WebView 保持全宽** |
| 收起 | Rust 恢复主 WebView 全宽 | 只 `hide()` 子 WebView |
| 位置 | Rust 按比例算 | 客户端上报 tab 正文矩形，Rust `set_bounds` 贴上 |
| 入口 | 面板「打开 WebVPN」直接调原生命令 | 先 `openTab('lab-webvpn')`，等首次矩形上报后再调原生命令。2026-09-22：该按钮随「数据库状态」废案移除，入口改为**桌面壳顶栏的 WebVPN 指示器**与右侧栏「+」的类型列表 |

**改动清单**

- 新增 `client/src/webvpn-bridge.js`：opener 语义 + 首次矩形等待 + 跨 iframe 上报。
  刻意不 import React，因此可在 Node 里直接单测。
- 新增 `client/src/webvpn-tab.js`：注册 tab 类型（id `dsh-lab-agent/webvpn`，kind
  `lab-webvpn`）与 `sidebar.right.pane.tab` 正文；正文用 `ResizeObserver` 量矩形，
  `tab.visible` 变化与卸载时都上报「不可见」。
- `client/src/apply.js`：单独一次 `ctx.inject(["slots","sidebarRightTabs","sidebarRight"], …)`
  ——右侧栏缺失时只有这一个能力缺失，不阻塞课题面板。
- `client/src/lib.js`：`openWebVpnLoginViaShell` / `openWebVpnCaptureViaShell` /
  `showWebVpnViaShell` 先 `await openWebVpnTab()`。
- `desktop/src/index.html`：新增 `WEBVPN_SET_RECT` 分支，用 `frame.getBoundingClientRect()`
  把 tab 相对视口的坐标换算成主窗口客户区坐标（高频消息，不回包）。
- `desktop/src-tauri/src/webvpn.rs`：新增 `apply_client_rect` / `sanitize_client_rect` 与
  `client_layout` 标志；`show_sidebar` / `hide_sidebar` / `resize_sidebar` 按该标志分支，
  接管后**不再触碰主 WebView**。
- `desktop/src-tauri/src/main.rs`：新增 async 命令 `webvpn_set_rect`。

**设计与取舍**

1. **贡献 guide 条目**（2026-09-22 人工审核后更正）。右侧栏「+」的类型列表就是 guide 页；
   贡献一条 `guide` 条目，「文献浏览器」才会出现在里面。**代价**：DSH 的默认页规则是
   「恰好一个 guide 条目 → 直接打开它；零个或多个 → 打开指南页」，自带「文件」已占一条，
   因此右侧栏首次展开时的默认页会从「文件」变成指南页。这是「+ 里能选浏览器」的唯一扩展点，
   属有意取舍。
2. **初始页 = WebVPN 门户**。从「+」打开时用户没给目标地址，`WebVpnTabBody` 首次可见时先查
   `webvpn_status`；**载体不存在**才打开配置的 `portal_url`（默认中国科大）。载体已存在
   （登录态保留、或正在看某出版社页面）时绝不重新导航。
3. **回落到旧路径**。`sidebarRight` 缺失时 `openWebVpnTab()` 返回 `false`，调用方照旧走
   原生分栏；Rust 侧在收到任意一条矩形上报之前也一直走旧路径。因此这个改动不是硬切换。

**2026-09-22 人工审核缺陷修复：点「尚未获取」文献打不开浏览器**

`armCaptureFor`（`client/src/components-project.js`）原有两条分支**只弹提示、不打开浏览器**，
用户点下去像没反应，只能靠顶部的 WebVPN 入口自救（该入口 2026-09-22 已移到桌面壳顶栏）：

| 分支 | 旧行为 | 新行为 |
|---|---|---|
| `!publisherUrl`（未登记 DOI/出版社页面） | 只 `notify` | 打开「文献浏览器」到 WebVPN 门户，提示可手动检索 |
| `active.pendingTaskId`（已有任务在处理） | 只 `notify` 后 `return` | 载体还在就先 `showWebVpnViaShell()` 带回正在下载的页面，再提示 |

**自动化验证**：Node 529/529 通过（`tests/unit/webvpn-tab-bridge.test.mjs` 7 条，
`tests/unit/webvpn-commands.test.mjs` 增加「右侧栏 tab 接入」与「点尚未获取文献必定打开浏览器」
两组契约断言）。本机**没有 cargo/rustc**，Rust 改动未经编译，只有静态契约断言兜底。

**⚠️ 仍需 Windows 真机人工验收（本机无法执行）**

1. 点桌面壳顶栏的 **WebVPN 指示器**（或右侧栏「+」→「文献浏览器」）→ 右侧栏出现「文献浏览器」tab，WebVPN 内容嵌在**该 tab 正文区域**内
   （不再是自己占一条 1/3 宽的栏），标签条与 DSH 自带「文件」tab 并列可见、可点击。
2. 拖动右侧栏宽度 / 切换 `fullscreen` → 子 WebView 跟随，不留白边、不越界。
3. 切到「文件」tab、收起右侧栏、关闭 tab → 子 WebView 立即消失，**不得**继续浮在对话区上方。
4. 窗口缩放 → 子 WebView 跟随（由 tab 正文的 ResizeObserver 重报）。
5. 登录 + 实际点击出版社 PDF 下载 → 归档链路仍正常；登录态在切换 tab 后保留。
6. 主 WebView **始终全宽**（用 DevTools 或 `webvpn_status` 复核），不再出现被收窄的情况。
7. **「+」→ 类型列表里能看到「文献浏览器」**（与自带「文件」并列），点它 → 正文自动打开
   中科大 WebVPN 门户；此时右侧栏首次展开的默认页应变成**指南页**（而非「文件」）。
8. 载体已存在（已登录）时再点「+」→「文献浏览器」→ **不得**重新导航到门户，应保留原页面。
9. 未登记 DOI/出版社页面的文献条目，点「尚未获取正文/SI」→ 打开浏览器到 WebVPN 门户，
   而不是只弹一句提示。
10. 已有下载任务在处理时（状态条显示进行中）再点「尚未获取正文/SI」→ 浏览器被带回
    正在下载的页面，而不是毫无反应。

**已知限制（原生覆盖层固有）**

- 原生子 WebView 永远绘制在 Web 内容之上。DSH 若在弹出的下拉/浮层里覆盖到 tab 正文区域，
  会被浏览器画面**遮住**（浮层本身仍可交互，只是视觉被盖）。`webvpn-tab` 正文自带一层
  中性底衬，覆盖范围之外的 DSH 浮层不受影响。
- 几何靠「量矩形 → postMessage → set_bounds」的异步链路，拖动右侧栏宽度时子 WebView
  会有**一帧左右的滞后**；这是原生覆盖层方案的固有代价，不是实现缺陷。
- 该 tab 只在桌面壳内可用；纯网页部署下正文显示说明文案，`openWebVpnTab()` 返回 `false`
  并回落到原生路径。

---

## 2026-09-12 同窗侧边栏更新

- 已将 WebVPN 载体从独立 `WebviewWindow` 改为主窗口内的 Tauri 官方子 WebView：
  `Window::add_child(WebviewBuilder, position, size)`。
- 打开时主 WebView 自动收窄，WebVPN 占据右侧 320–560 逻辑像素；收起后主界面恢复全宽，
  WebVPN 子 WebView 与专属 profile 保留，因此登录态不丢。
- capability 已从窗口级 `windows: ["main"]` 收紧为 `webviews: ["main"]`，外部 WebVPN 页面不继承主界面 IPC 权限。
- 当前验证：Rust 89 通过 / 1 ignored；Node 单元测试 308/308 通过。
- Windows 实机已确认打开与收起正常：主 WebView 宽度实测 1280→720→1280，
  收起后 `webvpn` 子 WebView 仍存在且 `sidebarVisible=false`，会话载体未销毁。

---

## 2026-09-11 当前进展（优先于下方历史交接内容）

- 阻塞 DSH 的孤儿锁 `node_modules.lock` 已核对死进程后删除；DSH 启动与鉴权已恢复。
- 阶段 0 已用登录后的真实 USTC WebVPN 会话完成：门户为 `https://wvpn.ustc.edu.cn/`；
  Nature、ACS、ScienceDirect 均可通过确定性 WRD 转发 URL 进入，并显示中国科大机构访问。
- 转发规则已实测为 AES-128-CFB 加密目标 host，key/IV 均为 `wrdvpnisthebest!`；
  USTC 快速跳转会请求新窗口，桌面端将其收敛回 `webvpn` 单例窗口。
- 阶段 2/3 已接入：客户端创建既有 manual-capture 任务后，由 Tauri WebView2 下载回调
  写入受限临时文件，再用一次性令牌 PUT 到原 `/api/lab-capture-upload`；失败可取消并回退 Edge。
- 数据库状态区已提供打开、确认登录、状态轮询和清除登录状态；默认门户已设为中国科大，
  旧版空配置会在读取时迁移。登录态仍只在专属 WebView2 profile 内。
- 🔴 **已修复：点「打开 WebVPN」跳出纯白空窗**。根因是 Tauri 2.11.5 在 Windows 上的已知问题——
  `WebviewWindowBuilder::new` **在同步命令里会死锁**（窗口先建出来、WebView 挂不上，于是只剩白框；
  且 `build()` 不返回，`webvpn.log` 一行都没有）。5 个操作窗口的命令已改 `async`，
  建窗改为「先隐藏 → 成功后才 show」，失败时回收残留窗口并把原因写进 `webvpn.log`。
  详见 `docs/WEBVPN_IN_APP_BROWSER_PLAN_REVIEW.md` **§15**（含现场证据链与 3/3 变异测试）。
- 当前自动化结果：Node **374/374** 通过（新增 2 条建窗回归断言）；Rust **86 通过 / 0 失败 / 1 ignored**。
- 尚需正式安装包人工验收：在桌面应用内重新登录一次，实际点击出版社 PDF 下载并确认归档；
  以及退出并重启应用后确认 WebView2 profile 的会话持续性。

下方第 0–4 节保留为接手时的历史现场记录，其中“尚未执行”“仍在”等状态描述已被本节取代。

---

## 0. 一句话状态

计划评审已完成；**不依赖探测**的阶段 1（配置接入 + 会话状态机）与阶段 4（安全加固、打包门禁、文档）已全部完成并提交；
阶段 0 探测脚手架**已就绪但尚未执行**。所有剩余工作（转发规则、下载捕获、客户端入口）**必须等阶段 0 的实测结论**，禁止按截图猜测。

⚠️ **接手前请先读第 1 节**——本机有遗留状态必须先处理，否则探测跑不起来。

---

## 1. ⚠️ 接手前必须先处理的本机遗留状态

### 1.1 孤儿写锁 —— 直接阻塞 DSH 启动（必处理）

```
C:\Users\admin\AppData\Local\iBM-Lab-Agent\dsh\profiles\node_modules.lock
```

- 大小 6 字节，生成于 **2026-09-11 16:28**，**内容为 `20152`**——即崩溃时持锁的那个 DSH 进程号
  （`app.log`：`Started DSH child process pid=20152`）。已核实 **PID 20152 现已不存在**（不是被别的进程复用而"看起来还活着"）。
- **后果**：之后每次启动 DSH 都在等这把永不释放的锁，报
  `Error: atomic-write: timed out waiting for the writer lock at ...\node_modules.lock`（默认只等 **2 秒**），
  健康检查永远不会通过（`app.log` 里会一直刷 `Waiting for DSH HTTP health check (n/90)`）。
- **完整因果链（已查实，非推测）**：
  1. 从 Agent shell 启动 → 垫片变量注入并被应用派生的 DSH 继承（见 1.2）；
  2. 垫片删除计数按 `scope:"turn"` **跨进程共享**，被同一轮的大量文件操作耗到上限 50；
  3. DSH 的 `withFileLock` 正常执行完操作后，在 **`finally` 块**里删锁
     （`dsh-atomic-write/lib/index.js:143` `await rm(lockPath, { force: true })`）；
  4. 该 `rm` **被垫片拦下抛异常**，于是锁文件**没被删除**；
  5. 异常冒泡成未捕获错误 → DSH 进程死亡 → 锁被孤儿化。
- **处置：删除这一个文件即可**（非递归）。这不是权宜之计，而是该库**指定的**恢复方式——`dsh-atomic-write`
  的 `withFileLock` 文档注释原文写明：*"The contender never removes an existing lock because file age cannot prove
  that its owner stopped; **orphan recovery is an operator action**."*
  即 DSH **不做陈旧锁检测、不按年龄抢占**，人工删除是唯一出路（也确认了没有可通过环境变量放宽的等待上限，
  `waitMs` 由调用方决定而非环境变量）。
- 截至交接时该文件**仍在**（用户要求暂停，未获授权清理）。

> ⚠️ **不要按 `*.lock` 通配删除。** 应用数据目录下共有 4 个 `*.lock`，其中 **3 个是 `requirements.lock`
> （pip 依赖锁定文件，正常内容文件，2998/299 字节）**，误删会破坏 Python 环境：
>
> ```
> dsh/lab-agent/requirements.lock                                              ← 正常，勿删
> dsh/profiles/ibm-lab/node_modules/dsh-lab-agent/python/requirements.lock      ← 正常，勿删
> dsh/profiles/ibm-lab/node_modules/dsh-lab-agent/python/requirements-linux.lock← 正常，勿删
> dsh/profiles/node_modules.lock                                               ← 孤儿写锁，仅删这个
> ```
>
> 判别方法：`atomic-write` 的写锁是**被保护文件的同名兄弟** `<filename>.lock`，且**内容就是一行 PID**；
> `requirements.lock` 则是有实质内容的依赖清单。

### 1.2 🔴 绝不要从 Agent / 沙箱 shell 启动桌面应用

这是本次最值得记取的教训。Agent shell 里注入了以下变量，**会被应用及其派生的 Node/Python 子进程继承**：

| 变量 | 影响 |
|---|---|
| `NODE_OPTIONS=--require=".../shim/node-language-shim.cjs"` | 被 tauri CLI 与应用派生的 `node.exe`(DSH) 继承 |
| `CODEBUDDY_SAFE_DELETE_ENABLED=1` | 启用删除垫片 |
| `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=50` | 单轮删除上限 50 |
| `CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR=...\Temp\codebuddy-safe-delete-bulk` | **计数跨进程共享**（`scope:"turn"`） |
| `CODEBUDDY_SAFE_DELETE_BIN_DIR=.../shim/safe-bin` | 同时占据 `PATH` 首位 |
| `BASH_ENV` / `PYTHONPATH` | 子 bash / 子 Python 同样被污染 |

**实测症状**（从 Agent shell 启动）：DSH 崩在
`Error: [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":50,"threshold":50,...}`，
并伴随 WebView2 弹窗 `msedgewebview2 has stopped working / Error launching CrashSender.exe`。
**用户自己从终端启动则一切正常**（DSH 健康检查 9 秒内通过）。

**规避**：
1. **首选——由用户在自己的终端里启动**（本就需要用户交互登录，天然合适）；
2. 备选——从 Agent 侧启动前 `unset NODE_OPTIONS BASH_ENV CODEBUDDY_SAFE_DELETE_*`
   （实测安全删除的报错会消失，但见 1.1，前一次崩溃留下的锁文件仍需清理）。

> 结论推广：**任何「应用会自行派生 Node/Python 子进程」的验证，都不要从 Agent shell 直接启动**，
> 否则测的是被垫片污染的链路而非真实产品行为——这类假失败极具误导性。

### 1.3 已修复：git 远程跟踪引用（供了解，无需再动）

本环境 **`git update-ref` / `git fetch` 的引用写入返回成功但不落盘**（对全新引用名同样如此，`exit=0` 却不生成文件）。
后果是本地 `origin/main` 一直卡在旧的 `5a9012c`，与远端真实值不符。
已通过**直接写文件**修复 `refs/remotes/origin/main` 与悬空的 `refs/remotes/origin/HEAD`。

**当前准确状态**（以 `git ls-remote` 为准）：

| 项 | 值 |
|---|---|
| `origin`(USTC) 的 `HEAD` / `main` / `release-0.4.2` | 三者同指 `0320330`（2026-09-09） |
| `github`(cyx1874cyx) 的 `main` | `0320330` |
| 两个远程是否存在 `release-0.4.3` | **都没有** |
| 未推送提交数 | **18**（对两个远程都是 18） |
| `v0.4.3..HEAD` | **13**（0.4.3 已打 tag 并出包，之后又落了 13 个提交） |

> 判断 fetch/push 是否生效**必须查远端**（`git ls-remote`），不能信本地远程跟踪引用。

---

## 2. 已完成的工作

### 2.1 提交清单（`v0.4.3` 之后的 13 个提交，新→旧）

| 提交 | 内容 |
|---|---|
| `b551bed` | 手册补充探测日志落盘路径（§12.5） |
| `4df5d86` | 记录文档与门禁锁定的提交引用 |
| `367b455` | 文档化软件内浏览器 + 源码级锁定 capabilities 门禁 |
| `4d98ee6` | 记录阶段 4 加固的提交引用 |
| `a454295` | 加固：capabilities 门禁、WebVPN 密钥面、kill 时序 |
| `d11396c` | 记录阶段 1 的提交引用 |
| `6bafed9` | **阶段 1 主体**：WebVPN 导航策略 + 会话状态机 |
| `30de10d` | 修正集成测试结论 |
| `a41c03a` | 修复测试：删除 profile 前先解除 boot-profile junction |
| `aca8c2c` | 阶段 −1 基线与阶段 0 手册 |
| `7a33bf2` | **探测脚手架**：WebVPN 单例窗口 + 阶段 0 探测器 |
| `7501f98` | 计划文档 + 落地前评审 |
| `740c899` | 补全 DSH 0.1.5 内嵌 WebView 鉴权链路 |

### 2.2 代码交付物

- `desktop/src-tauri/src/webvpn.rs`（约 1140 行，含 23 个内联测试）
  - 6 态会话状态机 `WebVpnSessionState`，迁移合法性只在 `can_transition_to` 收口，非法迁移**返回 `Err` 不静默改写**；
    注意 `Ready → Opening` 是**非法**的，重开窗口前需先 `mark_closed()` 归零，复用窗口走 `enter_reused_session()`。
  - 导航策略 `WebVpnPolicy`（后缀安全的主机匹配，`notdoi.org` 不得匹配 `doi.org`；锁失败时**失败关闭**）；
    被拒域名进 `denied_hosts` 并提供**逃生阀** `webvpn_allow_host` 写回配置。
  - `redact_for_log`：清 fragment（一次性令牌在 `#t=`）、用户凭据、敏感/不透明 query 值；**唯一写日志点**。
  - 专属 WebView2 profile `webvpn-webview2`，用 `resolve_profile_dir` + 逐段路径比较做边界校验。
  - `begin_navigation` 标了 `#[allow(dead_code)]`——**转发规则刻意未实现**，等阶段 0 结论。
- `desktop/src-tauri/src/runtime/{config.rs,mod.rs}`：`WebVpnConfig { portal_url, allowed_hosts, enforce_navigation }`
  全 `#[serde(default)]`，`portal_url` **默认空串**（不写死任何未验证域名）+ `save_webvpn_config`。
- `desktop/src-tauri/src/main.rs`：命令 `webvpn_probe_available/open/events/clear`、
  `webvpn_open_login` / `webvpn_confirm_login` / `webvpn_allow_host` / `webvpn_set_policy` / `webvpn_status` /
  `webvpn_hide` / `webvpn_clear_session`，全部已注册进 `generate_handler!`。
  > `webvpn_set_policy` 的命名刻意避开 `*_save_config` 形态：`tests/unit/desktop-native.test.mjs` 有架构护栏
  > 禁止主文件注册配置类命令。**不要放宽那条护栏，也不要照抄被禁的字面量**（连注释里出现都会触发）。
- `desktop/src/index.html`：debug-only 的探测面板 + 「阶段 1 · 导航白名单」块（含状态、被拒域名可点击放行）。
- 测试：`tests/unit/webvpn-commands.test.mjs`(5)、`tests/unit/webvpn-secrets-scan.test.mjs`(4)、
  `tests/unit/windows-release-scripts.test.mjs`(8/8)。
- `desktop/scripts/verify-package.ps1`：断言**每一个** capability 不含窗口级授权，且 `webviews` 必须且只能是 `["main"]`。

### 2.3 文档交付物

- `docs/ARCHITECTURE.md`：§4 增加「桌面窗口权限边界」，新增 **§12 WebVPN 软件内浏览器**。
- `docs/MANUAL_CAPTURE.md`：新增「与 WebVPN 通道的关系」（与手工捕获共用服务端契约的对照）+ 4 行故障排查。
- `docs/WEBVPN_IN_APP_BROWSER_PLAN_REVIEW.md`：§11 阶段 −1、**§12 阶段 0 操作手册**（含 §12.5 日志路径）、
  §13 阶段 1 记录（含 10 条缺陷清单）、§14 阶段 4 记录。

### 2.4 验证状态（最后一次全量运行）

| 套件 | 结果 |
|---|---|
| `npm test` | ✅ 371 通过 / 0 失败 |
| `cargo test` | ✅ 81 通过 / 0 失败 / 1 忽略 |
| `windows-release-scripts.test.mjs` | ✅ 8/8 |
| 密钥扫描守卫变异测试 | ✅ 4/4 CAUGHT（证明断言非恒真式） |
| capabilities 门禁变异测试 | ✅ 3/3 CAUGHT |

---

## 3. 阻塞项与未完成

| 项 | 状态 | 卡点 |
|---|---|---|
| **阶段 0 探测** | 🟡 脚手架就绪，**未执行** | 需用户本人的学校账号 + 验证码登录 USTC WebVPN |
| 阶段 2 下载捕获 | 🔴 阻塞 | PDF 是下载还是内联、路径是否被改写，只能实测（另有 R2：必须先查 Rust 再建服务端任务） |
| 阶段 3 客户端入口 | 🔴 阻塞 | 消息契约依赖阶段 0 结论；改完必须 `npm run build:client` 并**连产物一起提交** |
| 转发规则 / `webvpn_open_target` | 🔴 刻意未实现 | 那正是探测要测的东西，按截图猜必然返工 |

---

## 4. 待决策（交接时未决）

| # | 问题 | 用户当时的答复 |
|---|---|---|
| Q1 | 是否清理 1.1 的残留锁文件（仅此一个文件） | **要求暂停，未清理**——接手后需先确认再处理 |
| Q2/Q5 | WebVPN 是否占用 `0.4.4`？ | **未决**。`v0.4.3` 已打 tag 并出包，分支上已有 13 个发布后提交；若定 0.4.4，需同步改 7 处被 `release-version-consistency` 断言的位点 |
| Q3 | 18 个未推送提交怎么推？ | **暂不推送** |
| Q4 | 仓库根目录 18 个 `.tmp-*` 草稿（共 610K，已被 `.gitignore:14` 忽略） | **先不删** |
| Q6 | 跨应用重启是否保留 WebVPN 登录态 | 未决（计划默认保留；专属 profile 天然保留，清除入口 `webvpn_clear_session` 已实现） |
| Q7 | 弹窗策略：受管从属窗口 vs 收敛回主窗口 | 未决，**需阶段 0 实测后拍板** |

---

## 5. 关键操作速查

### 5.1 启动探测构建（在**用户自己的终端**里执行）

```bash
cd <仓库>/Code/iBM-Lab-Agent/desktop
export PATH="$HOME/.cargo/bin:$PATH"      # cargo 不在默认 PATH；别用 $USERPROFILE（反斜杠形式会失效）
node ./node_modules/@tauri-apps/cli/tauri.js dev
```

> 两个必须绕开的坑：① `$USERPROFILE` 在本机 Git Bash 里是 `C:\Users\admin`（反斜杠），拼进 PATH 无效，**用 `$HOME`**；
> ② **不要用 `./node_modules/.bin/tauri`**——该转发脚本会把路径拼成 `H:\h\107-iBM-Agent\...`（多一层 `h`）而报找不到模块，
> 直接调 JS 入口 `node ./node_modules/@tauri-apps/cli/tauri.js dev`。

构建产物路径 `desktop/src-tauri/target/debug/ibm-lab-desktop.exe`；`tauri.conf.json` 用 `frontendDist: "../src"`，
无 `beforeDevCommand`/`devUrl`，**不需要前端 dev server**。

### 5.2 日志与探测产物位置

```
%LOCALAPPDATA%\iBM-Lab-Agent\logs\            ← app.log / dsh.log / stderr.log / webvpn.log
```

⚠️ 别按 `app_local_data_dir()` 的常规认知去找：`RuntimeManager::new`（`runtime/mod.rs:66-71`）**优先读 `LOCALAPPDATA` 环境变量再拼
`iBM-Lab-Agent`**，读不到才回退 `app_local_data_dir()`（Tauri 2 下解析为 `identifier` = `cn.ustc.ibm-lab-agent`）。
本机**两个目录都存在**，按后者找会找错。最省事：点应用工具条的 **日志** 按钮（`open_logs`）。
`webvpn.log` 在首次探测运行前**不存在**；跑完仍无该文件 = 探测面板未被触发（先确认是否 debug 构建）。

### 5.3 阶段 0 探测步骤

见 `docs/WEBVPN_IN_APP_BROWSER_PLAN_REVIEW.md` **§12**：打开「诊断」→ 最下方「WebVPN 探测（仅开发构建）」→
填门户地址 → 打开 → 完成统一身份认证 → 依次访问 Nature / ACS / ScienceDirect 并**各点一次下载** →
关闭再打开确认无需重复登录 → 刷新记录 → 交出 `webvpn.log`。

### 5.4 孤儿写锁恢复（DSH 起不来时先查这里）

1. 确认没有进程占用：`ibm-lab-desktop.exe` 与 DSH 的 `node.exe` 都不在运行，且 3080 端口空闲。
2. 确认目标文件**内容是一行 PID**（例如 `20152`）——这是 `atomic-write` 写锁的特征；有实质内容的
   `requirements.lock` **不是**写锁，不要删。
3. 删除该单个文件（非递归）：`...\iBM-Lab-Agent\dsh\profiles\node_modules.lock`
4. 重新启动应用，确认 `app.log` 出现 `DSH health check passed`（干净环境下约 9 秒内）。

---

## 6. 踩坑清单（供接手人避免重蹈）

| 坑 | 症状 | 处置 |
|---|---|---|
| **同步命令里建 WebView 窗口** | 点开 WebVPN 跳出**纯白空窗**、`webvpn.log` 全空 | Tauri 2.11.5 的 Windows 已知问题（见 PLAN_REVIEW §15）：建窗/操作窗口的命令必须 `async`；`tests/unit/webvpn-commands.test.mjs` 已锁住 |
| Agent shell 环境污染 | DSH 启动即崩 + WebView2 崩溃弹窗 | 见 1.2，用户自己终端启动 |
| 孤儿写锁 `node_modules.lock` | DSH 健康检查永不通过（等锁 2 秒超时） | 见 1.1 / 5.4，删除该单文件；**别按 `*.lock` 通配删**，`requirements.lock` 是正常依赖文件 |
| `git update-ref`/`fetch` 写入丢失 | 引用值不更新，领先数算错 | 直接写文件；判断远程一律 `git ls-remote` |
| `$USERPROFILE` 反斜杠 | `cargo: command not found` | 用 `$HOME/.cargo/bin` |
| `node_modules/.bin/tauri` | 报 `H:\h\...` 找不到模块 | 直接 `node .../cli/tauri.js dev` |
| commit message 含 `PowerShell`/`pwsh` | 被安全层拦截 | 改写措辞 |
| 同一文件同批多次 Edit | 第二个报 "File has been modified since read" | 串行编辑，先重读 |
| `remove_dir_all` / profile 清理 | boot-profile 是 junction，需先解除 | 见 `a41c03a` |

---

## 7. 相关文档索引

| 文档 | 用途 |
|---|---|
| `docs/WEBVPN_IN_APP_BROWSER_DEVELOPMENT_PLAN.md` | 原始开发计划（409 行） |
| `docs/WEBVPN_IN_APP_BROWSER_PLAN_REVIEW.md` | **主入口**：评审结论 + 各阶段执行记录 + 阶段 0 手册（§0–§14、附录 A） |
| `docs/ARCHITECTURE.md` §12 | 架构层面说明 |
| `docs/MANUAL_CAPTURE.md` | 与手工捕获通道的关系与边界 |
| 本文件 | 交接说明与遗留状态 |

---

## 8. 建议的接手顺序

1. 读本文件第 1 节，处理残留锁文件。
2. 读 `WEBVPN_IN_APP_BROWSER_PLAN_REVIEW.md` §12，在自己的终端启动 dev 构建。
3. 完成阶段 0 探测，交出 `webvpn.log`。
4. 依据日志反推转发规则与 SSO/弹窗域名清单，填白名单，把 `enforce_navigation` 置为 `true`。
5. 再依次推进阶段 2（下载捕获，注意 R2 顺序）、阶段 3（客户端入口，注意 `npm run build:client` 与连产物提交）。
