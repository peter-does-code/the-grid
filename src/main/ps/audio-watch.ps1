# The Grid: prints Windows' default playback device as "id|name" whenever it changes.
# Checked once a second via Core Audio (audio-devices.cs, compiled once at start). Read-only.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less scripts in the ANSI code page.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$source = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'audio-devices.cs')
Add-Type -TypeDefinition $source
$last = ''
while ($true) {
  try { $d = [VisampAudio.Audio]::DefaultRender() } catch { $d = '|' }
  if ($d -ne $last) { [Console]::Out.WriteLine($d); [Console]::Out.Flush(); $last = $d }
  Start-Sleep -Milliseconds 1000
}
