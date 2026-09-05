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
  'plugin\dsh-lab-agent\node_modules\fast-xml-parser\package.json',
  'plugin\dsh-lab-agent\node_modules\js-yaml\package.json',
  'plugin\dsh-lab-agent\node_modules\jszip\package.json',
  'plugin\dsh-lab-agent\node_modules\zod\package.json',
  'plugin\dsh-lab-agent\vendor\nature-skills',
  'plugin\dsh-lab-agent\python\requirements.lock',
  'python\dist\python.exe',
  'plugin\presets\lab-research\agent.cordis.yml',
  'plugin\python\requirements.lock',
  'plugin\dsh-lab-agent\client\assets\ketcher-standalone\index.html',
  'plugin\dsh-lab-agent\src\experiment-plan-template.js',
  'plugin\dsh-lab-agent\lib\experiment-plan-templates.js'
)
foreach ($relativePath in $required) {
  $path = Join-Path $resourceRoot $relativePath
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing packaged runtime input: $relativePath" }
}

# 0.4.0：Ketcher index.html 引用的每个哈希资源必须存在（防止清旧块时误删在用资源）。
$ketcherIndex = Join-Path $resourceRoot 'plugin\dsh-lab-agent\client\assets\ketcher-standalone\index.html'
$ketcherHtml = Get-Content -LiteralPath $ketcherIndex -Raw
$ketcherRefs = [regex]::Matches($ketcherHtml, '(?:src|href)="\./assets/([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
if ($ketcherRefs.Count -eq 0) { throw 'Ketcher index.html references no assets (broken build output).' }
foreach ($ref in $ketcherRefs) {
  $refPath = Join-Path (Split-Path -Parent $ketcherIndex) ("assets\" + $ref)
  if (-not (Test-Path -LiteralPath $refPath)) { throw "Ketcher index.html references missing asset: assets\$ref" }
}

$node = Join-Path $resourceRoot 'node\node.exe'
$dshBin = Join-Path $resourceRoot 'dsh\node_modules\@deepseek-ai\dsh\lib\bin.js'
$python = Join-Path $resourceRoot 'python\dist\python.exe'
$pluginRoot = Join-Path $resourceRoot 'plugin\dsh-lab-agent'
# Verify imports from the exact packaged layout.  Merely checking files exist
# would not catch a missing transitive dependency behind a pnpm link.
$importProbePath = Join-Path $pluginRoot '.package-import-probe.mjs'
try {
  [System.IO.File]::WriteAllText($importProbePath, @'
await Promise.all([
  import('fast-xml-parser'),
  import('js-yaml'),
  import('jszip'),
  import('zod'),
  import('./lib/remote.js'),
  import('./lib/tasks.js'),
  import('./lib/ppt-templates.js'),
  import('./lib/manual-capture.js'),
  import('./lib/experiment-plan-templates.js'),
  import('./lib/synthesis.js'),
  import('./lib/evidence-shot.js'),
  import('./lib/user-action.js'),
]);
'@, (New-Object System.Text.UTF8Encoding($false)))
  & $node $importProbePath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Packaged plugin import probe failed.' }
} finally {
  if (Test-Path -LiteralPath $importProbePath) { Remove-Item -LiteralPath $importProbePath -Force }
}
$pythonCheck = & $python -I -c 'import markitdown; print(markitdown.__name__)'
if ($LASTEXITCODE -ne 0 -or $pythonCheck -ne 'markitdown') { throw 'Bundled Python cannot import markitdown.' }
# Origin MCP（固定 0.1.4）打包自检：版本精确 + CLI 可执行 + JSON 可解析。
# Bridge/Origin 未启动属合法环境：CLI 此时可能返回非零退出码，但 JSON 依旧
# 完整有效，不允许因此判打包失败（任务书 §18）。
$originVersion = & $python -I -c 'import origin_mcp; print(origin_mcp.__version__)'
if ($LASTEXITCODE -ne 0 -or $originVersion -ne '0.1.4') { throw "Bundled origin-mcp version mismatch: '$originVersion' (expected 0.1.4)." }
$originStatusOut = (& $python -I -m origin_mcp status --json 2>&1) -join "`n"
if ([string]::IsNullOrWhiteSpace($originStatusOut)) { throw 'Bundled origin_mcp status --json produced no output.' }
if ($originStatusOut -match 'ModuleNotFoundError') { throw 'Bundled origin_mcp import failed (ModuleNotFoundError).' }
try {
  $originStatus = $originStatusOut | ConvertFrom-Json
} catch {
  throw "Bundled origin_mcp status --json is not parseable JSON. Output: $originStatusOut"
}
if ($null -eq $originStatus.PSObject.Properties['state']) { throw 'origin_mcp status --json missing top-level state.' }
# Mnova MCP（固定 0.3.1）打包自检：版本精确 + 打包 asset bridge.qs 存在 +
# STDIO initialize/tools/list 探针。MestReNova 未安装属“功能不可用”，不是
# Installer 损坏，因此探针只验证 MCP Server 层（任务书 §7/§18）。
$mnovaVersion = & $python -I -c 'import mnova_mcp; print(mnova_mcp.__version__)'
if ($LASTEXITCODE -ne 0 -or $mnovaVersion -ne '0.3.1') { throw "Bundled mnova-mcp version mismatch: '$mnovaVersion' (expected 0.3.1)." }
$mnovaBridge = & $python -I -c 'from mnova_mcp.config import Settings; p = Settings.from_environment().bridge_script; print(p); assert p.is_file(), "bridge.qs missing"' 2>&1
if ($LASTEXITCODE -ne 0) { throw "Bundled mnova-mcp bridge.qs is missing. Output: $mnovaBridge" }
$mnovaProbe = & $python -I -c @'
import json, subprocess, sys
child = subprocess.Popen(
    [sys.executable, "-m", "mnova_mcp"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
)
msgs = [
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"ibm-lab-desktop-verify","version":"0.2.0"}}}',
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}',
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}',
]
out, err = child.communicate("\n".join(msgs) + "\n", timeout=60)
tools = []
for line in out.splitlines():
    try:
        value = json.loads(line)
    except Exception:
        continue
    if value.get("id") == 2 and "result" in value:
        tools = [t["name"] for t in value["result"].get("tools", [])]
        break
