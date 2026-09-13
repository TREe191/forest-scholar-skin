param([string]$ResourceRoot,[string]$DataRoot)
$ErrorActionPreference = 'Stop'
. (Join-Path $ResourceRoot 'scripts\Common.ps1')
$null = Initialize-FssStorage -DataRoot $DataRoot
$env:PATH = ''
$runtime = Get-FssNodeRuntime
if (-not (Test-FssPathEqual -Left $runtime.Path -Right (Join-Path $ResourceRoot 'node\node.exe'))) { throw 'Not bundled Node' }
if ($runtime.Major -lt 22) { throw 'Runtime too old' }
if (-not (Test-FssPathEqual -Left $script:FssDataRoot -Right $DataRoot)) { throw 'Incorrect data root' }
Write-Output 'BUNDLED_NODE_NO_PATH_OK'
