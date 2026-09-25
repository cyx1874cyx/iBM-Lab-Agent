[CmdletBinding()]
param(
  [string]$SourceRoot,
  [string]$Python = 'py -3.12',
  [string]$IndexUrl = 'https://pypi.tuna.tsinghua.edu.cn/simple/',
  # Needed to run scripts/patch-markitdown.mjs (magika-optional patch). New code and
  # comments in this file are intentionally ASCII-only: PowerShell 5.1 reads a
  # BOM-less UTF-8 script as ANSI, and non-ASCII bytes can break string terminators.
  [string]$NodeExe
)

# Build the self-contained bundled Python (resources/python/dist) for the
# iBM Lab Agent desktop package.
#
# dist/ is a full Python install tree (python.exe + python312.dll + DLLs +
# Lib + site-packages in one directory) so the packaged app works offline
# without any system Python. A copied *venv* is NOT portable on Windows
# (pyvenv.cfg pins the base interpreter), which is why we use the dist layout.
#
# Usage (from the desktop/ directory):
#   powershell -ExecutionPolicy Bypass -File scripts/build-bundled-python.ps1 -SourceRoot ..
#
# Requires: a Windows Python 3.12 installed and reachable via `py -3.12`.
# 0.5.4: raised from 3.11 to 3.12 to match the Linux line
# (runtime/versions.env PYTHON_VERSION=3.12.11) and because pptx-cli requires
# Python >= 3.12.

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $SourceRoot) { $SourceRoot = Join-Path $projectRoot '..' }
$sourceRoot = (Resolve-Path $SourceRoot).Path
$resourceRoot = Join-Path $projectRoot 'src-tauri\resources'
$dist = Join-Path $resourceRoot 'python\dist'

# Locate the base Python 3.12 install (used as the source for the stdlib).
$pythonParts = $Python.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)
$basePython = & $pythonParts[0] $pythonParts[1..($pythonParts.Count - 1)] -c "import sys; print(sys.prefix)" 2>$null
if (-not $basePython -or -not (Test-Path -LiteralPath (Join-Path $basePython 'python.exe'))) {
  throw "Python 3.12 not found via '$Python'. Install Python 3.12 first."
}
Write-Host "Base Python: $basePython"

# Node is needed for the markitdown magika-optional patch (step 4c). Resolve it early
# so a missing Node fails here rather than halfway through the pip installs.
if (-not $NodeExe) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) { $NodeExe = $nodeCommand.Source }
}
if (-not $NodeExe -or -not (Test-Path -LiteralPath $NodeExe)) {
  throw 'Node.js is required to patch markitdown. Pass -NodeExe with an approved Node 24 executable.'
}
Write-Host "Node: $NodeExe"

if (Test-Path -LiteralPath $dist) {
  $stale = Join-Path $resourceRoot 'python\dist.stale'
  if (Test-Path -LiteralPath $stale) { Remove-Item -LiteralPath $stale -Recurse -Force }
  Rename-Item -LiteralPath $dist -NewName 'dist.stale' -Force
}
New-Item -ItemType Directory -Force -Path $dist | Out-Null

