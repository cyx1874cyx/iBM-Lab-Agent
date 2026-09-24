# DSH Desktop 适配评估（iBM Lab Agent 作为插件）

> 评估对象：把本项目（`dsh-lab-agent`）作为插件，适配到社区桌面端 **DSH Desktop**
> （`anywhere-labs/dsh-desktop`，npm 包 `dsh-plugin-desktop`，官网 dshdesktop.cn）。
> 本文区分三类内容，请勿混读：
>
> - **实测事实**：来自 npm 发行物 tarball、GitHub API/tag 的原始文件，附路径或 URL。
> - **上游文档事实**：来自 DSH Desktop README / `docs/plugin-services.zh.md`，标注为上游声明。
> - **推断/估计**：工作量、风险、可行性判断，未在本机跑过 DSH Desktop。
>
> 评估时间：2026-09-24。DSH Desktop 与上游 DSH 都处在高频发布期（见 §5 风险 R1）。

---

## 1. 结论摘要

**架构上是同构的，工作量的大头不在「接不上」，而在「原来由自研 Tauri 壳承担的东西现在没人承担了」。**

DSH Desktop 的插件契约与本项目现有形态**天然对齐**：它认的就是普通 `dsh.bundle`
（`cordis.patch.yml` patch 层）+ 普通 `dsh.client`（`platform: web` + `exports["./client"]`）。
本项目的 Host 侧 `lib/` + `src/`、浏览器侧 `client/` **不需要为「桌面端」重写**，
`cordis.patch.yml` 的 26 行组合、18 个注入服务名也都不变。真正要还的债有三笔：

| 债 | 原因 | 规模 |
|---|---|---|
| **① 运行时自举** | 现有 Windows 桌面版的 Python 3.11、Node、DSH、Origin/Mnova MCP 全由自研 Tauri 壳打包并注入环境变量；DSH Desktop **不提供 Python**，插件也**拿不到 Electron API** | 最大单项 |
| **② 宿主形态判定** | 现有唯一的「是否桌面封装环境」判据是 `IBM_LAB_AGENT_BUNDLED_PYTHON`，由 Tauri 壳注入；DSH Desktop 不会设它 | 小，但牵一发动全身（浏览器模式、Python 解析、MCP 行） |
| **③ 桌面专属链路** | 外部 Edge 捕获回传（`open_in_edge` + 扩展 + Native Messaging）与 WebVPN 内嵌子 WebView 都建立在 Tauri 壳之上，插件侧无法复刻 | 中到大，含明确的功能损失 |

**工作量估计（1 名熟悉本仓库的开发者，人日）：**

| 目标档位 | 范围 | 估计 |
|---|---|---|
| **A. 最小可用** | Windows；插件能装进 DSH Desktop 活动 profile 并加载；对话/工具/存储/产物可用；接受「系统 Python 3.11 + venv」与「外部浏览器回退」；放弃捕获回传与内嵌 WebVPN | **15–25 人日（3–5 周）** |
| **B. 功能对齐** | 自举 Python（Win）、浏览器链路改为 `managed-edge`、捕获回传替代方案、兼容/高级双模式验证、分发与版本门禁、CI 冒烟 | **45–65 人日（9–13 周）** |
| **C. 加 macOS** | DSH Desktop 正式支持 macOS（universal DMG）；本项目目前**没有 macOS 路径** | 在 B 之上 **+10–20 人日** |
| **持续成本** | DSH Desktop / 上游 DSH 每发一版做兼容验证 | **2–4 人日/版** |

对照：本项目自己的 `0.1.7-rc.1` 迁移评估是 5–8 人日（`docs/DSH_0.1.7_RC1_MIGRATION_ASSESSMENT.md`）。
**换宿主的成本约是换 DSH 版本的 3–6 倍**，差值几乎全部来自「自研壳提供的运行时与原生链路」。

### 1.1 两个必须先解决的先决条件

