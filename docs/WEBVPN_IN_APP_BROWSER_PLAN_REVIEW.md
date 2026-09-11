# WebVPN 软件内浏览器开发计划 —— 落地前评审报告

> 评审对象：`docs/WEBVPN_IN_APP_BROWSER_DEVELOPMENT_PLAN.md`
> 评审基线：`release-0.4.3` 分支，`Cargo.toml` 版本 `0.4.3`，工作树含 6 个未提交改动
> 评审方法：所有结论均以仓库文件、构建脚本与本地 Cargo 依赖源码为证据，不做推测

---

## 0. 结论摘要

| 项目 | 结论 |
|---|---|
| 整体可行性 | ✅ **成立**。计划的架构选择（独立单例 Tauri WebView + 复用现有捕获接口）与现有工程结构一致，无方向性错误。 |
| Tauri API 依赖 | ✅ **已实测证实**。`data_directory` / `on_navigation` / `on_new_window` / `on_download` 在锁定的 tauri 2.11.5 + wry 后端上全部可用，无需额外 feature。 |
| 代码权威源 | ✅ **已定死**。权威源是仓库根目录，`desktop/src-tauri/resources/plugin/` 是构建产物。 |
| 会导致返工的错误假设 | ⚠️ **6 处**，见 §3。其中 2 处是文件路径错误，1 处是测试组织方式错误，1 处是 API 语义误解。 |
| 计划未覆盖的风险 | ⚠️ **6 项**，见 §5。最严重的是 token 泄漏进日志与两层单例状态死锁。 |
| 开工前阻塞项 | 🔴 **1 项**：工作树不干净，必须先清场（§7）。 |
| 阶段 0 归属 | 🔴 **无法由开发 Agent 独立完成**，需要用户本人登录 USTC WebVPN。 |

**总评**：这是一份质量较高的实施文档，安全边界（不读凭据、服务端最终裁决、URL 白名单）的表述是可执行的。但它在「文件清单」和「测试落位」两处脱离了本仓库的真实约定，照抄会产出无处安放的测试文件和改不动的样式文件。建议按 §6 修正后再进入编码。

---

## 1. 代码权威源核实结论

### 1.1 结论

**权威源 = 仓库根目录** 的 `src/`、`lib/`、`client/src/`、`presets/`、`python/`、`scripts/`、`bin/`、`vendor/`。

`desktop/src-tauri/resources/plugin/dsh-lab-agent/` 是**打包暂存快照**，禁止直接编辑。

### 1.2 证据链

| # | 证据 | 文件:行 |
|---|---|---|
| 1 | `desktop/.gitignore` 第 3 行忽略 `/src-tauri/resources/plugin/`，该目录下 0 个文件被 git 跟踪 | `desktop/.gitignore:3` |
| 2 | 打包脚本按 **git 跟踪文件**从仓库根目录复制 `lib, client, presets, python, scripts, bin, src, vendor` | `desktop/scripts/prepare-runtime.ps1:147` |
| 3 | 打包脚本把根目录 `presets/lab-research` 复制进暂存 `plugin/presets/` | `desktop/scripts/prepare-runtime.ps1:464` |
| 4 | 暂存逻辑先写入临时目录再整体替换，典型的产物生成流程 | `desktop/scripts/prepare-runtime.ps1:287,309` |

### 1.3 关键特例：`client/index.js`

`client/index.js` **既是 git 跟踪文件，又是构建产物**。这一点必须写进实施纪律：

- `scripts/build-client.mjs` 用 esbuild 把 `client/src/*.js` 打成单文件 `client/index.js`（`build-client.mjs:32,74`）
- 构建脚本会在产物与源不一致时**直接抛错**：`client/index.js 与 client/src 不一致；请先运行 npm run build:client 并提交生成产物`（`build-client.mjs:69`）
- 因此正确流程是：改 `client/src/*.js` → `npm run build:client` → **同时提交源与产物**

`client/dist/` 则完全不入库（`.gitignore:16`），无需关心。

> ✅ 计划 §10 末尾的这条警告是**正确且关键**的，予以保留并升级为强制纪律。

### 1.4 对实施的影响

计划 §10 的清单本身写的是根目录路径（`client/src/...`），**路径写法是对的**。真正的问题是：计划 §2.2 的「当前链路」描述让人以为存在两套代码。实际只有一套，`resources/plugin` 下那份是上一轮打包留下的快照，可能比根目录旧。**开发时若在编辑器里搜到两份，必须以根目录为准。**

---

## 2. 计划「已有能力」核对结果

逐条核对计划 §2.1 的六项声明。

| # | 计划声明 | 核实结果 | 证据 |
|---|---|---|---|
| 1 | `client/src/components-project.js` 的 `LitPanel` 能创建 `manual_capture_create` 并轮询 `manual_capture_get` | ✅ 准确 | `components-project.js:146`（create）、`:102`（get 轮询）、`:121`（依赖项） |
| 2 | `lib/manual-capture.js` 实现 `PUT /api/lab-capture-upload?token=`，含任务绑定/20 分钟/100 MB/文件名清洗/PDF-SI 校验/原子落盘/回填 bundle | ✅ 准确，但**常量归属写错** | 端点实现在 `lib/manual-capture.js:44,135,345,385`；`CAPTURE_TTL_MS = 20*60*1000` 与 `CAPTURE_MAX_BYTES = 100*1024*1024` 实际定义在 `src/manual-capture.js:27,30` |
| 3 | `desktop/src/index.html` + `client/src/lib.js` 有 postMessage 桥接，支持 `OPEN_IN_EDGE` 与 `OPEN_ARTIFACT_IN_BROWSER` | ✅ 准确，**且实际消息更多** | `index.html:334-394` 共 7 个分支：另外还有 `SYNC_THEME`、`SAVE_ARTIFACT`、`SAVE_TEXT_ARTIFACT`、`OPEN_ARTIFACT`、`OPEN_SAVED_PATH`、`REVEAL_SAVED_PATH`；`lib.js:216,241` 是对应 helper |
| 4 | `main.rs` 已有外部 Edge 打开逻辑与主窗口关闭回收 | ✅ 准确 | `main.rs:352 launch_edge`、`:392-397 on_window_event` 仅处理 `main` |
| 5 | `src/literature/data-sources.js`、`lib/literature-sources.js` 已定义机构访问会话及 `waiting-login`；`cordis.patch.yml` 桌面模式为 `desktop-edge-handoff` | ✅ 准确 | `cordis.patch.yml:148 browserMode: 'desktop-edge-handoff'`、`:145-146` 注释列出 `managed-edge` 备选、`:142 institutionPortalUrl` |
| 6 | Tauri 2.11.x 提供 `data_directory`/`on_navigation`/`on_new_window`/`on_download`，可实现独立持久化 WebView2 会话及下载回调 | ✅ **实测证实** | 见 §4，含签名与语义细节 |

**小结**：§2.1 的六项声明无一项是错的，工程质量可信。唯一需要修的是第 2 条的常量归属表述。