# 1) Interpreter + runtime DLLs (self-contained, no venv dependency).
foreach ($file in @('python.exe','pythonw.exe','python3.dll','python312.dll','vcruntime140.dll','vcruntime140_1.dll','LICENSE.txt')) {
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

    # markitdown 0.1.7 lists magika as an UNCONDITIONAL dependency, and magika requires
    # onnxruntime (Windows 33 MB). That whole chain is only used to guess a file type
    # from content; this plugin decides by extension instead (lib/convert.js
    # CONVERTIBLE_UPLOAD_EXTENSIONS). So:
    #   (1) pin exactly the format dependencies it actually needs (docx pulls
    #      mammoth -> cobble; pptx pulls python-pptx -> Pillow/lxml/XlsxWriter).
    #      python-pptx declares `XlsxWriter >=0.5.7`; the Linux line gets the same
    #      3.2.9 transitively. Pinning it here keeps the installed set deterministic
    #      instead of leaving it to whatever a resolver happens to pick.
    #   (2) install markitdown itself with --no-deps, so magika/onnxruntime are never
    #      present in the first place,
    #   (3) apply src/markitdown-patch.js's "magika optional" patch (anchor + sha256 +
    #      reversible) - the same mechanism the Linux line uses.
    # Measured on this machine: magika 4 + onnxruntime 33 + flatbuffers 1 +
    # coloredlogs 1 + humanfriendly 1 + protobuf ~= 40 MB.
    $markitdownDependencies = @(
      'beautifulsoup4==4.15.0', 'soupsieve==2.9.2', 'defusedxml==0.7.1',
      'markdownify==1.2.3', 'mammoth==1.11.0', 'cobble==0.1.4',
      'python-pptx==1.0.2', 'XlsxWriter==3.2.9'
    )
    & $pythonParts[0] $pythonParts[1..($pythonParts.Count - 1)] -m pip install --disable-pip-version-check --target $sitePackages -i $IndexUrl @markitdownDependencies
    if ($LASTEXITCODE -ne 0) { throw 'pip install markitdown dependencies failed' }
    & $pythonParts[0] $pythonParts[1..($pythonParts.Count - 1)] -m pip install --disable-pip-version-check --no-deps --target $sitePackages -i $IndexUrl 'markitdown==0.1.7'
    if ($LASTEXITCODE -ne 0) { throw 'pip install markitdown failed' }
    $markitdownSource = Join-Path $sitePackages 'markitdown\_markitdown.py'
    if (-not (Test-Path -LiteralPath $markitdownSource)) { throw "markitdown source not found: $markitdownSource" }
    & $NodeExe (Join-Path $sourceRoot 'scripts\patch-markitdown.mjs') patch --target $markitdownSource
    if ($LASTEXITCODE -ne 0) { throw 'markitdown magika-optional patch failed' }

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
    & $pythonParts[0] $pythonParts[1..($pythonParts.Count - 1)] -m pip wheel --disable-pip-version-check --no-cache-dir --no-deps --wheel-dir $mnovaWheelDir (Join-Path $mnovaVendor '.') -i $IndexUrl
    if ($LASTEXITCODE -ne 0) { throw 'mnova-mcp wheel build failed' }
    $mnovaWheel = Get-ChildItem -LiteralPath $mnovaWheelDir -Filter 'mnova_mcp-0.3.1-*.whl' | Select-Object -First 1
    if (-not $mnovaWheel) { throw 'mnova_mcp-0.3.1 wheel was not produced' }
    & $pythonParts[0] $pythonParts[1..($pythonParts.Count - 1)] -m pip install --disable-pip-version-check --no-deps --target $sitePackages $mnovaWheel.FullName
    if ($LASTEXITCODE -ne 0) { throw 'mnova-mcp wheel install failed' }

    # 5) Strip caches / test artifacts.
    Get-ChildItem -LiteralPath $dist -Recurse -Directory -Filter '__pycache__' -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $dist -Recurse -Filter '*.pyc' -Force -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

    # 5b) Strip third-party test trees shipped inside wheels. Runtime never loads them.
    # Measured on the previous Windows build: 129 tests directories, ~40 MB
    # (pandas 15, scipy 17, numpy 4, matplotlib 3, ...). Only directories named
    # exactly `tests` / `test` are removed: numpy/testing and pandas.testing are
    # public API and must survive. Same policy as install.sh's
    # strip_python_test_trees() on the Linux line.
    $beforeTests = [math]::Round(((Get-ChildItem -LiteralPath $sitePackages -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum/1MB),1)
    Get-ChildItem -LiteralPath $sitePackages -Recurse -Directory -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq 'tests' -or $_.Name -eq 'test' } |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $sitePackages -Recurse -File -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like 'test_*.py' -or $_.Name -eq 'conftest.py' } |
      Remove-Item -Force -ErrorAction SilentlyContinue
    $afterTests = [math]::Round(((Get-ChildItem -LiteralPath $sitePackages -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum/1MB),1)
    Write-Host ("Stripped third-party test trees: {0} MB -> {1} MB" -f $beforeTests, $afterTests)
    if (-not (Test-Path -LiteralPath (Join-Path $sitePackages 'numpy\testing'))) {
      Write-Host 'WARNING: numpy/testing is gone - it is public API and must be preserved.'
    }

    # 6) Verify the bundled interpreter stands alone and markitdown works.
    & (Join-Path $dist 'python.exe') -c "import sys; assert sys.prefix == r'$dist', sys.prefix; import markitdown; print('bundled python OK:', sys.version.split()[0])"
    if ($LASTEXITCODE -ne 0) { throw 'bundled python self-check failed' }

    # 6a) The magika/onnxruntime chain must be ABSENT. It is deliberately stripped
    # (see step 4); if it comes back, the install recipe regressed - e.g. someone
    # dropped `--no-deps`, or reverted to `markitdown[pdf,docx,...]`.
    & (Join-Path $dist 'python.exe') -c "import importlib.util as u; back=[m for m in ('magika','onnxruntime') if u.find_spec(m)]; assert not back, 'magika chain is back: %s' % back; print('magika chain absent: OK')"
    if ($LASTEXITCODE -ne 0) { throw 'bundled python still ships the magika/onnxruntime chain' }

    # 6b) Real conversion end-to-end, not just `import markitdown`: build one sample
    # per supported format and require non-empty Markdown from each. This is what
    # catches a silently broken extras/dependency set (e.g. a missing mammoth/cobble
    # would only show up as a runtime MissingDependencyException).
    $markitdownSelfCheck = @'
import os, sys, tempfile, zipfile
from markitdown import MarkItDown

tmp = tempfile.mkdtemp(prefix='ibm-lab-md-')
samples = []

# html
p = os.path.join(tmp, 'sample.html')
with open(p, 'w', encoding='utf-8') as fh:
    fh.write('<html><body><h1>Polymer Notes</h1><p>Ring-opening polymerization.</p></body></html>')
samples.append(p)

# xlsx (openpyxl + pandas path)
from openpyxl import Workbook
wb = Workbook(); ws = wb.active
ws['A1'] = 'Compound'; ws['B1'] = 'Mn'; ws['A2'] = 'PEG-b-PLGA'; ws['B2'] = 12.4
p = os.path.join(tmp, 'sample.xlsx'); wb.save(p); samples.append(p)

# pptx (python-pptx path)
from pptx import Presentation
from pptx.util import Inches
prs = Presentation(); slide = prs.slides.add_slide(prs.slide_layouts[5])
slide.shapes.title.text = 'Prodrug Polymer Delivery'
box = slide.shapes.add_textbox(Inches(1), Inches(2), Inches(6), Inches(2))
box.text_frame.text = 'RAFT polymerization of methacrylate monomers.'
p = os.path.join(tmp, 'sample.pptx'); prs.save(p); samples.append(p)

# pdf (pdfminer.six + pdfplumber path)
import pymupdf
doc = pymupdf.open(); page = doc.new_page(); page.insert_text((72, 72), 'Prodrug polymer review')
p = os.path.join(tmp, 'sample.pdf'); doc.save(p); doc.close(); samples.append(p)

# docx: minimal OOXML zip (mammoth + cobble path)
p = os.path.join(tmp, 'sample.docx')
with zipfile.ZipFile(p, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    z.writestr('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    z.writestr('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Prodrug Polymer Test</w:t></w:r></w:p></w:body></w:document>')
samples.append(p)

md = MarkItDown()
failed = []
for path in samples:
    ext = os.path.splitext(path)[1]
    try:
        text = (md.convert(path).text_content or '').strip()
    except Exception as exc:
        failed.append('%s -> %s: %s' % (ext, type(exc).__name__, exc)); continue
    print('  %-6s %s (%d chars)' % (ext, 'OK' if text else 'EMPTY', len(text)))
    if not text:
        failed.append('%s -> empty output' % ext)

if failed:
    sys.stderr.write('markitdown conversion self-check failed:\n' + '\n'.join(failed) + '\n')
    sys.exit(1)
print('markitdown conversion self-check OK: %d formats' % len(samples))
'@
    $selfCheckPath = Join-Path $env:TEMP 'ibm-lab-markitdown-selfcheck.py'
    [System.IO.File]::WriteAllText($selfCheckPath, $markitdownSelfCheck, (New-Object System.Text.UTF8Encoding($false)))
    & (Join-Path $dist 'python.exe') $selfCheckPath
    if ($LASTEXITCODE -ne 0) { throw 'bundled markitdown conversion self-check failed' }
    Remove-Item -LiteralPath $selfCheckPath -Force -ErrorAction SilentlyContinue

    # 6c) Verify the pinned origin-mcp is importable and at the exact version.
    & (Join-Path $dist 'python.exe') -c "import origin_mcp; assert origin_mcp.__version__ == '0.1.4', origin_mcp.__version__; print('origin-mcp OK:', origin_mcp.__version__)"
    if ($LASTEXITCODE -ne 0) { throw 'bundled origin-mcp self-check failed' }

    # 6d) Verify the pinned mnova-mcp 0.3.1 is importable and its packaged
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

# 7) Write the input fingerprint (roadmap 0.1, P0). build-windows-release.ps1 compares it
#    to decide whether an existing dist may be reused. Without it that decision was just
#    "does python.exe exist" - i.e. generate once, then skip forever, silently shipping a
#    stale tree after any recipe/requirements.lock change.
#    Not written into dist/: tauri.conf.json bundles resources/python/ wholesale, so build
#    metadata there would ship inside the installer. desktop/.build is gitignored.
$stampDir = Join-Path $projectRoot '.build'
New-Item -ItemType Directory -Force -Path $stampDir | Out-Null
& $NodeExe (Join-Path $sourceRoot 'scripts\bundled-python-inputs.mjs') --write $stampDir --python-exe (Join-Path $dist 'python.exe')
if ($LASTEXITCODE -ne 0) { throw 'bundled-python input fingerprint could not be written' }
$stamp = Get-Content -LiteralPath (Join-Path $stampDir 'bundled-python.stamp.json') -Raw | ConvertFrom-Json
Write-Host ("Input fingerprint: {0} (python {1})" -f $stamp.fingerprint, $stamp.pythonVersion)

Write-Host 'Bundled Python prepared (origin-mcp OK: 0.1.4 | mnova-mcp OK: 0.3.1 | mnova bridge.qs OK).'