1. **版本窗口不对齐（硬阻断）。** 已发布的 DSH Desktop **v2.0.13（2026-09-19）钉的是 DSH `0.1.5-rc.2`**，
   而本项目当前发行版 `0.5.3-beta9` 钉的是 `0.1.7-rc.1`。仓库 `master`（version `2.0.14`，未发版）
   才钉到 `0.1.7-rc.1`。**在 2.0.14 发布前，本项目的当前版本装进正式安装包必然不兼容**
   （preset 机制、descriptor codec、剪贴板补丁锚点全在 0.1.5↔0.1.7 之间变过）。
   可选项：等 2.0.14；或回退维护一条 0.1.5-rc.2 线；或双线兼容。
2. **插件访问不到 Electron。** DSH Desktop 明确「不授予第三方访问原始 Electron API、renderer 或
   launcher bootstrap 状态」，renderer 沙箱 + `contextIsolation`，**无 preload bridge**。
   因此任何依赖原生窗口、原生剪贴板、启动外部进程回调的能力，都不能沿用现有 Tauri 实现。

### 1.2 也有几笔「白捡」的便宜

- **核心插件代码零改动即可加载**：`dsh.bundle` 与 `dsh.client` 契约一致，`lib/`+`src/`+`client/` 不用为宿主重写。
- **依赖闭包一致**：master 的 DSH Desktop 与项目都钉 `0.1.7-rc.1`，本项目 `peerDependencies` 可解析。
- **Office 预览不用管**：`dsh-web-app` 自带 `office-to-pdf → libreoffice-kit`，DSH Desktop 的 profile 组合了
  `dsh-web-app`，本项目「LibreOffice 由 DSH 侧提供」的既有前提继续成立。
- **私有包不必上 npm**：DSH Desktop 的 `runPlugin()` 走上游 `dsh plugin --profile <active>`，
  **保留相对 `file:` / `link:` spec 语义**，私有包可以用本地路径安装。
- **客户端能自测宿主**：DSH Desktop 把 `dsh-desktop-mode` / `dsh-desktop-platform` 作为 URL 参数传入，
  并在 `document.body[data-dsh-desktop-mode]` / `[data-dsh-desktop-platform]` 上暴露
  （实测 `dsh-plugin-desktop@2.0.0` 的 `lib/client.js:449-452`）。浏览器侧不必依赖环境变量。

---

## 2. 宿主事实（DSH Desktop）

### 2.1 发行与版本（实测）

| 项 | 值 | 来源 |
|---|---|---|
| 仓库 | `anywhere-labs/dsh-desktop`（`deepseek-harness-desktop` 已改名/跳转） | GitHub API `full_name` |
| Star | **28,853**（评估时），fork 1,376 | GitHub API |
| License | MIT | GitHub API |
| 最近推送 | 2026-09-24 | GitHub API |
| 最新正式版 | **v2.0.13**（2026-09-19） | GitHub Releases |
| 产物 | `DSH-Desktop-2.0.13-x64-Setup.exe`（NSIS）、`DSH.Desktop-2.0.13-universal.dmg` | Releases assets |
| Linux | **无安装包**；仅「compatibility 模式」（`electron-builder.linux.target=["dir"]`） | README + `package.json` |
| npm 包 | `dsh-plugin-desktop`，npm 上只有 `0.0.1` 与 `2.0.0`；master 已是 `2.0.14` | registry.npmjs.org |

**版本钉（决定性）：**

| 版本 | DSH | electron | pnpm |
|---|---|---|---|
| 已发布 `dsh-plugin-desktop@2.0.0`（2026-08-16） | `0.1.0-rc.6` | 43.4.0 | 11.7.0 |
| 已发布 tag `v2.0.13` | **`0.1.5-rc.2`** | 43.3.0 | 11.8.0 |
| `master`（version `2.0.14`，未发版） | **`0.1.7-rc.1`** | 44.0.0 | 11.8.0 |

> 实测方式：`raw.githubusercontent.com/anywhere-labs/dsh-desktop/{v2.0.13,master}/dsh-plugin-desktop/package.json`。

### 2.2 插件模型（上游文档事实）