---

## 3. 必须修正的错误假设（会直接导致返工）

### 3.1 文件不存在：`client/src/styles.css`

| 项 | 内容 |
|---|---|
| 计划原文 | §10 清单：`` `client/src/styles.css` 或现有样式文件 `` |
| 实际情况 | ❌ **该文件不存在**。样式是 JS 模块：`client/src/styles.js`（另有 `theme.js`） |
| 影响 | 计划已用「或现有样式文件」留了后路，但明确写出来可避免开发 Agent 走错 |
| 修正 | 改为 `client/src/styles.js` |

### 3.2 测试落位错误：Rust 单测不在 `tests/unit/`

| 项 | 内容 |
|---|---|
| 计划原文 | §10：`` `tests/unit/*webvpn*`（新增）`` 用于「URL、状态机、消息桥接、配置兼容测试」；§12.1 标题为「Rust 单元测试」 |
| 实际情况 | ❌ 本仓库 **不存在独立的 Rust 测试文件**。全部 10 个 Rust 测试模块都是源文件内联的 `#[cfg(test)] mod tests` |
| 证据 | `main.rs:422`、`runtime/{bridge,config,deps,dsh,files,health,mcp,port,process}.rs` 共 10 处 `#[cfg(test)]`；根 `tests/unit/` 全是 `*.test.mjs`，由 `node --test` 驱动 |
| 影响 | 按计划字面执行会产出 Node 测试目录里的 Rust 测试或无法运行的孤立文件 |
| 修正 | **Rust 的 URL 校验/状态机/PendingCapture/配置兼容测试 → 写进 `desktop/src-tauri/src/webvpn.rs` 的内联 `#[cfg(test)] mod tests`**（该文件新建）；**消息桥接/客户端契约测试 → `tests/unit/webvpn-bridge.test.mjs`**（Node） |

补充：现有 Rust 测试的断言消息是**中文**（如 `"应拒绝非法 bundle id"`，`main.rs:457`），新测试应保持一致。

### 3.3 `DownloadEvent::Finished.path` 是 `Option<PathBuf>`

| 项 | 内容 |
|---|---|
| 计划原文 | §6.1：「`Finished(success=true)`：…**读取临时文件**…上传」 |
| 实际情况 | ⚠️ 签名是 `Finished { url: Url, path: Option<PathBuf>, success: bool }`，官方文档明确写着：`path` 为 `None` **不一定代表下载失败**，可能是其它原因；且 **macOS 上恒为空** |
| 证据 | `tauri-2.11.5/src/webview/mod.rs:86-102` |
| 影响 | 直接 `path.unwrap()` 会在边界情况下 panic；对「成功但无路径」的情形无处理分支 |
| 修正 | 状态机需新增一类结果：`success == true 但 path 为 None` → 记为可诊断失败（提示用户改为通过 WebView 内下载按钮重试或回退 Edge），**而不是**当作成功去读一个不存在的文件 |

### 3.4 `devtools` 已天然关闭，但调试期也受影响

| 项 | 内容 |
|---|---|
| 计划原文 | §7.2：「release 构建关闭 WebVPN WebView devtools」 |
| 实际情况 | ✅ **已天然满足，无需任何改动**。`open_devtools` 系列 API 受 `#[cfg(any(debug_assertions, feature = "devtools"))]` 门控，而 `Cargo.toml` 未启用 `devtools` feature |
| 证据 | `tauri-2.11.5/src/webview/webview_window.rs:2438,2471,2502`；`desktop/src-tauri/Cargo.toml` 中 `tauri = { version = "2.11.5", features = [] }` |
| 影响 | 计划把它列为待办属于**过度设计**，可从清单移除。但反向影响是：**调试 WebVPN 窗口必须用 debug 构建**（`cargo tauri dev` / debug profile），release 包里没有任何查看手段。这条应写进开发说明，否则调试期会反复困惑 |
| 修正 | 从待办移除；在 `docs/ARCHITECTURE.md` 补一句「WebVPN 窗口调试仅限 debug 构建」 |

### 3.5 `capabilities/default.json` 无需改动

| 项 | 内容 |
|---|---|
| 计划原文 | §10：「`capabilities/default.json` — 核对动态 `webvpn` 窗口无 IPC 权限」 |
| 实际情况 | ✅ **已天然满足**。该文件 `"windows": ["main"]`，权限仅 `core:default`，`webvpn` 窗口不在授权列表内，天然无任何命令权限 |
| 证据 | `desktop/src-tauri/capabilities/default.json` 全文 7 行 |
| 影响 | 属**核对项**而非改动项。计划的措辞已偏向核对，可保留但降级为「加一条断言」 |
| 修正 | 改为在 `verify-package.ps1` 增加断言：`windows` 数组**必须且只能**是 `["main"]`——防止未来有人图省事加上 `webvpn` 而开后门 |

### 3.6 `Cargo.toml` 无需新增依赖

| 项 | 内容 |
|---|---|
| 计划原文 | §10：「`Cargo.toml` — 仅在实现需要时增加异步 HTTP/临时文件依赖；优先复用现有依赖」 |
| 实际情况 | ✅ 现有依赖**已够用**：HTTP 上传可用 `reqwest`（已有 `blocking` + `rustls-tls` feature）；URL 解析用 `url`；文件名 URL 编码用 `percent-encoding`；哈希用 `sha2` |
| 证据 | `desktop/src-tauri/Cargo.toml` 依赖清单 |
| 需要注意 | `on_download` 的回调签名是 `Fn(...) -> bool + Send + Sync + 'static`，**是同步闭包**。上传是阻塞 I/O，必须在回调里 `std::thread::spawn`（或 `tauri::async_runtime::spawn`）后立即返回 `true`，否则会卡死 WebView2 的下载线程 |
| 修正 | 明确写入实施说明：**下载回调不阻塞、上传在独立线程** |

---

## 4. Tauri 2.11.5 API 实测结论

在本地 Cargo 依赖源码中直接验证，非文档推测。

| API | 位置 | 可用 | 关键语义 |
|---|---|---|---|
| `WebviewWindowBuilder::data_directory` | `webview_window.rs:1024` | ✅ | 接收 `PathBuf`，用于隔离专属 WebView2 profile |
| `.on_navigation(Fn(&Url) -> bool)` | `webview_window.rs:266` | ✅ | 返回 `false` 阻止导航。**这是白名单的实现点** |
| `.on_new_window(Fn(Url, NewWindowFeatures) -> NewWindowResponse<R>)` | `webview_window.rs:315` | ✅ | 可决定放行/收敛回主窗口/拒绝。**弹窗策略的实现点** |
| `.on_download(Fn(Webview<R>, DownloadEvent) -> bool + Send + Sync)` | `webview_window.rs:384` | ✅ | 返回 `false` 取消下载 |
| `DownloadEvent::Requested { url, destination: &mut PathBuf }` | `webview/mod.rs:77-84` | ✅ | **可直接改写 `destination`**，赋绝对路径即可重定向到应用私有临时目录——正是计划 §6.1 需要的 |
| `DownloadEvent::Finished { url, path: Option<PathBuf>, success }` | `webview/mod.rs:86-102` | ✅ 有坑 | 见 §3.3，`path` 可为 `None` |
| wry 后端是否启用 | `Cargo.lock` | ✅ | `tauri-runtime-wry` 与 `wry` 均在依赖树中 |

