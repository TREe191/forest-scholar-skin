[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $projectRoot 'runtime'
$sessionPath = Join-Path $runtimeDirectory 'session.json'
$statePath = Join-Path $runtimeDirectory 'injection-state.json'
$diagnosticPath = Join-Path $PSScriptRoot 'occlusion-diagnostic.mjs'

. (Join-Path $PSScriptRoot 'Common.ps1')

$session = Read-FssJson -Path $sessionPath
if ($null -eq $session) { throw 'No active Forest Scholar Skin session was found.' }
$node = Get-FssNodeRuntime
if (-not (Test-FssPathEqual -Left $node.Path -Right "$($session.nodePath)")) {
    throw 'The current Node.js path differs from the recorded injector runtime.'
}
$cdpIdentity = Get-FssCdpIdentity -Port ([int]$session.port) -ExpectedExecutable "$($session.expectedExecutable)"
if ($null -eq $cdpIdentity -or $cdpIdentity.BrowserId -ne "$($session.browserId)") {
    throw 'The recorded local CDP browser identity could not be verified.'
}

& $node.Path $diagnosticPath `
    --port ([int]$session.port) `
    --browser-id "$($session.browserId)" `
    --root $projectRoot `
    --state-file $statePath
if ($LASTEXITCODE -ne 0) { throw "Occlusion diagnostic failed with exit code $LASTEXITCODE." }
