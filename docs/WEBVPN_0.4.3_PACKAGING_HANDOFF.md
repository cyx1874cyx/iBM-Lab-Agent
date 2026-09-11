# WebVPN 0.4.3 Windows 打包与验收交接

> 编写时间：2026-09-11  
> 工程根目录：`H:\107-iBM-Agent\iBM-Agent\Code\iBM-Lab-Agent`  
> 当前分支：`release-0.4.3`  
> 编写时 HEAD：`25374b0`  
> 目标：把本轮 WebVPN 软件内浏览器改动构建成新的 Windows NSIS 安装包，并完成包级验收。

## 1. 当前结论

本轮代码已经完成调试编译和源码测试，但**尚未生成包含 WebVPN 改动的新安装包**。

`desktop/src-tauri/target/release/bundle/nsis/iBM Lab Agent_0.4.3_x64-setup.exe`
在编写本文时的修改时间为 **2026-09-11 10:40:34**、大小 **222,237,888 B**。它早于本轮
WebVPN 实现，属于旧 0.4.3 包，**不得复制、发布或作为验收对象**。发布脚本虽然会按本轮
构建开始时间筛选新文件，接手 Agent 仍须核对新安装包的时间、SHA256 和 release report。

当前工作树有 16 个已修改文件，并新增了本文档，共 17 个待提交路径：

```text
client/index.js
client/src/components-literature.js
client/src/components-project.js
client/src/lib.js
desktop/src-tauri/Cargo.lock
desktop/src-tauri/Cargo.toml
desktop/src-tauri/src/main.rs
desktop/src-tauri/src/runtime/config.rs
desktop/src-tauri/src/webvpn.rs
desktop/src/index.html
docs/ARCHITECTURE.md
docs/MANUAL_CAPTURE.md
docs/WEBVPN_IN_APP_BROWSER_HANDOVER.md
docs/WEBVPN_IN_APP_BROWSER_PLAN_REVIEW.md
tests/unit/webvpn-commands.test.mjs
tests/unit/webvpn-secrets-scan.test.mjs
docs/WEBVPN_0.4.3_PACKAGING_HANDOFF.md
```

接手后先用 `git status --short` 重新获取真实清单。不要仅根据本文清单执行批量暂存或覆盖。

## 2. 已完成实现与基线验证

本轮已经完成：

- 默认 USTC WebVPN 门户及旧空配置迁移；
- 独立、持久化、单例 WebView2 登录窗口；
- 实测 WRD AES-128-CFB 目标 host 转发 URL；
- Nature、ACS、ScienceDirect 同一 WebVPN 登录会话访问验证；
- PDF/SI 下载回调、受限临时文件、loopback 一次性令牌上传；
- 失败、超时、取消和 Edge 回退时的 pending task 清理；
- 客户端的打开、确认登录、状态刷新、清除登录状态入口；
- WebVPN 窗口无 Tauri IPC capability、日志脱敏及 profile 禁读护栏。

编写本文前的最后一次验证：

| 检查 | 结果 |
|---|---|
| `npm run build:client` 等价 pnpm 命令 | 通过 |
| Node 单元与集成测试 | 372/372 通过 |
| Rust 测试 | 86 通过、0 失败、1 ignored |
| `cargo build` | 通过；只有既有 `origin_mcp_package_dir` dead-code warning |
| DSH 调试启动 | 健康检查通过，不再卡在本地服务加载 |

源码与实测详情见：

- `docs/WEBVPN_IN_APP_BROWSER_HANDOVER.md`
- `docs/WEBVPN_IN_APP_BROWSER_PLAN_REVIEW.md` 的 §15
- `docs/ARCHITECTURE.md` 的 §12
- `docs/MANUAL_CAPTURE.md` 的 WebVPN 小节

## 3. 发布前必须处理

### 3.1 关闭调试实例

打包前退出所有 `iBM Lab Agent` 调试实例，等待其所属 DSH 进程树退出并释放 3080 端口。
不要在应用仍运行时删除正常持有的 `node_modules.lock`。只有日志明确证明锁所属 PID 已死亡时，
才能把孤儿锁作为单个文件处理；不得递归删除 DSH profile。

确认没有另一个发布或资源准备任务在运行。统一脚本会使用：

```text
desktop/.build/windows-release.lock
desktop/.build/prepare-runtime.lock
```