补充说明：`Cargo.toml` 写的是 `features = []` 而非 `default-features = false`，因此 `default` feature 组（含 `"wry"`）**仍然启用**。这是本项假设成立的原因，容易被误读，特此标注。

---

## 5. 计划未覆盖的风险

按严重度排序。

### R1 🔴 一次性 token 泄漏进日志（高）

**问题**：新链路要求把含 token 的完整 `uploadUrl` 从客户端 postMessage 给 shell。而 `desktop/src/index.html` 现有的消息处理分支**有打日志的习惯**（`index.html:357`、`:360`、`:365` 三处 `console.log`/`console.error` 打印打开请求详情）。

**后果**：一旦照抄该模式，一次性 token 会进入 shell 控制台日志，直接违反计划 §7.3 和 §13「不保存或记录学校凭据、Cookie、一次性 token」。

**处置**：在 `index.html` 的 `WEBVPN_*` 分支中**禁止打印 `uploadUrl` 与 `targetUrl` 的完整值**，只允许打印 `taskId`、`kind`、目标 host。并为此单独加一条自动化断言（见 §6 第 10 条）。

### R2 🔴 两层单例状态可能死锁（高）

**问题**：计划 §4.3 要求 Rust 侧维护单例 `PendingCapture`，拒绝第二个任务。但**服务端也已经是单例**：`src/manual-capture.js:297` 只在 `status === "armed"` 且未过期时才可复用，否则新建。

**后果**：若 Rust 侧拒绝了 `WEBVPN_OPEN_CAPTURE`，而服务端已经创建并 armed 了新任务，就会出现「服务端有一条永远等不到下载的 armed 任务，客户端以为没有任务」的错位。用户点一次「取消」都不一定能清掉。

**处置**：
- 顺序固定为 **先问 Rust 有无 pending，再创建服务端任务**，而不是先创建后登记；
- 或者在 Rust 拒绝时，由客户端**立即调用取消接口**回收刚创建的服务端任务；
- 无论选哪条，都要有一条测试覆盖「第二个捕获请求被拒后，服务端不残留 armed 任务」。

### R3 🟡 20 分钟 TTL 与登录耗时冲突（中）

**问题**：服务端 TTL 是 20 分钟，**从 `manual_capture_create` 时刻起算**。而首次使用 WebVPN 需要完成统一身份认证 + 可能的验证码/二次验证，耗时可能 5–10 分钟。

**计划内部其实是自洽的**：§8.2 明确说「WebVPN 未配置或未确认登录时，点击主操作**先打开登录窗口**，登录确认后**再**继续创建捕获任务」。这个时序能规避问题。

**风险**：这条时序约束很容易在实现时被简化成「点击即创建任务并跳转」，从而把 20 分钟窗口浪费在登录上。

**处置**：把「create 必须发生在登录确认之后」写成显式的前置条件与测试用例，不要依赖注释传达。

### R4 🟡 导航白名单可能锁死登录且无逃生阀（中）

**问题**：计划 §7.2 要求 `on_navigation` 只放行白名单域名。USTC 统一认证体系可能涉及多个域名（认证页、验证码服务、二次验证），第零阶段探测一旦漏掉一个，用户会**卡在登录页且无法自救**——因为拒绝导航是静默的。

**处置**：
- 被拒导航**必须记录被拒域名**（这本身不敏感）；
- 提供显式的「本次放行该域名」入口，由用户确认后加入临时白名单；
- 补一条测试：被拒域名会产生可诊断错误而不是空白页。

### R5 🟡 单例窗口与真实「多标签」行为的冲突（中）

**问题**：计划 §4.1 要求 `webvpn` 窗口单例。但出版社站点常用 `target=_blank` 打开 PDF 或跳转。计划 §7.2 给的方案是「用共享 WebView2 环境创建受管窗口，**或**把新窗口导航收敛回 `webvpn` 主窗口」，二选一留给第零阶段。

**风险**：如果选择「创建受管窗口」，就出现**第二个窗口**，与 §13 验收标准「WebVPN 始终为单例窗口」字面冲突。这是计划内部的**潜在矛盾**，需要在第零阶段用实测行为拍板，并同步修订验收标准措辞（例如明确「单例指门户窗口，弹窗为受管从属窗口」）。

**处置**：第零阶段必须把这条作为必答项，并据此修订 §13 的验收表述。

### R6 🟡 内联 PDF 时用户零反馈（中）

**问题**：计划 §6.2 已承认内联 PDF 不触发 `on_download`，并要求 UI 提示「请点击下载按钮」。但计划没有给这个状态设**超时**。

**后果**：用户停在这个状态去干别的，任务在 20 分钟后静默过期，用户回来看到的是一个已经失效的「等待下载中」。

**处置**：`waiting-download` 状态显示剩余有效期倒计时，并在过期时自动切到 `expired` 且给出可重试操作。

---

## 6. 验收标准 → 可自动化断言映射

将计划 §13 的 12 条验收标准逐条拆解。图例：🤖 可完全自动化 / 🧑 必须人工 / 🤖+🧑 混合。

| # | 计划验收标准 | 可自动化？ | 断言/验证方式 | 落位 |
|---|---|---|---|---|
| 1 | 用户可从软件内打开并登录 USTC WebVPN | 🧑 | 需真实凭据，无法自动化 | 安装包人工验收 |
| 2 | 关闭/再次打开 WebVPN 窗口不丢登录态 | 🤖+🧑 | 假门户写 Cookie → 触发 hide → `show` → 断言 Cookie 仍在 | `tests/integration/webvpn-session.test.mjs` |
| 3 | 连续访问三个不同出版社不重复登录 | 🧑 | 需真实站点 | 安装包人工验收 |
| 4 | WebVPN 始终为单例窗口 | 🤖 | 连续调用两次 `webvpn_open_login`，断言 `app.webview_windows().len()` 中 `webvpn` 恰为 1 | `webvpn.rs` 内联单测 |
| 5 | 文献条目可创建捕获任务并把 URL 交给 WebVPN | 🤖 | 断言 postMessage 的 `type`/`requestId`/payload 字段集合与规范化结果 | `tests/unit/webvpn-bridge.test.mjs` |
| 6 | 点击下载后 PDF 经现有接口校验并归档到正确 bundle | 🤖+🧑 | 假门户提供 attachment PDF → 断言上传后 bundle 路径/哈希/状态正确 | 扩展 `tests/integration/manual-capture.test.mjs` |
| 7 | 同一时间只捕获一个，过期或旧回调不污染新任务 | 🤖 | 状态机：并发第二次被拒、`generation` 递增后旧回调被丢弃、过期任务不可复用 | `webvpn.rs` 内联单测 |
| 8 | 内联 PDF、登录失效、网络失败有明确提示与可执行恢复 | 🤖+🧑 | 断言每种失败映射到确定的 status + 提示文案 + 恢复动作 | `tests/unit/webvpn-bridge.test.mjs` + 人工 |
| 9 | 外部 Edge 捕获和 OA 自动下载保持可用 | 🤖 | **回归**：现有 `capture-handoff.test.mjs` / `artifact-download.test.mjs` 必须全绿 | 既有测试套件 |
| 10 | 不保存或记录凭据、Cookie、一次性 token、完整 SSO URL | 🤖 | 扫描测试：对日志/配置文件断言不含 token 明文、Cookie、`?token=`、SSO ticket 形态字符串 | 新增 `tests/unit/webvpn-secrets-scan.test.mjs` |
| 11 | 清除登录状态彻底重建专属 profile 且不触碰目录外文件 | 🤖 | 传入逃逸路径（`..`、绝对路径、符号链接）断言拒绝；断言删除范围限于应用数据目录内 | `webvpn.rs` 内联单测 |
| 12 | 自动测试、打包检查与真实安装包验收通过 | 🤖+🧑 | `verify-package.ps1` 增加 WebVPN 断言；真实包人工走查 | `desktop/scripts/verify-package.ps1` |

