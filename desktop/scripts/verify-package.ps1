[CmdletBinding()]
param(
  [string]$InstallerPath,
  [switch]$WebSmokeTest
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$resourceRoot = Join-Path $projectRoot 'src-tauri\resources'
$required = @(
  'node\node.exe',
  'dsh\node_modules\@deepseek-ai\dsh\lib\bin.js',
  'plugin\vendor.lock.json',
  'plugin\dsh-lab-agent\package.json',
  'plugin\dsh-lab-agent\vendor\nature-skills',
  'plugin\dsh-lab-agent\python\requirements.lock',
  'python\dist\python.exe',
  'plugin\presets\lab-research\agent.cordis.yml',
  'plugin\python\requirements.lock'
)
foreach ($relativePath in $required) {
  $path = Join-Path $resourceRoot $relativePath
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing packaged runtime input: $relativePath" }
}

$node = Join-Path $resourceRoot 'node\node.exe'
$dshBin = Join-Path $resourceRoot 'dsh\node_modules\@deepseek-ai\dsh\lib\bin.js'
$python = Join-Path $resourceRoot 'python\dist\python.exe'
$pythonCheck = & $python -I -c 'import markitdown; print(markitdown.__name__)'
if ($LASTEXITCODE -ne 0 -or $pythonCheck -ne 'markitdown') { throw 'Bundled Python cannot import markitdown.' }
$temporaryHome = Join-Path ([System.IO.Path]::GetTempPath()) ("ibm-lab-desktop-verify-" + [guid]::NewGuid())
$smokeProcess = $null
try {
  $profile = Join-Path $temporaryHome 'profiles\ibm-lab'
  New-Item -ItemType Directory -Force -Path (Join-Path $profile 'node_modules') | Out-Null
  Copy-Item -LiteralPath (Join-Path $resourceRoot 'plugin\dsh-lab-agent') -Destination (Join-Path $profile 'node_modules\dsh-lab-agent') -Recurse -Force
  $labHome = Join-Path $temporaryHome 'lab-agent'
  New-Item -ItemType Directory -Force -Path $labHome | Out-Null
  Copy-Item -LiteralPath (Join-Path $resourceRoot 'plugin\dsh-lab-agent\vendor') -Destination (Join-Path $labHome 'vendor') -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $resourceRoot 'plugin\vendor.lock.json') -Destination (Join-Path $labHome 'vendor.lock.json') -Force
  Copy-Item -LiteralPath (Join-Path $resourceRoot 'plugin\dsh-lab-agent\python\requirements.lock') -Destination (Join-Path $labHome 'requirements.lock') -Force
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

  if ($WebSmokeTest) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    $listener.Stop()
    $stdoutPath = Join-Path $temporaryHome 'web-smoke.stdout.log'
    $stderrPath = Join-Path $temporaryHome 'web-smoke.stderr.log'
    $previousHarnessModules = $env:DSH_HARNESS_NODE_MODULES
    $previousWorkspace = $env:IBM_LAB_AGENT_WORKSPACE
    $previousBundledPython = $env:IBM_LAB_AGENT_BUNDLED_PYTHON
    $env:DSH_HARNESS_NODE_MODULES = Join-Path $resourceRoot 'dsh\node_modules'
    $env:IBM_LAB_AGENT_WORKSPACE = $temporaryHome
    $env:IBM_LAB_AGENT_BUNDLED_PYTHON = Join-Path $resourceRoot 'python\dist\python.exe'
    try {
      $smokeProcess = Start-Process -FilePath $node -ArgumentList @(
        $dshBin, '--profile', 'ibm-lab', '--no-open', '--host', '127.0.0.1', '--port', $port
      ) -WorkingDirectory $temporaryHome -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -WindowStyle Hidden -PassThru
      $ready = $false
      for ($attempt = 1; $attempt -le 90; $attempt++) {
        if ($smokeProcess.HasExited) { break }
        try {
          $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 2
          if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { $ready = $true; break }
        } catch {}
        Start-Sleep -Seconds 1
      }
      $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { '' }
      if (-not $ready) {
        $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { '' }
        throw "Bundled DSH Web smoke test failed.`nSTDOUT:`n$stdout`nSTDERR:`n$stderr"
      }
      if ($stderr -match 'service\s+["'']labAgent["'']\s+has been registered|plugin tree failed to load') {
        throw "Bundled DSH Web reported a duplicate service or plugin-tree error:`n$stderr"
      }
      $handoffUri = "http://127.0.0.1:$port/lab/capture/?taskId=capture-route-smoke"
      if ((Get-Command Invoke-WebRequest).Parameters.ContainsKey('SkipHttpErrorCheck')) {
        $handoffResponse = Invoke-WebRequest -Uri $handoffUri -UseBasicParsing -TimeoutSec 2 -SkipHttpErrorCheck
        $handoffStatus = [int]$handoffResponse.StatusCode
        $handoffBody = [string]$handoffResponse.Content
      } else {
        try {
          $handoffResponse = Invoke-WebRequest -Uri $handoffUri -UseBasicParsing -TimeoutSec 2
          $handoffStatus = [int]$handoffResponse.StatusCode
          $handoffBody = [string]$handoffResponse.Content
        } catch {
          $errorResponse = $_.Exception.Response
          if (-not $errorResponse) { throw }
          $handoffStatus = [int]$errorResponse.StatusCode
          $reader = New-Object System.IO.StreamReader($errorResponse.GetResponseStream())
          try { $handoffBody = $reader.ReadToEnd() } finally { $reader.Dispose() }
        }
      }
      if ($handoffStatus -ne 404 -or $handoffBody -ne 'capture task not found') {
        throw "Bundled DSH fixed capture handoff route did not reach the plugin handler (status=$handoffStatus, body=$handoffBody)."
      }
      Write-Host "Bundled DSH Web health check passed on 127.0.0.1:$port."
      Write-Host 'Bundled DSH fixed capture handoff route check passed.'
    } finally {
      if ($smokeProcess -and -not $smokeProcess.HasExited) {
        & taskkill.exe /PID $smokeProcess.Id /T /F | Out-Null
      }
      $env:DSH_HARNESS_NODE_MODULES = $previousHarnessModules
      $env:IBM_LAB_AGENT_WORKSPACE = $previousWorkspace
      $env:IBM_LAB_AGENT_BUNDLED_PYTHON = $previousBundledPython
    }
  }
} finally {
  $env:DSH_HOME = $previousHome
  if (Test-Path -LiteralPath $temporaryHome) { Remove-Item -LiteralPath $temporaryHome -Recurse -Force }
}

if ($InstallerPath) {
  if (-not (Test-Path -LiteralPath $InstallerPath)) { throw "Installer was not produced: $InstallerPath" }
  if ((Get-Item -LiteralPath $InstallerPath).Length -lt 1MB) { throw 'Installer is unexpectedly small; bundled runtime is probably absent.' }
}
Write-Host 'Package inputs and bundled DSH entrypoint verified.'