锁被其他活进程持有时等待该任务结束，不要并行启动第二次 `prepare-runtime` 或 Tauri/NSIS 构建。

### 3.2 审核并提交本轮改动

正式发布脚本默认拒绝脏工作树。接手 Agent 应逐项审核差异，确认没有用户凭据、Cookie、SSO
ticket、一次性捕获 token、机器专属路径或无关格式化改动，然后运行：

```powershell
git diff --check
git status --short
```

确认 `client/index.js` 是由 `scripts/build-client.mjs` 从本轮源码生成，而不是手工修改。
确认 `desktop/src-tauri/src/runtime/mcp.rs` 等无关文件没有混入差异。审核通过后提交本轮改动，
再确认 `git status --short` 无输出。不要用 stash 隐藏本轮功能后打包，也不要用 `-AllowDirty`
生成正式候选。

### 3.3 处理 0.4.3 同名包风险

当前五个发布版本位点均为 `0.4.3`：

```text
package.json
desktop/package.json
desktop/src-tauri/Cargo.toml
desktop/src-tauri/tauri.conf.json
desktop/docs/release-manifest.json
```

用户当前要求仍是 0.4.3，因此本文不擅自升级版本。仓库已经存在旧的同名 0.4.3 安装包和既有
0.4.3 发布记录；这会产生覆盖与升级识别风险。若产品负责人决定改为 0.4.4，必须一次性同步
全部版本位点、lockfile 和发布说明，并通过版本一致性测试后再打包。若仍使用 0.4.3，必须把
旧包视为历史产物，最终只交付本轮 report 指向的新文件与新 SHA256，禁止沿用旧发布说明中的
大小和哈希。

## 4. 工具与环境

需要 Windows 10/11、Rust stable MSVC toolchain、Node 24、PowerShell 7、WebView2，以及可用的
Tauri/NSIS 缓存或网络。当前 Codex 工作区可使用：

```powershell
$sourceRoot = 'H:\107-iBM-Agent\iBM-Agent\Code\iBM-Lab-Agent'
$nodeExe = 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$cargoExe = "$env:USERPROFILE\.cargo\bin\cargo.exe"
```

根目录 `node_modules` 必须包含锁定的 DSH：

```powershell
Test-Path "$sourceRoot\node_modules\@deepseek-ai\dsh\lib\bin.js"
```

不要设置 `TAURI_CONFIG={"bundle":{"resources":[]}}`。该覆盖会生成缺少 DSH、Python、插件、
PDF Viewer 或 Ketcher 资源的不完整安装包。

## 5. 推荐执行顺序

所有命令从工程根目录执行。每一步失败都先修复，不要跳过后继续制造安装包。

### 5.1 重建客户端并复跑源码测试

```powershell
Set-Location -LiteralPath $sourceRoot
& $nodeExe .\scripts\build-client.mjs
if ($LASTEXITCODE -ne 0) { throw 'client build failed' }

& $nodeExe --test 'tests/unit/*.test.mjs' 'tests/integration/*.test.mjs'
if ($LASTEXITCODE -ne 0) { throw 'Node tests failed' }

Push-Location .\desktop\src-tauri
& $cargoExe test
if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed' }
Pop-Location

git diff --check
```

如果重建 `client/index.js` 后产生新差异，需要重新审核并提交，再回到干净工作树。

### 5.2 只跑发布预检

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File .\desktop\scripts\build-windows-release.ps1 `
  -SourceRoot $sourceRoot `
  -NodeExe $nodeExe `
  -CargoExe $cargoExe `
  -PreflightOnly
```

该步骤必须确认五处版本一致、DSH 源存在、Ketcher/PDF Viewer 引用完整、Git HEAD 可读、对象
连通且工作树干净。

### 5.3 运行唯一正式打包入口

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File .\desktop\scripts\build-windows-release.ps1 `
  -SourceRoot $sourceRoot `
  -NodeExe $nodeExe `
  -CargoExe $cargoExe `
  -ForcePrepare
```

正式候选禁止传 `-AllowDirty`、`-SkipTests`、`-SkipBuild`。`-ForcePrepare` 用于确保本轮客户端、
Rust 配置和文档对应的打包资源重新快照；不要同时另开 `prepare-runtime.ps1`。