### 6.1 计划 §12.1 的 Rust 单测清单 → 全部落到 `webvpn.rs` 内联模块

计划 §12.1 列了 8 类 Rust 测试，全部可行，但**落位改为内联**：

1. 门户 URL、目标 URL、上传 URL 的正反例
2. 私网、loopback、危险 scheme、凭据 URL、超长 URL 拒绝
3. 单例窗口与 close-to-hide
4. `PendingCapture` 创建 / 并发拒绝 / 取消 / 过期 / generation 防串单
5. 临时路径始终位于应用临时目录，文件名不能目录逃逸
6. 下载成功、失败、上传 4xx/5xx、网络中断后的状态与清理
7. 配置旧版本读取与新版本 round-trip，不产生凭据字段
8. **（新增）** `Finished { success: true, path: None }` 的行为 ✅ 对应 §3.3

第 3 条需要 Tauri 运行时上下文，纯单测较难；建议把「单例判定」抽成纯函数（参考 `main.rs:240 validate_open_request` 的抽法），再对纯函数做单测，窗口创建本身放人工验收。

> 现有 `main.rs` 已经示范了这个模式：`validate_open_request`、`artifact_read_url`、`preflight_pdf` 都是抽出来可直接测的纯函数，甚至自己起 `TcpListener` 假服务器（`main.rs:428`）。新代码应沿用同一风格。

### 6.2 假门户集成测试的正确边界

计划 §12.3 提醒「测试逻辑需保持与生产 URL 校验分离」——这条很重要且正确。具体落法：

- 生产校验函数（如 `verify_upload_url`）接收**运行时端口**作为参数，测试传入假端口；
- 假门户的域名/host 白名单通过**测试专用配置注入**，而不是在生产代码里写 `if cfg!(test)`；
- 否则会出现「测试通过但生产拒绝」或反向的假阳性。

---

## 7. 开工前阻塞项

### 🔴 B1 工作树不干净

当前 `release-0.4.3` 分支有 **6 个文件未提交**（均为 0.4.3 相关的运行环境与打包修复）：

```
 M desktop/scripts/prepare-runtime.ps1
 M desktop/scripts/verify-package.ps1
 M desktop/src-tauri/src/runtime/health.rs
 M desktop/src-tauri/src/runtime/mcp.rs
 M desktop/src-tauri/src/runtime/process.rs
 M tests/unit/windows-release-scripts.test.mjs
?? docs/WEBVPN_IN_APP_BROWSER_DEVELOPMENT_PLAN.md
```

**为什么必须先清场**：WebVPN 功能会改到 `verify-package.ps1`——它与上面未提交的改动**同一个文件**。混在一起后，阶段验收无法用 diff 区分「回归」和「新增」，出问题也不好二分定位。

**建议**：先把这 6 个改动独立提交（或 stash），确认基线干净，再拉 WebVPN 分支开工。

### 🔴 B2 阶段 0 无法由开发 Agent 独立完成

计划 §11 阶段 0 的退出条件是「Nature、ACS、ScienceDirect 至少各有一次可复现的手动跳转记录」，§5.1 还要求登录后手动输入 DOI 并记录完整导航链。

这些**都需要用户本人的学校账号与验证码**。开发 Agent 既不应也无权获取。可行的分工是：

| 角色 | 职责 |
|---|---|
| 开发 Agent | 交付一个**只读探测脚手架**：单例 window + `on_navigation` 记录器 + `on_download` 记录器 + 落盘日志（不含 Cookie/凭据），并在退出后汇总导航链到文件 |
| 用户 | 在脚手架里登录 USTC WebVPN，手动访问三个目标站点，分别点一次下载 |
| 开发 Agent | 读日志反推转发规则、SSO 域名清单、弹窗行为、PDF 是下载还是内联，产出 provider 夹具与白名单 |

这个分工能让阶段 0 从「纯人工」变成「人工 20 分钟 + Agent 自动化分析」。

---

## 8. 修正后的实施清单

### 阶段 -1（新增）：清场与基线

- 提交或 stash 上述 6 个未提交改动
- 确认 `npm test` 与 `cargo test` 在基线上全绿
- 记录基线 commit hash 作为二分基准
- **退出条件**：工作树干净，基线测试全绿

### 阶段 0：协议与行为探测（🔴 需用户配合）

- 交付只读探测脚手架（见 B2 分工）
- 产出：门户 URL、转发规则、SSO/弹窗域名清单、PDF 是下载还是内联、跨重启会话结论
- 用实测结论**修订计划 §5.2 的 provider 接口与 §13 的单例表述**（对应 R5）
- **退出条件**：三个目标站点各一次可复现手动跳转记录

### 阶段 1：WebVPN 单例窗口

- 不再是「新增配置 + manager」这么简单，需明确：**单例判定抽为纯函数**以便单测
- 专属 `data_directory`、创建/显示/隐藏、登录确认、清除会话
- `on_navigation` 白名单 + **被拒域名可诊断 + 逃生阀**（对应 R4）
- 不接下载归档
- **退出条件**：登录一次后隐藏/显示三次，仍能访问三个目标站点、不重复登录、不产生第二窗口

### 阶段 2：下载捕获闭环

- `PendingCapture` 状态机，**顺序固定为先查 Rust 再创建服务端任务**（对应 R2）
- `on_download` 回调内**不阻塞**，上传走独立线程（对应 §3.6）
- 显式处理 `Finished { success: true, path: None }`（对应 §3.3）
- `waiting-download` 带倒计时与自动过期（对应 R6）
- **退出条件**：真实 PDF 经 WebVPN 下载后归档到正确 bundle，原客户端轮询可见完成

