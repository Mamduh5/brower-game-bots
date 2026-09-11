param([Parameter(Mandatory=$true)][long]$TargetHandle, [string]$Keys = 'W', [int]$HoldMs = 300, [int]$DelayMs = 0, [int]$MouseDx = 0, [string]$Button = '')
# Visible OS input for supervised validation. Never reads or modifies the game process.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ValidationInput {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int x, int y, uint data, UIntPtr extra);
 [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
}
'@
if ($HoldMs -lt 0 -or $HoldMs -gt 2000 -or $DelayMs -lt 0 -or $DelayMs -gt 10000 -or [Math]::Abs($MouseDx) -gt 100) { throw 'Validation input exceeds bounds' }
if ($Keys -notmatch '^[WASDE]*$' -and $Keys -ne 'F8') { throw 'Only bounded gameplay controls or F8 are permitted' }
if ($Button -notin @('', 'left', 'right')) { throw 'Unknown button' }
Start-Sleep -Milliseconds $DelayMs
if ([ValidationInput]::GetForegroundWindow().ToInt64() -ne $TargetHandle) { throw 'Validation target is not foreground' }
$codes = if ($Keys -eq 'F8') { @(119) } else { @($Keys.ToCharArray() | ForEach-Object { [int]$_ }) }
$marker = [UIntPtr]::new(0x47425453)
try {
 foreach ($code in $codes) { [ValidationInput]::keybd_event([byte]$code, 0, 0, $marker) }
 if ($Button) { [ValidationInput]::mouse_event($(if ($Button -eq 'right') { 8 } else { 2 }), 0, 0, 0, $marker) }
 if ($MouseDx) { [ValidationInput]::mouse_event(1, $MouseDx, 0, 0, $marker) }
 Start-Sleep -Milliseconds $HoldMs
} finally {
 if ($Button) { [ValidationInput]::mouse_event($(if ($Button -eq 'right') { 16 } else { 4 }), 0, 0, 0, $marker) }
 foreach ($code in $codes) { [ValidationInput]::keybd_event([byte]$code, 0, 2, $marker) }
}
@{ keys=$Keys; button=$Button; relativeDx=$MouseDx; holdMs=$HoldMs; released=(@($codes | Where-Object { ([ValidationInput]::GetAsyncKeyState($_) -band 0x8000) -ne 0 }).Count -eq 0) } | ConvertTo-Json -Compress
