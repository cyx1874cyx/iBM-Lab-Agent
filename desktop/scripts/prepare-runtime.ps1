[CmdletBinding()]
param(
  [string]$SourceRoot,
  [string]$RuntimeSourceRoot,
  [string]$DshSource,
  [string]$NodeExe = $env:CODEX_MCP_NODE_PATH,
  [switch]$Force,
  [ValidateRange(1, 64)]
  [int]$CopyThreads = 24
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $SourceRoot) { $SourceRoot = Join-Path $projectRoot '..' }
if (-not $NodeExe) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) { $NodeExe = $nodeCommand.Source }
}
$sourceRoot = (Resolve-Path $SourceRoot).Path
if (-not $RuntimeSourceRoot) { $RuntimeSourceRoot = $sourceRoot }
$runtimeSourceRoot = (Resolve-Path $RuntimeSourceRoot).Path
$resourceRoot = Join-Path $projectRoot 'src-tauri\resources'
$iconRoot = Join-Path $projectRoot 'src-tauri\icons'
if (-not $DshSource) {
  # 0.4.x uses the root pnpm workspace. Keep the legacy launcher path only as
  # a fallback so the documented default works on both layouts.
  $dshCandidates = @(
    (Join-Path $sourceRoot 'node_modules'),
    (Join-Path $runtimeSourceRoot 'runtime\launcher\node_modules')
  )
  $DshSource = $dshCandidates | Where-Object {
    Test-Path -LiteralPath (Join-Path $_ '@deepseek-ai\dsh\lib\bin.js')
  } | Select-Object -First 1
}
$dshSource = (Resolve-Path $DshSource -ErrorAction SilentlyContinue)?.Path
$buildStateRoot = Join-Path $projectRoot '.build'
$statePath = Join-Path $buildStateRoot 'prepare-runtime.state.json'
$lockPath = Join-Path $buildStateRoot 'prepare-runtime.lock'
$releaseLockPath = Join-Path $buildStateRoot 'windows-release.lock'

if (-not $NodeExe -or -not (Test-Path -LiteralPath $NodeExe)) {
  throw 'A Windows node.exe is required. Pass -NodeExe with an approved Node 24 executable before packaging.'
}
if (-not $dshSource -or -not (Test-Path -LiteralPath (Join-Path $dshSource '@deepseek-ai\dsh\lib\bin.js'))) {
  throw "DeepSeek Harness payload was not found at $dshSource"
}
$bundledPython = Join-Path $resourceRoot 'python\dist\python.exe'
if (-not (Test-Path -LiteralPath $bundledPython)) {
  throw "Bundled Python is missing: $bundledPython. Run scripts/build-bundled-python.ps1 before prepare-runtime."
}

