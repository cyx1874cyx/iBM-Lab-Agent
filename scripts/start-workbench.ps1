param([switch]$VerifyWindowResize)
$ErrorActionPreference = 'Stop'
$taskRepo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskDirectory = [System.IO.Path]::GetFullPath((Join-Path $taskRepo '../../work/workbench-dev-20261021'))
New-Item -ItemType Directory -Path $taskDirectory -Force | Out-Null
$taskNodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$taskBundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
if ($taskNodeCommand) { $taskNode = $taskNodeCommand.Source }
elseif (Test-Path -LiteralPath $taskBundledNode -PathType Leaf) { $taskNode = $taskBundledNode }
else { throw 'Node.js was not found. Install Node.js or restore the bundled workspace runtime.' }
$taskPreparation = Start-Process -FilePath $taskNode -ArgumentList ('"' + (Join-Path $PSScriptRoot 'dev-workbench.mjs') + '"'), '--prepare-only' -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $taskDirectory 'prepare.log') -RedirectStandardError (Join-Path $taskDirectory 'prepare.stderr.log')
if ($taskPreparation.ExitCode -ne 0) { throw "Development preparation failed; see $taskDirectory\prepare.stderr.log" }
$taskSettings = Get-Content -LiteralPath (Join-Path $taskDirectory 'development.json') -Raw | ConvertFrom-Json
$env:DSH_DESKTOP_NEXT_HOME = $taskSettings.home
$env:DSH_HOME = $taskSettings.home
$env:DSH_TELEMETRY_DISABLED = '1'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$taskArguments = @(('"' + $taskSettings.application + '"'), '--remote-debugging-port=0')
if ($VerifyWindowResize) { $taskArguments += '--verify-window-resize' }
Start-Process -FilePath $taskSettings.electron -ArgumentList $taskArguments -WindowStyle Normal -RedirectStandardOutput (Join-Path $taskDirectory 'electron.stdout.log') -RedirectStandardError (Join-Path $taskDirectory 'electron.stderr.log')
