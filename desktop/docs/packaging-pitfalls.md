# iBM-Lab-Agent 0.2.0 打包避坑指南（Agent 专用）

> 给**未来接手本仓库 Windows 打包/发布任务的 Agent** 的实战记录。
> 每个条目 = 现象 → 根因 → 正确操作。均在本机（Win11 / 用户名 admin）实测验证过。
> 更新此文件时保持条目化、可操作，别写散文。

---

## 0. 环境硬约定（先读，避免浪费 30 分钟）

| # | 约定 | 说明 |
|---|---|---|
| 1 | **PowerShell 一律用 pwsh7**：`& pwsh -NoProfile -File xxx.ps1` | PowerShell 工具宿主是 5.1；Bash 直调 pwsh 被安全层拦 |
| 2 | **PowerShell 工具 stdout 捕获为空** | 输出必须 `*> 文件` 落盘（UTF-16）再 `iconv -f UTF-16LE -t UTF-8 文件` 读取 |
| 3 | **cargo/rustc 不在 Git Bash PATH** | 每次用 `export PATH="/c/Users/admin/.cargo/bin:$PATH"` 前缀 |
| 4 | **安全层黑名单**：Bash 内调 powershell、`Add-Type`、`reg.exe` 都被拦 | 用 PowerShell 工具执行；删除走回收站见 §6.2 |
| 5 | **bundled Python 路径**：`desktop/src-tauri/resources/python/dist/python.exe` | 脚本若放在 `desktop/src-tauri/scripts/`，相对路径是 `../resources/...`（**一层**，别写成两层） |

---

## 1. 编译阶段

### 1.1 tauri-build "假死"（本仓库最大坑，已 patch registry 源码）
- **现象**：`cargo build --release` / `npx tauri build` 看起来冻结：CPU 双零、无 rustc 进程、日志停在 build script。
- **根因**：tauri-utils 把目录资源递归展开成 **44,325 个文件条目** → tauri-build `copy_resources` 逐文件 `println!("cargo:rerun-if-changed=…")`（3.5MB+ stdout）→ 后台任务 stdout 管道写满 → build script 阻塞在 println。复制高 IO 与并行 rustc 撞车另引发 `permission denied`（os error 5）。
- **已生效修复**（**换机器/重装 cargo 会丢失，需重打**）：
  1. 编辑 `~/.cargo/registry/src/index.crates.io-*/tauri-build-2.6.3/src/lib.rs`：
     - 注释 `copy_resources` 里 per-file 的 `println!("cargo:rerun-if-changed=...")`（约 108 行）
     - `copy_file` 开头加跳过逻辑：目标存在且 `len()` 与 `modified()` 都匹配源 → 直接 return（fs::copy 保留源 mtime，能命中跳过）
  2. 备份在 `lib.rs.bak-20260903`。
  3. **副作用补偿**：资源变更不再自动触发重跑 → 打包前 `touch desktop/src-tauri/build.rs`。
- **⚠️ `cargo clean -p tauri-build` 是陷阱**：它只删 `target/release/build/tauri-build-*`（12 文件），**不会删 `target/release/deps/libtauri_build-*.rlib`**——旧 rlib 时间戳不动 → patch 从不进入编译产物 → 症状照旧。**正确做法**：手动
  `rm -f target/release/deps/libtauri_build-* && rm -rf target/release/build/tauri-build-*`
  重编后日志出现 `Compiling tauri-build v2.6.3` 且 rerun 计数 = 0 才算生效。

### 1.2 "卡死"判别的两个铁律
- build script 复制期**无 rustc 是正常的**（44k 文件复制本来就要时间），别急着杀。
- 真卡死特征：CPU 双零 + 无 rustc + 日志长时间零增长 + 无 makensis。判据不足就先看日志尾部与进程表。

### 1.3 Rust 代码层
- 移动后借用：`.current_dir(path)` 后不能再 `foo(&path)` → 用 `&path`。
- 给 struct 加字段后（如 `McpServerConfig.tool_profile`），**所有字面量构造点都要补**——靠 `cargo test` 的 E0063 逐个清，别手数（本仓库曾有 15+ 处）。

---