- 宿主是 **Electron**，DSH 在 Electron main 进程里按普通 Cordis 组合启动；HTTP/WS 绑到
  `127.0.0.1` 临时端口，renderer 加载同源页面。
- **第三方 Host 插件只需提供普通 `dsh.bundle` patch**；带 UI 的再加普通 `dsh.client`
  （`platform: "web"`，导出 `./client`）。「Electron 不要求单独的客户端构建，也不引入 desktop 专用注册 API」。
- 安装/管理走上游 CLI：`dsh plugin --profile <profile> add|remove|update`；
  Host 侧把它包装成公开 service **`ctx.desktopPnpm`**（`run()` / `runPlugin(args, invokingDir)`）。
  插件管理器必须用 `runPlugin()`，由上游 CLI 负责 `file:`/`link:` 锚定与 `dsh.profile.bundles` reconcile。
- 另一个公开 service 是 **`ctx.desktopProfiles`**（`current{name,dir}` / `list()` / `select(name)`）。
- **无 preload / 无 Electron IPC bridge / 无 Node integration**；renderer 沙箱 + `contextIsolation`，
  导航被限制在**确切的 loopback origin**，外部 http(s)/mailto 交给操作系统打开。
- 公开契约类型从 `dsh-plugin-desktop/profile-service` 与 `dsh-plugin-desktop/pnpm` 引入；
  **不要**注入 `ctx.desktopRuntime`（内部 native adapter）或 `desktopPnpmBootstrap`（launcher 私有）。

### 2.3 profile 规则（上游文档事实）

- 两种呈现模式：`compatibility`（Win/mac/Linux）与 `advanced`（Win/mac，Linux 明确拒绝）；
  模式存 `$DSH_HOME/settings.yaml` 的 `dsh-desktop.mode`，切换会 dispose 整棵 Cordis 树再重启。
- 托盘可切换 profile。**可选 profile 必须直接按顺序组合 `dsh-base` 与 `dsh-web-app`**；
  headless / 损坏 / 已内嵌 desktop bundle 的 profile 会列出但不可选。
- 只有 `desktop` 是 launcher 管理的 profile：「修复安装方拥有的前缀，同时**保留第三方 bundle 的相对顺序**」。
- **launcher 只会为当前 generation 在 `dsh-web-app` 后插入自有 desktop layer，不会把它持久化到被选 bundle 列表**
  —— 即用户选择本项目自带的 `ibm-lab` profile 时，仍会得到桌面壳的 tray/窗口/advanced 布局。
- advanced 模式会**禁用官方 `ui-layout` row**，保留官方 `ui-sidebar` 与 `ui-conversation` row，
  由 desktop client 提供 `layout` service 并只注册 `root` slot occupant。

### 2.4 不提供的能力（实测）

- **不打包 Python。** README 原文：*"Python and Visual Studio C++ Build Tools are not required."*
  `dependencies` 里没有任何 Python 运行时；本项目的 nature-skills、markitdown、python-pptx、
  RDKit、PyMuPDF（evidence shot）、Origin/Mnova MCP 全部落空。
  （对比：**官方** `@deepseek-ai/dsh-desktop` 是打包 Python 的——但那是个 `private: true`、
  未发安装包的仓库内应用，见 §6。）
- **不注入自定义环境变量。** 启动器不修改全局环境；只有它自己打开的 DSH 终端会设置 `DSH_HOME`
  并前置私有 shim。第三方插件在 Host 内部加载，无法在 boot 前注入 env。
- **不暴露 Node/`dsh` 到公开 runtime 路径。**

---

## 3. 本项目接入面盘点（哪些能用、哪些不能）

### 3.1 直接可用（零改动或仅配置）

