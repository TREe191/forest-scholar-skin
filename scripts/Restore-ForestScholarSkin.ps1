[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $projectRoot 'runtime'
$sessionPath = Join-Path $runtimeDirectory 'session.json'

. (Join-Path $PSScriptRoot 'Common.ps1')

$session = Read-FssJson -Path $sessionPath
if ($null -eq $session) {
    Write-Host 'No recorded Forest Scholar Skin session was found. Nothing was closed or relaunched.'
    exit 0
}

$registration = Get-FssCodexRegistration
if ($registration.PackageFamilyName -ne "$($session.packageFamilyName)") {
    throw 'The registered Codex package family differs from the recorded themed session.'
}

try {
    & (Join-Path $PSScriptRoot 'Disable-ForestScholarSkin.ps1') -Quiet
}
catch {
    Write-Warning 'Live renderer cleanup could not be verified. Restore will continue by closing only Codex processes whose registered executable path matches.'
}

$verifiedProcesses = @()
foreach ($process in @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue)) {
    $identity = Get-FssProcessIdentity -ProcessId $process.Id
    if ($null -ne $identity -and $identity.Path -and
        (Test-FssPathEqual -Left $identity.Path -Right $registration.ExpectedExecutable)) {
        $verifiedProcesses += $identity
    }
}

foreach ($identity in $verifiedProcesses) {
    Stop-Process -Id $identity.ProcessId -ErrorAction SilentlyContinue
}

$deadline = [DateTime]::UtcNow.AddSeconds(10)
$remaining = @()
while ([DateTime]::UtcNow -lt $deadline) {
    $remaining = @()
    foreach ($process in @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue)) {
        $identity = Get-FssProcessIdentity -ProcessId $process.Id
        if ($null -ne $identity -and $identity.Path -and
            (Test-FssPathEqual -Left $identity.Path -Right $registration.ExpectedExecutable)) {
            $remaining += $identity
        }
    }
    if ($remaining.Count -eq 0) { break }
    Start-Sleep -Milliseconds 150
}

if ($remaining.Count -gt 0) {
    throw 'Verified Codex processes did not close within 10 seconds. The theme DOM was removed, but the CDP session may remain until Codex is closed manually.'
}

Remove-Item -LiteralPath `
    $sessionPath, `
    (Join-Path $runtimeDirectory 'injection-state.json'), `
    (Join-Path $runtimeDirectory 'ready.json'), `
    (Join-Path $runtimeDirectory 'stop.request') `
    -Force -ErrorAction SilentlyContinue

$null = Start-FssCodex -Registration $registration
Write-Host 'Forest Scholar Skin was removed and stock Codex was relaunched without a debugging port.'