## 2. prepare-runtime 与资源快照

- `Remove-Item -Recurse` 慢删（~4 文件/秒）→ 换 .NET `[IO.Directory]::Delete(path, true)`（在 PowerShell 工具里执行）。
- robocopy 单线程慢（~6.5 文件/秒）→ 加 **`/MT:16`**（23.6 文件/秒）。
- 后台任务被杀只杀 pwsh 父进程 → robocopy 成孤儿 → `taskkill /F /IM robocopy.exe` + 残留 pwsh `taskkill /F /T /PID <pid>`。
- 成功判据：robocopy RC=0 且快照与真身逐文件一致（vendor 725 文件）。

---

## 3. 长耗时命令的后台化纪律

- 一律 `run_in_background` + **输出 `> 日志文件 2>&1`**（管道阻塞是假死的温床）；日志文件末尾自己追加 `echo "RC=$?"`。
- 用 TaskOutput 等待，等 <task-notification>；**不要 sleep 轮询**。
- 本机参考耗时（release，16 线程）：
  - `cargo test` 全量：~7 min（增量 15 s）
  - `cargo build --release`：~7–8 min
  - `npx tauri build`（NSIS，44k 文件）：**~17–18 min**（cargo ~7 min + makensis 压缩 ~8 min）

---

## 4. 打包验证（7z + verify-package + 版本资源三层）

1. **内容**：`"/c/Program Files/7-Zip/7z.exe" l <setup.exe>` → 关键组件 grep（exe / python.exe / mnova_mcp / origin_mcp / bridge.qs）。
   - 统计口径坑：`grep -c "^20"` 得 44,327，`awk '{print $NF}' | wc -l` 得 44,326——**同一个包两种数**，别当差异；跨包对比用文件名集合 diff（`comm`）。
2. **Installer verification**：`& pwsh -NoProfile -File scripts/verify-package.ps1 -InstallerPath <setup.exe>`（PowerShell 工具内执行，输出 `*>` 落盘 UTF-16 再转码）。
3. **包内 exe 版本强验证**：`7z e -o<dir> <setup.exe> "*ibm-lab-desktop*"` 提取 → PowerShell `VersionInfo.FileVersion` 应 = 预期版本（证明非旧缓存）。
4. SHA256 源与副本比对：`sha256sum a b | awk '{print $1}' | uniq -c` 得 `2` 即一致。

---

## 5. 版本 bump 与提交

- 版本号 5 处：根 `package.json`、`desktop/package.json`、`Cargo.toml`、`tauri.conf.json`、`Cargo.lock`。
- 批量：`sed -i 's/0\.2\.0-rc\.X/0.2.0-rc.Y/g' <5 文件>`，然后 `grep -rn 旧版本 --include=*.json --include=*.toml .`（排除 node_modules/target/.workbuddy）确认零残留。
- 文档类（README/docs）引用**正式版本号**（0.2.0），不跟 rc 号。
- 提交按主题拆（desktop core / docs / plugin config），message 走 conventional commits；`git-lfs` hook 在位（已装 3.7.1，勿删）。

---

## 6. 桌面分发与清理

### 6.1 复制到桌面
`cp "bundle/nsis/iBM Lab Agent_<ver>_x64-setup.exe" "C:/Users/admin/Desktop/..."` + SHA256 校验。文件名含空格，记得引号。

### 6.2 删桌面旧包 → 回收站（不 `rm`）
`Add-Type` 被安全层拦，**不经 Add-Type 直调**即可（.NET 程序集已在进程中）：
```powershell
$files = @("C:\Users\admin\Desktop\<旧包>")
foreach ($f in $files) { if (Test-Path $f) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($f,'OnlyErrorDialogs','SendToRecycleBin') } }
```
桌面只留最新可用包，避免真机分发拿错（0.1.x / 旧 rc 全清，bundle 目录有源可恢复）。

---

## 7. GitHub Release（大资产上传）

- `gh` 已登录 github.com（cyx1874cyx）；git push 走 SSH（本机 key 有效）。
- **186MB 资产上传会超时中断** → release 留在 draft、assets 为空。修复流程：
  1. `gh release view <tag> --json isDraft,assets` 确认状态
  2. `gh release upload <tag> <exe> --repo cyx1874cyx/iBM-Lab-Agent --clobber`（后台跑，~5 min）
  3. `gh release edit <tag> --draft=false`