### 阶段 3：客户端体验

- 全局 WebVPN 卡片（`client/src/components-literature.js`）
- 统一三处入口：`components-project.js`（bundle + 搜索结果）、全文队列
- 样式改 **`client/src/styles.js`**（不是 .css，对应 §3.1）
- **改完必须 `npm run build:client` 并提交产物**（对应 §1.3）
- **index.html 的 WEBVPN 分支禁止打印 uploadUrl/targetUrl 完整值**（对应 R1）
- **退出条件**：三处入口行为一致，错误信息能明确告诉用户下一步

### 阶段 4：安全、回归与打包

- Rust 单测写进 `webvpn.rs` 内联模块，**用中文断言消息**（对应 §3.2）
- `tests/unit/webvpn-bridge.test.mjs` + `tests/integration/webvpn-*.test.mjs` 新增
- `tests/unit/webvpn-secrets-scan.test.mjs` 扫描 token/Cookie 泄漏（对应 R1）
- `verify-package.ps1` 增加断言：capabilities 的 `windows` **必须且只能是** `["main"]`（对应 §3.5）
- 回归：`capture-handoff.test.mjs`、`artifact-download.test.mjs`、`manual-capture.test.mjs` 必须全绿
- 更新 `docs/ARCHITECTURE.md`、`docs/MANUAL_CAPTURE.md`，并补「WebVPN 窗口调试仅限 debug 构建」（对应 §3.4）
- **退出条件**：自动化检查全通过；外部 Edge 捕获、OA 自动下载、已归档文件打开、DSH 启动/鉴权无回归

---

## 9. 计划 §10 文件清单修正对照表

| 计划原文 | 修正后 | 原因 |
|---|---|---|
| `client/src/styles.css` 或现有样式文件 | **`client/src/styles.js`** | 文件不存在（§3.1） |
| `tests/unit/*webvpn*`（URL、状态机、消息桥接、配置兼容） | **`desktop/src-tauri/src/webvpn.rs` 内联 `#[cfg(test)]`** 承载 Rust 测试；**`tests/unit/webvpn-bridge.test.mjs`** 承载消息桥接测试 | 仓库无独立 Rust 测试文件（§3.2） |
| `tests/integration/*webvpn*`（新增） | ✅ 保留，并扩展既有 `tests/integration/manual-capture.test.mjs` | 路径正确 |
| `Cargo.toml` 仅按需增加依赖 | ✅ **实际无需改动**；需注明下载回调不可阻塞 | 现有依赖已够（§3.6） |
| `capabilities/default.json` 核对 webvpn 无权限 | ✅ 降级为 `verify-package.ps1` 的断言 | 已天然满足（§3.5） |
| （缺失）| **新增 `tests/unit/webvpn-secrets-scan.test.mjs`** | 覆盖 R1 |
| （缺失）| **`desktop/src/index.html` 需增加日志脱敏约束** | 覆盖 R1 |
| 其余 12 项 | ✅ 全部准确，原样保留 | — |

---

## 10. 需要用户决策的开放问题

| # | 问题 | 影响 |
|---|---|---|
| Q1 | 是否同意先提交那 6 个未提交改动以清空工作树？（B1） | 阻塞开工 |
| Q2 | 阶段 0 是否采用 §7 B2 的「脚手架 + 用户登录」分工？ | 决定阶段 0 能否启动 |
| Q3 | 跨应用重启是否保留 WebVPN 登录态？（计划默认保留 + 提供清除入口） | 影响 §4.1 的实现与验收表述 |
| Q4 | 弹窗策略选「受管从属窗口」还是「收敛回主窗口」？ | 与「单例」验收标准冲突，需第零阶段实测后拍板（R5） |
| Q5 | 本需求是否占用 `0.4.4` 版本号？（当前 `Cargo.toml` 仍是 `0.4.3`） | 影响 `release-version-consistency.test.mjs` 是否需同步改 |

---

## 11. 阶段 -1 执行记录（已完成）

### 11.1 清场结果

原 6 个未提交改动已提交，工作树干净。

| 提交 | 内容 |
|---|---|
| `740c899` | `fix(desktop): complete the DSH 0.1.5 embedded-WebView auth plumbing`（5 个文件） |
| `7501f98` | `docs(webvpn): add the in-app browser plan and its pre-implementation review` |

其中 `desktop/src-tauri/src/runtime/mcp.rs` 经核实**纯属行尾假脏**：`git diff --numstat` 为空，暂存后自动从状态中消失，无内容改动。它与仓库既有的 `.gitattributes` 策略（`.toml` 已 pin 成 LF）是同类现象，但 `.rs` 未声明 `eol=lf`，因此会周期性出现这种"看起来脏但实际干净"的条目。

### 11.2 基线测试结果

| 套件 | 命令 | 结果 |
|---|---|---|
| Rust 单元测试 | `cargo test`（在 `desktop/src-tauri`） | ✅ 70 通过 / 0 失败 / 1 ignored |
| Node 单元测试 | `node --test "tests/unit/*.test.mjs"` | ✅ 294 通过 / 0 失败 |
| Node 集成测试 | `node --test "tests/integration/*.test.mjs"` | ✅ 66/66 通过（初测 62 失败，已修复，见 11.3） |
| 全量 | `npm test` | ✅ 360 通过（偶发 1 例既有 flaky，见 11.3 末） |

### 11.3 集成测试阻塞：已定位并修复

**初次观测**：集成测试整套跑出现 62/66 失败，一度看起来与仓库代码无关。

**根因（已确认）**：62 个失败对应 62 条错误，**单一根因，无第二种错误类型**：

```
[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]
{"count":80,"threshold":50,"targets":["...Temp\\dsh-lab-agent-boot-XXXX\\node_modules\\@deepseek-ai"]}
```

`tests/helpers/boot-lite.mjs` 为模拟真实 DSH profile，在临时目录里建 `@deepseek-ai` 与
`dsh-lab-agent` 两个 junction 软链，然后用 `fs.rm(dir, {recursive:true})` 清理。
Windows 上这次递归会**顺着 junction 走进仓库的 `node_modules`**——既是丢失依赖树的风险，
删除量也足以触发宿主的批量删除保护。单文件运行正常（`manual-capture.test.mjs` 10/10）、
两个文件一起也正常，只有整目录跑才会级联失败，这正是它难以定位的原因。

**修复（提交 `a41c03a`）**：新增 `removeBootDir`，先用
`fs.rm(link, {recursive:false, force:true})` 逐个摘除链接（实测只删链接本身，
其后的 240 个目标条目完好），**之后**才递归删除剩余目录。同时：

- 清理失败只告警、不再向上抛——环境拒绝删除不应该让通过的断言看起来像代码坏了；
- `dispose()` 仍保留 `ctx.fiber.dispose()` 的异常（那是真实的插件拆除缺陷信号），
  但把目录清理挪进 `finally`，保证一定执行且不覆盖原始错误；