required = ["mnova_status", "mnova_process_1d", "mnova_prepare_structure_1d", "mnova_apply_assignments_1d"]
missing = [name for name in required if name not in tools]
if missing:
    print(f"mnova probe missing tools: {missing}", file=sys.stderr)
    print(err[-2000:] if err else "", file=sys.stderr)
    sys.exit(3)
print(f"mnova probe OK: {len(tools)} tools")
'@ 2>&1
if ($LASTEXITCODE -ne 0) { throw "Bundled mnova_mcp STDIO probe failed. Output: $mnovaProbe" }
Write-Host "Bundled Python checks: origin-mcp 0.1.4 | mnova-mcp $mnovaVersion | $mnovaBridge | $mnovaProbe"
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

      # 0.4.0-rc.4（§8）：Ketcher 静态资源冒烟——不仅检查首页 2xx，还遍历
      # /api/lab-ketcher/index.html 及其引用的静态资源必须全部 2xx；资源引用
      # 缺失/引用悬挂直接视为冒烟失败。headless 全量渲染（ready/SMILES 载入/
      # 编辑保存/PNG/SVG 导出）需要真实浏览器，属安装后人工/受控浏览器验收，
      # 不在无头 CLI 里声称完成。
      $ketcherIndexUri = "http://127.0.0.1:$port/api/lab-ketcher/index.html"
      $ketcherHtml = (Invoke-WebRequest -Uri $ketcherIndexUri -UseBasicParsing -TimeoutSec 3).Content
      if (-not $ketcherHtml -or $ketcherHtml -notmatch '<div id="root">') {
        throw "Ketcher smoke failed: /api/lab-ketcher/index.html did not return the shell document."
      }
      $ketcherAssets = [regex]::Matches($ketcherHtml, '(?:src|href)="\.\/assets\/([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
      if ($ketcherAssets.Count -eq 0) {
        throw "Ketcher smoke failed: index.html references no static assets."
      }
      foreach ($asset in $ketcherAssets) {
        $assetUri = "http://127.0.0.1:$port/api/lab-ketcher/assets/$asset"
        $assetResponse = Invoke-WebRequest -Uri $assetUri -UseBasicParsing -TimeoutSec 15 -SkipHttpErrorCheck
        if ([int]$assetResponse.StatusCode -ge 400) {
          throw "Ketcher smoke failed: static asset $asset returned HTTP $([int]$assetResponse.StatusCode)."
        }
      }
      Write-Host "Ketcher static smoke passed: index.html + $($ketcherAssets.Count) asset(s) served (HTTP 2xx). Browser-level render (ready/load/edit/PNG/SVG export/offline) is covered by the installed-app manual acceptance (see 0.4.0_RC3_REMEDIATION_PLAN §8)."
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
