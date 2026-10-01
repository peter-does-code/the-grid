# The Grid selftest: plays a WAV file through Windows' default playback device and waits until done.
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
(New-Object System.Media.SoundPlayer $Path).PlaySync()
