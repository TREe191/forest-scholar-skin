[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Light', 'Dark', 'Auto')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$requestedMode = $Mode
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $projectRoot 'runtime'
$sessionPath = Join-Path $runtimeDirectory 'session.json'
$injectionStatePath = Join-Path $runtimeDirectory 'injection-state.json'
$readyPath = Join-Path $runtimeDirectory 'ready.json'
$stopPath = Join-Path $runtimeDirectory 'stop.request'
$injectorPath = Join-Path $PSScriptRoot 'injector.mjs'
$stdoutPath = Join-Path $runtimeDirectory 'injector.log'
$stderrPath = Join-Path $runtimeDirectory 'injector-error.log'
$historyRoot = Join-Path $runtimeDirectory 'history'

. (Join-Path $PSScriptRoot 'Common.ps1')

$appConfigPath = Join-Path $projectRoot 'config\app.json'
$themesRoot = Join-Path $projectRoot 'themes'
if (-not (Test-Path -LiteralPath $appConfigPath -PathType Leaf)) {
    throw "The application configuration is missing: $appConfigPath"
}
try {
    $appConfig = Get-Content -LiteralPath $appConfigPath -Raw | ConvertFrom-Json
}
catch {
    throw "The application configuration is not valid JSON: $($_.Exception.Message)"
}
$requiredAppProperties = @('schemaVersion', 'activeTheme', 'appearance')
$actualAppProperties = @($appConfig.PSObject.Properties.Name)
$unsupportedAppProperties = @($actualAppProperties | Where-Object { $_ -notin $requiredAppProperties })
$missingAppProperties = @($requiredAppProperties | Where-Object { $_ -notin $actualAppProperties })
if ($unsupportedAppProperties.Count -gt 0 -or $missingAppProperties.Count -gt 0) {
    throw 'The application configuration does not match schemaVersion 1.'
}
if ([int]$appConfig.schemaVersion -ne 1) {
    throw "Unsupported application configuration schemaVersion: $($appConfig.schemaVersion)"
}
$activeTheme = "$($appConfig.activeTheme)"
if ($activeTheme -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$' -or $activeTheme.Length -gt 80) {
    throw 'activeTheme is not a valid machine-readable theme identifier.'
}
$configuredAppearance = "$($appConfig.appearance)"
if ($configuredAppearance -notin @('auto', 'light', 'dark')) {
    throw 'appearance must be auto, light, or dark.'
}
if ($requestedMode -eq 'Auto') {
    $Mode = switch ($configuredAppearance) {
        'light' { 'Light' }
        'dark' { 'Dark' }
        default { 'Auto' }
    }
}
$resolvedThemesRoot = (Resolve-Path -LiteralPath $themesRoot).Path
$declaredThemePackage = Join-Path $resolvedThemesRoot $activeTheme
if (-not (Test-Path -LiteralPath $declaredThemePackage -PathType Container)) {
    throw "The active theme package does not exist: $activeTheme"
}
$themePackagePath = (Resolve-Path -LiteralPath $declaredThemePackage).Path
if (-not (Test-FssPathEqual -Left (Split-Path -Parent $themePackagePath) -Right $resolvedThemesRoot)) {
    throw 'The active theme package is not a direct child of the themes directory.'
}

if (-not (Test-Path -LiteralPath $runtimeDirectory -PathType Container)) {
    $null = New-Item -ItemType Directory -Path $runtimeDirectory -Force
}

if (-not (Test-Path -LiteralPath $historyRoot -PathType Container)) {
    $null = New-Item -ItemType Directory -Path $historyRoot -Force
}

$launchStartedAt = [DateTime]::UtcNow.ToString('o')
$historyBaseName = [DateTime]::Now.ToString('yyyy-MM-dd_HHmmss_fff')
$historyName = $historyBaseName
$historySequence = 0
$historyDirectory = Join-Path $historyRoot $historyName
while (Test-Path -LiteralPath $historyDirectory) {
    $historySequence += 1
    $historyName = '{0}_{1:D2}' -f $historyBaseName, $historySequence
    $historyDirectory = Join-Path $historyRoot $historyName
}
$null = New-Item -ItemType Directory -Path $historyDirectory

$historyLauncherLogPath = Join-Path $historyDirectory 'launcher.log'
$historyStdoutPath = Join-Path $historyDirectory 'injector.log'
$historyStderrPath = Join-Path $historyDirectory 'injector-error.log'
$historySessionPath = Join-Path $historyDirectory 'session.json'
$historyReadyPath = Join-Path $historyDirectory 'ready.json'
$historyInjectionStatePath = Join-Path $historyDirectory 'injection-state.json'
$script:FssHistoryDiagnosticLineCount = 0
$script:FssHistoryStages = @{}
$script:FssHistoryRuntimeReset = $false
$script:FssHistoryInjectorStarted = $false
$script:FssHistorySession = [ordered]@{
    historySchemaVersion = 1
    launchId = $historyName
    mode = $Mode
    requestedMode = $requestedMode
    configuredAppearance = $configuredAppearance
    activeTheme = $activeTheme
    status = 'starting'
    launcherPid = $PID
    launcherStartedAt = $launchStartedAt
    failureStage = $null
}

function Write-FssHistoryEvent {
    param(
        [Parameter(Mandatory = $true)][string]$Event,
        [string]$At,
        [System.Collections.IDictionary]$Details
    )

    $entry = [ordered]@{
        at = if ($At) { $At } else { [DateTime]::UtcNow.ToString('o') }
        event = $Event
    }
    if ($null -ne $Details -and $Details.Count -gt 0) {
        $entry.details = $Details
    }
    $line = $entry | ConvertTo-Json -Depth 8 -Compress
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::AppendAllText($historyLauncherLogPath, $line + [Environment]::NewLine, $encoding)
}

function Set-FssHistorySessionFields {
    param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$Fields)

    foreach ($key in $Fields.Keys) {
        $script:FssHistorySession[$key] = $Fields[$key]
    }
    Write-FssJsonAtomic -Path $historySessionPath -Value $script:FssHistorySession
}