脚本会顺序执行：客户端 bundle 一致性、Node 全量测试、回归、preset 导出、真实浏览器 Ketcher、
lint、资源准备、DSH Web smoke、Tauri/NSIS、安装包验证，并每 20 秒报告心跳。默认 prepare
上限 60 分钟，Tauri/NSIS 上限 120 分钟。长时间压缩无新输出时看心跳和阶段日志，不要仅因
控制台安静就强制结束。

日志目录：

```text
desktop/.build/windows-release-<yyyyMMdd-HHmmss>/
```

成功后应同时得到：

```text
desktop/src-tauri/target/release/bundle/nsis/iBM Lab Agent_0.4.3_x64-setup.exe
desktop/.build/windows-release-<时间>/release-report.json
```

## 6. 产物真实性与静态验证

不要从 NSIS 目录“取第一个 EXE”。以最新成功 `release-report.json` 的 `installer` 字段为唯一
候选，并逐项确认：

```powershell
$report = Get-Content -LiteralPath '<本轮日志目录>\release-report.json' -Raw | ConvertFrom-Json
if (-not $report.publishable) { throw 'diagnostic build must not be published' }
if (-not (Test-Path -LiteralPath $report.installer)) { throw 'installer missing' }

Get-Item -LiteralPath $report.installer | Select-Object FullName, Length, LastWriteTime
Get-FileHash -Algorithm SHA256 -LiteralPath $report.installer

pwsh -NoProfile -ExecutionPolicy Bypass `
  -File .\desktop\scripts\verify-package.ps1 `
  -InstallerPath $report.installer
if ($LASTEXITCODE -ne 0) { throw 'installer verification failed' }

(Get-Item -LiteralPath .\desktop\src-tauri\target\release\ibm-lab-desktop.exe).VersionInfo |
  Select-Object FileVersion, ProductVersion
```

验收值必须满足：

- `publishable=true`；
- 文件名精确匹配本次决定的版本；
- 安装包时间晚于本轮构建开始时间；
- SHA256 与 report 一致，且不能沿用旧 0.4.3 的哈希；
- EXE 的 FileVersion/ProductVersion 与发布版本一致；
- capability 检查仍要求每个文件的 `windows` 必须且只能是 `["main"]`，不能把 `webvpn`
  窗口加入 IPC 权限。

公开发布还应走 `docs/windows-release.md` 规定的签名工作流；本地脚本的 `publishable=true` 只证明
源码与本地发布门禁合格，不能替代 Authenticode 签名。

## 7. 安装包人工验收

优先使用干净 Windows 用户或虚拟机。至少完成以下流程并记录实际结果：

### 7.1 安装、启动与 DSH

1. 安装本轮 report 指向的 NSIS，不要误装旧同名包。
2. 启动后确认加载页能进入 DSH，不出现 `dsh web authentication required`，也不永久停在
   “加载本地服务”。
3. 再启动一次应用，确认只保留一个主实例并聚焦已有窗口。
4. 退出应用，确认 DSH/Node 进程树和本地端口被释放。

### 7.2 WebVPN 首次登录与会话

1. 在“数据库状态”点击“打开 WebVPN”。
2. 在独立 WebVPN 窗口完成 USTC 统一身份认证，然后回到主界面点击“我已登录”。
3. 隐藏或关闭 WebVPN 窗口，再点“返回 WebVPN”，确认仍是登录状态且只有一个 WebVPN 窗口。
4. 完全退出并重启应用，再打开 WebVPN，确认专属 WebView2 profile 能保持登录；若学校策略使
   会话过期，应能明确重新登录，而不是白屏或永久等待。

Codex 内置浏览器、系统 Edge 与桌面 WebVPN 使用不同 profile。它们的登录状态互不复制，
验收必须在安装包自己的 WebVPN 窗口中完成。

### 7.3 真实 PDF/SI 捕获

1. 选择一条已登记 DOI/出版社地址但缺失 PDF 的文献，点击 PDF 捕获入口。
2. 确认同一 WebVPN 窗口直接进入出版社页面；在页面中点击正文 PDF 下载按钮。
3. 确认客户端状态依次进入等待下载/上传，最终原 bundle 显示 PDF 已归档并可打开。
4. 至少完成一篇 Nature 正文；再验证 ACS 和 ScienceDirect 能复用同一登录状态进入。
5. 对 SI PDF 重复一次，确认归档种类没有写成正文 PDF。
6. 确认 WebVPN 路线不要求安装浏览器扩展。

