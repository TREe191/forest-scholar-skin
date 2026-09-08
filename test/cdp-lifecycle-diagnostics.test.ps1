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

function New-FakeProcess {
    param(
        [int]$ProcessId,
        [int]$ParentProcessId,
        [string]$Path,
        [string]$CommandLine
    )
    return [pscustomobject]@{
        ProcessId = $ProcessId
        ParentProcessId = $ParentProcessId
        Name = 'ChatGPT.exe'
        ExecutablePath = $Path
        CreationDate = [DateTime]'2026-09-04T00:00:00Z'
        CommandLine = $CommandLine
    }
}

function New-LifecycleSnapshot {
    param(
        [int]$ActivationProcessId,
        [int[]]$ObservedProcessIds,
        [int[]]$PortBearingProcessIds,
        [int[]]$ListenerPids
    )
    return [pscustomobject]@{
        processQuerySucceeded = $true
        processQueryFailureType = $null
        listenerQuerySucceeded = $true
        listenerQueryFailureType = $null
        expectedExecutableName = 'ChatGPT.exe'
        activationProcessId = $ActivationProcessId
        activationProcessPresent = @($ObservedProcessIds) -contains $ActivationProcessId
        activationProcessHasSelectedPort = @($PortBearingProcessIds) -contains $ActivationProcessId
        observedProcessIds = @($ObservedProcessIds)
        matchingExpectedPathProcessIds = @($ObservedProcessIds)
        portBearingProcessIds = @($PortBearingProcessIds)
        listenerPids = @($ListenerPids)
        processes = @()
    }
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

Invoke-Test 'Activation PID is identified as the listener-owning browser candidate' {
    $observation = Get-FssCodexLifecycleObservation `
        -ActivationProcessId 4000 `
        -Port 55000 `
        -ExpectedExecutable $expectedExecutable `
        -ProcessProvider {
            @((New-FakeProcess -ProcessId 4000 -ParentProcessId 3000 -Path $expectedExecutable `
                -CommandLine 'ChatGPT.exe --remote-debugging-address=127.0.0.1 --remote-debugging-port=55000'))
        } `
        -ListenerProvider { @([pscustomobject]@{ OwningProcess = 4000 }) }

    Assert-True $observation.activationProcessPresent 'Activation PID should be present.'
    Assert-True $observation.activationProcessHasSelectedPort 'Activation PID should carry the selected port.'
    Assert-True (@($observation.portBearingProcessIds).Count -eq 1 -and $observation.portBearingProcessIds[0] -eq 4000) 'Port-bearing PID was not identified.'
    Assert-True (@($observation.listenerPids).Count -eq 1 -and $observation.listenerPids[0] -eq 4000) 'Listener owner PID was not recorded.'
}

Invoke-Test 'A replacement browser candidate is observed without being trusted automatically' {
    $observation = Get-FssCodexLifecycleObservation `
        -ActivationProcessId 4000 `
        -Port 55000 `
        -ExpectedExecutable $expectedExecutable `
        -ProcessProvider {
            @((New-FakeProcess -ProcessId 4100 -ParentProcessId 4000 -Path $expectedExecutable `
                -CommandLine 'ChatGPT.exe --remote-debugging-address=127.0.0.1 --remote-debugging-port=55000'))
        } `
        -ListenerProvider { @([pscustomobject]@{ OwningProcess = 4100 }) }

    Assert-True (-not $observation.activationProcessPresent) 'Activation PID should be absent.'
    Assert-True (@($observation.matchingExpectedPathProcessIds) -contains 4100) 'Replacement path match was not recorded.'
    Assert-True (@($observation.portBearingProcessIds) -contains 4100) 'Replacement port flag was not recorded.'
    Assert-True (@($observation.listenerPids) -contains 4100) 'Replacement listener owner was not recorded.'
}

Invoke-Test 'Path mismatch and missing selected port remain explicit' {
    $observation = Get-FssCodexLifecycleObservation `
        -ActivationProcessId 4000 `
        -Port 55000 `
        -ExpectedExecutable $expectedExecutable `
        -ProcessProvider {
            @((New-FakeProcess -ProcessId 4000 -ParentProcessId 3000 -Path 'C:\Other\ChatGPT.exe' `
                -CommandLine 'ChatGPT.exe --remote-debugging-port=55001'))
        } `
        -ListenerProvider { @() }

    Assert-True (@($observation.matchingExpectedPathProcessIds).Count -eq 0) 'Mismatched executable should not be accepted.'
    Assert-True (@($observation.portBearingProcessIds).Count -eq 0) 'Wrong port should not match the selected port.'
    Assert-True (@($observation.listenerPids).Count -eq 0) 'No listener should remain explicit.'
}

Invoke-Test 'Lifecycle output does not expose command line or executable path' {
    $observation = Get-FssCodexLifecycleObservation `
        -ActivationProcessId 4000 `
        -Port 55000 `
        -ExpectedExecutable $expectedExecutable `
        -ProcessProvider {
            @((New-FakeProcess -ProcessId 4000 -ParentProcessId 3000 -Path $expectedExecutable `
                -CommandLine 'ChatGPT.exe --remote-debugging-address=127.0.0.1 --remote-debugging-port=55000 --private-value=secret'))
        } `
        -ListenerProvider { @() }

    $propertyNames = @($observation.processes[0].PSObject.Properties.Name)
    Assert-True ($propertyNames -notcontains 'CommandLine') 'Full command line must not be returned.'
    Assert-True ($propertyNames -notcontains 'ExecutablePath') 'Full executable path must not be returned.'
    Assert-True ($propertyNames -notcontains 'Path') 'Full executable path must not be returned under an alternate name.'
}

Invoke-Test 'Process metadata query failure is diagnostic and non-authoritative' {
    $observation = Get-FssCodexLifecycleObservation `
        -ActivationProcessId 4000 `
        -Port 55000 `
        -ExpectedExecutable $expectedExecutable `
        -ProcessProvider { throw 'simulated query failure' } `
        -ListenerProvider { @() }

    Assert-True (-not $observation.processQuerySucceeded) 'Query failure should be recorded.'
    Assert-True ($observation.processQueryFailureType -eq 'RuntimeException') 'Failure type should be recorded without the sensitive message.'
    Assert-True (@($observation.observedProcessIds).Count -eq 0) 'Failed query must not invent processes.'
}

Invoke-Test 'Lifecycle transitions preserve activation to replacement evidence' {
    $state = @{
        Clock = [DateTime]'2026-09-04T00:00:00Z'
        CdpIndex = 0
        LifecycleIndex = 0
    }
    $lifecycleSnapshots = @(
        (New-LifecycleSnapshot -ActivationProcessId 4000 -ObservedProcessIds @(4000) -PortBearingProcessIds @(4000) -ListenerPids @()),
        (New-LifecycleSnapshot -ActivationProcessId 4000 -ObservedProcessIds @(4100) -PortBearingProcessIds @(4100) -ListenerPids @(4100))
    )
    $result = Wait-FssCodexCdpReadiness `
        -ProcessId 4000 `
        -Port 55000 `
        -ExpectedExecutable $expectedExecutable `
        -ProcessTimeoutMilliseconds 1000 `
        -CdpTimeoutMilliseconds 3000 `
        -ProcessPollMilliseconds 100 `
        -CdpPollMilliseconds 1000 `
        -ProcessObservationProvider {
            [pscustomobject]@{
                State = 'ready'
                HardFailure = $false
                Identity = [pscustomobject]@{
                    ProcessId = 4000
                    Name = 'ChatGPT'
                    Path = $expectedExecutable
                    StartedAt = '2026-09-04T00:00:00Z'
                }
            }
        } `
        -CdpObservationProvider {
            $stage = if ($state.CdpIndex -eq 0) { 'listener-not-seen' } else { 'ready' }
            $state.CdpIndex += 1
            [pscustomobject]@{
                Stage = $stage
                Ready = $stage -eq 'ready'
                HardFailure = $false
                ListenerSeen = $stage -eq 'ready'
                ListenerPids = if ($stage -eq 'ready') { @(4100) } else { @() }
                HttpSucceeded = $stage -eq 'ready'
                WebSocketSeen = $stage -eq 'ready'
                BrowserIdentityValid = $stage -eq 'ready'
                HttpFailureType = $null
                Identity = if ($stage -eq 'ready') {
                    [pscustomobject]@{
                        BrowserId = 'browser-test-id'
                        BrowserWebSocketDebuggerUrl = 'ws://127.0.0.1:55000/devtools/browser/browser-test-id'
                        Browser = 'Chrome/Test'
                    }
                } else { $null }
            }
        } `
        -LifecycleObservationProvider {
            $index = [math]::Min($state.LifecycleIndex, $lifecycleSnapshots.Count - 1)
            $state.LifecycleIndex += 1
            $lifecycleSnapshots[$index]
        } `
        -UtcNowProvider { $state.Clock } `
        -SleepAction { param($milliseconds) $state.Clock = $state.Clock.AddMilliseconds($milliseconds) }

    Assert-True $result.Succeeded 'Mocked listener should become ready.'
    Assert-True (@($result.LifecycleTransitions).Count -eq 2) 'Expected two distinct lifecycle transitions.'
    Assert-True (@($result.LifecycleTransitions[1].RemovedProcessIds) -contains 4000) 'Activation PID exit was not preserved.'
    Assert-True (@($result.LifecycleTransitions[1].AddedProcessIds) -contains 4100) 'Replacement PID creation was not preserved.'
}

Write-Output "RESULT passed=$script:Passed failed=$script:Failed"
if ($script:Failed -gt 0) { exit 1 }