function Add-FssHistoryStageOnce {
    param(
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][string]$Event,
        [string]$At,
        [System.Collections.IDictionary]$Details
    )

    if ($script:FssHistoryStages.ContainsKey($Key)) { return }
    $script:FssHistoryStages[$Key] = $true
    Write-FssHistoryEvent -Event $Event -At $At -Details $Details
}

function Copy-FssHistorySnapshot {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    if (Test-Path -LiteralPath $Source -PathType Leaf) {
        $sourceStream = $null
        $destinationStream = $null
        try {
            $sourceStream = [System.IO.File]::Open(
                $Source,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::Read,
                [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
            )
            $destinationStream = [System.IO.File]::Open(
                $Destination,
                [System.IO.FileMode]::Create,
                [System.IO.FileAccess]::Write,
                [System.IO.FileShare]::Read
            )
            $sourceStream.CopyTo($destinationStream)
        }
        finally {
            if ($null -ne $destinationStream) { $destinationStream.Dispose() }
            if ($null -ne $sourceStream) { $sourceStream.Dispose() }
        }
    }
    elseif (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
        [System.IO.File]::WriteAllText($Destination, '', (New-Object System.Text.UTF8Encoding($false)))
    }
}

function Sync-FssHistoryArtifacts {
    Write-FssJsonAtomic -Path $historySessionPath -Value $script:FssHistorySession
    if ($script:FssHistoryInjectorStarted) {
        Copy-FssHistorySnapshot -Source $stdoutPath -Destination $historyStdoutPath
        Copy-FssHistorySnapshot -Source $stderrPath -Destination $historyStderrPath
    }
    else {
        if (-not (Test-Path -LiteralPath $historyStdoutPath -PathType Leaf)) {
            [System.IO.File]::WriteAllText($historyStdoutPath, '', (New-Object System.Text.UTF8Encoding($false)))
        }
        if (-not (Test-Path -LiteralPath $historyStderrPath -PathType Leaf)) {
            [System.IO.File]::WriteAllText($historyStderrPath, '', (New-Object System.Text.UTF8Encoding($false)))
        }
    }

    if ($script:FssHistoryRuntimeReset -and $script:FssHistoryInjectorStarted) {
        $readySnapshot = Read-FssJson -Path $readyPath
        $readyMatchesLaunch = $null -ne $readySnapshot -and
            $readySnapshot.PSObject.Properties.Name -contains 'port' -and
            $readySnapshot.PSObject.Properties.Name -contains 'browserId' -and
            $readySnapshot.PSObject.Properties.Name -contains 'injectorPid' -and
            [int]$readySnapshot.port -eq [int]$script:FssHistorySession.port -and
            "$($readySnapshot.browserId)" -eq "$($script:FssHistorySession.browserId)" -and
            [int]$readySnapshot.injectorPid -eq [int]$script:FssHistorySession.injectorPid
        if ($readyMatchesLaunch) {
            Write-FssJsonAtomic -Path $historyReadyPath -Value $readySnapshot
        }
        $stateSnapshot = Read-FssJson -Path $injectionStatePath
        $stateMatchesLaunch = $null -ne $stateSnapshot -and
            $stateSnapshot.PSObject.Properties.Name -contains 'port' -and
            $stateSnapshot.PSObject.Properties.Name -contains 'browserId' -and
            $stateSnapshot.PSObject.Properties.Name -contains 'injectorPid' -and
            [int]$stateSnapshot.port -eq [int]$script:FssHistorySession.port -and
            "$($stateSnapshot.browserId)" -eq "$($script:FssHistorySession.browserId)" -and
            [int]$stateSnapshot.injectorPid -eq [int]$script:FssHistorySession.injectorPid
        if ($stateMatchesLaunch) {
            Write-FssJsonAtomic -Path $historyInjectionStatePath -Value $stateSnapshot
        }
    }
}

function Update-FssHistoryFromInjectorDiagnostics {
    if (-not $script:FssHistoryInjectorStarted) { return }
    if (-not (Test-Path -LiteralPath $stderrPath -PathType Leaf)) { return }
    $lines = @(Get-Content -LiteralPath $stderrPath -Encoding UTF8 -ErrorAction SilentlyContinue)
    if ($lines.Count -le $script:FssHistoryDiagnosticLineCount) { return }

    $newLines = @($lines | Select-Object -Skip $script:FssHistoryDiagnosticLineCount)
    $script:FssHistoryDiagnosticLineCount = $lines.Count
    foreach ($line in $newLines) {
        $match = [regex]::Match("$line", '^\[diagnostic\]\s+(?<event>[a-z0-9-]+)\s+(?<json>\{.*\})$')
        if (-not $match.Success) { continue }
        try {
            $event = $match.Groups['event'].Value
            $details = $match.Groups['json'].Value | ConvertFrom-Json
            switch ($event) {
                'json-list' {
                    $acceptedTargets = @($details.targets | Where-Object { [bool]$_.accepted })
                    if ($acceptedTargets.Count -gt 0) {
                        Add-FssHistoryStageOnce -Key 'app-target-discovered' -Event 'app-target-discovered' -Details ([ordered]@{
                            targetCount = [int]$details.targetCount
                            acceptedTargetCount = $acceptedTargets.Count
                            targetIndex = [int]$acceptedTargets[0].index
                            urlScheme = 'app:'
                        })
                    }
                }
                'renderer-attached' {
                    Add-FssHistoryStageOnce -Key 'renderer-stable-attach' -Event 'renderer-stable-attach' -At "$($details.attachedAt)" -Details ([ordered]@{
                            targetIndex = [int]$details.targetIndex
                            earlyDocumentScriptRegistered = [bool]$details.earlyDocumentScriptRegistered
                        })
                }
                'install-start' {
                    Add-FssHistoryStageOnce -Key 'first-install' -Event 'first-install' -At "$($details.firstInstallAt)" -Details ([ordered]@{
                            targetIndex = [int]$details.targetIndex
                        })
                }
                'install-verification' {
                    $attempt = [int]$details.attempt
                    Add-FssHistoryStageOnce -Key "install-verification-$attempt" -Event 'install-verification' -At "$($details.checkedAt)" -Details ([ordered]@{
                            attempt = $attempt
                            pass = [bool]$details.pass
                            repairCounts = $details.repairCounts
                        })
                }
                'renderer-ready' {
                    Add-FssHistoryStageOnce -Key 'renderer-ready' -Event 'renderer-ready' -At "$($details.readyAt)" -Details ([ordered]@{
                            verificationAttempts = [int]$details.verificationAttempts
                            selfHealOccurred = [bool]$details.selfHealOccurred
                            repairCounts = $details.repairCounts
                        })
                    Add-FssHistoryStageOnce -Key 'self-heal-count' -Event 'self-heal-count' -At "$($details.readyAt)" -Details ([ordered]@{
                            count = [int]$details.repairCounts.cycles
                        })
                }
                'ready-written' {
                    Add-FssHistoryStageOnce -Key 'injector-ready-written' -Event 'injector-ready-written' -At "$($details.readyAt)" -Details ([ordered]@{
                            targetCount = [int]$details.targetCount
                            verificationAttempts = [int]$details.verificationAttempts
                            selfHealOccurredBeforeReady = [bool]$details.selfHealOccurredBeforeReady
                        })
                }
                'target-error' {
                    Add-FssHistoryStageOnce -Key ("target-error-{0}" -f $details.stage) -Event 'injector-failure-signal' -Details ([ordered]@{
                            stage = "$($details.stage)"
                            failed = [bool]$details.failed
                            reason = "$($details.reason)"
                        })
                }
            }
        }
        catch {
            # History parsing is deliberately isolated from launcher success criteria.
        }
    }
}

function Remove-FssOldHistory {
    $rootFullPath = [System.IO.Path]::GetFullPath($historyRoot).TrimEnd('\') + '\'
    $directories = @(Get-ChildItem -LiteralPath $historyRoot -Directory -ErrorAction Stop |
        Sort-Object LastWriteTimeUtc -Descending)
    foreach ($directory in @($directories | Select-Object -Skip 15)) {
        $targetFullPath = [System.IO.Path]::GetFullPath($directory.FullName)
        if (-not $targetFullPath.StartsWith($rootFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refused to prune a history directory outside $historyRoot."
        }
        Remove-Item -LiteralPath $targetFullPath -Recurse -Force
    }
}

Write-FssHistoryEvent -Event 'launcher-start' -At $launchStartedAt -Details ([ordered]@{
        mode = $Mode
        launcherPid = $PID
        launchId = $historyName
    })
Write-FssJsonAtomic -Path $historySessionPath -Value $script:FssHistorySession

$node = $null
$registration = $null
$port = 0
$appProcessId = 0
$appIdentity = $null
$injectorProcess = $null
$sessionWritten = $false
$failureStage = 'launcher-preflight'

try {
    $failureStage = 'history-retention'
    Remove-FssOldHistory

    $failureStage = 'node-runtime-check'
    $node = Get-FssNodeRuntime

    $failureStage = 'codex-registration-check'
    $registration = Get-FssCodexRegistration

    $failureStage = 'existing-codex-check'
    $runningCodex = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue)
    if ($runningCodex.Count -gt 0) {
        throw 'Codex is already running. Close every Codex window, wait a few seconds, then run this launcher again. This script will not close the current app automatically.'
    }

    $failureStage = 'existing-session-check'
    $existingSession = Read-FssJson -Path $sessionPath
    if ($null -ne $existingSession) {
        $existingInjector = Get-FssProcessIdentity -ProcessId ([int]$existingSession.injectorPid)
        if ($null -ne $existingInjector) {
            throw 'A recorded Forest Scholar injector is still running. Use Restore-ForestScholarSkin.cmd first.'
        }
        $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
        Move-Item -LiteralPath $sessionPath -Destination (Join-Path $runtimeDirectory "session.stale-$stamp.json")
    }

    $failureStage = 'runtime-reset'
    Remove-Item -LiteralPath $readyPath, $stopPath, $injectionStatePath -Force -ErrorAction SilentlyContinue
    $script:FssHistoryRuntimeReset = $true

    $failureStage = 'random-port-selection'
    $port = Select-FssRandomPort
    Set-FssHistorySessionFields -Fields ([ordered]@{ port = $port })
    Write-FssHistoryEvent -Event 'cdp-port-selected' -Details ([ordered]@{
            port = $port
            bindAddress = '127.0.0.1'
        })

    $failureStage = 'codex-activation'
    $appProcessId = Start-FssCodex -Registration $registration -Arguments @(
        '--remote-debugging-address=127.0.0.1',
        "--remote-debugging-port=$port"
    )
    Write-FssHistoryEvent -Event 'codex-process-start' -Details ([ordered]@{
            appProcessId = $appProcessId
        })

    $failureStage = 'codex-process-identity-verification'
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
    Set-FssHistorySessionFields -Fields ([ordered]@{
            appProcessId = $appIdentity.ProcessId
            appStartedAt = $appIdentity.StartedAt
        })

    $failureStage = 'cdp-port-readiness'
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    $cdpIdentity = $null
    while ($null -eq $cdpIdentity -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 350
        $cdpIdentity = Get-FssCdpIdentity -Port $port -ExpectedExecutable $registration.ExpectedExecutable
    }
    if ($null -eq $cdpIdentity) {
        throw "Codex did not expose a verified 127.0.0.1 CDP endpoint on high port $port within 45 seconds."
    }
    Write-FssHistoryEvent -Event 'cdp-port-ready' -Details ([ordered]@{
            port = $port
            bindAddress = '127.0.0.1'
            browserId = $cdpIdentity.BrowserId
        })
    Set-FssHistorySessionFields -Fields ([ordered]@{
            browserId = $cdpIdentity.BrowserId
            browser = $cdpIdentity.Browser
        })

    $nodeArguments = @(
        $injectorPath,
        '--watch',
        '--port', "$port",
        '--browser-id', $cdpIdentity.BrowserId,
        '--root', $projectRoot,
        '--theme-package', $themePackagePath,
        '--mode', $Mode,
        '--state-file', $injectionStatePath
    )
    $argumentLine = ($nodeArguments | ForEach-Object { ConvertTo-FssNativeArgument -Value "$_" }) -join ' '
    $failureStage = 'node-process-start'
    $injectorProcess = Start-Process `
        -FilePath $node.Path `
        -ArgumentList $argumentLine `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru
    $script:FssHistoryInjectorStarted = $true
    Write-FssHistoryEvent -Event 'node-process-start' -Details ([ordered]@{
            injectorPid = $injectorProcess.Id
            nodeVersion = $node.Version
        })
    Set-FssHistorySessionFields -Fields ([ordered]@{
            injectorPid = $injectorProcess.Id
            nodeVersion = $node.Version
        })

    $failureStage = 'injector-process-identity-verification'
    $injectorVerification = Wait-FssProcessIdentity `
        -Process $injectorProcess `
        -ExpectedPath $node.Path `
        -TimeoutMilliseconds 5000 `
        -PollMilliseconds 100
    Write-FssHistoryEvent -Event 'injector-identity-verification' -Details ([ordered]@{
            attempts = $injectorVerification.Attempts
            verified = [bool]$injectorVerification.Verified
            exited = [bool]$injectorVerification.Exited
            hardMismatch = [bool]$injectorVerification.HardMismatch
            failureReason = $injectorVerification.FailureReason
        })
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
        activeTheme = $activeTheme
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
    Set-FssHistorySessionFields -Fields ([ordered]@{
            schemaVersion = $script:FssSchemaVersion
            activeTheme = $activeTheme
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
            startedAt = $session.startedAt
        })

    $failureStage = 'renderer-readiness'
    $readyDeadline = [DateTime]::UtcNow.AddSeconds(35)
    while (-not (Test-Path -LiteralPath $readyPath -PathType Leaf) -and [DateTime]::UtcNow -lt $readyDeadline) {
        Update-FssHistoryFromInjectorDiagnostics
        if ($injectorProcess.HasExited) {
            throw "The injector exited before applying the MVP. See $stderrPath"
        }
        Start-Sleep -Milliseconds 150
    }
    if (-not (Test-Path -LiteralPath $readyPath -PathType Leaf)) {
        throw "The injector did not confirm a Codex renderer within 35 seconds. See $stderrPath"
    }
    Update-FssHistoryFromInjectorDiagnostics

    $failureStage = 'ready-identity-validation'
    $ready = Read-FssJson -Path $readyPath
    $readyThemeId = $null
    if ($null -ne $ready -and $ready.PSObject.Properties.Name -contains 'theme' -and
        $null -ne $ready.theme -and $ready.theme.PSObject.Properties.Name -contains 'id') {
        $readyThemeId = "$($ready.theme.id)"
    }
    if ([int]$ready.port -ne $port -or "$($ready.browserId)" -ne $cdpIdentity.BrowserId -or
        "$($ready.mode)" -ne $Mode -or $readyThemeId -ne $activeTheme -or
        [int]$ready.injectorPid -ne $injectorProcess.Id) {
        throw 'The injector readiness identity did not match the launched session.'
    }

    $readyTarget = @($ready.targets | Select-Object -First 1)
    $readyTarget = if ($readyTarget.Count -eq 1) { $readyTarget[0] } else { $null }
    $finalReadyAt = if ($null -ne $readyTarget -and $readyTarget.readyAt) { "$($readyTarget.readyAt)" } else { [DateTime]::UtcNow.ToString('o') }
    $repairCounts = if ($null -ne $readyTarget) { $readyTarget.repairCountsAtReady } else { $null }
    Write-FssHistoryEvent -Event 'final-ready' -At $finalReadyAt -Details ([ordered]@{
            verificationAttempts = if ($null -ne $readyTarget) { $readyTarget.verificationAttempts } else { $null }
            selfHealCount = if ($null -ne $repairCounts) { $repairCounts.cycles } else { 0 }
        })
    Set-FssHistorySessionFields -Fields ([ordered]@{
            status = 'ready'
            finalReadyAt = $finalReadyAt
            failureStage = $null
        })
    Sync-FssHistoryArtifacts
    $failureStage = 'complete'

    Write-Host "Forest Scholar Skin MVP started in $Mode mode."
    Write-Host "CDP is bound to 127.0.0.1 on randomized high port $port."
}
catch {
    $failure = $_
    try { Update-FssHistoryFromInjectorDiagnostics } catch {}
    try {
        Set-FssHistorySessionFields -Fields ([ordered]@{
                status = 'failed'
                failureStage = $failureStage
                failedAt = [DateTime]::UtcNow.ToString('o')
            })
        Write-FssHistoryEvent -Event 'failure-stage' -Details ([ordered]@{
                stage = $failureStage
                exceptionType = $failure.Exception.GetType().FullName
                message = "$($failure.Exception.Message)"
            })
        Sync-FssHistoryArtifacts
    } catch {}
    if ($null -ne $injectorProcess -and $null -ne $node) {
        try {
            $injectorIdentity = Get-FssProcessIdentity -ProcessId $injectorProcess.Id
            if ($null -ne $injectorIdentity -and $injectorIdentity.Path -and $injectorIdentity.StartedAt -and
                (Test-FssPathEqual -Left $injectorIdentity.Path -Right $node.Path)) {
                $null = Stop-FssOwnedProcess -ProcessId $injectorIdentity.ProcessId -ExpectedPath $node.Path -ExpectedStartedAt $injectorIdentity.StartedAt
            }
        } catch {}
    }
    if ($null -ne $appIdentity -and $null -ne $registration) {
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
    try {
        Update-FssHistoryFromInjectorDiagnostics
        Sync-FssHistoryArtifacts
    } catch {}
    throw $failure
}
