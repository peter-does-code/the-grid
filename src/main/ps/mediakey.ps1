# The Grid: presses one Windows media key (play/pause, stop, previous, next), exactly like a
# multimedia keyboard does. Spotify reacts to these even without Premium.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less scripts in the ANSI code page.
param([Parameter(Mandatory = $true)][ValidateSet(176, 177, 178, 179)][int]$Vk)
$ErrorActionPreference = 'Stop'
$sig = '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);'
$keys = Add-Type -MemberDefinition $sig -Name GridKeys -Namespace TheGrid -PassThru
$KEYEVENTF_EXTENDEDKEY = 1
$KEYEVENTF_KEYUP = 2
$keys::keybd_event([byte]$Vk, 0, $KEYEVENTF_EXTENDEDKEY, [UIntPtr]::Zero)
$keys::keybd_event([byte]$Vk, 0, ($KEYEVENTF_EXTENDEDKEY -bor $KEYEVENTF_KEYUP), [UIntPtr]::Zero)
