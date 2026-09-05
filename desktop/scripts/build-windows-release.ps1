[CmdletBinding()]
param(
  [string]$SourceRoot,
  [string]$NodeExe = $env:CODEX_MCP_NODE_PATH,
  [string]$DshSource,
  [switch]$AllowDirty,
  [switch]$PreflightOnly,
  [switch]$SkipTests,
  [switch]$SkipBuild,
  [switch]$ForcePrepare,
  [switch]$RebuildBundledPython,
  [ValidateRange(5, 300)]
  [int]$HeartbeatSeconds = 20,
  [ValidateRange(5, 240)]
  [int]$PrepareTimeoutMinutes = 60,
  [ValidateRange(10, 360)]
  [int]$BuildTimeoutMinutes = 120
)

$ErrorActionPreference = 'Stop'
$desktopRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $SourceRoot) { $SourceRoot = Join-Path $desktopRoot '..' }
$sourceRoot = (Resolve-Path -LiteralPath $SourceRoot).Path
$buildRoot = Join-Path $desktopRoot '.build'
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$logRoot = Join-Path $buildRoot ("windows-release-" + $runId)
$lockPath = Join-Path $buildRoot 'windows-release.lock'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

if (-not $NodeExe) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) { $NodeExe = $nodeCommand.Source }
}
if (-not $NodeExe -or -not (Test-Path -LiteralPath $NodeExe)) {
  throw 'Node.js is unavailable. Pass -NodeExe with an approved Windows Node 24 executable.'
}
$NodeExe = (Resolve-Path -LiteralPath $NodeExe).Path

if (-not $DshSource) {
  $DshSource = Join-Path $sourceRoot 'node_modules'
}
$DshSource = (Resolve-Path -LiteralPath $DshSource -ErrorAction SilentlyContinue)?.Path
if (-not $DshSource -or -not (Test-Path -LiteralPath (Join-Path $DshSource '@deepseek-ai\dsh\lib\bin.js'))) {
  throw "DSH runtime is unavailable below '$DshSource'. Install the locked root workspace dependencies first."
}