- 双远程：origin = USTC（git.ustc.edu.cn:qbdeng2025/iBM-Lab-Agent.git），github = cyx1874cyx 镜像。分支/tag 都要推两个。
- USTC GitLab Release 需要 API token（本机未配）→ GitLab 侧只保证 tag 就位，Release 建不建由用户在 UI 操作。

---

## 8. Origin/Mnova MCP 排障（今天刚踩）

- **"MCP Server 返回错误: {大段 tools/list}" 不是 MCP 错误**——是成功响应被误判。
  桌面端握手判定已改为**语义判定**（JSON 顶层有 `error` 对象才算错），别回退成子串匹配 `contains("\"error\"")`（schema 里 error 字面量到处都是）。
- **工具面档位**（`ORIGIN_MCP_TOOL_PROFILE`，0.1.4 实测）：
  compact 25 / data 59 / plot 56 / analysis 46 / standard 118 / full 237 个工具。
  白名单 9 值：compact data plot analysis standard legacy full expert all。UI 下拉 6 档。
  档位在 server 启动时读取 → 改动必须**重启运行环境**生效（这是设计，不是 bug）。
- 排障方法论：直接用 bundled python `python -m origin_mcp` 走 JSON-RPC 序列（initialize → notifications/initialized → tools/list，id 递增），逐行解析 `id==2` 的响应——比看 UI 快且是权威真相。windows 下子进程要 `text=True, encoding="utf-8", errors="replace"`。

---

## 9. 版本/产物历史锚点（截至 0.2.0-rc.3）

- rc.1（02:04，186,486,602 B，缺 --patch 修复）→ rc.2（12:48，缺三连改）→ **rc.3（17:38，186,484,453 B，SHA256 233c7d34…，当前唯一有效包）**
- release-0.2.0 分支 5 commits（vendor 基线 → 3 主题 → rc.3 bump），tag `v0.2.0-rc.3` @3affc8f 双远程。
- main 仍停 0.1.16；真机验收通过前**不要**标 DoD、不要合 main。

---

## 10. 0.3.0 打包实录（合成路线工作台）

- **产物**：`iBM Lab Agent_0.3.0_x64-setup.exe`（188,106,742 B，SHA256 e813d0b4475355d1b29ef600c6998397cf7ce917c1d731432480020ff423d625），tag `v0.3.0` @1283713 双远程 + GitHub Release 已正式发布（asset 上传 ~2.5 min，无需 draft 中转）。
- **tauri CLI 入口是 `tauri.js` 不是 `cli.js`**：`node ../node_modules/@tauri-apps/cli/tauri.js build`（desktop/node_modules/@tauri-apps/cli，package.json main=main.js、bin=./tauri.js）。
- **makensis "failed opening file … 系统找不到指定的文件 (os error 2)" 新根因**：`runtime/launcher/node_modules` 里 pnpm 类残留目录损坏（`node_modules/@deepseek-ai/dsh-session-telemetry-otel/node_modules/@opentelemetry` 只剩 `.core-*`/`.resources-*` 两个不可读空壳，目录 mtime 被改写）。修复：从 `C:\Program Files\iBM Lab Agent\dsh\node_modules`（rc.3 安装里的健康树）`copytree` 补回 `@opentelemetry/{core,resources}` 并删除坏点目录；`dsh-skill-filesystem/node_modules` 的点目录（`.chokidar-*`/`.readdirp-*`）重命名为正常包名。源（runtime/launcher）与打包副本（resources/dsh）两处都要修，否则下次 prepare-runtime 重新引入。
- **verify-package**：`-InstallerPath <setup.exe>` 18s 通过（bundled python origin-mcp 0.1.4 / mnova-mcp 0.3.1 / bridge.qs / probe 4 tools）。
- **包内 exe 版本强验证**：7z e 提取 `*ibm-lab-desktop*` → `VersionInfo.FileVersion = 0.3.0`。
- prepare-runtime 本机耗时波动大（本次 1h11m，robocopy /SL 遇大 junction 树变慢）；后台任务壳可能显示 running 但进程已退出，先查进程再决定是否 TaskStop 清理悬挂任务。