New-Item -ItemType Directory -Force -Path $buildStateRoot | Out-Null
if ((Test-Path -LiteralPath $releaseLockPath) -and -not $env:IBM_LAB_RELEASE_ORCHESTRATOR_PID) {
  try {
    $releaseProbe = [System.IO.File]::Open($releaseLockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $releaseProbe.Dispose()
  } catch {
    throw "A Windows release build is active ($releaseLockPath). Do not refresh resources while Tauri/NSIS may be reading them."
  }
}
try {
  $lockStream = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch {
  throw "prepare-runtime is already running for this checkout ($lockPath). Do not start a second copy."
}

function Write-Phase([string]$Message) {
  Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $Message)
}

function Get-FileDigest([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return "missing:$Path" }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Get-GitTrackedFileList([string]$Root, [string[]]$Subdirectories = @()) {
  # 0.4.0-rc.4（§9.2）：插件源码优先用 git ls-files 取稳定清单（只依赖 index，
  # 不递归枚举磁盘），对未跟踪但允许打包的明确文件（*.lock、cordis.patch.yml）
  # 单独补入。git 不可用（对象库损坏/裸环境）时回退为文件枚举。
  $includeUntracked = @('package.json', 'pnpm-lock.yaml', 'harness.lock.json', 'vendor.lock.json', 'cordis.patch.yml', 'python/requirements.lock')
  $files = [System.Collections.Generic.List[string]]::new()
  try {
    $tracked = & git -C $Root ls-files 2>$null
    if ($LASTEXITCODE -eq 0 -and $tracked) {
      foreach ($line in $tracked) {
        $candidate = [string]$line
        if (-not $candidate) { continue }
        if ($candidate -match '(^|/)node_modules/') { continue }
        if ($candidate -match '(^|/)\.workbuddy/') { continue }
        if ($Subdirectories.Count -gt 0 -and -not ($Subdirectories | Where-Object { $candidate -eq $_ -or $candidate.StartsWith($_ + '/') })) { continue }
        $files.Add($candidate)
      }
      foreach ($extra in $includeUntracked) {
        if (Test-Path -LiteralPath (Join-Path $Root $extra) -PathType Leaf) { $files.Add($extra) }
      }
      $unique = $files | Sort-Object -Unique
      return ,$unique
    }
  } catch {
    # fall through to enumeration below
  }
  # 回退：按相对路径枚举（排除 node_modules/.workbuddy/.git）
  $rows = @()
  foreach ($sub in $Subdirectories) {
    $full = Join-Path $Root $sub
    if (Test-Path -LiteralPath $full) {
      $rows += Get-ChildItem -LiteralPath $full -Recurse -File -Force | Where-Object {
        $_.FullName -notmatch '(\\|/)(node_modules|\.[^\\/]+)(\\|/|$)'
      } | ForEach-Object { [System.IO.Path]::GetRelativePath($Root, $_.FullName) }
    }
  }
  return ,($rows | Sort-Object -Unique)
}

function Get-StreamingTreeDigest([string]$Root, [string[]]$RelativeFiles) {
  # 0.4.0-rc.4（§9.2）：流式向增量 SHA256 写 "相对路径|长度|mtime"，
  # 禁止构造完整 $rows 大集合与一次拼接的大字符串（大目录下峰值内存可压到极小）。
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $incremental = [System.Security.Cryptography.CryptoStream]::new(
      [System.IO.Stream]::Null,
      $sha,
      [System.Security.Cryptography.CryptoStreamMode]::Write)
    try {
      $buffer = [System.Text.UTF8Encoding]::new($false)
      foreach ($relative in $RelativeFiles) {
        $path = Join-Path $Root ($relative -replace '/', '\')
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        $item = Get-Item -LiteralPath $path -Force
        $bytes = $buffer.GetBytes("$relative|$($item.Length)|$($item.LastWriteTimeUtc.Ticks)`n")
        $incremental.Write($bytes, 0, $bytes.Length)
      }
      $incremental.FlushFinalBlock()
    } finally {
      $incremental.Dispose()
    }
    return [Convert]::ToHexString($sha.Hash)
  } finally {
    $sha.Dispose()
  }
}

function Get-PluginFingerprint {
  # 0.4.0-rc.4（§9.2）：插件源码指纹 = git 跟踪清单 + 顶层锁文件，逐一
  # 流式哈希；不递归扫描磁盘大目录，避免 2.7GB 工作集与分钟级无输出。
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $files = Get-GitTrackedFileList $sourceRoot @('lib', 'client', 'presets', 'python', 'scripts', 'bin', 'src', 'vendor')
  Write-Phase ("Plugin source manifest: {0} files from git (took {1:n0}ms)." -f $files.Count, $stopwatch.ElapsedMilliseconds)
  $sourceDigest = Get-StreamingTreeDigest $sourceRoot $files
  $metaDigest = Get-StreamingTreeDigest $sourceRoot @('package.json', 'pnpm-lock.yaml', 'harness.lock.json', 'vendor.lock.json', 'cordis.patch.yml', 'python/requirements.lock')
  Write-Phase ("Plugin fingerprint computed in {0:n1}s." -f $stopwatch.Elapsed.TotalSeconds)
  return "$sourceDigest|$metaDigest"
}

function Get-DshFingerprint {
  # 0.4.0-rc.4（§9.2）：DSH 指纹只依赖锁文件、入口包版本与解析后的依赖闭包
  # （manifest 的依赖名→解析版本），不递归扫描整个 node_modules。
  $parts = [System.Collections.Generic.List[string]]::new()
  foreach ($file in @('harness.lock.json')) {
    $path = Join-Path $sourceRoot $file
    $parts.Add("$file=$(Get-FileDigest $path)")
  }
  $dshManifest = Join-Path $dshSource '@deepseek-ai\dsh\package.json'
  $parts.Add(("dsh-entry=$(Get-FileDigest $dshManifest)"))
  # 解析闭包：入口 manifest 的 dependencies（+ 逐层解析）。版本来自各物化包
  # package.json 的 version 字段——不枚举目录内容，只读 manifest。
  $seen = @{}
  $queue = [System.Collections.Generic.Queue[string]]::new()
  foreach ($dep in @((Get-Content -LiteralPath $dshManifest -Raw | ConvertFrom-Json).dependencies.PSObject.Properties.Name)) {
    $queue.Enqueue($dep)
  }
  $dshRoot = Join-Path $dshSource '@deepseek-ai'
  while ($queue.Count -gt 0) {
    $depName = $queue.Dequeue()
    if ($seen.ContainsKey($depName)) { continue }
    $seen[$depName] = $true
    $depManifest = Join-Path $dshSource ($depName + '\package.json')
    $resolved = Join-Path $dshSource (Join-Path 'node_modules' ($depName + '\package.json'))
    $chosen = if (Test-Path -LiteralPath $resolved) { $resolved } elseif (Test-Path -LiteralPath $depManifest) { $depManifest } else { $null }
    if (-not $chosen) { continue }
    try {
      $manifest = Get-Content -LiteralPath $chosen -Raw | ConvertFrom-Json
      $parts.Add("$depName=$($manifest.version)")
      if ($manifest.dependencies) {
        foreach ($child in @($manifest.dependencies.PSObject.Properties.Name)) {
          if (-not $seen.ContainsKey($child)) { $queue.Enqueue($child) }
        }
      }
    } catch {
      $parts.Add("$depName=unreadable")
    }
  }
  $payload = [System.Text.Encoding]::UTF8.GetBytes(($parts -join "`n"))
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return [Convert]::ToHexString($sha.ComputeHash($payload)) } finally { $sha.Dispose() }
}

function Test-KetcherAssetReferences([string]$PluginRoot) {
  $indexPath = Join-Path $PluginRoot 'client\assets\ketcher-standalone\index.html'
  if (-not (Test-Path -LiteralPath $indexPath)) { return $false }
  $html = Get-Content -LiteralPath $indexPath -Raw
  $references = [regex]::Matches($html, '(?:src|href)="\.\/assets\/([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
  if ($references.Count -eq 0) { return $false }
  foreach ($reference in $references) {
    if (-not (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $indexPath) ("assets\" + $reference)))) { return $false }
  }
  return $true
}

function Test-NodeSnapshot {
  return Test-Path -LiteralPath (Join-Path $resourceRoot 'node\node.exe')
}

function Test-DshSnapshot {
  return Test-Path -LiteralPath (Join-Path $resourceRoot 'dsh\node_modules\@deepseek-ai\dsh\lib\bin.js')
}

function Test-PluginSnapshot {
  $pluginRoot = Join-Path $resourceRoot 'plugin\dsh-lab-agent'
  $required = @(
    (Join-Path $pluginRoot 'package.json'),
    (Join-Path $pluginRoot 'lib\remote.js')
  )
  if ($required | Where-Object { -not (Test-Path -LiteralPath $_) }) { return $false }
  return Test-KetcherAssetReferences $pluginRoot
}

try {
  # 0.4.0-rc.4（§9.2）：三组件指纹分别计时并即时输出，禁止长时间无子阶段心跳。
  $fingerprintWatch = [System.Diagnostics.Stopwatch]::StartNew()
  Write-Phase 'Computing Node fingerprint (single file hash).'
  $nodeFingerprint = Get-FileDigest $NodeExe
  Write-Phase ("Node fingerprint ready in {0:n1}s." -f $fingerprintWatch.Elapsed.TotalSeconds)

  $dshWatch = [System.Diagnostics.Stopwatch]::StartNew()
  Write-Phase 'Computing DSH fingerprint (lock + entry + dependency closure).'
  $dshFingerprint = Get-DshFingerprint
  Write-Phase ("DSH fingerprint ready in {0:n1}s." -f $dshWatch.Elapsed.TotalSeconds)

  Write-Phase 'Computing plugin source fingerprint (git ls-files + streaming SHA256).'
  $pluginFingerprint = Get-PluginFingerprint
  Write-Phase ("All fingerprints computed in {0:n1}s." -f $fingerprintWatch.Elapsed.TotalSeconds)

  if (Test-Path -LiteralPath $statePath) {
    try { $previousState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } catch { $previousState = $null }
  } else { $previousState = $null }
  $refreshNode = [bool]$Force -or -not (Test-NodeSnapshot) -or -not $previousState -or $previousState.nodeFingerprint -ne $nodeFingerprint
  $refreshDsh = [bool]$Force -or -not (Test-DshSnapshot) -or -not $previousState -or $previousState.dshFingerprint -ne $dshFingerprint
  $refreshPlugin = [bool]$Force -or -not (Test-PluginSnapshot) -or -not $previousState -or $previousState.pluginFingerprint -ne $pluginFingerprint
  if (-not $refreshNode -and -not $refreshDsh -and -not $refreshPlugin) {
    Write-Phase 'All runtime components are unchanged and complete; skipping delete/copy. Use -Force to rebuild them.'
    return
  }
  Write-Phase "Refresh plan: node=$refreshNode, dsh=$refreshDsh, plugin=$refreshPlugin."

  # Refuse to copy a broken Ketcher shell into the desktop resources. This is
  # deliberately checked before deleting the last known-good snapshot.
  if (-not (Test-KetcherAssetReferences $sourceRoot)) {
    throw 'Source Ketcher index.html references missing assets. Rebuild/fix client/assets/ketcher-standalone before prepare-runtime.'
  }

  # 0.4.0-rc.4（§9.2）：先在同一磁盘的临时目录里构建全部组件，全部验证通过
  # 后再原子切换到正式快照；任何失败只清理临时目录，绝不动最后一个可用快照。
  $tempRoot = Join-Path $buildStateRoot ("prepare-runtime.tmp-" + [System.Guid]::NewGuid().ToString('N'))
  $tempResourceRoot = Join-Path $tempRoot 'resources'
  $swapped = $false
  New-Item -ItemType Directory -Force -Path $tempResourceRoot | Out-Null
  Write-Phase "Staging refresh under temporary directory: $tempRoot"

function Remove-TreeFast([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $full = (Resolve-Path -LiteralPath $Path).Path
  try {
    # .NET 原生递归删除：比 Remove-Item -Recurse 快两个数量级（Remove-Item
    # 在本机实测约 4 文件/秒，3 万文件的 dsh 树需要数小时）。
    [System.IO.Directory]::Delete($full, $true)
  } catch {
    # 只读文件会阻断递归删除：先清只读位再删
    Get-ChildItem -LiteralPath $full -Recurse -Force | ForEach-Object { $_.Attributes = 'Normal' }
    [System.IO.Directory]::Delete($full, $true)
  }
}

$targetNames = @()
if ($refreshNode) { $targetNames += 'node' }
if ($refreshDsh) { $targetNames += 'dsh' }
if ($refreshPlugin) { $targetNames += 'plugin' }
# rc.4（§9.2）：不在正式快照上先删后建——只在临时 staging 目录里建空结构，
# 全部组件验证通过后再一次原子切换（见下方 Commit-StagedResources）。
$stageTargets = $targetNames | ForEach-Object { Join-Path $tempResourceRoot $_ }
foreach ($target in $stageTargets) {
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  Write-Phase "Staged directory ready: $target"
}
New-Item -ItemType Directory -Force -Path (Join-Path $tempResourceRoot 'node') | Out-Null

Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap 64, 64
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::FromArgb(22, 52, 91))
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(119, 190, 255))
$graphics.FillEllipse($brush, 7, 7, 50, 50)
$graphics.FillRectangle([System.Drawing.Brushes]::White, 29, 16, 6, 32)
$graphics.FillRectangle([System.Drawing.Brushes]::White, 16, 29, 32, 6)
$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream = [System.IO.File]::Create((Join-Path $iconRoot 'icon.ico'))
$icon.Save($stream); $stream.Dispose(); $icon.Dispose(); $brush.Dispose(); $graphics.Dispose(); $bitmap.Dispose()

function Copy-Tree(
  [string]$Source,
  [string]$Destination,
  [string[]]$ExcludeDirectories = @(),
  [string[]]$ExcludeFiles = @(),
  [switch]$ExcludeJunctions
) {
  # /MT:16 多线程复制：单线程 robocopy 在本机实测约 6 文件/秒，2.9 万文件的
  # dsh 树需 1 小时以上；16 线程可将整体刷新压缩到几分钟。
  Write-Phase "Copying $Source -> $Destination (robocopy /MT:$CopyThreads)."
  $copyWatch = [System.Diagnostics.Stopwatch]::StartNew()
  $arguments = @($Source, $Destination, '/E', '/SL', "/MT:$CopyThreads", '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  if ($ExcludeJunctions) { $arguments += '/XJ' }
  if ($ExcludeDirectories.Count -gt 0) { $arguments += '/XD'; $arguments += $ExcludeDirectories }
  if ($ExcludeFiles.Count -gt 0) { $arguments += '/XF'; $arguments += $ExcludeFiles }
  & robocopy @arguments | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "robocopy failed while copying $Source (exit $LASTEXITCODE)" }
  Write-Phase ("Copy completed in {0:n1}s (robocopy exit {1})." -f $copyWatch.Elapsed.TotalSeconds, $LASTEXITCODE)
}

if ($refreshNode) {
  Write-Phase 'Copying Node executable into staged resources.'
  $nodeWatch = [System.Diagnostics.Stopwatch]::StartNew()
  Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $tempResourceRoot 'node\node.exe') -Force
  Write-Phase ("Node executable copied in {0:n1}s." -f $nodeWatch.Elapsed.TotalSeconds)
}
# pnpm's internal content-addressed store duplicates the already materialized top-level
# runtime dependencies. Bundling it adds hundreds of thousands of files without being
# consulted by Node.js at runtime, so keep the flattened dependency tree only.
if ($refreshDsh) {
  Write-Phase 'Copying DSH dependency tree into staged resources.'
  $dshCopyWatch = [System.Diagnostics.Stopwatch]::StartNew()
  Copy-Tree $dshSource (Join-Path $tempResourceRoot 'dsh\node_modules') `
    -ExcludeDirectories @((Join-Path $dshSource '.pnpm')) `
    -ExcludeFiles @('.modules.yaml', '.package-map.json', '.pnpm-workspace-state-v1.json')
  Write-Phase ("DSH tree copied in {0:n1}s." -f $dshCopyWatch.Elapsed.TotalSeconds)
}
if ($refreshPlugin) {
  Write-Phase 'Copying plugin sources and materializing production dependencies into staged resources.'
  $pluginCopyWatch = [System.Diagnostics.Stopwatch]::StartNew()
$pluginRoot = Join-Path $tempResourceRoot 'plugin\dsh-lab-agent'
New-Item -ItemType Directory -Force -Path $pluginRoot, (Join-Path $pluginRoot 'node_modules') | Out-Null
foreach ($item in @('package.json', 'LICENSE', 'lib', 'client', 'cordis.patch.yml', 'presets', 'python', 'scripts', 'bin', 'src', 'vendor', 'vendor.lock.json', 'harness.lock.json')) {
  $from = Join-Path $sourceRoot $item
  $to = Join-Path $pluginRoot $item
  # 构建期依赖（例如 scripts/ketcher-shell/node_modules）不属于桌面运行时。
  # 仅复制脚本源码，避免把临时前端构建树装入安装包。
  if ((Get-Item -LiteralPath $from).PSIsContainer) {
    if ($item -eq 'scripts') { Copy-Tree $from $to -ExcludeDirectories @('node_modules') }
    else { Copy-Tree $from $to }
  } else { Copy-Item -LiteralPath $from -Destination $to -Force }
}
# Materialize the plugin's declared production dependency closure.  In a pnpm
# workspace each direct dependency is normally a symbolic link into .pnpm; the
# previous LinkType filter skipped every one of them, leaving the desktop bundle
# without fast-xml-parser/jszip and causing the entire plugin tree to abort.
# robocopy /SL (inside Copy-Tree) dereferences both those links and the packages'
# nested production links, without copying the .pnpm store itself.
$dependencyRoot = Join-Path $sourceRoot 'node_modules'
$productionDependencies = @('fast-xml-parser', 'js-yaml', 'jszip', 'zod')
if (-not (Test-Path -LiteralPath $dependencyRoot)) { throw "Plugin node_modules is missing: $dependencyRoot" }
function Resolve-MaterializedPackageDirectory([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.LinkType -and $item.Target) {
    # Windows pnpm materializes with Junctions whose Target is an absolute path,
    # while SymbolicLinks may carry a relative target. Treat absolute targets
    # directly; only join for genuinely relative ones.
    $target = [string]$item.Target
    if ([System.IO.Path]::IsPathRooted($target)) {
      return [System.IO.Path]::GetFullPath($target)
    }
    return [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Path $item.FullName -Parent) $target))
  }
  return $item.FullName
}
function Copy-ProductionDependency([string]$DependencyName, [string]$SearchRoot, [hashtable]$Visited) {
  $dependencyLink = Join-Path $SearchRoot (Join-Path 'node_modules' $DependencyName)
  # pnpm places a package's resolved dependencies beside that package under
  # .pnpm/<package>/node_modules/, rather than inside <package>/node_modules/.
  if (-not (Test-Path -LiteralPath $dependencyLink)) {
    $dependencyLink = Join-Path (Split-Path -Path $SearchRoot -Parent) $DependencyName
  }
  if (-not (Test-Path -LiteralPath (Join-Path $dependencyLink 'package.json'))) {
    throw "Production dependency '$DependencyName' is not installed below $SearchRoot"
  }
  $dependencySource = Resolve-MaterializedPackageDirectory $dependencyLink
  $manifestPath = Join-Path $dependencySource 'package.json'
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $packageName = [string]$manifest.name
  if ([string]::IsNullOrWhiteSpace($packageName)) { throw "Invalid package manifest: $manifestPath" }
  if ($Visited.ContainsKey($packageName)) { return }
  $Visited[$packageName] = $true
  # Do not recurse through node_modules here: it contains pnpm's .bin links.
  # Dependencies are materialized explicitly below, which keeps the final tree
  # flattened and avoids following a cyclic link back into the pnpm store.
  Copy-Tree $dependencySource (Join-Path $pluginRoot (Join-Path 'node_modules' $packageName)) -ExcludeDirectories @('node_modules') -ExcludeJunctions
  if ($null -ne $manifest.dependencies) {
    $childNames = @(
      $manifest.dependencies.PSObject.Properties |
        ForEach-Object { [string]$_.Name } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
    foreach ($childName in $childNames) {
      Copy-ProductionDependency $childName $dependencySource $Visited
    }
  }
}
$visitedDependencies = @{}
foreach ($dependencyName in $productionDependencies) {
  Copy-ProductionDependency $dependencyName $sourceRoot $visitedDependencies
}
New-Item -ItemType Directory -Force -Path (Join-Path $tempResourceRoot 'plugin\presets') | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'presets\lab-research') -Destination (Join-Path $tempResourceRoot 'plugin\presets\lab-research') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'vendor.lock.json') -Destination (Join-Path $tempResourceRoot 'plugin\vendor.lock.json') -Force
New-Item -ItemType Directory -Force -Path (Join-Path $tempResourceRoot 'plugin\python') | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'python\requirements.lock') -Destination (Join-Path $tempResourceRoot 'plugin\python\requirements.lock') -Force
  Write-Phase ("Plugin staged in {0:n1}s." -f $pluginCopyWatch.Elapsed.TotalSeconds)
}

