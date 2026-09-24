#!/usr/bin/env bash
#
# 在 WSL 里驱动 Windows 侧出 Windows 安装包。
#
# 为什么是这个架构（而不是在 Linux 上交叉编译）：
#   * 本项目的发布目标是 Tauri + NSIS（`bundle.targets: ["nsis"]`）。NSIS 官方虽支持
#     在 Linux 上交叉编译，但 Tauri 自己说那是"测试较少、最后手段"，且**交叉编译出的
#     包无法在 Linux 上验证** —— 而 verify-package.ps1 -WebSmokeTest 要真的把打包后的
#     应用启动起来、访问回环 HTTP、检查 Ketcher 静态资源与捆绑 Python 自检。
#   * WSL 的 Windows 侧就在同一台机器上：原生 MSVC + 原生 NSIS + WebView2/DPAPI/LibreOffice
#     齐全，产物可验证，且能复用项目既有的、已在本机验证过的 build-windows-release.ps1。
#
# 分工：WSL 负责开发与迭代（跑 5 道闸门 / 发布预检），Windows 只当打包工具。
#
# Windows 侧首次准备（本脚本会自动补 desktop/ 的依赖，其余需手工一次）：
#   * Node 24（zip 解压即可，与 runtime/versions.env 的 NODE_VERSION 对齐）
#   * Rust stable + MSVC 工具链；`tauri-build` 的 registry 补丁见 desktop/docs/packaging-pitfalls.md §1.1
#   * corepack -> pnpm（根 workspace 依赖）
#
# ⚠️ 三个 WSL 专属坑（本脚本已在代码里规避，改脚本时别退化）：
#   1. **UNC 工作目录**：cwd 在 \\wsl.localhost\... 时 cmd.exe/powershell.exe 直接拒绝
#      （"UNC 路径不支持"）。所以调用 .exe 之前必须先 cd 到 /mnt/<盘>/ 下的路径。
#   2. **编码**：中文输出经 interop 回来会乱码。ps1 里统一设
#      [Console]::OutputEncoding = UTF8，必要时落盘 UTF-16 再 iconv。
#   3. **绝不在 drvfs 上构建**：/mnt/c 的目录遍历极慢（实测 find 60s 超时）。源码副本、
#      node_modules、target 一律放在 NTFS（默认 H:\build），跨盘只传 git 对象。
#
# 用法：
#   scripts/windows-release-from-wsl.sh                 # 同步 + 完整出包
#   scripts/windows-release-from-wsl.sh --preflight-only # 只同步 + 跑发布预检
#   scripts/windows-release-from-wsl.sh --skip-sync      # 不打 git，直接出包
#   scripts/windows-release-from-wsl.sh --dry-run        # 只打印将要做什么
#   scripts/windows-release-from-wsl.sh --ref <分支|SHA>  # 构建任意 ref（基线归因/重建历史版本）
#
# 可覆盖的环境变量：
#   IBM_LAB_WSL_BARE   传输裸仓库（NTFS 上）默认 /mnt/h/build/ibm-lab-agent.git
#   IBM_LAB_WSL_WORK   源码副本（NTFS 上）  默认 H:\build\ibm-lab-agent
#   IBM_LAB_WSL_NODE   Windows Node        默认 C:\Users\admin\node-v24.16.0-win-x64\node.exe
#   IBM_LAB_WSL_CARGO  Windows cargo       默认 C:\Users\admin\.cargo\bin\cargo.exe
#   IBM_LAB_WSL_LOGDIR 出包日志目录        默认 H:\build\release-logs
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bare="${IBM_LAB_WSL_BARE:-/mnt/h/build/ibm-lab-agent.git}"
work_win="${IBM_LAB_WSL_WORK:-H:\\build\\ibm-lab-agent}"
node_win="${IBM_LAB_WSL_NODE:-C:\\Users\\admin\\node-v24.16.0-win-x64\\node.exe}"
cargo_win="${IBM_LAB_WSL_CARGO:-C:\\Users\\admin\\.cargo\\bin\\cargo.exe}"
log_dir_win="${IBM_LAB_WSL_LOGDIR:-H:\\build\\release-logs}"
work_mnt="/mnt/$(printf '%s' "$work_win" | sed -E 's#^([A-Za-z]):.*#\L\1#')/$(printf '%s' "$work_win" | sed -E 's#^[A-Za-z]:\\##; s#\\#/#g')"
bare_dir="$(dirname "$bare")"

mode="release"
skip_sync=0
dry_run=0
ref_override=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--preflight-only) mode="preflight" ;;
		--skip-sync) skip_sync=1 ;;
		--dry-run) dry_run=1 ;;
		# 构建任意 ref（分支/SHA）：基线归因（重建 0.5.0 对比体积）与重建历史版本都要用
		--ref)
			[[ $# -ge 2 ]] || { echo "--ref 需要一个参数" >&2; exit 2; }
			ref_override="$2"
			shift
			;;
		-h|--help) sed -n '2,60p' "${BASH_SOURCE[0]}"; exit 0 ;;
		*) echo "未知参数：$1" >&2; exit 2 ;;
	esac
	shift
