[CmdletBinding()]
param(
  [string]$SourceRoot,
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
$resourceRoot = Join-Path $projectRoot 'src-tauri\resources'
$iconRoot = Join-Path $projectRoot 'src-tauri\icons'
$dshSource = Join-Path $sourceRoot 'runtime\launcher\node_modules'

if (-not $NodeExe -or -not (Test-Path -LiteralPath $NodeExe)) {
  throw 'A Windows node.exe is required. Pass -NodeExe with an approved Node 24 executable before packaging.'
}
if (-not (Test-Path -LiteralPath (Join-Path $dshSource '@deepseek-ai\dsh\lib\bin.js'))) {
  throw "DeepSeek Harness payload was not found at $dshSource"
}

$targets = @('node', 'dsh', 'plugin') | ForEach-Object { Join-Path $resourceRoot $_ }
foreach ($target in $targets) {
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
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

function Copy-Tree([string]$Source, [string]$Destination) {
  & robocopy $Source $Destination /E /SL /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "robocopy failed while copying $Source (exit $LASTEXITCODE)" }
}

Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $resourceRoot 'node\node.exe') -Force
Copy-Tree $dshSource (Join-Path $resourceRoot 'dsh\node_modules')
$pluginRoot = Join-Path $resourceRoot 'plugin\dsh-lab-agent'
New-Item -ItemType Directory -Force -Path $pluginRoot, (Join-Path $pluginRoot 'node_modules') | Out-Null
foreach ($item in @('package.json', 'LICENSE', 'lib', 'client', 'cordis.patch.yml', 'presets', 'python', 'scripts', 'bin', 'src', 'vendor', 'vendor.lock.json', 'harness.lock.json')) {
  $from = Join-Path $sourceRoot $item
  $to = Join-Path $pluginRoot $item
  if ((Get-Item -LiteralPath $from).PSIsContainer) { Copy-Tree $from $to } else { Copy-Item -LiteralPath $from -Destination $to -Force }
}
foreach ($dependency in @('fast-xml-parser', 'js-yaml', 'jszip', 'zod')) {
  Copy-Tree (Join-Path $sourceRoot "node_modules\$dependency") (Join-Path $pluginRoot "node_modules\$dependency")
}
New-Item -ItemType Directory -Force -Path (Join-Path $resourceRoot 'plugin\presets') | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'presets\lab-research') -Destination (Join-Path $resourceRoot 'plugin\presets\lab-research') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'vendor.lock.json') -Destination (Join-Path $resourceRoot 'plugin\vendor.lock.json') -Force
New-Item -ItemType Directory -Force -Path (Join-Path $resourceRoot 'plugin\python') | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'python\requirements.lock') -Destination (Join-Path $resourceRoot 'plugin\python\requirements.lock') -Force

Write-Host 'Bundled Node, DSH 0.1.1-rc.2, iBM Lab plugin, preset, and Python lock were prepared.'