try {
  $releaseLock = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch {
  throw "Another Windows release build is already active ($lockPath). Do not run prepare-runtime or Tauri build concurrently."
}
$prepareLockPath = Join-Path $buildRoot 'prepare-runtime.lock'
if (Test-Path -LiteralPath $prepareLockPath) {
  try {
    $prepareProbe = [System.IO.File]::Open($prepareLockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $prepareProbe.Dispose()
  } catch {
    $releaseLock.Dispose()
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    throw "prepare-runtime is already active ($prepareLockPath). Wait for it to finish before starting a release build."
  }
}

function Write-ReleaseStatus([string]$Message) {
  Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $Message)
}

function Get-Tail([string]$Path, [int]$Count = 40) {
  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  return (Get-Content -LiteralPath $Path -Tail $Count -ErrorAction SilentlyContinue) -join "`n"
}

function Invoke-LoggedProcess {
  param(
    [Parameter(Mandatory)] [string]$Name,
    [Parameter(Mandatory)] [string]$FilePath,
    [string[]]$Arguments = @(),
    [Parameter(Mandatory)] [string]$WorkingDirectory,
    [ValidateRange(1, 360)] [int]$TimeoutMinutes = 30,
    [hashtable]$Environment = @{}
  )
  $safeName = $Name -replace '[^A-Za-z0-9._-]', '-'
  $stdoutPath = Join-Path $logRoot ("$safeName.stdout.log")
  $stderrPath = Join-Path $logRoot ("$safeName.stderr.log")
  $info = [System.Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $FilePath
  $info.WorkingDirectory = $WorkingDirectory
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  foreach ($argument in $Arguments) { [void]$info.ArgumentList.Add([string]$argument) }
  $info.Environment['CI'] = 'true'
  $info.Environment['CODEBUDDY_SAFE_DELETE_ENABLED'] = '0'
  foreach ($key in $Environment.Keys) { $info.Environment[[string]$key] = [string]$Environment[$key] }

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $info
  $stdoutFile = [System.IO.FileStream]::new($stdoutPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
  $stderrFile = [System.IO.FileStream]::new($stderrPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  Write-ReleaseStatus "START $Name (timeout ${TimeoutMinutes}m). Logs: $stdoutPath"
  $exitCode = $null
  try {
    if (-not $process.Start()) { throw "Failed to start phase '$Name'." }
    $stdoutCopy = $process.StandardOutput.BaseStream.CopyToAsync($stdoutFile)
    $stderrCopy = $process.StandardError.BaseStream.CopyToAsync($stderrFile)
    while (-not $process.WaitForExit($HeartbeatSeconds * 1000)) {
      $process.Refresh()
      $outSize = if (Test-Path -LiteralPath $stdoutPath) { (Get-Item -LiteralPath $stdoutPath).Length } else { 0 }
      $errSize = if (Test-Path -LiteralPath $stderrPath) { (Get-Item -LiteralPath $stderrPath).Length } else { 0 }
      Write-ReleaseStatus ("HEARTBEAT {0}: elapsed={1:hh\:mm\:ss}, pid={2}, cpu={3:n1}s, logs={4}/{5} bytes" -f $Name, $watch.Elapsed, $process.Id, $process.TotalProcessorTime.TotalSeconds, $outSize, $errSize)
      if ($watch.Elapsed.TotalMinutes -ge $TimeoutMinutes) {
        try { $process.Kill($true) } catch {}
        throw "Phase '$Name' exceeded ${TimeoutMinutes} minutes and its process tree was stopped. Inspect $stdoutPath and $stderrPath."
      }
    }
    [void]$stdoutCopy.GetAwaiter().GetResult()
    [void]$stderrCopy.GetAwaiter().GetResult()
    $exitCode = $process.ExitCode
  } finally {
    $stdoutFile.Dispose()
    $stderrFile.Dispose()
    $process.Dispose()
  }
  if ($exitCode -ne 0) {
    throw "Phase '$Name' failed with exit code $exitCode.`nSTDOUT tail:`n$(Get-Tail $stdoutPath)`nSTDERR tail:`n$(Get-Tail $stderrPath)"
  }
  Write-ReleaseStatus ("DONE {0} in {1:hh\:mm\:ss}." -f $Name, $watch.Elapsed)
  return [ordered]@{ name = $Name; seconds = [math]::Round($watch.Elapsed.TotalSeconds, 1); stdout = $stdoutPath; stderr = $stderrPath }
}

function Assert-KetcherReferences([string]$Root) {
  $indexPath = Join-Path $Root 'client\assets\ketcher-standalone\index.html'
  if (-not (Test-Path -LiteralPath $indexPath)) { throw "Ketcher entry is missing: $indexPath" }
  $html = Get-Content -LiteralPath $indexPath -Raw
  $references = [regex]::Matches($html, '(?:src|href)="\.\/assets\/([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
  if ($references.Count -eq 0) { throw "Ketcher entry has no hashed asset references: $indexPath" }
  foreach ($reference in $references) {
    $asset = Join-Path (Split-Path -Parent $indexPath) ("assets\" + $reference)
    if (-not (Test-Path -LiteralPath $asset)) { throw "Ketcher entry references a missing asset: $asset" }
  }
}

function Get-ReleaseVersion {
  $rootVersion = (Get-Content -LiteralPath (Join-Path $sourceRoot 'package.json') -Raw | ConvertFrom-Json).version
  $desktopVersion = (Get-Content -LiteralPath (Join-Path $desktopRoot 'package.json') -Raw | ConvertFrom-Json).version
  $tauriVersion = (Get-Content -LiteralPath (Join-Path $desktopRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version
  $manifestVersion = (Get-Content -LiteralPath (Join-Path $desktopRoot 'docs\release-manifest.json') -Raw | ConvertFrom-Json).ibmLabAgent
  $cargoText = Get-Content -LiteralPath (Join-Path $desktopRoot 'src-tauri\Cargo.toml') -Raw
  $cargoVersion = [regex]::Match($cargoText, '(?ms)^\[package\].*?^version\s*=\s*"([^"]+)"').Groups[1].Value
  $versions = @($rootVersion, $desktopVersion, $tauriVersion, $manifestVersion, $cargoVersion)
  if (($versions | Select-Object -Unique).Count -ne 1) {
    throw "Release versions are inconsistent: root=$rootVersion desktop=$desktopVersion tauri=$tauriVersion manifest=$manifestVersion cargo=$cargoVersion"
  }
  return [string]$rootVersion
}

$phases = [System.Collections.Generic.List[object]]::new()

# rc.4 review（§6）：发布预检必须失败关闭——git 缺失 / HEAD 坏对象 / status
# 非零 / diff --check 非零 / 工作区脏（无 AllowDirty）/ fsck 连通性失败，任何
# 一项都立即 throw。绝不能把“git 报错但 stdout 为空”当作干净仓库继续打包。
function Assert-GitReleaseReady {
  param([string]$RepoRoot, [switch]$AllowDirty)
  $git = Get-Command git -ErrorAction SilentlyContinue
  if (-not $git) { throw 'Git is unavailable. Release preflight cannot verify a clean, complete repository.' }
  # 1) 非 bare 工作树
  & $git.Source -C $RepoRoot rev-parse --is-inside-work-tree *> $null
  if ($LASTEXITCODE -ne 0) { throw "Repository check failed (exit $LASTEXITCODE): '$RepoRoot' is not inside a git working tree." }
  if ((& $git.Source -C $RepoRoot rev-parse --is-bare-repository) -eq 'true') {
    throw "Repository '$RepoRoot' is bare; releases require a normal (non-bare) working repository."
  }
  # 2) HEAD 可解析为可读 commit（bad object 直接终止，不把空输出当干净）
  & $git.Source -C $RepoRoot rev-parse --verify -q 'HEAD^{commit}' *> $null
  if ($LASTEXITCODE -ne 0) { throw "Repository HEAD cannot be resolved to a commit (exit $LASTEXITCODE); refusing to release from a broken repository." }
  & $git.Source -C $RepoRoot cat-file -e 'HEAD^{commit}' 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Repository HEAD does not point to a readable commit object.' }
  # 3) status --porcelain 必须自身成功；失败时空 stdout 不得解释为干净
  $porcelain = @(& $git.Source -C $RepoRoot status --porcelain)
  if ($LASTEXITCODE -ne 0) { throw "git status --porcelain failed (exit $LASTEXITCODE); empty output must NOT be treated as a clean tree." }
  # 4) diff --check（空白/冲突标记）无条件必须 0
  & $git.Source -C $RepoRoot diff --check *> $null
  if ($LASTEXITCODE -ne 0) { throw 'git diff --check reported whitespace/conflict errors; fix them before release.' }
  $dirty = $porcelain.Count -gt 0
  if ($dirty -and -not $AllowDirty) {
    throw 'Working tree is dirty. Commit/stash the release inputs, or pass -AllowDirty only for a non-publishable diagnostic build.'
  }
  if ($dirty) {
    Write-Warning 'Building from a dirty tree (-AllowDirty): this output is DIAGNOSTIC ONLY and must not be published.'
    New-Item -ItemType File -Force -Path (Join-Path $logRoot 'DIAGNOSTIC-NOT-PUBLISHABLE.txt') -Value ("Built " + (Get-Date).ToUniversalTime().ToString('o') + " from a dirty working tree with -AllowDirty. Publish/upload must reject this artifact.") | Out-Null
  }
  # 5) 对象连通性
  & $git.Source -C $RepoRoot fsck --connectivity-only *> $null
  if ($LASTEXITCODE -ne 0) { throw "git fsck --connectivity-only reported problems (exit $LASTEXITCODE); refusing to release from an incomplete repository." }
  return @{ dirty = $dirty }
}

try {
  $version = Get-ReleaseVersion
  Assert-KetcherReferences $sourceRoot
  $gitState = Assert-GitReleaseReady -RepoRoot $sourceRoot -AllowDirty:$AllowDirty
  if ($gitState.dirty) { $AllowDirty = $true } # 已确认 dirty 走诊断语义
  Write-ReleaseStatus "Windows release preflight passed for $version."

  if ($PreflightOnly) {
    Write-ReleaseStatus 'PreflightOnly requested: versions, Ketcher references, DSH source and git/worktree preflight are valid.'
    return
  }

  if (-not $SkipTests) {
    $phases.Add((Invoke-LoggedProcess -Name 'tests' -FilePath $NodeExe -Arguments @('--test', 'tests/unit/*.test.mjs', 'tests/integration/*.test.mjs') -WorkingDirectory $sourceRoot -TimeoutMinutes 20))
    $phases.Add((Invoke-LoggedProcess -Name 'regression' -FilePath $NodeExe -Arguments @('scripts/regression/run.mjs') -WorkingDirectory $sourceRoot -TimeoutMinutes 20 -Environment @{ DSH_HARNESS_NODE_MODULES = $DshSource }))
    $phases.Add((Invoke-LoggedProcess -Name 'preset-exports' -FilePath $NodeExe -Arguments @('scripts/check-preset-exports.mjs') -WorkingDirectory $sourceRoot -TimeoutMinutes 5))
    # rc.4 review（§7.2）：真实浏览器 + 离线 Ketcher 验收必须进入统一发布脚本，
    # 失败阻止 Tauri 打包（驱动本机 Edge/Chrome headless，无浏览器则本阶段失败）。
    $phases.Add((Invoke-LoggedProcess -Name 'browser-ketcher' -FilePath $NodeExe -Arguments @('--test', 'tests/browser') -WorkingDirectory $sourceRoot -TimeoutMinutes 15))
    $eslint = Join-Path $sourceRoot 'node_modules\eslint\bin\eslint.js'
    if (-not (Test-Path -LiteralPath $eslint)) { throw "ESLint is missing: $eslint" }
    $phases.Add((Invoke-LoggedProcess -Name 'lint' -FilePath $NodeExe -Arguments @($eslint, 'lib', 'src', 'scripts', 'tests', 'client', 'browser-extension', '--max-warnings=200') -WorkingDirectory $sourceRoot -TimeoutMinutes 15))
  }

  $bundledPython = Join-Path $desktopRoot 'src-tauri\resources\python\dist\python.exe'
  if ($RebuildBundledPython -or -not (Test-Path -LiteralPath $bundledPython)) {
    $phases.Add((Invoke-LoggedProcess -Name 'bundled-python' -FilePath (Get-Command pwsh).Source -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'build-bundled-python.ps1'), '-SourceRoot', $sourceRoot) -WorkingDirectory $desktopRoot -TimeoutMinutes 90))
  }

  $prepareArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'prepare-runtime.ps1'), '-SourceRoot', $sourceRoot, '-DshSource', $DshSource, '-NodeExe', $NodeExe)
  if ($ForcePrepare) { $prepareArguments += '-Force' }
  $phases.Add((Invoke-LoggedProcess -Name 'prepare-runtime' -FilePath (Get-Command pwsh).Source -Arguments $prepareArguments -WorkingDirectory $desktopRoot -TimeoutMinutes $PrepareTimeoutMinutes -Environment @{ IBM_LAB_RELEASE_ORCHESTRATOR_PID = $PID }))
  $phases.Add((Invoke-LoggedProcess -Name 'verify-runtime' -FilePath (Get-Command pwsh).Source -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'verify-package.ps1'), '-WebSmokeTest') -WorkingDirectory $desktopRoot -TimeoutMinutes 20))

  if ($SkipBuild) {
    Write-ReleaseStatus 'SkipBuild requested: runtime snapshot verified; no installer was produced.'
    return
  }

  $tauriCli = Join-Path $desktopRoot 'node_modules\@tauri-apps\cli\tauri.js'
  if (-not (Test-Path -LiteralPath $tauriCli)) { throw "Tauri CLI is missing: $tauriCli" }
  $buildStartedAt = [DateTime]::UtcNow
  $phases.Add((Invoke-LoggedProcess -Name 'tauri-nsis' -FilePath $NodeExe -Arguments @($tauriCli, 'build') -WorkingDirectory $desktopRoot -TimeoutMinutes $BuildTimeoutMinutes -Environment @{ CARGO_TERM_COLOR = 'never' }))

  $installerRoot = Join-Path $desktopRoot 'src-tauri\target\release\bundle\nsis'
  $installer = Get-ChildItem -LiteralPath $installerRoot -File -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "iBM Lab Agent_${version}_x64-setup.exe" -and $_.LastWriteTimeUtc -ge $buildStartedAt.AddMinutes(-1)
  } | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if (-not $installer) { throw "Tauri exited successfully but did not create a fresh exact-version installer for $version below $installerRoot" }

  $phases.Add((Invoke-LoggedProcess -Name 'verify-installer' -FilePath (Get-Command pwsh).Source -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'verify-package.ps1'), '-InstallerPath', $installer.FullName) -WorkingDirectory $desktopRoot -TimeoutMinutes 20))
  $hash = Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256
  $report = [ordered]@{
    version = $version
    publishable = -not [bool]$AllowDirty
    installer = $installer.FullName
    bytes = $installer.Length
    sha256 = $hash.Hash
    completedAt = (Get-Date).ToUniversalTime().ToString('o')
    phases = $phases
  }
  $reportPath = Join-Path $logRoot 'release-report.json'
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding utf8
  Write-ReleaseStatus "SUCCESS $version | $($installer.FullName) | SHA256 $($hash.Hash)"
  Write-ReleaseStatus "Release report: $reportPath"
} finally {
  if ($releaseLock) { $releaseLock.Dispose() }
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
