[CmdletBinding()]
param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $projectRoot 'runtime'
$sessionPath = Join-Path $runtimeDirectory 'session.json'
$injectionStatePath = Join-Path $runtimeDirectory 'injection-state.json'
$readyPath = Join-Path $runtimeDirectory 'ready.json'
$stopPath = Join-Path $runtimeDirectory 'stop.request'
$injectorPath = Join-Path $PSScriptRoot 'injector.mjs'

. (Join-Path $PSScriptRoot 'Common.ps1')

$session = Read-FssJson -Path $sessionPath
if ($null -eq $session) {
    if (-not $Quiet) { Write-Host 'No recorded Forest Scholar Skin session is active.' }
    exit 0
}

$injectorIdentity = Get-FssProcessIdentity -ProcessId ([int]$session.injectorPid)
if ($null -ne $injectorIdentity) {
    if (-not $injectorIdentity.Path -or -not $injectorIdentity.StartedAt -or
        -not (Test-FssPathEqual -Left $injectorIdentity.Path -Right "$($session.nodePath)") -or
        "$($injectorIdentity.StartedAt)" -ne "$($session.injectorStartedAt)") {
        throw 'Refused to stop the recorded injector because its process identity no longer matches.'
    }

    Set-Content -LiteralPath $stopPath -Value 'stop' -Encoding ASCII
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while ((Get-Process -Id $injectorIdentity.ProcessId -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 100
    }
    if (Get-Process -Id $injectorIdentity.ProcessId -ErrorAction SilentlyContinue) {
        $null = Stop-FssOwnedProcess `
            -ProcessId $injectorIdentity.ProcessId `
            -ExpectedPath "$($session.nodePath)" `
            -ExpectedStartedAt "$($session.injectorStartedAt)"
    }
}

$cdpIdentity = Get-FssCdpIdentity -Port ([int]$session.port) -ExpectedExecutable "$($session.expectedExecutable)"
if ($null -ne $cdpIdentity) {
    if ($cdpIdentity.BrowserId -ne "$($session.browserId)") {
        throw 'Refused to clean the renderer because the CDP browser identity changed.'
    }
    $node = Get-FssNodeRuntime
    if (-not (Test-FssPathEqual -Left $node.Path -Right "$($session.nodePath)")) {
        throw 'The current Node.js path differs from the recorded injector runtime.'
    }
    & $node.Path $injectorPath `
        --remove `
        --port ([int]$session.port) `
        --browser-id "$($session.browserId)" `
        --root $projectRoot `
        --mode "$($session.mode)" `
        --state-file $injectionStatePath
    if ($LASTEXITCODE -ne 0) {
        throw "Renderer cleanup failed with exit code $LASTEXITCODE."
    }
}
else {
    $verifiedCodexStillRunning = $false
    foreach ($process in @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue)) {
        $identity = Get-FssProcessIdentity -ProcessId $process.Id
        if ($null -ne $identity -and $identity.Path -and
            (Test-FssPathEqual -Left $identity.Path -Right "$($session.expectedExecutable)")) {
            $verifiedCodexStillRunning = $true
            break
        }
    }
    if ($verifiedCodexStillRunning) {
        throw 'Codex is still running, but the recorded CDP identity could not be verified. Session metadata was retained; use Restore or retry Disable.'
    }
}

Remove-Item -LiteralPath $sessionPath, $injectionStatePath, $readyPath, $stopPath -Force -ErrorAction SilentlyContinue
if (-not $Quiet) {
    Write-Host 'Forest Scholar Skin is disabled. Codex is still running with its local CDP session until it is closed or Restore is used.'
}
