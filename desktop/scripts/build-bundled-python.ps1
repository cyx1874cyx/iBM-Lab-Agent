[CmdletBinding()]
param(
  [string]$SourceRoot,
  [string]$Python = 'py -3.11',
  [string]$IndexUrl = 'https://pypi.tuna.tsinghua.edu.cn/simple/'
)

# Build the self-contained bundled Python (resources/python/dist) for the
# iBM Lab Agent desktop package.
#
# dist/ is a full Python install tree (python.exe + python311.dll + DLLs +
# Lib + site-packages in one directory) so the packaged app works offline
# without any system Python. A copied *venv* is NOT portable on Windows
# (pyvenv.cfg pins the base interpreter), which is why we use the dist layout.
#
# Usage (from the desktop/ directory):
#   powershell -ExecutionPolicy Bypass -File scripts/build-bundled-python.ps1 -SourceRoot ..
#
# Requires: a Windows Python 3.11 installed and reachable via `py -3.11`.

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $SourceRoot) { $SourceRoot = Join-Path $projectRoot '..' }
$sourceRoot = (Resolve-Path $SourceRoot).Path
$resourceRoot = Join-Path $projectRoot 'src-tauri\resources'
$dist = Join-Path $resourceRoot 'python\dist'

# Locate the base Python 3.11 install (used as the source for the stdlib).
$pythonParts = $Python.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)
$basePython = & $pythonParts[0] $pythonParts[1..($pythonParts.Count - 1)] -c "import sys; print(sys.prefix)" 2>$null
if (-not $basePython -or -not (Test-Path -LiteralPath (Join-Path $basePython 'python.exe'))) {
  throw "Python 3.11 not found via '$Python'. Install Python 3.11 first."
}
Write-Host "Base Python: $basePython"

if (Test-Path -LiteralPath $dist) {
  $stale = Join-Path $resourceRoot 'python\dist.stale'
  if (Test-Path -LiteralPath $stale) { Remove-Item -LiteralPath $stale -Recurse -Force }
  Rename-Item -LiteralPath $dist -NewName 'dist.stale' -Force
}
New-Item -ItemType Directory -Force -Path $dist | Out-Null