### 7.4 恢复与回退

- 下载取消或失败后，pending task 应被释放，可以再次点击重新发起。
- 下载成功但 WebView2 没返回路径时，应显示可恢复错误，不能永久停在加载状态。
- WebVPN 打开失败时，应先撤销本地布防，再复用同一服务端任务回退 Microsoft Edge。
- 点击“清除登录状态”后，WebVPN 窗口被销毁、专属 profile 被删除，下次打开必须重新登录。
- OA 自动下载、既有 Edge 扩展捕获、已归档 PDF 打开仍应可用。

### 7.5 安全检查

- `app.log`、`stderr.log`、`webvpn.log` 和配置 JSON 中不能出现学校密码、Cookie、SSO ticket、
  Authorization 值或 manual-capture 一次性 token。
- WebVPN 登录页面不能调用主窗口的 Tauri 命令。
- 临时下载文件在上传成功、失败或取消后应删除；不得读取 WebView2 profile 内容。

## 8. 常见失败与处理

| 现象 | 处理 |
|---|---|
| 预检提示 working tree dirty | 审核并提交改动；正式包不要加 `-AllowDirty` |
| 提示另一个 release/prepare 正在运行 | 找到对应活进程并等待；不要并行构建或直接删活锁 |
| DSH 等待 `node_modules.lock` 超时 | 先核对锁内 PID 是否已死亡；仅对已证实的孤儿锁做单文件恢复 |
| `client-bundle-check` 失败 | 重跑 `node scripts/build-client.mjs`，审核并提交生成的 `client/index.js` |
| Web smoke 返回 authentication required | 检查桌面壳是否使用 `dsh web` 输出的带 token URL，不要改成裸 loopback URL |
| Tauri/NSIS 长时间无新输出 | 查看心跳和 `tauri-nsis.*.log`；进程 CPU/日志仍变化时继续等待 |
| 找到的安装包还是旧时间/旧 SHA | 视为失败；只接受本轮 report 指向且时间满足要求的新包 |
| 新装应用没有 WebVPN 按钮 | 多半打入了旧 runtime/client bundle；重新 prepare 并从干净提交完整构建 |
| WebVPN 登录后仍显示 waiting-login | 用户需在主界面点击“我已登录”；不能用页面加载完成自动推断认证成功 |
| 登录页白屏 | 查看被导航策略拒绝的 host；USTC 默认允许门户与 `id.ustc.edu.cn`，不得为省事给 WebVPN IPC 权限 |

## 9. 交付给下一位负责人的内容

完成后更新 `docs/releases/v0.4.3.md` 或新版本对应的发布说明，并至少交付：

- 最终分支、完整 commit SHA、是否有 tag；
- 安装包绝对路径、文件名、字节数、修改时间、SHA256；
- `release-report.json` 绝对路径和 `publishable` 值；
- Node/Rust/发布流水线结果；
- Nature/ACS/ScienceDirect、SI、跨重启会话、清除登录状态、Edge 回退的人工验收记录；
- 签名状态；
- 未通过项、复现步骤和对应阶段日志，禁止把未验收项写成已完成。

可直接转交给打包 Agent 的任务描述：

> 阅读 `docs/WEBVPN_0.4.3_PACKAGING_HANDOFF.md`、`docs/WEBVPN_IN_APP_BROWSER_HANDOVER.md`
> 和 `docs/WEBVPN_IN_APP_BROWSER_PLAN_REVIEW.md` §15。先关闭现有调试实例，审核并提交本轮
> WebVPN 改动，保持工作树干净。不要使用旧的同名 0.4.3 NSIS，也不要使用 `-AllowDirty`、
> `-SkipTests`、空 `bundle.resources` 或并行 prepare。用
> `desktop/scripts/build-windows-release.ps1` 运行完整 Windows 发布流水线，记录本轮
> `release-report.json`、安装包路径/大小/SHA256/签名状态。随后在安装包自己的 WebVPN
> WebView2 中完成 USTC 登录，实测 Nature PDF 归档、ACS/ScienceDirect 访问、SI、隐藏重开、
> 跨应用重启、清除登录状态、失败恢复与 Edge 回退。任何门禁或人工验收失败都先修复并重跑，
> 不得把诊断包或旧包交付为正式结果。