done

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { echo "错误：$*" >&2; exit 1; }

# ── 前置检查（interop 与 Windows 侧路径）────────────────────────────────────
[[ -d /mnt/c ]] || die "没有 /mnt/c —— 这不是带 interop 的 WSL 环境"
command -v powershell.exe >/dev/null 2>&1 || die "找不到 powershell.exe（WSL interop 未启用）"
[[ -n "$(printf '%s' "$work_win" | sed -nE 's#^([A-Za-z]):.*#\1#p')" ]] || die "IBM_LAB_WSL_WORK 必须是 Windows 盘符路径"

branch="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD)"
ref="${ref_override:-origin/$branch}"
[[ "$branch" != "HEAD" ]] || die "当前是 detached HEAD，无法同步"

log "仓库   : $repo_root（分支 $branch @ $(git -C "$repo_root" rev-parse --short HEAD)）"
log "传输   : $bare"
log "副本   : $work_win  →  $work_mnt"
log "模式   : $mode$([[ $skip_sync -eq 1 ]] && echo '（跳过同步）')"
[[ -n "$ref_override" ]] && log "目标 ref: $ref（非当前分支：构建历史版本，用于基线归因）"

if [[ $dry_run -eq 1 ]]; then
	log "dry-run：将执行 git push → Windows 侧 fetch/reset → 补 desktop 依赖 → 运行 build-windows-release.ps1"
	exit 0
fi

# ── 1) WSL → NTFS 裸仓库（只传 git 对象，不传工作树）────────────────────────
if [[ $skip_sync -eq 0 ]]; then
	mkdir -p "$bare_dir"
	if [[ ! -d "$bare" ]]; then
		log "创建传输裸仓库"
		git -C "$repo_root" clone --bare --quiet . "$bare"
	fi
	log "推送 $branch → 裸仓库"
	git -C "$repo_root" push --quiet "$bare" "refs/heads/${branch}:refs/heads/${branch}"
	log "  裸仓库 HEAD: $(git --git-dir="$bare" log -1 --format='%h %s' "refs/heads/${branch}")"
fi

# ── 2) Windows 侧：同步 + 补依赖 + 出包 ─────────────────────────────────────
# ps1 落在 Windows 临时目录（不进仓库），并用 Windows git 操作 NTFS 工作树。
#
# ⚠️ 坑 4（本脚本踩过）：生成的 .ps1 必须是**纯 ASCII**。PowerShell 5.1 读取没有 BOM 的
# UTF-8 文件时按 ANSI 码页解析，中文/emoji 会被拆成乱码字节并破坏字符串终止符，报成
# ParserError: TerminatorExpectedAtEndOfString。解释性中文一律留在本 bash 文件里。
ps1_win='C:\Users\admin\AppData\Local\Temp\ibm-lab-wsl-release.ps1'
ps1_mnt="/mnt/c/Users/admin/AppData/Local/Temp/ibm-lab-wsl-release.ps1"
cat > "$ps1_mnt" <<PS1
\$OutputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
\$ErrorActionPreference = 'Continue'
\$work  = '${work_win}'
\$node  = '${node_win}'
\$cargo = '${cargo_win}'
\$mode  = '${mode}'
\$branch = '${branch}'
\$ref = '${ref}'
\$logDir = '${log_dir_win}'

# Gotcha 1: cwd must be on a Windows drive (UNC cwd is rejected by powershell.exe).
Set-Location \$work

Write-Output '=== sync working copy ==='
& git -c safe.directory=* fetch origin 2>&1 | Select-Object -Last 1
# --ref defaults to origin/<branch> (same as before); an explicit --ref <sha> builds a
# historical version. Always detached: the build copy should not sit on a branch, and
# this is what makes building an arbitrary commit possible.
& git -c safe.directory=* checkout -q --detach \$ref 2>&1 | Select-Object -Last 1
& git -c safe.directory=* log -1 --format='  HEAD: %h %s'
\$dirty = (& git -c safe.directory=* status --porcelain | Measure-Object).Count
Write-Output ("  dirty entries: " + \$dirty)
if (\$dirty -ne 0) { Write-Output '  WARNING: worktree is dirty; the release preflight will refuse to build.' }

