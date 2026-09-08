$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\Common.ps1')

$script:Passed = 0
$script:Failed = 0
$expectedExecutable = 'C:\Program Files\Codex\ChatGPT.exe'

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function New-ProcessObservation {
    param([string]$State)
    switch ($State) {
        'ready' {
            return [pscustomobject]@{
                State = 'ready'; HardFailure = $false
                Identity = [pscustomobject]@{ ProcessId = 4000; Name = 'ChatGPT'; Path = $expectedExecutable; StartedAt = '2026-09-02T00:00:00.0000000Z' }
            }
        }
        'path-mismatch' {
            return [pscustomobject]@{
                State = 'path-mismatch'; HardFailure = $true
                Identity = [pscustomobject]@{ ProcessId = 4000; Name = 'ChatGPT'; Path = 'C:\Other\ChatGPT.exe'; StartedAt = '2026-09-02T00:00:00.0000000Z' }
            }
        }
        default { return [pscustomobject]@{ State = $State; HardFailure = $false; Identity = $null } }
    }
}

function New-CdpObservation {
    param([string]$Stage)
    $base = [ordered]@{
        Stage = $Stage
        Ready = $false
        HardFailure = $false
        ListenerSeen = $false
        ListenerPids = @()
        HttpSucceeded = $false
        WebSocketSeen = $false
        BrowserIdentityValid = $false
        HttpFailureType = $null
        Identity = $null
    }
    switch ($Stage) {
        'listener-not-seen' {}
        'listener-owner-unavailable' {
            $base.ListenerSeen = $true; $base.ListenerPids = @(4000)
        }
        'http-not-ready' {
            $base.ListenerSeen = $true; $base.ListenerPids = @(4000); $base.HttpFailureType = 'WebException'
        }
        'browser-websocket-not-seen' {
            $base.ListenerSeen = $true; $base.ListenerPids = @(4000); $base.HttpSucceeded = $true
        }
        'browser-identity-invalid' {
            $base.ListenerSeen = $true; $base.ListenerPids = @(4000); $base.HttpSucceeded = $true; $base.WebSocketSeen = $true
        }
        'listener-owner-path-mismatch' {
            $base.ListenerSeen = $true; $base.ListenerPids = @(9000); $base.HardFailure = $true
        }
        'ready' {
            $base.ListenerSeen = $true
            $base.ListenerPids = @(4000)
            $base.HttpSucceeded = $true
            $base.WebSocketSeen = $true
            $base.BrowserIdentityValid = $true
            $base.Ready = $true
            $base.Identity = [pscustomobject]@{
                BrowserId = 'browser-test-id'
                BrowserWebSocketDebuggerUrl = 'ws://127.0.0.1:55000/devtools/browser/browser-test-id'
                Browser = 'Chrome/Test'
            }
        }
        default { throw "Unknown CDP test stage: $Stage" }
    }
    return [pscustomobject]$base
}

function Invoke-MockedReadiness {
    param(
        [string[]]$ProcessStates,
        [string[]]$CdpStages,
        [int]$ProcessTimeoutMilliseconds = 1000,
        [int]$CdpTimeoutMilliseconds = 1500
    )
    $state = @{
        Clock = [DateTime]'2026-09-02T00:00:00Z'
        ProcessIndex = 0
        CdpIndex = 0
    }
    $processProvider = {
        param($id, $expected)
        $index = [math]::Min($state.ProcessIndex, $ProcessStates.Count - 1)
        $state.ProcessIndex += 1
        return New-ProcessObservation -State $ProcessStates[$index]
    }
    $cdpProvider = {
        param($port, $expected)
        $index = [math]::Min($state.CdpIndex, $CdpStages.Count - 1)
        $state.CdpIndex += 1
        return New-CdpObservation -Stage $CdpStages[$index]
    }
    $lifecycleProvider = {
        param($activationId, $port, $expected)
        return [pscustomobject]@{
            processQuerySucceeded = $true
            processQueryFailureType = $null
            listenerQuerySucceeded = $true
            listenerQueryFailureType = $null
            expectedExecutableName = 'ChatGPT.exe'
            activationProcessId = $activationId
            activationProcessPresent = $true
            activationProcessHasSelectedPort = $true
            observedProcessIds = @($activationId)
            matchingExpectedPathProcessIds = @($activationId)
            portBearingProcessIds = @($activationId)
            listenerPids = @($activationId)
            processes = @()
        }
    }
    $clockProvider = { $state.Clock }
    $sleep = { param($milliseconds) $state.Clock = $state.Clock.AddMilliseconds($milliseconds) }
    return Wait-FssCodexCdpReadiness `
        -ProcessId 4000 `
        -Port 55000 `
        -ExpectedExecutable $expectedExecutable `
        -ProcessTimeoutMilliseconds $ProcessTimeoutMilliseconds `
        -CdpTimeoutMilliseconds $CdpTimeoutMilliseconds `
        -ProcessPollMilliseconds 100 `
        -CdpPollMilliseconds 250 `
        -ProcessObservationProvider $processProvider `
        -CdpObservationProvider $cdpProvider `
        -LifecycleObservationProvider $lifecycleProvider `
        -UtcNowProvider $clockProvider `
        -SleepAction $sleep
}

function Invoke-Test {
    param([string]$Name, [scriptblock]$Body)
    try {
        & $Body
        $script:Passed += 1
        Write-Output "PASS $Name"
    }
    catch {
        $script:Failed += 1
        Write-Output "FAIL $Name :: $($_.Exception.Message)"
    }
}

