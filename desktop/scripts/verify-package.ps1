[CmdletBinding()]
param([string]$InstallerPath)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$resourceRoot = Join-Path $projectRoot 'src-tauri\resources'
$required = @(
  'node\node.exe',
  'dsh\node_modules\@deepseek-ai\dsh\lib\bin.js',
  'plugin\vendor.lock.json',
  'plugin\dsh-lab-agent\package.json',
  'plugin\dsh-lab-agent\vendor\nature-skills',
  'plugin\presets\lab-research\agent.cordis.yml',
  'plugin\python\requirements.lock'
)
foreach ($relativePath in $required) {
  $path = Join-Path $resourceRoot $relativePath
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing packaged runtime input: $relativePath" }
}

$node = Join-Path $resourceRoot 'node\node.exe'
$dshBin = Join-Path $resourceRoot 'dsh\node_modules\@deepseek-ai\dsh\lib\bin.js'
$temporaryHome = Join-Path ([System.IO.Path]::GetTempPath()) ("ibm-lab-desktop-verify-" + [guid]::NewGuid())
try {
  $profile = Join-Path $temporaryHome 'profiles\ibm-lab'
  New-Item -ItemType Directory -Force -Path (Join-Path $profile 'node_modules') | Out-Null
  Copy-Item -LiteralPath (Join-Path $resourceRoot 'plugin\dsh-lab-agent') -Destination (Join-Path $profile 'node_modules\dsh-lab-agent') -Recurse -Force
  $profileManifest = @'
{
  "name": "dsh-profile-ibm-lab",
  "private": true,
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-lab-agent"] } }
}
'@
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Join-Path $profile 'package.json'), $profileManifest, $utf8)
  [System.IO.File]::WriteAllText((Join-Path $profile 'cordis.patch.yml'), "[]`n", $utf8)
  $previousHome = $env:DSH_HOME; $env:DSH_HOME = $temporaryHome
  & $node $dshBin --profile ibm-lab --help | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Bundled DSH profile check failed.' }
} finally {
  $env:DSH_HOME = $previousHome
  if (Test-Path -LiteralPath $temporaryHome) { Remove-Item -LiteralPath $temporaryHome -Recurse -Force }
}

if ($InstallerPath) {
  if (-not (Test-Path -LiteralPath $InstallerPath)) { throw "Installer was not produced: $InstallerPath" }
  if ((Get-Item -LiteralPath $InstallerPath).Length -lt 1MB) { throw 'Installer is unexpectedly small; bundled runtime is probably absent.' }
}
Write-Host 'Package inputs and bundled DSH entrypoint verified.'
