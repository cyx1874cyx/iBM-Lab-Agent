[CmdletBinding()]
param([string]$OutputPath)

$ErrorActionPreference = 'Stop'
$extensionRoot = $PSScriptRoot
if (-not $OutputPath) {
  $version = (Get-Content -Raw -LiteralPath (Join-Path $extensionRoot 'manifest.json') | ConvertFrom-Json).version
  $OutputPath = Join-Path $extensionRoot "dist\ibm-literature-capture-edge-$version.zip"
}
$manifest = Get-Content -Raw -LiteralPath (Join-Path $extensionRoot 'manifest.json') | ConvertFrom-Json
if ($manifest.manifest_version -ne 3) { throw 'Edge Add-ons submission requires Manifest V3.' }
foreach ($required in @('background.js', 'content.js', 'popup.html', 'popup.js', 'popup.css', 'icons\icon16.png', 'icons\icon48.png', 'icons\icon128.png')) {
  if (-not (Test-Path -LiteralPath (Join-Path $extensionRoot $required))) { throw "Missing extension asset: $required" }
}
$output = [System.IO.Path]::GetFullPath($OutputPath)
$outputDir = Split-Path -Parent $output
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Force }
$files = @('manifest.json', 'background.js', 'content.js', 'popup.html', 'popup.js', 'popup.css', 'README.md', 'icons') | ForEach-Object { Join-Path $extensionRoot $_ }
Compress-Archive -LiteralPath $files -DestinationPath $output -CompressionLevel Optimal
if ((Get-Item -LiteralPath $output).Length -lt 1KB) { throw 'Packaged extension is unexpectedly small.' }
Write-Host "Edge Add-ons package created: $output"