| 项 | 依据 |
|---|---|
| `dsh.bundle.patch`（`cordis.patch.yml` + `presets/lab-research/preset.patch.yml`） | 与 DSH Desktop 的 bundle 契约同构 |
| `dsh.client`（`platform: web`、6 个 inject、`exports["./client"]`） | advanced 模式保留 `ui-sidebar`/`ui-conversation`，本项目只用标准 slot |
| Host 服务层（`ctx.lab*`，18 个注入服务） | 依赖 `storageDomain`/`webServer`/`llm` 等上游服务，`dsh-base`+`dsh-web-app` 均提供 |
| 存储与产物（`$DSH_HOME/lab-agent/*`、`storages/`） | DSH Desktop 各 profile 共用同一 `$DSH_HOME` 的 sessions/settings/storage |
| Ketcher / PDF viewer 静态资源 | 由插件自己的 `webServer` 路由托管（`/api/lab-ketcher/*`、`/api/lab-pdf-viewer/*`），宿主无关 |
| 客户端 slots（`conversation.session.header.utilities`、`sidebarRightTabs`、`sidebarRight`） | 本项目 `client/src/apply.js` 实测只用这些标准注入点 |
| LibreOffice 文档预览 | 由 `dsh-web-app → office-to-pdf` 提供，DSH Desktop profile 已含 |

### 3.2 必须改造

| 项 | 现状 | 改造点 | 文件 |
|---|---|---|---|
| 桌面形态判定 | `isDesktopShell()` 只看 `IBM_LAB_AGENT_BUNDLED_PYTHON` | 改为「宿主 service 注入 + 安装期写配置文件 + 客户端 body marker」三路判据；组合期 `!!js process.env[...]` 三元式同步改掉 | `lib/capabilities.js`、`cordis.patch.yml`（`lab-literature-sources`） |
| Python 解析 | `bundledPythonFromEnv()` 优先，其次 venv，再系统 | 新增插件自举的 Python 根；`resolvePythonExecutable` 增加自举档位 | `src/python-env.js`、`src/markitdown.js`、`src/pptx-builder.js`、`src/skill-executor.js`、`src/chemistry/rdkit-pubchem.js`、`lib/characterization-tool.js` |
| MCP 行 | `presets/mcp/*.patch.yml` 以 `!!js process.env['IBM_LAB_AGENT_BUNDLED_PYTHON']` 作 `command` | 改为插件在运行期解析解释器并生成/覆盖 MCP 行；`IBM_LAB_MNOVA_*` 四个变量同理 | `presets/mcp/mnova-mcp.patch.yml`（及 origin 对应文件）、`desktop/src-tauri/src/runtime/dsh.rs` 是旧实现参照 |
| 安装路径 | `install.sh`（Linux，uv 装 Python）+ Tauri 打包（Windows） | 新增 DSH Desktop 目标：`dsh plugin --profile <active> add <path>`、物化 vendor 树、写自举配置；可用 `ctx.desktopPnpm.runPlugin()` 做 in-app | `scripts/install.mjs`、`install.sh`、新增 bootstrap 脚本 |
| 客户端 shell 桥 | `window.parent.postMessage` 等 Tauri 壳回 `OPEN_IN_EDGE` / `WEBVPN_*` / `IWAN_STATUS` | 抽出「host capability adapter」；DSH Desktop 下走 `managed-edge` + `window.open` 回退 | `client/src/lib.js`（`client/index.js:590` 为构建产物）、`lib/adapters/browser.js`、`lib/literature-sources.js:448` |

### 3.3 无法移植 / 需要产品取舍