Invoke-Test 'Codex process appears after a delay' {
    $result = Invoke-MockedReadiness -ProcessStates @('not-detected', 'metadata-unavailable', 'ready', 'ready') -CdpStages @('ready')
    Assert-True $result.Succeeded 'Expected delayed process detection to succeed.'
    Assert-True ($result.ProcessAttempts -eq 3) 'Expected three process attempts.'
}

Invoke-Test 'Port listener appears after a delay' {
    $result = Invoke-MockedReadiness -ProcessStates @('ready') -CdpStages @('listener-not-seen', 'listener-not-seen', 'ready')
    Assert-True $result.Succeeded 'Expected delayed listener to succeed.'
    Assert-True ($result.ReadinessAttempts -eq 3) 'Expected three readiness attempts.'
}

Invoke-Test 'HTTP endpoint appears after listener' {
    $result = Invoke-MockedReadiness -ProcessStates @('ready') -CdpStages @('http-not-ready', 'http-not-ready', 'ready')
    Assert-True $result.Succeeded 'Expected delayed HTTP readiness to succeed.'
    Assert-True ($null -ne $result.ListenerFirstSeenAt) 'Listener timestamp was not captured.'
}

Invoke-Test 'Transient endpoint failure recovers' {
    $result = Invoke-MockedReadiness -ProcessStates @('ready') -CdpStages @('listener-owner-unavailable', 'http-not-ready', 'ready')
    Assert-True $result.Succeeded 'Expected transient endpoint failure to recover.'
}

Invoke-Test 'Browser identity first fails then stabilizes' {
    $result = Invoke-MockedReadiness -ProcessStates @('ready') -CdpStages @('browser-identity-invalid', 'ready')
    Assert-True $result.Succeeded 'Expected browser identity retry to succeed.'
    Assert-True ($result.BrowserIdentityValidatedAt -ne $null) 'Browser identity timestamp was not captured.'
}

Invoke-Test 'Listener timeout is classified precisely' {
    $result = Invoke-MockedReadiness -ProcessStates @('ready') -CdpStages @('listener-not-seen') -CdpTimeoutMilliseconds 1000
    Assert-True (-not $result.Succeeded) 'Expected listener timeout to fail.'
    Assert-True ($result.FailureStage -eq 'cdp-listener-readiness') 'Listener timeout was misclassified.'
}

Invoke-Test 'HTTP timeout is classified precisely' {
    $result = Invoke-MockedReadiness -ProcessStates @('ready') -CdpStages @('http-not-ready') -CdpTimeoutMilliseconds 1000
    Assert-True (-not $result.Succeeded) 'Expected HTTP timeout to fail.'
    Assert-True ($result.FailureStage -eq 'cdp-http-readiness') 'HTTP timeout was misclassified.'
}

Invoke-Test 'Browser endpoint timeout is classified precisely' {
    $result = Invoke-MockedReadiness -ProcessStates @('ready') -CdpStages @('browser-websocket-not-seen') -CdpTimeoutMilliseconds 1000
    Assert-True (-not $result.Succeeded) 'Expected browser endpoint timeout to fail.'
    Assert-True ($result.FailureStage -eq 'cdp-browser-endpoint-validation') 'Browser endpoint timeout was misclassified.'
}

Invoke-Test 'Codex process exits before CDP ready' {
    $result = Invoke-MockedReadiness -ProcessStates @('ready', 'not-detected') -CdpStages @('listener-not-seen')
    Assert-True (-not $result.Succeeded) 'Expected exited process to fail.'
    Assert-True ($result.FailureStage -eq 'codex-process-exited') 'Exited process was misclassified.'
}

Invoke-Test 'Existing Codex instance blocks launch' {
    $existing = Get-FssExistingCodexObservation -ExpectedExecutable $expectedExecutable -ProcessProvider {
        @([pscustomobject]@{ Id = 2147483000 })
    }
    Assert-True (-not $existing.LaunchAllowed) 'Existing instance should block launch.'
    Assert-True ($existing.DetectedCount -eq 1) 'Existing instance count was not recorded.'
}

Invoke-Test 'Process path mismatch fails closed' {
    $result = Invoke-MockedReadiness -ProcessStates @('path-mismatch') -CdpStages @('ready')
    Assert-True (-not $result.Succeeded) 'Expected process path mismatch to fail.'
    Assert-True ($result.FailureStage -eq 'codex-process-identity') 'Process mismatch was misclassified.'
}

Invoke-Test 'Listener owner path mismatch fails closed' {
    $result = Invoke-MockedReadiness -ProcessStates @('ready') -CdpStages @('listener-owner-path-mismatch')
    Assert-True (-not $result.Succeeded) 'Expected listener owner mismatch to fail.'
    Assert-True ($result.FailureStage -eq 'cdp-listener-identity') 'Listener owner mismatch was misclassified.'
}

Invoke-Test 'Normal fast launch succeeds' {
    $result = Invoke-MockedReadiness -ProcessStates @('ready') -CdpStages @('ready')
    Assert-True $result.Succeeded 'Expected fast launch to succeed.'
    Assert-True ($result.ReadinessAttempts -eq 1) 'Expected one readiness attempt.'
    Assert-True ($result.CdpIdentity.BrowserId -eq 'browser-test-id') 'Browser identity did not propagate.'
}

Write-Output "RESULT passed=$script:Passed failed=$script:Failed"
if ($script:Failed -gt 0) { exit 1 }
