[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string[]]$Files,
  [string]$CertificateBase64 = $env:WINDOWS_CERTIFICATE_BASE64,
  [string]$CertificatePassword = $env:WINDOWS_CERTIFICATE_PASSWORD,
  [string]$TimestampUrl = 'http://timestamp.digicert.com',
  [switch]$Required
)

$ErrorActionPreference = 'Stop'
$targets = @($Files | ForEach-Object { Get-Item -LiteralPath $_ -ErrorAction Stop })
if (-not $CertificateBase64) {
  if ($Required) { throw 'Authenticode signing is required for tagged releases, but WINDOWS_CERTIFICATE_BASE64 is not configured.' }
  Write-Warning 'Authenticode certificate is not configured; leaving this non-release build unsigned.'
  return
}

$sdkRoots = @(
  "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
  "$env:ProgramFiles\Windows Kits\10\bin"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$signtool = $sdkRoots | ForEach-Object { Get-ChildItem -LiteralPath $_ -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue } |
  Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { throw 'signtool.exe was not found in the Windows SDK.' }

$pfx = Join-Path ([System.IO.Path]::GetTempPath()) ("ibm-lab-signing-{0}.pfx" -f [Guid]::NewGuid())
try {
  [System.IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($CertificateBase64))
  foreach ($target in $targets) {
    & $signtool.FullName sign /fd SHA256 /td SHA256 /tr $TimestampUrl /f $pfx /p $CertificatePassword $target.FullName
    if ($LASTEXITCODE -ne 0) { throw "signtool failed for $($target.FullName)" }
    & $signtool.FullName verify /pa /all $target.FullName
    if ($LASTEXITCODE -ne 0) { throw "Authenticode verification failed for $($target.FullName)" }
  }
} finally {
  if (Test-Path -LiteralPath $pfx) { Remove-Item -LiteralPath $pfx -Force }
}
