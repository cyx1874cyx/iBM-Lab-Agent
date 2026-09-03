[CmdletBinding()]
param(
  [string]$SourceRoot,
  [string]$RuntimeSourceRoot,
  [string]$NodeExe = $env:CODEX_MCP_NODE_PATH
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
$dshSource = Join-Path $runtimeSourceRoot 'runtime\launcher\node_modules'

if (-not $NodeExe -or -not (Test-Path -LiteralPath $NodeExe)) {
  throw 'A Windows node.exe is required. Pass -NodeExe with an approved Node 24 executable before packaging.'
}
if (-not (Test-Path -LiteralPath (Join-Path $dshSource '@deepseek-ai\dsh\lib\bin.js'))) {
  throw "DeepSeek Harness payload was not found at $dshSource"
}
$bundledPython = Join-Path $resourceRoot 'python\dist\python.exe'
if (-not (Test-Path -LiteralPath $bundledPython)) {
  throw "Bundled Python is missing: $bundledPython. Run scripts/build-bundled-python.ps1 before prepare-runtime."
}

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

$targets = @('node', 'dsh', 'plugin') | ForEach-Object { Join-Path $resourceRoot $_ }
foreach ($target in $targets) {
  Remove-TreeFast $target
}
New-Item -ItemType Directory -Force -Path (Join-Path $resourceRoot 'node'), (Join-Path $resourceRoot 'dsh'), (Join-Path $resourceRoot 'plugin') | Out-Null
New-Item -ItemType Directory -Force -Path $iconRoot | Out-Null

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
  [string[]]$ExcludeFiles = @()
) {
  # /MT:16 多线程复制：单线程 robocopy 在本机实测约 6 文件/秒，2.9 万文件的
  # dsh 树需 1 小时以上；16 线程可将整体刷新压缩到几分钟。
  $arguments = @($Source, $Destination, '/E', '/SL', '/MT:16', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  if ($ExcludeDirectories.Count -gt 0) { $arguments += '/XD'; $arguments += $ExcludeDirectories }
  if ($ExcludeFiles.Count -gt 0) { $arguments += '/XF'; $arguments += $ExcludeFiles }
  & robocopy @arguments | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "robocopy failed while copying $Source (exit $LASTEXITCODE)" }
}

Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $resourceRoot 'node\node.exe') -Force
# pnpm's internal content-addressed store duplicates the already materialized top-level
# runtime dependencies. Bundling it adds hundreds of thousands of files without being
# consulted by Node.js at runtime, so keep the flattened dependency tree only.
Copy-Tree $dshSource (Join-Path $resourceRoot 'dsh\node_modules') `
  -ExcludeDirectories @((Join-Path $dshSource '.pnpm')) `
  -ExcludeFiles @('.modules.yaml', '.package-map.json', '.pnpm-workspace-state-v1.json')
$pluginRoot = Join-Path $resourceRoot 'plugin\dsh-lab-agent'
New-Item -ItemType Directory -Force -Path $pluginRoot, (Join-Path $pluginRoot 'node_modules') | Out-Null
foreach ($item in @('package.json', 'LICENSE', 'lib', 'client', 'cordis.patch.yml', 'presets', 'python', 'scripts', 'bin', 'src', 'vendor', 'vendor.lock.json', 'harness.lock.json')) {
  $from = Join-Path $sourceRoot $item
  $to = Join-Path $pluginRoot $item
  if ((Get-Item -LiteralPath $from).PSIsContainer) { Copy-Tree $from $to } else { Copy-Item -LiteralPath $from -Destination $to -Force }
}
# Copy the complete materialized production dependency tree. npm places transitive
# packages (including scoped packages) beside the direct dependencies, and copying
# only the four manifest entries can leave a package that passes import checks but
# fails when a feature loads at runtime. Test-only DSH junctions are excluded.
$dependencyRoot = Join-Path $sourceRoot 'node_modules'
foreach ($dependency in Get-ChildItem -LiteralPath $dependencyRoot -Directory -Force) {
  if ($dependency.Name -in @('.bin', '@deepseek-ai', 'dsh-lab-agent')) { continue }
  if (($dependency.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
  Copy-Tree $dependency.FullName (Join-Path $pluginRoot "node_modules\$($dependency.Name)")
}
New-Item -ItemType Directory -Force -Path (Join-Path $resourceRoot 'plugin\presets') | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'presets\lab-research') -Destination (Join-Path $resourceRoot 'plugin\presets\lab-research') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'vendor.lock.json') -Destination (Join-Path $resourceRoot 'plugin\vendor.lock.json') -Force
New-Item -ItemType Directory -Force -Path (Join-Path $resourceRoot 'plugin\python') | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'python\requirements.lock') -Destination (Join-Path $resourceRoot 'plugin\python\requirements.lock') -Force

Write-Host 'Bundled Node, DSH 0.1.1-rc.2, iBM Lab plugin, preset, bundled Python, and Python lock were prepared.'
