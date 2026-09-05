# iBM Lab Agent Desktop

Windows desktop packaging for the iBM Lab Agent plugin on DeepSeek Harness (DSH) `0.1.1-rc.2`.

The desktop shell is deliberately small: it starts a bundled Node.js and DSH process on loopback, waits for an HTTP health response, and displays the local DSH interface inside its own window. It never opens the system browser.

## Build

> **Agent 必读**：本仓库 Windows 打包有大量环境性/工具链陷阱（tauri-build 资源扫描假死、
> pwsh 输出捕获、后台管道阻塞、NSIS 耗时等），完整避坑记录见
> [docs/packaging-pitfalls.md](docs/packaging-pitfalls.md)。先读再动手。

在已安装 Rust stable、Microsoft C++ Build Tools 和 Node 24 的 Windows 构建机上，推荐只使用统一发布入口：

```powershell
Set-Location <repository-root>
pwsh -NoProfile -ExecutionPolicy Bypass -File .\desktop\scripts\build-windows-release.ps1 -SourceRoot . -NodeExe (Get-Command node).Source
```

该脚本依次执行源码测试、回归、预设导出检查、lint、资源准备、Web 冒烟、Tauri/NSIS 构建和精确安装包验证。每个阶段写入独立日志并默认每 20 秒输出心跳；prepare 和 build 分别有超时，超时只终止本次启动的进程树。日志与 `release-report.json` 位于 `desktop\.build\windows-release-<时间>`。

发布构建默认拒绝脏工作树并使用锁阻止并发。`-AllowDirty` 只用于诊断，产物会标记为不可发布；`-SkipBuild` 可只验证源码和资源；`-ForcePrepare` 强制忽略资源指纹做完整快照刷新。

`prepare-runtime` 现在默认从根 pnpm workspace 的 `node_modules` 识别 DSH；旧 `runtime\launcher\node_modules` 仅为兼容回退。它为源码和依赖生成资源指纹，资源未变化且完整时跳过删除/复制；完整性检查包含 Ketcher `index.html` 的动态哈希引用。不要并发运行两次 `prepare-runtime`。

`build-bundled-python` materializes `resources\python\dist` — a self-contained
Python 3.11 install (interpreter + stdlib + `site-packages` with the pinned
`requirements.lock` plus `markitdown[pdf,docx,pptx,xls,xlsx]`), so document
conversion and skill scripts work offline without any system Python. The
desktop shell injects `IBM_LAB_AGENT_BUNDLED_PYTHON` into the DSH child
process; the plugin resolver prefers this bundled interpreter (venv →
bundled → system python). Do not replace it with a copied venv: Windows venvs
pin the base interpreter via `pyvenv.cfg` and are not portable.

`verify-package -WebSmokeTest` boots the packaged `ibm-lab` profile on an ephemeral loopback port, requires an HTTP success response, rejects duplicate `labAgent`/plugin-tree errors, and terminates the test process tree. The NSIS installer uses Tauri's `downloadBootstrapper` WebView2 mode: Windows 10/11 normally already provide WebView2, while a missing runtime is downloaded by the installer.

### 长时间构建与进度判断

首次 Rust/LTO 编译或 makensis 压缩可能持续数十分钟。统一脚本会持续打印阶段、PID、CPU、日志大小和耗时；只要心跳持续且未超过阶段上限，不要另开第二次构建。若超时或失败，先读取该阶段 stdout/stderr 尾部，再决定是否用 `-ForcePrepare` 重跑。

正式发布禁止设置 `TAURI_CONFIG={"bundle":{"resources":[]}}`。该做法可能缩短资源扫描，却会使安装包资源完整性无法得到保证。增量加速依赖资源指纹不触碰未变化快照以及复用默认 Cargo target。

If GitHub is unreachable from the build machine, the NSIS toolchain download
also stalls; a proxy or mirror must be available for
`github.com/tauri-apps/binary-releases` and `github.com/tauri-apps/nsis-tauri-utils`.

## Runtime location

Per-user operational data is kept below `%LOCALAPPDATA%\iBM-Lab-Agent`:

- `dsh\` — private DSH home and the `ibm-lab` profile
- `workspace\` — default work folder
- `config\app-config.json` — non-secret provider settings plus a DPAPI credential reference
- `config\api-key.dpapi` — API key encrypted for the current Windows user with DPAPI
- `logs\app.log`, `logs\dsh.log`, `logs\stderr.log`
- `runtime-state\dsh.pid` — recoverable child-process state

The API key is neither logged nor written to ordinary JSON. Windows DPAPI encrypts it for the current user; existing plaintext `apiKey` values are migrated on first read and removed from `app-config.json`.

## Distribution checks

See [docs/release-checklist.md](docs/release-checklist.md) for the clean-machine and regression checklist, and [docs/reference-desktop-analysis.md](docs/reference-desktop-analysis.md) for the separately reviewed reference architecture and licensing decision.

## Origin / Mnova MCP Integration (0.2.0)

The desktop bundle carries both MCP adapters inside the self-contained
Python 3.11 (`resources/python/dist`) — `origin-mcp==0.1.4` and
`mnova-mcp==0.3.1` (which also ships the Mnova `bridge.qs` asset and the
vendored `nmr-analyze-simulate` skill) — so neither Origin nor Mnova
automation needs a system Python, `uv`, an external checkout, or a
user-installed package. Both DSH MCP patches reference the interpreter the
launcher injects as `IBM_LAB_AGENT_BUNDLED_PYTHON` and start
`python -m origin_mcp` (with `ORIGIN_MCP_TOOL_PROFILE=compact`) /
`python -m mnova_mcp`; the Mnova child additionally
receives `IBM_LAB_MNOVA_WORKSPACE` / `IBM_LAB_MNOVA_OUTPUT_ROOT` /
`IBM_LAB_MNOVA_RUNTIME_ROOT` (ASCII-safe) / `IBM_LAB_MNOVA_BRIDGE_SCRIPT`.

Mnova GUI/Verify workflows require a locally installed and licensed
MestReNova; file-based NMR analysis and synthetic-FID generation do not.
See [docs/release-checklist.md](docs/release-checklist.md) (and
[docs/release-manifest.json](docs/release-manifest.json)) for the release
gates, and `tests/e2e/origin/` at the repository root for the on-machine
Origin E2E data and expectations (`sample.csv` / `expected.json` /
`README.md`).