# 0.4.0-rc.4（§9.2）：验证 staged 快照后，先备份正式快照 → 移入新快照 →
# 删除旧备份。任何一步失败只清理 staged，正式快照保持最近一次可用版本。
function Test-StagedSnapshot {
  if ($refreshNode -and -not (Test-Path -LiteralPath (Join-Path $tempResourceRoot 'node\node.exe'))) { return $false }
  if ($refreshDsh -and -not (Test-Path -LiteralPath (Join-Path $tempResourceRoot 'dsh\node_modules\@deepseek-ai\dsh\lib\bin.js'))) { return $false }
  if ($refreshPlugin -and -not (Test-Path -LiteralPath (Join-Path $tempResourceRoot 'plugin\dsh-lab-agent\lib\remote.js'))) { return $false }
  if ($refreshPlugin -and -not (Test-KetcherAssetReferences (Join-Path $tempResourceRoot 'plugin\dsh-lab-agent'))) { return $false }
  return $true
}

if (-not (Test-StagedSnapshot)) {
  throw "Staged resource snapshot failed validation; formal snapshot untouched. Review logs under $tempRoot."
}
Write-Phase 'Staged snapshot validation passed. Committing to formal resources (transactional swap with rollback).'
$swapWatch = [System.Diagnostics.Stopwatch]::StartNew()
# rc.4 review（§9.2）：
#  - 备份父目录可预建，但每个组件的最终备份目标在 Move-Item 前必须不存在，
#    避免 Windows 把正式目录嵌套进备份目录、恢复路径不确定；
#  - 记录每个已完成的移动动作；任一步失败按相反顺序回滚（新目录移回 staged →
#    旧目录从备份恢复 → 验证正式快照）；
#  - state 只在全部组件切换并验证成功后更新；
#  - 备份只保留最近 2 个，防大型 runtime 树长期积累。
$backupRoot = Join-Path $buildStateRoot ("prepare-runtime.backup-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$movedActions = [System.Collections.Generic.List[object]]::new()

function Undo-StagedSwap {
  for ($i = $movedActions.Count - 1; $i -ge 0; $i--) {
    $act = $movedActions[$i]
    $formal = Join-Path $resourceRoot $act.name
    $staged = Join-Path $tempResourceRoot $act.name
    try {
      # 1) 已安装的新目录移回 staged（quarantine），确保新快照不残留在正式位
      if (Test-Path -LiteralPath $formal) {
        Remove-TreeFast $staged
        Move-Item -LiteralPath $formal -Destination $staged -Force -ErrorAction Stop
      }
      # 2) 旧目录从备份恢复到原位置
      if (Test-Path -LiteralPath $act.backup) {
        if (Test-Path -LiteralPath $formal) { Remove-TreeFast $formal }
        Move-Item -LiteralPath $act.backup -Destination $formal -Force -ErrorAction Stop
      }
      Write-Phase "Rolled back component '$($act.name)' to its previous snapshot."
    } catch {
      Write-Phase "Rollback of '$($act.name)' failed: $($_.Exception.Message). Manual recovery required under $backupRoot."
    }
  }
}

try {
  foreach ($name in $targetNames) {
    $formal = Join-Path $resourceRoot $name
    $staged = Join-Path $tempResourceRoot $name
    $backupPath = Join-Path $backupRoot $name
    if (Test-Path -LiteralPath $formal) {
      Write-Phase "Moving existing $name snapshot to backup ($backupPath)."
      # 最终备份目标必须不存在（父目录已预建）→ Move 直接落为该路径本身，无嵌套
      if (Test-Path -LiteralPath $backupPath) { Remove-TreeFast $backupPath }
      Move-Item -LiteralPath $formal -Destination $backupPath -Force -ErrorAction Stop
    }
    # 备份移动一旦完成就立刻登记回滚动作。若下一条 staged -> formal 失败，
    # 旧实现尚未把该组件加入 movedActions，catch 无法把 backup 恢复回正式位。
    $movedActions.Add([pscustomobject]@{ name = $name; backup = $backupPath })
    Write-Phase "Moving staged $name into formal resources."
    Move-Item -LiteralPath $staged -Destination $formal -Force -ErrorAction Stop
  }
  # 全部切换后验证正式快照可用；失败即回滚（§9.2 第 3 步）
  $formalOk = $true
  if ($refreshNode -and -not (Test-NodeSnapshot)) { $formalOk = $false; Write-Phase 'Formal node snapshot validation failed.' }
  if ($refreshDsh -and -not (Test-DshSnapshot)) { $formalOk = $false; Write-Phase 'Formal dsh snapshot validation failed.' }
  if ($refreshPlugin -and -not (Test-PluginSnapshot)) { $formalOk = $false; Write-Phase 'Formal plugin snapshot validation failed.' }
  if (-not $formalOk) { throw "Formal snapshot validation failed after swap; triggering rollback." }
  $swapped = $true
} catch {
  Write-Phase "Swap failed: $($_.Exception.Message). Rolling back completed component swaps."
  Undo-StagedSwap
  throw "prepare-runtime swap aborted and rolled back: $($_.Exception.Message)"
}
Write-Phase ("Transactional swap completed in {0:n1}s. Old snapshots kept at $backupRoot" -f $swapWatch.Elapsed.TotalSeconds)

# 备份保留策略：只保留最近 2 个 backup 快照
Get-ChildItem -LiteralPath $buildStateRoot -Directory -Filter 'prepare-runtime.backup-*' -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending |
  Select-Object -Skip 2 |
  ForEach-Object { Write-Phase "Pruning old backup $($_.Name)"; Remove-TreeFast $_.FullName }

$state = [ordered]@{
  nodeFingerprint = $nodeFingerprint
  dshFingerprint = $dshFingerprint
  pluginFingerprint = $pluginFingerprint
  preparedAt = (Get-Date).ToUniversalTime().ToString('o')
  sourceRoot = $sourceRoot
  dshSource = $dshSource
  nodeExe = (Resolve-Path -LiteralPath $NodeExe).Path
  stagedFrom = $tempRoot
  backupRoot = $backupRoot
}
$state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
Write-Phase 'Bundled Node, DSH 0.1.1-rc.2, iBM Lab plugin, preset, bundled Python, and Python lock were prepared.'
} finally {
  if ($lockStream) { $lockStream.Dispose() }
  # rc.4（§9.2）：失败/被终止时清理本次临时目录；成功后备份目录保留以便回滚
  if (-not $swapped -and $tempRoot -and (Test-Path -LiteralPath $tempRoot)) {
    Write-Phase "Cleaning staged temporary directory $tempRoot after failure/abort."
    Remove-TreeFast $tempRoot
  }
  # rc.4（§9.2）：锁文件用独占句柄判断活跃——句柄已释放后，残留锁文件
  # 不代表进程仍在运行；只有"打开失败=别的进程持锁"才值得保留。此处
  # 释放句柄后再独占探测一次：能拿到独占句柄说明无活跃进程，删除残留锁。
  try {
    if (Test-Path -LiteralPath $lockPath) {
      $probe = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
      $probe.Dispose()
      Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    }
  } catch {
    Write-Phase "Lock file $lockPath is still held by an active process; leaving it in place."
  }
}