# Root workspace dependencies: prepare-runtime stages the SHIPPED Harness tree
# from <sourceRoot>\node_modules, so a stale tree silently ships the wrong DSH.
# Compare the installed @deepseek-ai/dsh with runtime/versions.env and reinstall
# on mismatch. This is how a DSH upgrade reaches the Windows side: the WSL repo
# commits a new pnpm-lock.yaml, the guard sees the old tree and reinstalls.
\$wantDsh = (Select-String -Path (Join-Path \$work 'runtime\versions.env') -Pattern '^DSH_VERSION=(.+)\$').Matches[0].Groups[1].Value
\$dshManifest = Join-Path \$work 'node_modules\@deepseek-ai\dsh\package.json'
\$haveDsh = ''
if (Test-Path \$dshManifest) { \$haveDsh = (Get-Content \$dshManifest -Raw | ConvertFrom-Json).version }
if (\$haveDsh -ne \$wantDsh) {
  Write-Output ('=== root workspace deps: DSH ' + \$haveDsh + ' -> ' + \$wantDsh + ' (corepack pnpm install --frozen-lockfile) ===')
  \$env:PATH = (Split-Path \$node -Parent) + ';' + \$env:PATH
  Push-Location \$work
  & corepack pnpm install --frozen-lockfile 2>&1 | Select-Object -Last 8
  \$pnpmRc = \$LASTEXITCODE
  Pop-Location
  if (\$pnpmRc -ne 0) { Write-Output ('  corepack pnpm install failed: exit ' + \$pnpmRc); exit \$pnpmRc }
  \$haveDsh = (Get-Content \$dshManifest -Raw | ConvertFrom-Json).version
  Write-Output ('  root workspace deps now on DSH ' + \$haveDsh)
  if (\$haveDsh -ne \$wantDsh) { Write-Output '  FATAL: root dependencies still do not match runtime/versions.env'; exit 1 }
}

# desktop/ is a separate npm unit (not in the root pnpm workspace); install the CLI
# automatically so a fresh copy cannot fail late in tauri-nsis.
\$cli = Join-Path \$work 'desktop\node_modules\@tauri-apps\cli\tauri.js'
if (-not (Test-Path \$cli)) {
  Write-Output '=== desktop/ has no Tauri CLI: running npm ci ==='
  \$env:PATH = (Split-Path \$node -Parent) + ';' + \$env:PATH
  Push-Location (Join-Path \$work 'desktop'); & npm ci 2>&1 | Select-Object -Last 3; Pop-Location
}

\$args = @('-NoProfile','-ExecutionPolicy','Bypass','-File', (Join-Path \$work 'desktop\scripts\build-windows-release.ps1'),
          '-SourceRoot', \$work, '-NodeExe', \$node, '-CargoExe', \$cargo)
if (\$mode -eq 'preflight') { \$args += '-PreflightOnly' }

New-Item -ItemType Directory -Force -Path \$logDir | Out-Null
\$log = Join-Path \$logDir ("release-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".log")
Write-Output ("=== build-windows-release.ps1 (" + \$mode + ") log: " + \$log + " ===")
# Gotcha 5: this driver used to always print the NEWEST release-report.json and ANY
# *-setup.exe under the build tree. After a FAILED phase that showed a stale, plausible
# installer with a valid SHA256 - i.e. it attributed an earlier build's artifact to this
# run. Only artifacts created after \$startedAt belong to this run.
\$startedAt = (Get-Date).AddSeconds(-2)
& pwsh @args 2>&1 | Tee-Object -FilePath \$log
\$rc = \$LASTEXITCODE
Write-Output ("=== exit code: " + \$rc + " ===")

\$freshReports = @(Get-ChildItem (Join-Path \$work 'desktop\.build') -Recurse -Filter 'release-report.json' -ErrorAction SilentlyContinue |
  Where-Object { \$_.LastWriteTime -gt \$startedAt } | Sort-Object LastWriteTime -Descending)
if (\$rc -eq 0 -and \$freshReports.Count -gt 0) {
  \$r = \$freshReports[0]
  \$json = Get-Content \$r.FullName -Raw | ConvertFrom-Json
  Write-Output ("  report: " + \$r.FullName)
  Write-Output ("  version: " + \$json.version + "  publishable: " + \$json.publishable)
  Write-Output ("  installer: " + \$json.installer)
  Write-Output ("  bytes: " + \$json.bytes + "  sha256: " + \$json.sha256)
  Write-Output ("  phases: " + ((\$json.phases | ForEach-Object { \$_.name + '=' + \$_.seconds + 's' }) -join ', '))
} elseif (\$rc -ne 0) {
  Write-Output '  THIS RUN PRODUCED NO ARTIFACT (a phase failed above).'
  Write-Output '  Not publishing anything; the artifacts listed below are NOT from this run.'
  Get-ChildItem (Join-Path \$work 'desktop\src-tauri\target') -Recurse -Filter '*-setup.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 | ForEach-Object {
      Write-Output ("  stale artifact from an earlier build: " + \$_.FullName)
      Write-Output ("    mtime " + \$_.LastWriteTime.ToString('o') + "  bytes " + \$_.Length) }
} elseif (\$mode -eq 'release') {
  Write-Output '  WARNING: exit code 0 but no fresh release-report.json was found; do not publish.'
} else {
  Write-Output ("  " + \$mode + ": no installer is expected from this run.")
}
exit \$rc
PS1

log "在 Windows 侧执行（日志同时写入 ${log_dir_win}）"
# 坑 1（续）：从 /mnt/h 这类 Windows 盘路径启动
cd "$work_mnt" 2>/dev/null || cd /mnt/h/build
set +e
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ps1_win"
rc=$?
set -e
rm -f "$ps1_mnt"
log "结束，退出码 $rc"
exit $rc