| 能力 | 现状实现 | 为什么不能移植 | 可选替代 |
|---|---|---|---|
| 外部 Edge 捕获回传（`desktop-edge-handoff`） | Tauri shell `open_in_edge()` + `capture-handoff` 页面 + Edge 扩展 + Native Messaging（Rust `bridge.rs` 注册） | 无 Electron API、无 preload；DSH Desktop 还会把外部链接丢给系统浏览器，固定回传链断 | ① 改默认 `managed-edge`（本项目已实现且 `requiresDesktopShell:false`）；② 用独立安装器注册 Native Messaging host（工作量最大）；③ 放弃自动捕获，保留手工上传 |
| WebVPN 内嵌浏览器（右侧栏子 WebView） | Tauri 多 WebView（`Window::add_child` / `unstable` 多 WebView API），见 `docs/WEBVPN_SIDEBAR_CHILD_WINDOW_EVALUATION.md` | 插件无法创建原生子 WebView | ① 降级为外部浏览器 + 状态提示；② 同源 iframe（跨站会被拦）；③ 放弃内嵌 |
| Origin / Mnova MCP | 由 Tauri 打包的自包含 Python 提供，随环境变量启动 | Python 与 env 注入都没了 | 随 Python 自举一起解决（W3），MCP 行改运行期生成；仍需本机安装并授权的 Origin/MestReNova |
| API Key DPAPI 加密 | Tauri Rust 用 Windows DPAPI | 无 Electron API | 交给 DSH 的 credentials 体系；或插件侧独立加密（新增工作） |
| 软件内自动更新 / 端口分配 / 单实例 / 托盘 | Tauri `updates.rs` / `port.rs` / Tauri 插件 | 由 DSH Desktop 自己提供（托盘、更新、profile 切换、端口） | 直接删除本项目这一层，改用宿主能力 |

> **注意「删除」也是工作量**：本项目 `desktop/src-tauri` 有 **10,414 行 Rust**，
> 但迁移到 DSH Desktop 后它不再是必需项；真正要保留的只有 Python 自举与 MCP 启动逻辑
> （`dsh.rs` 的 MCP patch 生成、`process.rs` 的 env 注入是**参照实现**，不是可搬运代码）。

---

## 4. 工作量分解

口径：1 名熟悉本仓库的开发者；人日；含各自单元/回归测试，不含跨团队评审等待。

| # | 工作流 | 内容 | A 档（最小可用） | B 档（功能对齐） |
|---|---|---|---|---|
| W1 | 安装与挂载 | bundle 装进 DSH Desktop 活动 profile；`file:`/`link:` 安装脚本；`ctx.desktopPnpm.runPlugin()` 对接；`ibm-lab` vs `desktop` profile 取舍与文档 | 2–3 | 4–6 |
| W2 | 形态判定重构 | 三路判据（service / 安装期配置 / client body marker）替换 env 判据；`cordis.patch.yml` 组合期表达式同步 | 2–3 | 3–4 |
| W3 | **Python 自举** | A 档：要求系统 Python 3.11+，建 venv + 联网 pip；B 档：按平台下载/内置 python-build-standalone 到 `$DSH_HOME/lab-agent`，哈希校验、镜像回退、离线可用，复用 `desktop/scripts/build-bundled-python.ps1` 的清单逻辑 | 3–5 | 13–23 |
| W4 | 就地补丁策略 | `dsh-web-frontend` 剪贴板补丁在 Electron/loopback 安全上下文下**验证后可去掉**；`dsh-agent-loop` fake-invoke 补丁改为插件钩子（若不支持则显式停用并记录） | 2–3 | 4–7 |
| W5 | 浏览器与捕获链 | 默认 `managed-edge` 在 Win 验证；`desktop-edge-handoff` 走降级；捕获回传替代或明确放弃；WebVPN 内嵌降级 | 3–5 | 12–23 |
| W6 | 客户端双模式 | 兼容/高级两种模式实机验证与修正；`dsh-desktop-mode/platform` marker 接入；iframe 预览、Ketcher、PDF viewer、右侧栏 tab | 2–3 | 4–6 |
| W7 | 分发与版本门禁 | 私有插件打包（tgz/本地目录）、DSH Desktop 钉版本门禁、安装/升级文档、`doctor` 增列宿主诊断 | 2–3 | 4–7 |
| W8 | 测试与 CI | 无头 loader 冒烟（对齐 DSH Desktop 自己的 `verify:loader`）、Win/mac 矩阵、能力断言、回归子集 | 3–5 | 6–10 |
| | **合计** | | **19–30（取目标区间 15–25，见下）** | **50–83（取 45–65）** |

**区间收敛说明：**