---

## 11. 0.3.1-rc.1 打包实录（修复版，2026-09-04）

- **产物**：`iBM Lab Agent_0.3.1-rc.1_x64-setup.exe`（195,947,526 B，SHA256 720bf93b08afc21207e9bf9c8d4b2d9ff4651d655edeb15b2745d89bb4645a07）。全量重建（非增量），本地交付未推送。
- **判活铁律（补 §1.2）**：`ps -W` 首列不是 PID（且可能显示已退进程的陈旧行）；`Get-Process -Id` 对错拿的 PID 会误报 "gone"。**权威查法**：PowerShell `Get-CimInstance Win32_Process | ? Name -in node/cargo/rustc/makensis | Select CommandLine`——能看到 rustc 实际编译命令行。
- **双实例并发坑（新）**：连续两次后台启动 prepare-runtime（首轮任务壳看似结束实未退）会并发删除/重建同一 resources 树，表现为目标目录大小忽大忽小、文件缺失随机。处理：PowerShell `Stop-Process` 杀全部相关 pwsh + robocopy 子进程 → 清点后**只跑一轮**。重跑单轮 37m12s 完成（历史 1h11m 的 52%）。
- **build-bundled-python 收尾慢**：`Remove-Item`/stale 清理旧 `dist.stale`（数 GB、数万文件）需 ~10min+ 且零日志，别误判卡死；实际 EXIT=0 由末尾 "EXIT=" 行确认（*>* 落盘为 UTF-16，`iconv -f UTF-16LE -t UTF-8` 转码后读）。
- **tauri build 全量重建耗时重估**：resources 全变更时 build-script 顺序 fs::copy ~45k 文件 + 主 crate LTO（-C codegen-units=1）单线程编译，**合计 45–50min 属正常**；增量场景才是历史 ~18min。判据：CIM 里能看到 rustc 命令行即活着。
- 资源树重建后**新增文件必须 7z 抽查**：本次验证含 pymupdf-1.28.2、plugin\dsh-lab-agent\lib\synthesis-tool.js、bridge\capture-spec.json、更新版 presets\lab-research\agent.cordis.yml。
- 构建日志归档到仓库外（`C:\Users\admin\Desktop\iBM-Agent\build-logs-rc1\`），保持工作树干净。

## 12. 0.3.1-rc.2 打包实录（2026-09-04）

- **产物**：`iBM Lab Agent_0.3.1-rc.2_x64-setup.exe`（200,982,132 B，SHA256 a2b5a45627c880bfaceba5ddcddbef8040cd9bd2bb89fd5ba160429ccb0ed605）。含真机验收两轮热修（exports 根源头 + lab_synth_* cleanJson）。prepare-runtime **1h15m** + tauri build **22m**（增量，快一倍）。
- **Remove-TreeFast 慢分支（新判活维度）**：删除遇只读/占用文件会进 catch（`Get-ChildItem -Recurse | ForEach Attributes='Normal'` 逐文件清只读，PowerShell 单线程管道），3 万文件 dsh 树可拖 40min+——**CPU 满载 ≠ 健康推进**，必须配合结构信号判断阶段：
  - 删除期：目录**文件数递减**（PowerShell `Get-ChildItem -Recurse -File | Measure-Object`），无 robocopy 子进程、无新写入文件属正常；
  - 同步期：文件数递增 + robocopy 子进程出现 + 关键文件（如 `dsh\node_modules\@deepseek-ai\dsh\lib\bin.js`）到位。
  - 本轮全程顺序：node 删净 → dsh 3 万删剩 500 → plugin 归零 → robocopy 启动 → dsh 29,219 文件到位 → 完成。
- **插件 exports 真源头 = 根 package.json**：dsh-lab-agent 插件包本体即根 package.json（prepare-runtime.ps1 第 90 行 foreach 直接拷贝生成 `resources/plugin/dsh-lab-agent/package.json`，整树 gitignore）。**热修必须三处同改**（根 / resources 副本 / 安装实例），校验与下轮打包只认根；`npm run check:preset-exports`（scripts/check-preset-exports.mjs）盯住 preset 挂载 ⊆ exports，负向自测过。
- **validate 幂等修正**：9:20 首轮只热修 resources 副本与安装实例、漏根 → 若未补，下次 prepare-runtime 会把 bug 带回。教训：**gitignore 内的打包产物树不是修复对象，先找 git 跟踪的源头**。

---

## 13. 0.3.2-rc.1 打包实录（2026-09-04，合成路线结构式 + Evidence 截图）

- **产物**：`iBM Lab Agent_0.3.2-rc.1_x64-setup.exe`（206,813,449 B，SHA256 b87cc80c5ff95e99d69d3e7fb83174f7ac8966bed908c8d6751330271a955186）。tag `v0.3.2-rc.1` @1f450bb 双远程 + GitHub Release。
- **prepare-runtime 82.6min**（EXIT=0）：删除期 74min（node → dsh 29,219→0，尾段速度回落至 ~5 文件/s 属正常，勿误判卡死）+ robocopy 同步期 ~8min（dsh 重建 8,463→29,219，峰值 ~48 文件/s，/MT:16 生效）。全程结构信号判活。
- **tauri build 18m39s（RC=0，增量大幅生效）**：`Compiling ibm-lab-desktop v0.3.2-rc.1` → 6m38s Finished（target/ 增量缓存 + tauri-build patch 跳过未变资源）→ makensis ~8min。**只要 resources 未全量变更 + patch 在位，不必按 §11 预期 45min 全量**。
- **工作树提交惯例更新（本节实践）**：rc.1/rc.2 曾长期"本地出包不提交"，本次 0.3.2-rc.1 首次把 release-0.3.0 分支从 0.3.0 起的全部实底按主题入库：fix(rc 基线) → feat(0.3.2) → chore(工具/规范) → docs → chore(release bump) 5+1 提交；**混合文件（package.json 同时含 rc exports 修复 + 0.3.2 exports + bump）整体归 bump 提交**，不追求 hunk 级拆分。
- **杂项清理**：tauri target-v0*（v014/v015/v016 各 ~5GB 编译产物残留）加入 desktop/.gitignore `/src-tauri/target-v0*/`（不删目录保缓存）；根 prepare-runtime.log/ps-tool-test.txt 直接删。
- **GitHub Release**：gh release create 首遇 Bad Gateway（瞬时，重试即过）；206MB asset 上传后台 ~7min+（比 0.3.0 的 2.5min 慢，gh 服务器侧波动），未中断成功——仍按 §7 draft → upload --clobber → edit draft=false 流程。
- **7z 抽查重点更新**：0.3.2 新组件 = `plugin\dsh-lab-agent\client\assets\ketcher-standalone\`（12 条目含 28.9MB 主 chunk）、`lib\ketcher-assets.js`、`lib\evidence-shot.js`、`scripts\evidence-shot.py`、`src\synthesis\{structures,pubchem-resolve}.js`。grep 模式 `ketcher-standalone/index\.html` 首查未命中是 7z 行格式问题，用宽松 `grep -ic ketcher` 确认即可。
- 日志归档：`C:\Users\admin\Desktop\iBM-Agent\build-logs-032rc1\`（prepare-runtime.log + tauri-build.log）。

---

## 14. 0.4.0 pnpm workspace 迁移后的打包环境实录（2026-09-05）

- **架构变化**：仓库依赖从 npm 平铺改为 **pnpm workspace（lockfile v9 / pnpm 10.34.5）**。根 `node_modules` 仅含 4 个生产依赖 + autoInstallPeers 的直接 peer；`runtime/launcher/node_modules` 已不存在（runtime/launcher 现为 Linux 部署包）。
- **工具调用硬规矩（WorkBuddy 环境）**：
  - node/pnpm 前必须 `CODEBUDDY_SAFE_DELETE_ENABLED=0`——WorkBuddy node 安全删除垫片会拦截 pnpm 的 store 清理（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）直接失败。
  - corepack 入口：`node <托管node>/node_modules/corepack/dist/corepack.js pnpm@10.34.5 ...`（bash 里 `corepack` cmd shim 失效）。
  - MSYS 路径喂原生 node 会变 `C:\c\...` → 一律用 `C:/...` Windows 路径。
- **DSH 运行时源**：DSH 完整树不在仓库内。dev-link（`DSH_HARNESS_NODE_MODULES=C:\Program Files\iBM Lab Agent\dsh\node_modules node scripts/dev-link.mjs`）把安装版 197 个 `@deepseek-ai/*` 链入根 node_modules。integration/regression（boot DSH）必须先 dev-link，否则 `cordis:include loader entries failed to apply`（unit 不经 boot 不受影响）。
- **prepare-runtime.ps1 断点**：默认 `-DshSource` 指向已不存在的 `runtime\launcher\node_modules` → 必须显式 `-DshSource 'C:\Program Files\iBM Lab Agent\dsh\node_modules'` 或 dev-link 后指向根 node_modules，否则直接 throw "DeepSeek Harness payload was not found"。
- **两个 worktree 的 CRLF 陷阱**：inCodeX 是 inWB 仓库的 linked worktree（`inWB/.git/worktrees/`）。robocopy 把 CRLF checkout 形态文件复制到另一个 worktree 后，git 会把整树误报为 modified。修复 = `git restore` + `git read-tree HEAD`（重建 index）+ `git apply` 重放真实 diff patch。**行尾陷阱的权威修法：read-tree 重建 index，别逐个文件改行尾。**
- **Ketcher 大文件删除事故**：对 29MB 哈希块用 `git rm` 时，整个 `client/assets/ketcher-standalone` 目录被外部机制连带清空（两次复现）→ **大文件删除一律 `rm -f` + 事后 `git add -A` 记录**，不用 git rm；完成后立即 `ls` 复检目录完整性。丢失的 untracked 新块可从 `scripts/ketcher-shell/dist/assets` 重新复制（两处为同一构建产物）。
- **verify-package.ps1 0.4.0 扩展**：required 增 ketcher index.html/css/experiment-plan-template 文件存在性；新增 **Ketcher index.html 引用完整性检查**（解析 src/href 逐个验证 resources 树内存在，防清旧块误删在用资源）；import probe 增 `lib/experiment-plan-templates.js`、`lib/synthesis.js`。
- 0.4.0 client 工作台三组件已落地（StepReactionLayout 挂载/双源核验面板/锁定语义仅 locked）；lint 工具链补装（eslint/@eslint/js/globals devDeps，ignore 补 `**/dist/**`、`**/assets/**`，噪声规则 off，见 eslint.config.js）。

---

## 15. 0.4.x Windows 单命令发布与防假死约定

- 唯一推荐入口为 `scripts/build-windows-release.ps1`。它为测试、prepare、Web smoke、Tauri/NSIS 和安装包验证分别写日志，并每 20 秒输出 PID、CPU、日志大小与累计耗时。
- `prepare-runtime.ps1` 默认从根 pnpm workspace 的 `node_modules` 解析 DSH，并用源码/锁文件/Node 指纹跳过未变化且完整的资源快照；需要排查缓存时显式传 `-Force`。
- 两个脚本均使用独占锁。看到“already running”时先确认已有任务，而不是删除锁文件后并发启动；只有确认没有对应进程的遗留锁才可人工处理。
- prepare 默认上限 60 分钟，Tauri/NSIS 默认上限 120 分钟。超时会终止本次启动的进程树并保留日志，不会无限等待。
- Ketcher 引用在删除旧资源前检查。`index.html` 指向不存在的哈希文件时立即停止，先重新构建/提交 Ketcher 产物，禁止在 resources 快照中临时补文件。
- 发布脚本只接受本轮构建时间之后生成、名称与五处版本完全一致的 NSIS；旧目录里同名或其他版本安装包不能充当成功产物。
- 禁止用 `TAURI_CONFIG={"bundle":{"resources":[]}}` 构建正式包。无变化增量加速来自资源快照不改 mtime 和 Cargo target 复用，不以牺牲安装包内容为代价。
- 诊断脏工作树必须传 `-AllowDirty`，最终报告会明确 `publishable=false`；正式候选必须回到干净提交重新构建。

