[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Light', 'Dark', 'Auto')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $projectRoot 'runtime'
$sessionPath = Join-Path $runtimeDirectory 'session.json'
$injectionStatePath = Join-Path $runtimeDirectory 'injection-state.json'
$readyPath = Join-Path $runtimeDirectory 'ready.json'
$stopPath = Join-Path $runtimeDirectory 'stop.request'
$injectorPath = Join-Path $PSScriptRoot 'injector.mjs'
$stdoutPath = Join-Path $runtimeDirectory 'injector.log'
$stderrPath = Join-Path $runtimeDirectory 'injector-error.log'

. (Join-Path $PSScriptRoot 'Common.ps1')

if (-not (Test-Path -LiteralPath $runtimeDirectory -PathType Container)) {
    $null = New-Item -ItemType Directory -Path $runtimeDirectory -Force
}

$node = Get-FssNodeRuntime
$registration = Get-FssCodexRegistration

$runningCodex = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue)
if ($runningCodex.Count -gt 0) {
    throw 'Codex is already running. Close every Codex window, wait a few seconds, then run this launcher again. This script will not close the current app automatically.'
}

$existingSession = Read-FssJson -Path $sessionPath
if ($null -ne $existingSession) {
    $existingInjector = Get-FssProcessIdentity -ProcessId ([int]$existingSession.injectorPid)
    if ($null -ne $existingInjector) {
        throw 'A recorded Forest Scholar injector is still running. Use Restore-ForestScholarSkin.cmd first.'
    }
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
    Move-Item -LiteralPath $sessionPath -Destination (Join-Path $runtimeDirectory "session.stale-$stamp.json")
}

Remove-Item -LiteralPath $readyPath, $stopPath, $injectionStatePath -Force -ErrorAction SilentlyContinue
$port = Select-FssRandomPort
$appProcessId = 0
$appIdentity = $null
$injectorProcess = $null
$sessionWritten = $false