- A 档合计 19–30 人日，但其中 W3/W5 取下限（系统 Python、`managed-edge` 直接复用）时可以压到 **15–25 人日**，
  这是**推荐用于立项沟通的区间**；表格上限代表「每个工作流都不顺」的情形。
- B 档上限 83 偏保守，因为 W3/W5 的替代方案存在产品取舍：若放弃捕获回传与内嵌 WebVPN，
  B 档落在 **45–55**。若两项都要替代实现，接近 **65–83**。

### 4.1 建议实施顺序（关键路径）

1. **先解决版本窗口**（等 2.0.14 / 或决定 0.1.5 线）——否则后面全部返工。
2. **W1+W2**：把「能装、能判定宿主形态」打通，用一个最小 smoke 证明插件在 DSH Desktop 里 boot 成功。
3. **W3**：Python 自举是后续所有科研能力的依赖，越早越好；A 档先落系统 Python 降级，B 档再自包含。
4. **W4+W5**：补丁与浏览器链路，决定功能边界。
5. **W6+W7+W8**：双模式、分发、CI，收口。

---

## 5. 风险

| ID | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | **上游高频换 DSH 版本**：v2.0.11→v2.0.13 只隔 2 天；已发布 v2.0.13 是 0.1.5-rc.2，master 已跳到 0.1.7-rc.1 | 3 处就地补丁 + 276 个 strict codec + client inject 全是版本敏感点，宿主一升级就可能静默失效 | 建 DSH Desktop 版本门禁 + CI 冒烟；把补丁降级为可选项 |
| R2 | **macOS 是全新平台**：本项目现有 Windows 桌面 + Linux 服务端两条线，没有 macOS | DSH Desktop 的 advanced 模式与 universal DMG 都以 macOS 为一等公民；没有 macOS 路径意味着放弃一半用户 | 明确范围；B 档之后再评估；Python 自举与 Edge/Chrome 探测按平台分支 |
| R3 | **原生能力被抽走后出现体验倒退**：无 DPAPI、无内嵌 WebVPN、无捕获回传 | 与现有自研桌面版的「同等体验」预期落差 | 提前把「DSH Desktop 适配版」定位为**功能子集**，并在文档/`doctor` 里显式声明 |
| R4 | **就地补丁在签名/只读安装目录下失败** | macOS 改 app bundle 破坏签名；Windows 安装目录更新即覆盖 | W4 改为插件钩子优先；补丁失败必须显式告警而非静默 |
| R5 | **插件体积** 58 MB（Ketcher + pdf-viewer assets）走本地安装 | `file:`/`link:` 安装对大目录的 pnpm 行为需实测 | 用 tgz 分发；把静态资源改为按需下载（可选优化） |
| R6 | **双宿主维护成本**：同时维护自研 Tauri 版与 DSH Desktop 版 | CI、文档、发布流程翻倍 | 明确主/次；建议以 DSH Desktop 为分发主渠道，自研壳退为「离线/内网版」 |

---

## 6. 与「官方桌面端」的关系（重要澄清）

上游 DeepSeek 仓库里确实有一个 `apps/desktop`，包名 **`@deepseek-ai/dsh-desktop@0.1.7-rc.1`**，
`"private": true`，npm 上不存在（registry 返回 404）。它是 Electron 实现，**打包 Node + pnpm + 完整 Python 发行版**
（numpy/pandas/python-docx/python-pptx/openpyxl/Pillow/lxml/XlsxWriter），从
`$DSH_HOME/profiles/desktop` 加载插件，带应用内 Web Plugin Manager，支持 macOS arm64/x64 + Windows x64。
截至评估日**没有发布安装包**，只能 `pnpm run dev:desktop` 源码构建。

**对本项目的意义：**

- 如果目标是「官方桌面端」而不是社区 DSH Desktop，**W3（Python 自举）与部分 W2 会大幅缩小**，
  因为宿主自带 Python 运行时与插件管理器；总工作量大致可降到 **25–40 人日**。
- 但官方桌面端与 DSH Desktop 的插件模型**不完全相同**，不能假定同一套改动两边通吃；
  若两边都要支持，需要先抽宿主适配层（额外 5–10 人日）。