# 1) Interpreter + runtime DLLs (self-contained, no venv dependency).
foreach ($file in @('python.exe','pythonw.exe','python3.dll','python311.dll','vcruntime140.dll','vcruntime140_1.dll','LICENSE.txt')) {
  Copy-Item -LiteralPath (Join-Path $basePython $file) -Destination (Join-Path $dist $file) -Force
}
# 2) C extension DLLs.
robocopy (Join-Path $basePython 'DLLs') (Join-Path $dist 'DLLs') /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -gt 7) { throw 'robocopy DLLs failed' }
# 3) Standard library (exclude site-packages/test trees; they are reinstalled below).
robocopy (Join-Path $basePython 'Lib') (Join-Path $dist 'Lib') /E /NFL /NDL /NJH /NJS /NP /XD site-packages test tests __pycache__ | Out-Null
if ($LASTEXITCODE -gt 7) { throw 'robocopy Lib failed' }

  # 4) Install the pinned requirements + markitdown formats straight into dist.
  $sitePackages = Join-Path $dist 'Lib\site-packages'
  New-Item -ItemType Directory -Force -Path $sitePackages | Out-Null
  $previousPythonUtf8 = $env:PYTHONUTF8
  $env:PYTHONUTF8 = '1'
  try {
    # Windows defaults to the active ANSI code page (often GBK). The pinned lock
    # contains UTF-8 comments, so force UTF-8 while pip parses it.
    & $pythonParts[0] $pythonParts[1..($pythonParts.Count - 1)] -m pip install --disable-pip-version-check --target $sitePackages -r (Join-Path $sourceRoot 'python\requirements.lock') -i $IndexUrl
    if ($LASTEXITCODE -ne 0) { throw 'pip install requirements.lock failed' }
    & $pythonParts[0] $pythonParts[1..($pythonParts.Count - 1)] -m pip install --disable-pip-version-check --target $sitePackages -i $IndexUrl 'markitdown[pdf,docx,pptx,xls,xlsx]'
    if ($LASTEXITCODE -ne 0) { throw 'pip install markitdown failed' }

    # 4b) Install the pinned mnova-mcp from the vendored source tree: build a
    # wheel offline from vendor/mnova-mcp then install --no-deps so all
    # transitive requirements stay managed by requirements.lock above (mcp /
    # pydantic / filelock are already present). The wheel carries the packaged
    # assets/bridge.qs (0.3.1 packaging fix), so the installed module is
    # self-contained and does not require a source checkout at runtime.
    $mnovaVendor = Join-Path $sourceRoot 'vendor\mnova-mcp'
    if (-not (Test-Path -LiteralPath (Join-Path $mnovaVendor 'pyproject.toml'))) {
      throw "Vendored mnova-mcp source missing at $mnovaVendor"
    }
    $mnovaWheelDir = Join-Path $resourceRoot 'python\mnova-wheel'
    if (Test-Path -LiteralPath $mnovaWheelDir) { Remove-Item -LiteralPath $mnovaWheelDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $mnovaWheelDir | Out-Null
    & $pythonParts[0] $pythonParts[1..($pythonParts.Count - 1)] -m pip wheel --disable-pip-version-check --no-deps --wheel-dir $mnovaWheelDir (Join-Path $mnovaVendor '.') -i $IndexUrl
    if ($LASTEXITCODE -ne 0) { throw 'mnova-mcp wheel build failed' }
    $mnovaWheel = Get-ChildItem -LiteralPath $mnovaWheelDir -Filter 'mnova_mcp-0.3.1-*.whl' | Select-Object -First 1
    if (-not $mnovaWheel) { throw 'mnova_mcp-0.3.1 wheel was not produced' }
    & $pythonParts[0] $pythonParts[1..($pythonParts.Count - 1)] -m pip install --disable-pip-version-check --no-deps --target $sitePackages $mnovaWheel.FullName
    if ($LASTEXITCODE -ne 0) { throw 'mnova-mcp wheel install failed' }

    # 5) Strip caches / test artifacts.
    Get-ChildItem -LiteralPath $dist -Recurse -Directory -Filter '__pycache__' -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $dist -Recurse -Filter '*.pyc' -Force -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

    # 6) Verify the bundled interpreter stands alone and markitdown works.
    & (Join-Path $dist 'python.exe') -c "import sys; assert sys.prefix == r'$dist', sys.prefix; import markitdown; print('bundled python OK:', sys.version.split()[0])"
    if ($LASTEXITCODE -ne 0) { throw 'bundled python self-check failed' }

    # 6b) Verify the pinned origin-mcp is importable and at the exact version.
    & (Join-Path $dist 'python.exe') -c "import origin_mcp; assert origin_mcp.__version__ == '0.1.4', origin_mcp.__version__; print('origin-mcp OK:', origin_mcp.__version__)"
    if ($LASTEXITCODE -ne 0) { throw 'bundled origin-mcp self-check failed' }

    # 6c) Verify the pinned mnova-mcp 0.3.1 is importable and its packaged
    # bridge.qs asset resolves to an existing file (0.2.0 §6 acceptance gate).
    $mnovaCheck = & (Join-Path $dist 'python.exe') -c "import mnova_mcp; print(mnova_mcp.__version__)" 2>$null
    if ($LASTEXITCODE -ne 0 -or $mnovaCheck -ne '0.3.1') {
      throw "bundled mnova-mcp version mismatch: '$mnovaCheck' (expected 0.3.1)"
    }
    & (Join-Path $dist 'python.exe') -c "from mnova_mcp.config import Settings; p=Settings.from_environment().bridge_script; print(p); assert p.is_file(), 'bridge.qs missing from installed package'"
    if ($LASTEXITCODE -ne 0) { throw 'bundled mnova bridge.qs self-check failed' }
  } finally {
  if ($null -eq $previousPythonUtf8) { Remove-Item Env:PYTHONUTF8 -ErrorAction SilentlyContinue }
  else { $env:PYTHONUTF8 = $previousPythonUtf8 }
}

if (Test-Path -LiteralPath (Join-Path $resourceRoot 'python\dist.stale')) {
  Remove-Item -LiteralPath (Join-Path $resourceRoot 'python\dist.stale') -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path -LiteralPath (Join-Path $resourceRoot 'python\mnova-wheel')) {
  Remove-Item -LiteralPath (Join-Path $resourceRoot 'python\mnova-wheel') -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host 'Bundled Python prepared (origin-mcp OK: 0.1.4 | mnova-mcp OK: 0.3.1 | mnova bridge.qs OK).'