try {
    $appProcessId = Start-FssCodex -Registration $registration -Arguments @(
        '--remote-debugging-address=127.0.0.1',
        "--remote-debugging-port=$port"
    )

    $identityDeadline = [DateTime]::UtcNow.AddSeconds(5)
    while ($null -eq $appIdentity -and [DateTime]::UtcNow -lt $identityDeadline) {
        $candidate = Get-FssProcessIdentity -ProcessId $appProcessId
        if ($null -ne $candidate -and $candidate.Path -and
            (Test-FssPathEqual -Left $candidate.Path -Right $registration.ExpectedExecutable)) {
            $appIdentity = $candidate
            break
        }
        Start-Sleep -Milliseconds 100
    }
    if ($null -eq $appIdentity) {
        throw 'The activated Codex process identity could not be verified.'
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    $cdpIdentity = $null
    while ($null -eq $cdpIdentity -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 350
        $cdpIdentity = Get-FssCdpIdentity -Port $port -ExpectedExecutable $registration.ExpectedExecutable
    }
    if ($null -eq $cdpIdentity) {
        throw "Codex did not expose a verified 127.0.0.1 CDP endpoint on high port $port within 45 seconds."
    }

    $nodeArguments = @(
        $injectorPath,
        '--watch',
        '--port', "$port",
        '--browser-id', $cdpIdentity.BrowserId,
        '--root', $projectRoot,
        '--mode', $Mode,
        '--state-file', $injectionStatePath
    )
    $argumentLine = ($nodeArguments | ForEach-Object { ConvertTo-FssNativeArgument -Value "$_" }) -join ' '
    $injectorProcess = Start-Process `
        -FilePath $node.Path `
        -ArgumentList $argumentLine `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru

    $injectorVerification = Wait-FssProcessIdentity `
        -Process $injectorProcess `
        -ExpectedPath $node.Path `
        -TimeoutMilliseconds 5000 `
        -PollMilliseconds 100
    if (-not $injectorVerification.Verified) {
        if ($injectorVerification.Exited) {
            $exitDetail = if ($null -ne $injectorVerification.ExitCode) { " Exit code: $($injectorVerification.ExitCode)." } else { '' }
            throw "The Forest Scholar injector exited before its identity could be verified.$exitDetail See $stderrPath"
        }
        if ($injectorVerification.HardMismatch) {
            throw 'The Forest Scholar injector executable path did not match the selected Node.js runtime.'
        }
        throw "The Forest Scholar injector process identity did not become queryable within 5 seconds. Last state: $($injectorVerification.FailureReason)."
    }
    $injectorIdentity = $injectorVerification.Identity

    $session = [ordered]@{
        schemaVersion = $script:FssSchemaVersion
        mode = $Mode
        port = $port
        browserId = $cdpIdentity.BrowserId
        browser = $cdpIdentity.Browser
        appProcessId = $appIdentity.ProcessId
        appStartedAt = $appIdentity.StartedAt
        expectedExecutable = $registration.ExpectedExecutable
        packageFullName = $registration.PackageFullName
        packageFamilyName = $registration.PackageFamilyName
        appUserModelId = $registration.AppUserModelId
        injectorPid = $injectorIdentity.ProcessId
        injectorStartedAt = $injectorIdentity.StartedAt
        injectorIdentityAttempts = $injectorVerification.Attempts
        nodePath = $node.Path
        nodeVersion = $node.Version
        startedAt = [DateTime]::UtcNow.ToString('o')
    }
    Write-FssJsonAtomic -Path $sessionPath -Value $session
    $sessionWritten = $true

    $readyDeadline = [DateTime]::UtcNow.AddSeconds(35)
    while (-not (Test-Path -LiteralPath $readyPath -PathType Leaf) -and [DateTime]::UtcNow -lt $readyDeadline) {
        if ($injectorProcess.HasExited) {
            throw "The injector exited before applying the MVP. See $stderrPath"
        }
        Start-Sleep -Milliseconds 150
    }
    if (-not (Test-Path -LiteralPath $readyPath -PathType Leaf)) {
        throw "The injector did not confirm a Codex renderer within 35 seconds. See $stderrPath"
    }

    $ready = Read-FssJson -Path $readyPath
    if ([int]$ready.port -ne $port -or "$($ready.browserId)" -ne $cdpIdentity.BrowserId -or
        "$($ready.mode)" -ne $Mode -or [int]$ready.injectorPid -ne $injectorProcess.Id) {
        throw 'The injector readiness identity did not match the launched session.'
    }

    Write-Host "Forest Scholar Skin MVP started in $Mode mode."
    Write-Host "CDP is bound to 127.0.0.1 on randomized high port $port."
}
catch {
    $failure = $_
    if ($null -ne $injectorProcess) {
        try {
            $injectorIdentity = Get-FssProcessIdentity -ProcessId $injectorProcess.Id
            if ($null -ne $injectorIdentity -and $injectorIdentity.Path -and $injectorIdentity.StartedAt -and
                (Test-FssPathEqual -Left $injectorIdentity.Path -Right $node.Path)) {
                $null = Stop-FssOwnedProcess -ProcessId $injectorIdentity.ProcessId -ExpectedPath $node.Path -ExpectedStartedAt $injectorIdentity.StartedAt
            }
        } catch {}
    }
    if ($null -ne $appIdentity) {
        try {
            $null = Stop-FssOwnedProcess -ProcessId $appIdentity.ProcessId -ExpectedPath $registration.ExpectedExecutable -ExpectedStartedAt $appIdentity.StartedAt -WaitSeconds 8
            $null = Start-FssCodex -Registration $registration
        } catch {
            Write-Warning 'Startup rollback could not completely reopen stock Codex.'
        }
    }
    if ($sessionWritten) {
        Remove-Item -LiteralPath $sessionPath -Force -ErrorAction SilentlyContinue
    }
    throw $failure
}