- 新增 `tests/unit/boot-lite-cleanup.test.mjs` 锁住「先解链接后递归」的顺序契约，
  以及最重要的安全属性：清理 profile **绝不能删除 junction 指向的依赖树**。

**修复后结果**：

| 套件 | 修复前 | 修复后 |
|---|---|---|
| `tests/integration/*.test.mjs` | 62/66 失败 | ✅ **66/66 通过** |
| `npm test`（unit + integration） | 42 失败 | ✅ **360 通过** |

**残余现象（非阻塞）**：日志里仍有 `boot-lite: 解除链接失败` 告警。原因是该沙箱按
**单轮累计删除量**限流（`count: 82`，`threshold: 50`，`scope: "turn"`）：一轮内删除累计超过
50 条后，本轮后续所有删除请求都被拒绝。因此 `%TEMP%` 下的 `dsh-lab-agent-boot-*` 残留目录
（观测到 881 个）在本环境内无法自动回收。这是环境限制，不影响测试结论。

**对计划的影响（结论已更新）**：计划 §11 阶段 -1 的退出条件与 §13 第 12 条
**可以**继续依赖完整 `npm test`。唯一需要留意的是
`evidence-shot-handler.test.mjs` 里的 `killPythonTree` 用例——它用 3 秒硬超时判断进程树终止，
在机器高负载时会偶发失败（实测：整轮跑偶发 1 例失败，单独跑 3/3 全过）。这属于既有的
时序脆弱性，与本需求无关，但会影响阶段 4 的「所有自动化检查通过」判据，建议在此前把该
超时放宽或改为轮询等待。


---

## 12. 阶段 0 探测操作手册

阶段 0 的脚手架已于 `7a33bf2` 落地。执行方式如下。

### 12.1 前置

必须使用 **debug 构建**（探测面板只在 debug 出现，这与 devtools 仅在 debug 编译是同一约束）：

```bash
cd desktop/src-tauri && cargo tauri dev
```

若 `cargo tauri` 不可用，用仓库现有的一键脚本或在 `desktop/` 下走常规 Tauri dev 流程。

### 12.2 操作步骤

1. 打开右上角 **诊断** → 最下方出现 **「WebVPN 探测（仅开发构建）」** 面板。
2. 在输入框填入学校 WebVPN 门户地址（默认占位 `https://webvpn.ustc.edu.cn/`），点 **打开 WebVPN**。
3. 在弹出窗口中完成**统一身份认证**（含验证码 / 二次验证，由用户本人操作）。
4. 依次访问 **Nature、ACS、ScienceDirect** 各一次，并在每个站点**点击一次 PDF 下载**。
5. 关闭窗口（只会隐藏），再次点 **打开 WebVPN**，确认无需重复登录。
6. 回到面板点 **刷新记录**，然后把日志目录里的 `webvpn.log` 一并提供。

### 12.3 需要从记录中读出的结论

| 待确认项 | 记录中的观察点 |
|---|---|
| 门户 URL | 第一条 `navigation` 事件 |
| 转发规则 | 输入 DOI 后出现的 `navigation` 序列与**最终代理 URL 的路径结构** |
| SSO / 二次验证域名 | 登录过程中的全部 `navigation` host |
| 弹窗行为 | `newWindow` 事件（阶段 0 为默认放行，仅观察） |
| PDF 是下载还是内联 | 有无 `downloadRequested`；有则看 `defaultDestination` 的文件名与类型 |
| 跨重启会话 | 重启应用后再打开，是否仍为已登录态 |

### 12.4 已知限制

- **阶段 0 不拦截导航**（`enforce=false`）。这是刻意的：白名单正是本阶段要测的东西，提前上拦截会把登录流程自己锁死，且用户无法自救。探测期间请勿把 debug 包当作日常浏览器使用。
- **阶段 0 不改写下载路径**，保留 WebView2 默认落盘位置，以便判断出版社给的是附件还是内联预览。捕获归档在阶段 2 接入。
- 记录只保留最近 **800** 条，且只写脱敏后的 URL / host / 错误类别；不含 Cookie、凭据、一次性令牌。

---

## 13. 阶段 1 执行记录（配置接入 + 状态机，已完成；转发未接）

阶段 0 依赖用户亲自登录，无法由开发 Agent 独立完成。因此先推进**不依赖探测结果**的
阶段 1 部分：配置接入与 §4.2 状态机。**转发规则明确不做**——那正是阶段 0 要测得的东西，
提前猜测会直接返工。

| 提交 | 内容 |
|---|---|
| `6bafed9` | `feat(desktop): add the WebVPN navigation policy and session state machine`（7 个文件，+1133/−38） |

### 13.1 已落地内容

| 项 | 位置 | 说明 |
|---|---|---|
| 配置结构 | `runtime/config.rs::WebVpnConfig` | `portal_url` / `allowed_hosts` / `enforce_navigation` 三者全部 `#[serde(default)]`；`portal_url` **默认为空串**，不写死任何未验证域名 |
| 配置兼容 | 同上 | 旧 `config.json` 无需迁移：字段缺省即回填默认值，新增测试锁定该行为 |
| 会话状态机 | `webvpn.rs::WebVpnSessionState` | 6 态（`closed`/`opening`/`waiting-login`/`ready`/`navigating`/`error`），迁移合法性集中在 `can_transition_to` 单点收口；非法迁移**返回 `Err` 而不静默改写** |
| 导航策略 | `webvpn.rs::WebVpnPolicy` | `from_config`（门户自身始终放行）/ `record_only`（阶段 0 只记录）；后缀安全匹配，`notdoi.org` 不命中 `doi.org` |
| 逃生阀 | `denied_hosts` + `webvpn_allow_host` | 被拦域名进入 `deniedHosts`，用户确认后放行**并写回配置**（对应 R4） |
| 命令 | `main.rs` | `webvpn_open_login` / `webvpn_confirm_login` / `webvpn_allow_host` / `webvpn_set_policy` / `webvpn_status`，全部已注册进 `generate_handler!` |
| 调试面板 | `desktop/src/index.html` | 在既有 debug-only 面板内扩展「阶段 1 · 导航白名单」区块 |

**UI 仍留在 debug-only 面板内**，不进正式界面：门户地址与域名清单要等阶段 0 实测确认，
在此之前把未验证域名写进发布包正是计划明令禁止的。正式界面属阶段 3。

### 13.2 实施中发现并修正的缺陷

