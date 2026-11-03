param(
 [Parameter(Mandatory=$true)][long]$WindowHandle,
 [Parameter(Mandatory=$true)][string]$PointsPath,
 [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference='Stop'
# Ask the real window's non-client hit test. No cursor movement or simulated clicks.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class IbmWindowDragProbe {
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr window, ref Point point);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
}
'@
$previousContext=[IbmWindowDragProbe]::SetThreadDpiAwarenessContext([IntPtr](-4))
try {
 $samples=Get-Content -LiteralPath $PointsPath -Raw | ConvertFrom-Json
 $checks=@(foreach($sample in $samples.points){
  $position=New-Object IbmWindowDragProbe+Point
  $position.X=[int][Math]::Round($sample.x*$samples.ratio)
  $position.Y=[int][Math]::Round($sample.y*$samples.ratio)
  if(-not [IbmWindowDragProbe]::ClientToScreen([IntPtr]$WindowHandle,[ref]$position)){throw 'Window coordinate conversion failed'}
  $packed=([long]($position.Y -band 0xffff) -shl 16) -bor ($position.X -band 0xffff)
  $hit=[UIntPtr]::Zero
  $sent=[IbmWindowDragProbe]::SendMessageTimeout([IntPtr]$WindowHandle,0x84,[UIntPtr]::Zero,[IntPtr]$packed,2,2000,[ref]$hit)
  if($sent -eq [IntPtr]::Zero){throw 'Window hit test timed out'}
  $code=[int]$hit.ToUInt64()
  [pscustomobject]@{name=$sample.name;dragExpected=$sample.drag;hitTest=$code;ok=if($sample.drag){$code -eq 2}else{$code -eq 1}}
 })
 $report=[pscustomobject]@{ok=@($checks | Where-Object {-not $_.ok}).Count -eq 0;checks=$checks;scope='Native WM_NCHITTEST: HTCAPTION=2 drags the window; HTCLIENT=1 keeps controls interactive.'}
 $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutputPath -Encoding utf8
 $report | ConvertTo-Json -Depth 5
 if(-not $report.ok){exit 1}
} finally {
 if($previousContext -ne [IntPtr]::Zero){[void][IbmWindowDragProbe]::SetThreadDpiAwarenessContext($previousContext)}
}