- 本文按用户确认的目标（**anywhere-labs/dsh-desktop**）给出估计；官方桌面端仅作对照。

来源：`github.com/deepseek-ai/deepseek-harness/tree/master/apps/desktop`（子代理调研，未在本机复核源码）。

---

## 7. 未实测 / 待验证清单

本文的工作量估计建立在以下**尚未在本机验证**的点上，落地前应逐条 spike（每条 0.5–1 人日）：

1. 在本机/一台 Windows 上实装 DSH Desktop v2.0.13，确认 `$DSH_HOME`、profile 目录布局、
   `dsh plugin --profile desktop add <本地路径>` 的真实行为（尤其 `file:`/`link:` 与大目录）。
2. 确认 master/2.0.14 确实发布并钉 `0.1.7-rc.1`；确认发布产物里 DSH 的实际版本。
3. 实机用 `ibm-lab` profile 启动，确认 launcher 是否按文档为**被选第三方 profile**插入 desktop layer。
4. 在 compatibility 与 advanced 两种模式下，逐个验证本项目 client 的注入点
   （`conversation.session.header.utilities`、`sidebarRightTabs`、`sidebarRight`）是否齐全。
5. 验证 Electron/loopback 安全上下文下 `navigator.clipboard.writeText` 可用，从而**确认可删除剪贴板补丁**。
6. 验证 `dsh-agent-loop` 在 DSH Desktop 的 deploy root 是否可写；确认补丁是否被安装器更新覆盖。
7. 验证 `managed-edge` 在 Windows 上能找到 Edge/Chrome 并可 CDP 定位；macOS 同理。
8. 确认 DSH Desktop 是否把第 3 方插件列入 plugin inventory UI（影响 `doctor`/诊断设计）。
9. 量化 `dsh plugin add` 安装 58 MB 插件的耗时与失败模式。
10. 确认 DSH Desktop 的 `pwsh-sandbox` adapter 对本项目工具（经 subprocess 调 Python/Node）无副作用。

---

## 8. 给决策的三句话

1. **技术上可行，且不是重写**：本项目已经是一个标准 DSH bundle + web client 插件，接上 DSH Desktop
   的核心工作量（W1/W2/W6）不到 10 人日。
2. **钱花在「原来壳给的运行时」上**：Python 自举（W3）与浏览器/捕获链替代（W5）占 B 档的一半以上；
   如果接受功能子集，A 档 15–25 人日可交付一个可用的 Windows 版本。
3. **最大的不确定性是上游节奏，不是代码**：DSH Desktop 与 DSH 都在按天迭代，
   已发布版本与 master 的 DSH 钉版本已经错开两个 minor。**先定版本窗口，再开工**；
   否则建议先按官方桌面端（自带 Python、未发版）观望，等它发布后再重估。

---

## 9. 引用

- DSH Desktop 仓库与元数据：https://github.com/anywhere-labs/dsh-desktop
- DSH Desktop README（master）：https://raw.githubusercontent.com/anywhere-labs/dsh-desktop/master/README.md
- 插件作者 service 契约：`dsh-plugin-desktop/docs/plugin-services.zh.md`（随 npm 包分发）
- npm `dsh-plugin-desktop`（含 tarball）：https://registry.npmjs.org/dsh-plugin-desktop
- 已发布 tag 的版本钉：`/v2.0.13/dsh-plugin-desktop/package.json`、`/master/dsh-plugin-desktop/package.json`
- Releases（产物清单）：https://github.com/anywhere-labs/dsh-desktop/releases
- 官方桌面端（未发布）：https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/desktop
- DSH 0.1.7 bundle / client 文档：`docs/user/develop/basic/publish.md`、`docs/subsystems/client-modules.md`
- 本仓库对照物：`docs/DSH_0.1.7_RC1_MIGRATION_ASSESSMENT.md`、
  `docs/WEBVPN_SIDEBAR_CHILD_WINDOW_EVALUATION.md`、`desktop/docs/reference-desktop-analysis.md`