| # | 缺陷 | 性质 | 修正 |
|---|---|---|---|
| 1 | `crate::runtime::config::WebVpnConfig` —— `config` 是私有模块 | 🔴 编译失败（2 处） | 把 `WebVpnConfig` 加入 `runtime` 的公开再导出，改 `runtime::WebVpnConfig` |
| 2 | `RuntimeManager::save_webvpn_config` 被调用但从未定义 | 🔴 编译失败 | 在 `runtime/mod.rs` 补齐，并注明**登录态一律不进配置** |
| 3 | 5 条阶段 1 命令漏注册 `generate_handler!` | 🔴 命令不可达（编译期无法发现） | 全部补注册 |
| 4 | `open_window` 复用分支无条件走 `Opening` | 🔴 逻辑缺陷 | `Ready → Opening` 本就非法（防状态漂移），复用已有窗口时会把"重新打开"直接**报错**；改为「窗口不存在则先归零再 Opening」，并新增 `enter_reused_session` |
| 5 | 复用窗口会强制回到 `waiting-login` | 🟡 体验缺陷 | 已确认的会话被降级，用户每点一次"打开"就要重新确认一次；`enter_reused_session` 对 `ready`/`navigating` 保持不变 |
| 6 | `webvpn_clear_session` 销毁窗口但未归零会话状态 | 🟡 状态自相矛盾 | 补 `mark_closed()`，否则 `webvpn_status` 会报出 `state=ready` 且 `windowOpen=false` |
| 7 | `status` 把「用户配置意图」与「实际生效策略」混为一谈 | 🟡 信息缺失 | 新增 `configured_allowed_hosts` / `configured_enforce_navigation`；探测模式下二者必然不同，UI 必须能分辨 |
| 8 | 测试 `assert!(closed.enforce_navigation)` 实际会失败 | 🟡 错误断言 | 该用例从未 `apply_policy`，生效策略是默认只记录；改断言 `configured_enforce_navigation`，并补断言生效侧为 `false` |
| 9 | 命令名 `webvpn_save_config` 触发既有架构护栏 | 🟡 与仓库既定不变量冲突 | `desktop-native.test.mjs` 断言桌面壳不得注册 `*_config` 形态命令（模型配置由 DSH 托管）；**改名 `webvpn_set_policy`，不放宽护栏** |
| 10 | 新写的护栏测试抓错了函数 | 🟡 测试自身缺陷 | 文件里有两个 `fn record(`（`WebVpnState::record` 方法与模块级落日志入口），改为按完整签名定位 |

其中 #4/#5/#6/#7 是**纯逻辑缺陷**，编译不会报错、也不会被基线测试捕获，属于本阶段新增测试
才把它逼出来的类型。#9 说明仓库既有的架构护栏**确实在起作用**：它拦下的不是我的设计错误，
而是命名碰撞，正确反应是改名而不是改护栏。#10 则是"测试自己写错"的典型，若不深究就会
误以为实现有 bug。

### 13.3 测试结果

| 套件 | 命令 | 结果 |
|---|---|---|
| Rust 单元测试 | `cargo test`（`desktop/src-tauri`） | ✅ **81 通过 / 0 失败 / 1 ignored**（基线 70；`webvpn` 模块 23 条） |
| 编译警告 | `cargo check --all-targets` | ✅ 0 条新增警告（`origin_mcp_package_dir` 为既有存量） |
| 新增护栏测试 | `tests/unit/webvpn-commands.test.mjs` | ✅ 5/5 通过 |
| Node 全量 | `npm test` | ✅ **365 通过 / 0 失败**（基线 360 + 新增 5） |
| 内联脚本语法 | 自建检查 | ✅ `index.html` 内联 JS 语法通过 + 新增 9 个 UI id 全部存在 |

新增的 `tests/unit/webvpn-commands.test.mjs` 锁住 5 条不变量，全部是**编译期无法发现、
只在运行时或安全边界上才暴露**的类型：

1. `index.html` 里 `invoke('…')` 的每个命令都必须在 `generate_handler!` 中注册
   ——漏注册不报编译错误，只在用户点下去的那一刻失败；
2. 阶段 0 探测无法从 release 构建抵达：`probe_available()` 必须只看 `cfg!(debug_assertions)`，
   且唯一以「只记录不拦截」策略开窗的命令必须显式拒绝 release，面板默认隐藏；
3. WebVPN 日志只写脱敏结果：模块级落日志入口必须先 `redact_for_log`，日志行不得引用 `raw_url`；
4. 窗口与主窗口隔离（专属 `data_directory`）、单例判定只认 label、关闭即隐藏（`prevent_close`）；
5. 逃生阀存在：被拒域名可诊断、可放行、并写回配置，且 UI 真的把它渲染成可点击入口。

`begin_navigation` 目前无调用方，标注 `#[allow(dead_code)]` 并注明原因：转发规则须待阶段 0
实测确认，阶段 2/3 由 `webvpn_open_target` 接入；该方法**有单测覆盖**，不是死代码。

### 13.4 阶段 1 退出条件对照

计划 §11 的阶段 1 退出条件为「登录一次后隐藏/显示三次，仍能访问三个目标站点、不重复登录、
不产生第二窗口」。当前状态：

| 子条件 | 状态 |
|---|---|
| 单例窗口、隐藏/显示保留会话 | ⏳ 代码就绪，待阶段 0 后实机验证 |
| 白名单拦截 + 被拒域名可诊断 + 逃生阀 | ⏳ 代码就绪，域名清单待阶段 0 填充 |
| 不重复登录（跨隐藏/显示） | ⏳ 待实机验证（依赖 R3 的 TTL 结论） |
| 不产生第二窗口 | ⏳ 待实机验证（依赖 §12.3「弹窗」结论） |
| 转发到三个目标站点 | ❌ **刻意未做**——转发规则须由阶段 0 实测确定 |

### 13.5 下一步

1. **阶段 0 探测**（需用户亲自登录）：按 §12 操作手册执行，产出域名清单与转发规则。
2. 据实测结论**回填白名单**并把 `enforce_navigation` 翻转为 `true`。
3. 用实测转发规则实现 `webvpn_open_target`，接上 `begin_navigation`。
4. 收尾开放问题 Q3–Q5（跨重启会话保留 / 弹窗策略 / 版本号归属），见 §10。

---

## 14. 阶段 4（无探测依赖部分）执行记录

阶段 0 仍卡在用户登录，因此继续推进阶段 4 中**不依赖探测器输出**的三项。

### 14.1 `killPythonTree` 的时序硬化（不是"修掉了一个可复现的 flake"）

**问题**：`lib/evidence-shot.js::killPythonTree` 以 fire-and-forget 方式
`spawn('taskkill', …)` 后**立即返回**；调用方（`renderPageToPng` 超时分支）紧接着抛出
"已终止渲染进程并清理临时文件"，而进程彼时往往还活着。测试也只能赌一个 3 秒硬 deadline。

**本机实测**：

| 观测 | 数值 |
|---|---|
| `killPythonTree` 同步返回耗时 | **12 ms**（只是 spawn 调用的耗时） |
| 调用后立即检查 `child.killed` | `false`（进程仍在运行） |
| 子进程真正退出耗时 | **904 ms** |

即那 3 秒要覆盖「spawn 延迟 + taskkill 枚举 + 终止 + exit 事件」全链，余量不足 2 倍。
本机进程创建受 EDR 挂钩（§9 亦记录过 PowerShell spawn 被拦截数秒），高负载下余量会被吃光。

**诚实结论**：**本轮未能复现原始失败。** 6 路 CPU 负载下连跑 8 轮新旧对照，旧写法最慢
1.67s，仍在 3s 之内；三连全量 `npm test` 也全部通过。因此本次改动的准确定性是
**时序硬化**——一条真实存在但未能在本环境触发的竞态——而**不是**"修复了一个可复现的 flake"。
把它记为 flake 修复会高估证据强度。

**改动**：

- `killPythonTree` 改为返回可 await 的 Promise（等待 killer 结束）。调用方可 await
  （需要确定性）或忽略返回值（只需尽力而为），向后兼容。
- `renderPageToPng` 超时分支改为**先真正终止进程树再拒绝**，让"已终止渲染进程"成为事实，
  同时避免残留 python/fitz 与下一次渲染抢 CPU 和临时目录。
- 测试先等 `spawn` 事件再杀（`pid` 存在 ≠ 进程已就绪，taskkill 可能扑空），随后 await killer；
  上限由 3s 放宽至 15s——该上限只在真实故障时才会触及。
- 新增断言：任何入参都必须返回可 await 的句柄且不抛异常（终止是尽力而为，不该打断调用方）。

### 14.2 密钥卫生扫描（R1）

新增 `tests/unit/webvpn-secrets-scan.test.mjs`，4 条源码级断言——都是**编译期发现不了、
只在泄漏那一刻才暴露**的类型：

| 断言 | 兜住的风险 |
|---|---|
| 桌面 shell 的每个 `console.*` 实参都不得引用敏感值 | R1 原始风险：新链路要把含 token 的完整 `uploadUrl` 交给 shell，照抄现有打日志习惯就会泄进控制台 |
| `WebVpnConfig` 不得出现凭据/存储类**字段** | 登录态只能由专属 WebView2 profile 承载，配置里不许开第二份 |
| WebVPN 模块不得 `read_dir` / `read_to_string` / `File::open` | 一旦开始读 profile，就等于把 Cookie / Local Storage 纳入应用数据面 |
| `webvpn.log` 只有一个写入点且强制走 `redact_for_log` | 多点写入会让脱敏约定被绕过 |

两处值得记录的实现细节：

- 第 1 条用 `\btoken\b` 而非 `token`：`index.html` 里的 `payload.tokens` 是**主题色**，
  用子串匹配会误报。`\b` 恰好排除 `tokens` 而保留 `token`。
- 第 2 条断言的是**字段声明**而非文档措辞：必须先剥掉 `///` 注释行，否则
  "不得存放任何凭据、Cookie" 这类说明性文字会被自己的断言判为违规。

**变异测试（证明断言非空转）**：逐条注入违规 → 跑测试 → 必须失败 → 立即还原。

| 注入的违规 | 结果 |
|---|---|
| `console.log('leaked token=' + data.payload.uploadUrl)` | ✅ CAUGHT |
| `WebVpnConfig` 增加 `pub cookie: String` | ✅ CAUGHT |
| `resolve_profile_dir` 内调用 `std::fs::read_dir` | ✅ CAUGHT |
| 增加第二个 `logger().write` 写入点 | ✅ CAUGHT |

4/4 全部被捕获，说明这 4 条断言确实在起作用，而不是写了个恒真式。

### 14.3 发布闸门：capabilities 边界（§3.5）

`desktop/scripts/verify-package.ps1` 增加断言：**每一个** capability 文件的 `windows`
必须且只能是 `["main"]`。检查全部文件而非仅 `default.json`，这样**新增 capability 文件
也无法绕过**。WebVPN 等新窗口一旦进入 `windows` 数组就会拿到 IPC 命令面，等于把任意网页
变成客户端入口，这条边界必须由发布闸门兜住，而不是靠人记得。

**行为验证**（不是只做语法检查）：脚本语法用 pwsh 7.6.6 解析通过；并**抽出脚本里的真实检查
代码块**，对 5 个场景实际运行：

| 场景 | 期望 | 结果 |
|---|---|---|
| `windows: ["main"]` | 通过 | ✅ PASS |
| `windows: ["main","webvpn"]` | 抛错 | ✅ PASS（并报出违规窗口名） |
| `windows: ["webvpn"]` | 抛错 | ✅ PASS |
| `default.json` 合法但**额外多一个** `webvpn.json` | 抛错 | ✅ PASS（报出 `webvpn.json`） |
| 仓库真实 capabilities | 通过 | ✅ PASS |

### 14.4 验证结果

| 套件 | 结果 |
|---|---|
| `npm test` | ✅ **370 通过 / 0 失败**（366 + 新增 4） |
| `npm test` 连跑 3 轮 | ✅ 3/3 全绿，`killPythonTree` 用例每次都通过 |
| `cargo test` | ✅ 未受影响（本批无 Rust 改动，阶段 1 的 81 通过保持） |
| `verify-package.ps1` 语法 | ✅ pwsh 7.6.6 解析通过 |

**未做（需探测结果）**：`WEBVPN_*` 消息分支本身（阶段 3）、下载捕获闭环（阶段 2）、
转发规则（阶段 0）。

---

## 附录 A：本次评审使用的证据文件清单

| 文件 | 用途 |
|---|---|
| `desktop/scripts/prepare-runtime.ps1` | 权威源判定（第 147、287、309、464 行） |
| `desktop/.gitignore` | 权威源判定（第 3 行） |
| `.gitignore` | `client/dist` 与 `*.tmp-*` 忽略规则（第 16 行） |
| `scripts/build-client.mjs` | `client/index.js` 是构建产物（第 32、69、74 行） |
| `desktop/src-tauri/Cargo.toml` | 依赖与 feature 判定 |
| `desktop/src-tauri/Cargo.lock` | 确认 `wry` / `tauri-runtime-wry` 在依赖树 |
| `~/.cargo/.../tauri-2.11.5/src/webview/webview_window.rs` | 四个 API 的存在与签名（第 266、315、384、1024 行）+ devtools 门控 |
| `~/.cargo/.../tauri-2.11.5/src/webview/mod.rs` | `DownloadEvent` 定义（第 75–103 行） |
| `desktop/src-tauri/src/main.rs` | 现有命令、窗口事件、纯函数测试风格 |
| `desktop/src-tauri/src/runtime/config.rs` | `DiskConfig` 兼容序列化模式（第 63–82 行） |
| `desktop/src-tauri/capabilities/default.json` | 权限边界已满足 |
| `desktop/src/index.html` | 桥接实现与日志习惯（第 334–394 行） |
| `client/src/lib.js` | 客户端 shell helper 模式（第 216、241 行） |
| `client/src/components-project.js` | `LitPanel` 捕获流程（第 96–152 行） |
| `lib/manual-capture.js` | 上传端点契约（第 44、135、345、385 行） |
| `src/manual-capture.js` | 常量：`CAPTURE_TTL_MS`（第 27 行）、`CAPTURE_MAX_BYTES`（第 30 行） |
| `lib/capture-handoff.js` | 现有 handoff 路径（第 28 行） |
| `cordis.patch.yml` | `browserMode: desktop-edge-handoff`（第 148 行） |
