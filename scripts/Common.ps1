Set-StrictMode -Version Latest

$script:FssSchemaVersion = 1
$script:FssDataRoot = Split-Path -Parent $PSScriptRoot
$script:FssUseBundledNode = $false

function Initialize-FssStorage {
    param([string]$DataRoot)
    if (-not $DataRoot -and (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'node\runtime.json'))) { throw 'Packaged workflows require an explicit writable DataRoot.' }
    if ($DataRoot) {
        if (-not [System.IO.Path]::IsPathRooted($DataRoot)) { throw 'DataRoot must be absolute.' }
        $resolvedData = [System.IO.Path]::GetFullPath($DataRoot).TrimEnd('\')
        $resources = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
        if ($resolvedData.Equals($resources, [System.StringComparison]::OrdinalIgnoreCase) -or
            $resolvedData.StartsWith($resources + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'DataRoot must be outside read-only resources.' }
        $ancestor = $resolvedData
        while ($ancestor) {
            if (Test-Path -LiteralPath $ancestor) {
                if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Linked DataRoot ancestors are not supported.' }
            }
            $parent = Split-Path -Parent $ancestor
            if ($parent -eq $ancestor) { break }
            $ancestor = $parent
        }
        $script:FssDataRoot = $resolvedData
        $script:FssUseBundledNode = $true
    }
    return $script:FssDataRoot
}

function Test-FssPathEqual {
    param(
        [Parameter(Mandatory = $true)][string]$Left,
        [Parameter(Mandatory = $true)][string]$Right
    )

    try {
        $leftPath = [System.IO.Path]::GetFullPath($Left).TrimEnd('\')
        $rightPath = [System.IO.Path]::GetFullPath($Right).TrimEnd('\')
        return $leftPath.Equals($rightPath, [System.StringComparison]::OrdinalIgnoreCase)
    }
    catch {
        return $false
    }
}

function Get-FssPathComparisonDiagnostic {
    param([AllowNull()][AllowEmptyString()][string]$ExpectedPath, [AllowNull()][AllowEmptyString()][string]$ActualPath)
    $expected = $null
    $actual = $null
    $reason = $null
    try { if ($ExpectedPath) { $expected = [System.IO.Path]::GetFullPath($ExpectedPath).TrimEnd('\') } } catch { $reason = 'expected-path-normalization-failed' }
    try { if ($ActualPath) { $actual = [System.IO.Path]::GetFullPath($ActualPath).TrimEnd('\') } } catch { $reason = 'actual-path-normalization-failed' }
    if (-not $ExpectedPath) { $reason = 'expected-path-unavailable' }
    elseif (-not $ActualPath) { $reason = 'actual-path-unavailable' }
    elseif ($expected -and $actual -and -not $expected.Equals($actual, [System.StringComparison]::OrdinalIgnoreCase)) {
        $reason = 'normalized-path-different'
        if (-not [System.IO.Path]::GetFileName($expected).Equals([System.IO.Path]::GetFileName($actual), [System.StringComparison]::OrdinalIgnoreCase)) {
            $reason = 'executable-name-different'
        } elseif ($expected -match '\\WindowsApps\\([^\\]+)\\' -and $actual -match '\\WindowsApps\\([^\\]+)\\') {
            $expectedPackage = [regex]::Match($expected, '\\WindowsApps\\([^\\]+)\\', 'IgnoreCase').Groups[1].Value
            $actualPackage = [regex]::Match($actual, '\\WindowsApps\\([^\\]+)\\', 'IgnoreCase').Groups[1].Value
            if (-not $expectedPackage.Equals($actualPackage, [System.StringComparison]::OrdinalIgnoreCase)) { $reason = 'windowsapps-package-directory-different' }
        }
    }
    return [pscustomobject]@{
        expectedPath = $ExpectedPath; actualPath = $ActualPath
        normalizedExpectedPath = $expected; normalizedActualPath = $actual
        comparisonMode = 'GetFullPath.TrimEnd(backslash)/OrdinalIgnoreCase'
        mismatchReason = $reason
    }
}

function Write-FssJsonAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        $null = New-Item -ItemType Directory -Path $directory -Force
    }

    $temporaryPath = Join-Path $directory ('.{0}.{1}.tmp' -f ([System.IO.Path]::GetFileName($Path)), [guid]::NewGuid().ToString('N'))
    try {
        $json = $Value | ConvertTo-Json -Depth 12
        [System.IO.File]::WriteAllText($temporaryPath, $json, (New-Object System.Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    }
    finally {
        Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
}

function Read-FssJson {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }

    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-FssNodeRuntime {
    if ($script:FssUseBundledNode) {
        $nodeDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'node'
        $nodePath = Join-Path $nodeDirectory 'node.exe'
        $metadata = Read-FssJson -Path (Join-Path $nodeDirectory 'runtime.json')
        if ($null -eq $metadata -or -not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw 'Bundled Node runtime is missing.' }
        $hasher = [System.Security.Cryptography.SHA256]::Create()
        $stream = [System.IO.File]::OpenRead($nodePath)
        try { $actualHash = [System.BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '') }
        finally { $stream.Dispose(); $hasher.Dispose() }
        if ($actualHash -ne $metadata.sha256) { throw 'Bundled Node runtime hash mismatch.' }
    } else {
        $command = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $command) { throw 'Node.js was not found in PATH. Forest Scholar Skin did not download or install anything.' }
        $nodePath = $command.Source
    }

    $versionText = (& $nodePath --version 2>$null).Trim()
    if ($script:FssUseBundledNode -and $versionText -ne $metadata.version) { throw 'Bundled Node version mismatch.' }
    $match = [regex]::Match($versionText, '^v(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)')
    if (-not $match.Success) {
        throw "Unable to parse Node.js version: $versionText"
    }

    $major = [int]$match.Groups['major'].Value
    if ($major -lt 22) {
        throw "Node.js 22 or newer is required. Found $versionText. No runtime was downloaded or changed."
    }

    return [pscustomobject]@{
        Path = $nodePath
        Version = $versionText
        Major = $major
    }
}

function Get-FssCodexRegistration {
    $packages = @(Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue | Sort-Object Version -Descending)
    if ($packages.Count -eq 0) {
        throw 'The registered OpenAI.Codex Store package is unavailable in this user session.'
    }

    $package = @($packages | Where-Object { "$($_.SignatureKind)" -eq 'Store' } | Select-Object -First 1)
    if ($package.Count -eq 0) {
        throw 'OpenAI.Codex is registered, but no Store-signed package registration was found.'
    }
    $package = $package[0]

    $familyName = "$($package.PackageFamilyName)"
    if ($familyName -notmatch '^[A-Za-z0-9._-]{1,128}$') {
        throw 'The registered Codex package family name is invalid.'
    }

    $startApps = @(Get-StartApps -ErrorAction SilentlyContinue | Where-Object {
        "$($_.AppID)" -like "$familyName!*"
    })
    if ($startApps.Count -gt 1) {
        $preferred = @($startApps | Where-Object { "$($_.Name)" -match 'Codex|ChatGPT' })
        if ($preferred.Count -eq 1) { $startApps = $preferred }
    }
    if ($startApps.Count -ne 1) {
        throw "Unable to resolve one AppUserModelId for registered package family $familyName without reading AppxManifest.xml."
    }

    $appUserModelId = "$($startApps[0].AppID)"
    if ($appUserModelId -notmatch '^[A-Za-z0-9._-]{1,128}![A-Za-z0-9._-]{1,64}$') {
        throw 'The resolved Codex AppUserModelId is invalid.'
    }

    $installLocation = "$($package.InstallLocation)"
    if (-not $installLocation) {
        throw 'The registered Codex package does not expose an install location.'
    }

    return [pscustomobject]@{
        Name = "$($package.Name)"
        PackageFullName = "$($package.PackageFullName)"
        PackageFamilyName = $familyName
        Version = "$($package.Version)"
        SignatureKind = "$($package.SignatureKind)"
        InstallLocation = $installLocation
        AppUserModelId = $appUserModelId
        ExpectedExecutable = Join-Path $installLocation 'app\ChatGPT.exe'
    }
}

function Initialize-FssPackageActivator {
    if ($null -ne ('ForestScholarSkin.PackageActivator' -as [type])) {
        return
    }

    $runtimeDirectory = Join-Path $script:FssDataRoot 'runtime'
    $compilerTemp = Join-Path $runtimeDirectory 'compiler-temp'
    $null = New-Item -ItemType Directory -Path $compilerTemp -Force
    $previousTemp = $env:TEMP
    $previousTmp = $env:TMP
    try {
        $env:TEMP = $compilerTemp
        $env:TMP = $compilerTemp
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace ForestScholarSkin
{
    [Flags]
    internal enum ActivateOptions
    {
        None = 0
    }

    [ComImport]
    [Guid("2e941141-7f97-4756-ba1d-9decde894a3d")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IApplicationActivationManager
    {
        int ActivateApplication(
            [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            [MarshalAs(UnmanagedType.LPWStr)] string arguments,
            ActivateOptions options,
            out uint processId);
    }

    [ComImport]
    [Guid("45ba127d-10a8-46ea-8ab7-56ea9078943c")]
    internal class ApplicationActivationManager { }

    public static class PackageActivator
    {
        public static uint Launch(string appUserModelId, string arguments)
        {
            var manager = (IApplicationActivationManager)new ApplicationActivationManager();
            try
            {
                uint processId;
                int result = manager.ActivateApplication(
                    appUserModelId,
                    arguments ?? string.Empty,
                    ActivateOptions.None,
                    out processId);
                Marshal.ThrowExceptionForHR(result);
                return processId;
            }
            finally
            {
                if (Marshal.IsComObject(manager)) Marshal.FinalReleaseComObject(manager);
            }
        }
    }
}
'@
    }
    finally {
        $env:TEMP = $previousTemp
        $env:TMP = $previousTmp
    }
}

function Start-FssCodex {
    param(
        [Parameter(Mandatory = $true)]$Registration,
        [string[]]$Arguments = @()
    )

    Initialize-FssPackageActivator
    $argumentLine = ($Arguments | ForEach-Object {
        if ($_ -match '[\s"]') { '"{0}"' -f ($_.Replace('"', '\"')) } else { $_ }
    }) -join ' '
    $processId = [ForestScholarSkin.PackageActivator]::Launch($Registration.AppUserModelId, $argumentLine)
    if ($processId -le 0) {
        throw 'Windows did not return a Codex process ID after package activation.'
    }
    return [int]$processId
}

function Get-FssProcessIdentity {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
        $path = $null
        $startedAt = $null
        try { $path = $process.Path } catch {}
        try { $startedAt = $process.StartTime.ToUniversalTime().ToString('o') } catch {}
        return [pscustomobject]@{
            ProcessId = $process.Id
            Name = $process.ProcessName
            Path = $path
            StartedAt = $startedAt
        }
    }
    catch {
        return $null
    }
}

function Wait-FssProcessIdentity {
    param(
        [Parameter(Mandatory = $true)]$Process,
        [Parameter(Mandatory = $true)][string]$ExpectedPath,
        [ValidateRange(100, 30000)][int]$TimeoutMilliseconds = 5000,
        [ValidateRange(10, 1000)][int]$PollMilliseconds = 100
    )

    $processId = [int]$Process.Id
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    $attempts = 0
    $lastObservation = 'not-queried'

    do {
        $attempts += 1
        $hasExited = $false
        try { $hasExited = [bool]$Process.HasExited } catch {}
        if ($hasExited) {
            $exitCode = $null
            try { $exitCode = [int]$Process.ExitCode } catch {}
            return [pscustomobject]@{
                Verified = $false
                Exited = $true
                HardMismatch = $false
                FailureReason = 'process-exited'
                Attempts = $attempts
                ExitCode = $exitCode
                Identity = $null
            }
        }

        $candidate = Get-FssProcessIdentity -ProcessId $processId
        if ($null -eq $candidate) {
            $lastObservation = 'process-metadata-unavailable'
        }
        elseif ([int]$candidate.ProcessId -ne $processId) {
            return [pscustomobject]@{
                Verified = $false
                Exited = $false
                HardMismatch = $true
                FailureReason = 'process-id-mismatch'
                Attempts = $attempts
                ExitCode = $null
                Identity = $candidate
            }
        }
        elseif (-not $candidate.Path) {
            $lastObservation = 'executable-path-unavailable'
        }
        elseif (-not (Test-FssPathEqual -Left $candidate.Path -Right $ExpectedPath)) {
            return [pscustomobject]@{
                Verified = $false
                Exited = $false
                HardMismatch = $true
                FailureReason = 'executable-path-mismatch'
                Attempts = $attempts
                ExitCode = $null
                Identity = $candidate
            }
        }
        elseif (-not $candidate.StartedAt) {
            $lastObservation = 'start-time-unavailable'
        }
        else {
            return [pscustomobject]@{
                Verified = $true
                Exited = $false
                HardMismatch = $false
                FailureReason = $null
                Attempts = $attempts
                ExitCode = $null
                Identity = $candidate
            }
        }

        if ([DateTime]::UtcNow -lt $deadline) {
            Start-Sleep -Milliseconds $PollMilliseconds
        }
    } while ([DateTime]::UtcNow -lt $deadline)

    return [pscustomobject]@{
        Verified = $false
        Exited = $false
        HardMismatch = $false
        FailureReason = $lastObservation
        Attempts = $attempts
        ExitCode = $null
        Identity = $null
    }
}

function Get-FssPortListeners {
    param([Parameter(Mandatory = $true)][int]$Port)

    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
        throw 'Get-NetTCPConnection is required to verify CDP listener ownership.'
    }
    return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Test-FssPortAvailable {
    param([Parameter(Mandatory = $true)][int]$Port)
    $activeListeners = @(
        [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    )
    return @($activeListeners | Where-Object { $_.Port -eq $Port }).Count -eq 0
}

function Select-FssRandomPort {
    for ($attempt = 0; $attempt -lt 160; $attempt++) {
        $candidate = Get-Random -Minimum 49152 -Maximum 65535
        if (Test-FssPortAvailable -Port $candidate) {
            return $candidate
        }
    }
    throw 'Unable to find an unused high loopback port.'
}

function Test-FssWebSocketUrl {
    param(
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][ValidateSet('browser','page')][string]$Kind,
        [string]$Identifier
    )

    try {
        $uri = [Uri]$Value
        if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'ws' -or $uri.Host -ne '127.0.0.1' -or
            $uri.Port -ne $Port -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
            return $false
        }
        $pattern = if ($Identifier) {
            '^/devtools/{0}/{1}$' -f [regex]::Escape($Kind), [regex]::Escape($Identifier)
        } else {
            '^/devtools/{0}/[A-Za-z0-9._-]{{1,200}}$' -f [regex]::Escape($Kind)
        }
        return $uri.AbsolutePath -cmatch $pattern
    }
    catch {
        return $false
    }
}

function Test-FssListenerOwnership {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$ExpectedExecutable
    )

    $listeners = @(Get-FssPortListeners -Port $Port)
    if ($listeners.Count -eq 0) { return $false }

    foreach ($listener in $listeners) {
        if ("$($listener.LocalAddress)" -ne '127.0.0.1') { return $false }
        $identity = Get-FssProcessIdentity -ProcessId ([int]$listener.OwningProcess)
        if ($null -eq $identity -or -not $identity.Path -or
            -not (Test-FssPathEqual -Left $identity.Path -Right $ExpectedExecutable)) {
            return $false
        }
    }
    return $true
}

function Get-FssCodexProcessObservation {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][string]$ExpectedExecutable
    )

    $identity = Get-FssProcessIdentity -ProcessId $ProcessId
    if ($null -eq $identity) {
        return [pscustomobject]@{
            State = 'not-detected'
            HardFailure = $false
            Identity = $null
        }
    }
    if (-not $identity.Path -or -not $identity.StartedAt) {
        return [pscustomobject]@{
            State = 'metadata-unavailable'
            HardFailure = $false
            Identity = $identity
        }
    }
    if (-not (Test-FssPathEqual -Left $identity.Path -Right $ExpectedExecutable)) {
        return [pscustomobject]@{
            State = 'path-mismatch'
            HardFailure = $true
            Identity = $identity
        }
    }
    return [pscustomobject]@{
        State = 'ready'
        HardFailure = $false
        Identity = $identity
    }
}

function Get-FssExistingCodexObservation {
    param(
        [Parameter(Mandatory = $true)][string]$ExpectedExecutable,
        [scriptblock]$ProcessProvider
    )

    if ($null -eq $ProcessProvider) {
        $ProcessProvider = { @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue) }
    }
    $processes = @(& $ProcessProvider)
    $matchingCount = 0
    foreach ($process in $processes) {
        $identity = Get-FssProcessIdentity -ProcessId ([int]$process.Id)
        if ($null -ne $identity -and $identity.Path -and
            (Test-FssPathEqual -Left $identity.Path -Right $ExpectedExecutable)) {
            $matchingCount += 1
        }
    }
    return [pscustomobject]@{
        LaunchAllowed = $processes.Count -eq 0
        DetectedCount = $processes.Count
        MatchingExpectedExecutableCount = $matchingCount
        ProcessIds = @($processes | ForEach-Object { [int]$_.Id })
    }
}

function Get-FssProcessLaunchMetadata {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][int]$Port
    )

    $result = [ordered]@{
        queried = $false
        commandLineAvailable = $false
        parentProcessId = $null
        remoteDebuggingAddressPresent = $null
        remoteDebuggingPortPresent = $null
        remoteDebuggingPortMatches = $null
    }
    try {
        $metadata = @(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop)
        if ($metadata.Count -ne 1) { return [pscustomobject]$result }
        $result.queried = $true
        $result.parentProcessId = [int]$metadata[0].ParentProcessId
        $commandLine = "$($metadata[0].CommandLine)"
        if (-not $commandLine) { return [pscustomobject]$result }
        $result.commandLineAvailable = $true
        $result.remoteDebuggingAddressPresent = $commandLine -match '(?i)(?:^|[\s"])--remote-debugging-address=127\.0\.0\.1(?=[\s"]|$)'
        $portMatches = [regex]::Matches($commandLine, '(?i)(?:^|[\s"])--remote-debugging-port=(\d{1,5})(?=[\s"]|$)')
        $result.remoteDebuggingPortPresent = $portMatches.Count -gt 0
        $result.remoteDebuggingPortMatches = @($portMatches | Where-Object { [int]$_.Groups[1].Value -eq $Port }).Count -gt 0
    }
    catch {}
    return [pscustomobject]$result
}

function Get-FssCodexLifecycleObservation {
    param(
        [Parameter(Mandatory = $true)][int]$ActivationProcessId,
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$ExpectedExecutable,
        [scriptblock]$ProcessProvider,
        [scriptblock]$ListenerProvider
    )

    $expectedExecutableName = [System.IO.Path]::GetFileName($ExpectedExecutable)
    if ($null -eq $ProcessProvider) {
        $ProcessProvider = {
            param($executableName)
            $escapedName = "$executableName".Replace("'", "''")
            @(Get-CimInstance -ClassName Win32_Process -Filter "Name = '$escapedName'" -ErrorAction Stop)
        }
    }
    if ($null -eq $ListenerProvider) {
        $ListenerProvider = { param($selectedPort) @(Get-FssPortListeners -Port $selectedPort) }
    }

    $processQuerySucceeded = $false
    $processQueryFailureType = $null
    $rawProcesses = @()
    try {
        $rawProcesses = @(& $ProcessProvider $expectedExecutableName)
        $processQuerySucceeded = $true
    }
    catch {
        $processQueryFailureType = $_.Exception.GetType().Name
    }

    $observedProcesses = @()
    foreach ($process in $rawProcesses) {
        $processIdProperty = $process.PSObject.Properties['ProcessId']
        if ($null -eq $processIdProperty) { $processIdProperty = $process.PSObject.Properties['Id'] }
        if ($null -eq $processIdProperty) { continue }

        $processId = 0
        try { $processId = [int]$processIdProperty.Value } catch { continue }
        if ($processId -le 0) { continue }

        $parentProperty = $process.PSObject.Properties['ParentProcessId']
        $parentProcessId = $null
        if ($null -ne $parentProperty) {
            try { $parentProcessId = [int]$parentProperty.Value } catch {}
        }

        $pathProperty = $process.PSObject.Properties['ExecutablePath']
        if ($null -eq $pathProperty) { $pathProperty = $process.PSObject.Properties['Path'] }
        $processPath = if ($null -ne $pathProperty) { "$($pathProperty.Value)" } else { $null }
        if (-not $processPath) { $processPath = $null }

        $nameProperty = $process.PSObject.Properties['Name']
        if ($null -eq $nameProperty) { $nameProperty = $process.PSObject.Properties['ProcessName'] }
        $executableName = if ($null -ne $nameProperty -and $nameProperty.Value) {
            "$($nameProperty.Value)"
        } elseif ($processPath) {
            [System.IO.Path]::GetFileName($processPath)
        } else {
            $null
        }

        $startedAt = $null
        $creationProperty = $process.PSObject.Properties['CreationDate']
        if ($null -eq $creationProperty) { $creationProperty = $process.PSObject.Properties['StartTime'] }
        if ($null -ne $creationProperty -and $null -ne $creationProperty.Value) {
            try { $startedAt = ([DateTime]$creationProperty.Value).ToUniversalTime().ToString('o') } catch {}
        }

        $commandLineProperty = $process.PSObject.Properties['CommandLine']
        $commandLine = if ($null -ne $commandLineProperty) { "$($commandLineProperty.Value)" } else { $null }
        if (-not $commandLine) { $commandLine = $null }
        $remoteDebuggingAddressPresent = $null
        $remoteDebuggingPortPresent = $null
        $remoteDebuggingPortMatches = $null
        if ($commandLine) {
            $remoteDebuggingAddressPresent = $commandLine -match '(?i)(?:^|[\s"])--remote-debugging-address=127\.0\.0\.1(?=[\s"]|$)'
            $portMatches = [regex]::Matches($commandLine, '(?i)(?:^|[\s"])--remote-debugging-port=(\d{1,5})(?=[\s"]|$)')
            $remoteDebuggingPortPresent = $portMatches.Count -gt 0
            $remoteDebuggingPortMatches = @($portMatches | Where-Object { [int]$_.Groups[1].Value -eq $Port }).Count -gt 0
        }

        $pathMatchesExpected = $null
        if ($processPath) {
            $pathMatchesExpected = Test-FssPathEqual -Left $processPath -Right $ExpectedExecutable
        }

        $observedProcesses += [pscustomobject]@{
            processId = $processId
            parentProcessId = $parentProcessId
            executableName = $executableName
            startedAt = $startedAt
            isActivationProcess = $processId -eq $ActivationProcessId
            pathAvailable = [bool]$processPath
            pathMatchesExpected = $pathMatchesExpected
            commandLineAvailable = [bool]$commandLine
            remoteDebuggingAddressPresent = $remoteDebuggingAddressPresent
            remoteDebuggingPortPresent = $remoteDebuggingPortPresent
            remoteDebuggingPortMatches = $remoteDebuggingPortMatches
            parentIsObservedCodex = $false
        }
    }

    $observedProcesses = @($observedProcesses | Sort-Object processId)
    $observedProcessIds = @($observedProcesses | ForEach-Object { [int]$_.processId })
    foreach ($process in $observedProcesses) {
        $process.parentIsObservedCodex = $null -ne $process.parentProcessId -and
            $observedProcessIds -contains [int]$process.parentProcessId
    }

    $listenerQuerySucceeded = $false
    $listenerQueryFailureType = $null
    $listenerPids = @()
    try {
        $listeners = @(& $ListenerProvider $Port)
        $listenerPids = @($listeners | ForEach-Object {
                $ownerProperty = $_.PSObject.Properties['OwningProcess']
                if ($null -ne $ownerProperty) { [int]$ownerProperty.Value }
            } | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
        $listenerQuerySucceeded = $true
    }
    catch {
        $listenerQueryFailureType = $_.Exception.GetType().Name
    }

    $matchingExpectedPathProcessIds = @($observedProcesses |
        Where-Object { $_.pathMatchesExpected -eq $true } |
        ForEach-Object { [int]$_.processId })
    $portBearingProcessIds = @($observedProcesses |
        Where-Object { $_.remoteDebuggingPortMatches -eq $true } |
        ForEach-Object { [int]$_.processId })

    return [pscustomobject]@{
        processQuerySucceeded = $processQuerySucceeded
        processQueryFailureType = $processQueryFailureType
        listenerQuerySucceeded = $listenerQuerySucceeded
        listenerQueryFailureType = $listenerQueryFailureType
        expectedExecutableName = $expectedExecutableName
        activationProcessId = $ActivationProcessId
        activationProcessPresent = $observedProcessIds -contains $ActivationProcessId
        activationProcessHasSelectedPort = $portBearingProcessIds -contains $ActivationProcessId
        observedProcessIds = $observedProcessIds
        matchingExpectedPathProcessIds = $matchingExpectedPathProcessIds
        portBearingProcessIds = $portBearingProcessIds
        listenerPids = $listenerPids
        processes = $observedProcesses
    }
}

function Get-FssHttpFailureDiagnostic {
    param([Parameter(Mandatory = $true)]$Failure)

    $httpStatus = $null
    $safeErrorCode = $null
    $socketFailure = $false
    $timeoutFailure = $false
    $jsonParseFailure = $false
    $webStatus = $null
    $pending = New-Object System.Collections.Queue
    $pending.Enqueue($Failure)
    $inspected = 0
    while ($pending.Count -gt 0 -and $inspected -lt 32) {
        $current = $pending.Dequeue()
        $inspected += 1
        foreach ($name in @('HttpStatus', 'StatusCode')) {
            $property = $current.PSObject.Properties[$name]
            if ($null -ne $property -and $null -ne $property.Value) {
                try { $httpStatus = [int]$property.Value } catch {}
            }
        }
        $responseProperty = $current.PSObject.Properties['Response']
        if ($null -ne $responseProperty -and $null -ne $responseProperty.Value) {
            $statusProperty = $responseProperty.Value.PSObject.Properties['StatusCode']
            if ($null -ne $statusProperty -and $null -ne $statusProperty.Value) {
                try { $httpStatus = [int]$statusProperty.Value } catch {}
            }
        }
        foreach ($name in @('NativeErrorCode', 'ErrorCode', 'SocketErrorCode')) {
            $property = $current.PSObject.Properties[$name]
            if ($null -eq $property -or $null -eq $property.Value) { continue }
            $candidate = "$($property.Value)"
            if ($candidate -match '^(10054|10060|10061)$') { $safeErrorCode = [int]$candidate }
            elseif ($null -eq $safeErrorCode -and $candidate -match '^(?i:ECONNRESET|ETIMEDOUT|ECONNREFUSED|ConnectionReset|TimedOut|ConnectionRefused)$') { $safeErrorCode = $candidate }
        }
        $statusProperty = $current.PSObject.Properties['Status']
        if ($null -ne $statusProperty -and $null -ne $statusProperty.Value) { $webStatus = "$($statusProperty.Value)" }
        $typeName = $current.GetType().FullName
        if ($typeName -match 'SocketException|WebException|HttpRequestException|IOException') { $socketFailure = $true }
        if ($typeName -match 'TimeoutException|TaskCanceledException|OperationCanceledException') { $timeoutFailure = $true }
        if ($typeName -match 'JsonException|JsonReaderException|JsonSerializationException') { $jsonParseFailure = $true }
        $messageProperty = $current.PSObject.Properties['Message']
        if ($null -ne $messageProperty -and "$($messageProperty.Value)" -match '(?i)(invalid|malformed|unexpected).{0,24}(json|javascript object notation)|(json|javascript object notation).{0,24}(parse|deserializ|invalid|malformed)') {
            $jsonParseFailure = $true
        }
        foreach ($name in @('Exception','InnerException','ErrorRecord','TargetObject')) {
            $property = $current.PSObject.Properties[$name]
            if ($null -ne $property -and $null -ne $property.Value -and -not [object]::ReferenceEquals($property.Value,$current)) {
                $pending.Enqueue($property.Value)
            }
        }
    }

    $failureType = 'unknown'
    if ($null -ne $httpStatus -and ($httpStatus -lt 200 -or $httpStatus -ge 300)) { $failureType = 'http-non-2xx' }
    elseif ($safeErrorCode -in @(10061, 'ECONNREFUSED', 'ConnectionRefused')) { $failureType = 'connection-refused' }
    elseif ($safeErrorCode -in @(10054, 'ECONNRESET', 'ConnectionReset')) { $failureType = 'connection-reset' }
    elseif ($safeErrorCode -in @(10060, 'ETIMEDOUT', 'TimedOut') -or $timeoutFailure -or $webStatus -eq 'Timeout') { $failureType = 'timeout' }
    elseif ($jsonParseFailure) { $failureType = 'malformed-json' }
    elseif ($socketFailure -or $webStatus -in @('ConnectFailure','ConnectionClosed','ReceiveFailure','SendFailure','KeepAliveFailure','PipelineFailure')) { $failureType = 'socket-transport-error' }

    return [pscustomobject]@{ FailureType = $failureType; HttpStatus = $httpStatus; ErrorCode = $safeErrorCode }
}

function Get-FssListenerOwnerRelation {
    param(
        [Nullable[int]]$ListenerOwningPid,
        [Parameter(Mandatory = $true)][int]$ActivationProcessId,
        [object[]]$Processes
    )
    if ($null -eq $ListenerOwningPid) { return 'unknown' }
    if ([int]$ListenerOwningPid -eq $ActivationProcessId) { return 'activation' }
    $byId = @{}
    foreach ($process in @($Processes)) { $byId[[int]$process.processId] = $process }
    $current = [int]$ListenerOwningPid
    for ($depth = 0; $depth -lt 32; $depth += 1) {
        if (-not $byId.ContainsKey($current)) { return 'unknown' }
        $parent = $byId[$current].parentProcessId
        if ($null -eq $parent -or [int]$parent -le 0) { return 'unrelated' }
        if ([int]$parent -eq $ActivationProcessId) { return $(if ($depth -eq 0) { 'child' } else { 'descendant' }) }
        $current = [int]$parent
    }
    return 'unknown'
}

function Get-FssCdpReadinessObservation {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$ExpectedExecutable,
        [scriptblock]$ListenerProvider,
        [scriptblock]$IdentityProvider,
        [scriptblock]$HttpProvider
    )

    if ($null -eq $ListenerProvider) { $ListenerProvider = { param($selectedPort) @(Get-FssPortListeners -Port $selectedPort) } }
    if ($null -eq $IdentityProvider) { $IdentityProvider = { param($processId) Get-FssProcessIdentity -ProcessId $processId } }
    if ($null -eq $HttpProvider) { $HttpProvider = { param($selectedPort) Invoke-RestMethod -Uri "http://127.0.0.1:$selectedPort/json/version" -TimeoutSec 2 -MaximumRedirection 0 -ErrorAction Stop } }

    $listeners = @(& $ListenerProvider $Port)
    if ($listeners.Count -eq 0) {
        return [pscustomobject]@{
            Stage = 'listener-not-seen'
            Ready = $false
            HardFailure = $false
            ListenerSeen = $false
            ListenerPids = @()
            ListenerOwningPid = $null
            ListenerOwnerPathMatchesExpected = $null
            HttpAttempted = $false
            HttpSucceeded = $false
            WebSocketSeen = $false
            BrowserIdentityValid = $false
            HttpFailureType = $null
            HttpStatus = $null
            HttpErrorCode = $null
            Identity = $null
        }
    }

    $listenerPids = @($listeners | ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique)
    if (@($listeners | Where-Object { "$($_.LocalAddress)" -ne '127.0.0.1' }).Count -gt 0) {
        return [pscustomobject]@{
            Stage = 'listener-address-mismatch'
            Ready = $false
            HardFailure = $true
            ListenerSeen = $true
            ListenerPids = $listenerPids
            ListenerOwningPid = if ($listenerPids.Count -eq 1) { $listenerPids[0] } else { $null }
            ListenerOwnerPathMatchesExpected = $null
            HttpAttempted = $false
            HttpSucceeded = $false
            WebSocketSeen = $false
            BrowserIdentityValid = $false
            HttpFailureType = $null
            HttpStatus = $null
            HttpErrorCode = $null
            Identity = $null
        }
    }
    foreach ($listener in $listeners) {
        $listenerIdentity = & $IdentityProvider ([int]$listener.OwningProcess)
        if ($null -eq $listenerIdentity -or -not $listenerIdentity.Path) {
            return [pscustomobject]@{
                Stage = 'listener-owner-unavailable'
                Ready = $false
                HardFailure = $false
                ListenerSeen = $true
                ListenerPids = $listenerPids
                ListenerOwningPid = if ($listenerPids.Count -eq 1) { $listenerPids[0] } else { $null }
                ListenerOwnerPathMatchesExpected = $null
                HttpAttempted = $false
                HttpSucceeded = $false
                WebSocketSeen = $false
                BrowserIdentityValid = $false
                HttpFailureType = $null
                HttpStatus = $null
                HttpErrorCode = $null
                Identity = $null
            }
        }
        if (-not (Test-FssPathEqual -Left $listenerIdentity.Path -Right $ExpectedExecutable)) {
            return [pscustomobject]@{
                Stage = 'listener-owner-path-mismatch'
                Ready = $false
                HardFailure = $true
                ListenerSeen = $true
                ListenerPids = $listenerPids
                ListenerOwningPid = if ($listenerPids.Count -eq 1) { $listenerPids[0] } else { $null }
                ListenerOwnerPathMatchesExpected = $false
                HttpAttempted = $false
                HttpSucceeded = $false
                WebSocketSeen = $false
                BrowserIdentityValid = $false
                HttpFailureType = $null
                HttpStatus = $null
                HttpErrorCode = $null
                Identity = $null
            }
        }
    }

    try {
        $version = & $HttpProvider $Port
    }
    catch {
        $httpFailure = Get-FssHttpFailureDiagnostic -Failure $_
        return [pscustomobject]@{
            Stage = 'http-not-ready'
            Ready = $false
            HardFailure = $false
            ListenerSeen = $true
            ListenerPids = $listenerPids
            ListenerOwningPid = if ($listenerPids.Count -eq 1) { $listenerPids[0] } else { $null }
            ListenerOwnerPathMatchesExpected = $true
            HttpAttempted = $true
            HttpSucceeded = $false
            WebSocketSeen = $false
            BrowserIdentityValid = $false
            HttpFailureType = $httpFailure.FailureType
            HttpStatus = $httpFailure.HttpStatus
            HttpErrorCode = $httpFailure.ErrorCode
            Identity = $null
        }
    }

    $malformedJson = $false
    if ($version -is [string]) {
        try { $null = $version | ConvertFrom-Json -ErrorAction Stop } catch { $malformedJson = $true }
    }
    if ($malformedJson) {
        return [pscustomobject]@{
            Stage = 'browser-websocket-not-seen'; Ready = $false; HardFailure = $false
            ListenerSeen = $true; ListenerPids = $listenerPids
            ListenerOwningPid = if ($listenerPids.Count -eq 1) { $listenerPids[0] } else { $null }
            ListenerOwnerPathMatchesExpected = $true; HttpAttempted = $true; HttpSucceeded = $true
            WebSocketSeen = $false; BrowserIdentityValid = $false
            HttpFailureType = 'malformed-json'; HttpStatus = $null; HttpErrorCode = $null; Identity = $null
        }
    }

    $webSocketProperty = if ($null -ne $version) { $version.PSObject.Properties['webSocketDebuggerUrl'] } else { $null }
    $webSocketUrl = if ($null -ne $webSocketProperty) { "$($webSocketProperty.Value)" } else { '' }
    if (-not $webSocketUrl) {
        return [pscustomobject]@{
            Stage = 'browser-websocket-not-seen'
            Ready = $false
            HardFailure = $false
            ListenerSeen = $true
            ListenerPids = $listenerPids
            ListenerOwningPid = if ($listenerPids.Count -eq 1) { $listenerPids[0] } else { $null }
            ListenerOwnerPathMatchesExpected = $true
            HttpAttempted = $true
            HttpSucceeded = $true
            WebSocketSeen = $false
            BrowserIdentityValid = $false
            HttpFailureType = 'missing-browser-websocket'
            HttpStatus = $null
            HttpErrorCode = $null
            Identity = $null
        }
    }
    if (-not (Test-FssWebSocketUrl -Value $webSocketUrl -Port $Port -Kind browser)) {
        return [pscustomobject]@{
            Stage = 'browser-websocket-invalid'
            Ready = $false
            HardFailure = $false
            ListenerSeen = $true
            ListenerPids = $listenerPids
            ListenerOwningPid = if ($listenerPids.Count -eq 1) { $listenerPids[0] } else { $null }
            ListenerOwnerPathMatchesExpected = $true
            HttpAttempted = $true
            HttpSucceeded = $true
            WebSocketSeen = $true
            BrowserIdentityValid = $false
            HttpFailureType = 'invalid-browser-websocket'
            HttpStatus = $null
            HttpErrorCode = $null
            Identity = $null
        }
    }
    $browserId = ([Uri]$webSocketUrl).AbsolutePath.Split('/')[-1]
    if ($browserId -notmatch '^[A-Za-z0-9._-]{1,200}$') {
        return [pscustomobject]@{
            Stage = 'browser-identity-invalid'
            Ready = $false
            HardFailure = $false
            ListenerSeen = $true
            ListenerPids = $listenerPids
            ListenerOwningPid = if ($listenerPids.Count -eq 1) { $listenerPids[0] } else { $null }
            ListenerOwnerPathMatchesExpected = $true
            HttpAttempted = $true
            HttpSucceeded = $true
            WebSocketSeen = $true
            BrowserIdentityValid = $false
            HttpFailureType = 'invalid-browser-identity'
            HttpStatus = $null
            HttpErrorCode = $null
            Identity = $null
        }
    }
    if (-not (Test-FssListenerOwnership -Port $Port -ExpectedExecutable $ExpectedExecutable)) {
        return [pscustomobject]@{
            Stage = 'listener-ownership-changed'
            Ready = $false
            HardFailure = $true
            ListenerSeen = $true
            ListenerPids = $listenerPids
            ListenerOwningPid = if ($listenerPids.Count -eq 1) { $listenerPids[0] } else { $null }
            ListenerOwnerPathMatchesExpected = $true
            HttpAttempted = $true
            HttpSucceeded = $true
            WebSocketSeen = $true
            BrowserIdentityValid = $false
            HttpFailureType = 'listener-ownership-changed'
            HttpStatus = $null
            HttpErrorCode = $null
            Identity = $null
        }
    }
    return [pscustomobject]@{
        Stage = 'ready'
        Ready = $true
        HardFailure = $false
        ListenerSeen = $true
        ListenerPids = $listenerPids
        ListenerOwningPid = if ($listenerPids.Count -eq 1) { $listenerPids[0] } else { $null }
        ListenerOwnerPathMatchesExpected = $true
        HttpAttempted = $true
        HttpSucceeded = $true
        WebSocketSeen = $true
        BrowserIdentityValid = $true
        HttpFailureType = $null
        HttpStatus = $null
        HttpErrorCode = $null
        Identity = [pscustomobject]@{
            BrowserId = $browserId
            BrowserWebSocketDebuggerUrl = $webSocketUrl
            Browser = "$($version.Browser)"
        }
    }
}

function Wait-FssCodexCdpReadiness {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$ExpectedExecutable,
        [ValidateRange(100, 30000)][int]$ProcessTimeoutMilliseconds = 5000,
        [ValidateRange(100, 120000)][int]$CdpTimeoutMilliseconds = 45000,
        [ValidateRange(10, 2000)][int]$ProcessPollMilliseconds = 100,
        [ValidateRange(10, 2000)][int]$CdpPollMilliseconds = 350,
        [scriptblock]$ProcessObservationProvider,
        [scriptblock]$CdpObservationProvider,
        [scriptblock]$LifecycleObservationProvider,
        [scriptblock]$UtcNowProvider,
        [scriptblock]$SleepAction
    )

    if ($null -eq $ProcessObservationProvider) {
        $ProcessObservationProvider = { param($id, $expected) Get-FssCodexProcessObservation -ProcessId $id -ExpectedExecutable $expected }
    }
    if ($null -eq $CdpObservationProvider) {
        $CdpObservationProvider = { param($selectedPort, $expected) Get-FssCdpReadinessObservation -Port $selectedPort -ExpectedExecutable $expected }
    }
    if ($null -eq $LifecycleObservationProvider) {
        $LifecycleObservationProvider = {
            param($activationId, $selectedPort, $expected)
            Get-FssCodexLifecycleObservation `
                -ActivationProcessId $activationId `
                -Port $selectedPort `
                -ExpectedExecutable $expected
        }
    }
    if ($null -eq $UtcNowProvider) { $UtcNowProvider = { [DateTime]::UtcNow } }
    if ($null -eq $SleepAction) { $SleepAction = { param($milliseconds) Start-Sleep -Milliseconds $milliseconds } }

    $startedAt = & $UtcNowProvider
    $processDeadline = $startedAt.AddMilliseconds($ProcessTimeoutMilliseconds)
    $transitions = New-Object System.Collections.Generic.List[object]
    $transitionState = @{ Last = $null }
    $processAttempts = 0
    $readinessAttempts = 0
    $processIdentity = $null
    $processDetectedAt = $null
    $listenerFirstSeenAt = $null
    $httpFirstSuccessAt = $null
    $httpAttemptCount = 0
    $firstHttpAttemptAt = $null
    $lastHttpAttemptAt = $null
    $lastHttpFailureType = $null
    $lastHttpStatus = $null
    $lastHttpErrorCode = $null
    $webSocketFirstSeenAt = $null
    $browserIdentityValidatedAt = $null
    $lastObservation = $null
    $processWasSeen = $false
    $lifecycleState = @{
        SampleCount = 0
        QueryFailureCount = 0
        NextSampleAt = $null
        PreviousProcessIds = @()
        LastFingerprint = $null
        LastObservedAt = $null
        LastObservation = $null
        Transitions = New-Object System.Collections.Generic.List[object]
    }

    $captureLifecycle = {
        param([DateTime]$At, [bool]$Force)
        if (-not $Force -and $null -ne $lifecycleState.NextSampleAt -and $At -lt $lifecycleState.NextSampleAt) {
            return
        }
        $lifecycleState.NextSampleAt = $At.AddSeconds(1)
        $lifecycleState.SampleCount += 1

        $observation = $null
        try {
            $observation = & $LifecycleObservationProvider $ProcessId $Port $ExpectedExecutable
        }
        catch {
            $observation = [pscustomobject]@{
                processQuerySucceeded = $false
                processQueryFailureType = $_.Exception.GetType().Name
                listenerQuerySucceeded = $false
                listenerQueryFailureType = $null
                activationProcessId = $ProcessId
                activationProcessPresent = $false
                activationProcessHasSelectedPort = $false
                observedProcessIds = @()
                matchingExpectedPathProcessIds = @()
                portBearingProcessIds = @()
                listenerPids = @()
                processes = @()
            }
        }
        if ($null -eq $observation) {
            $observation = [pscustomobject]@{
                processQuerySucceeded = $false
                processQueryFailureType = 'NullObservation'
                listenerQuerySucceeded = $false
                listenerQueryFailureType = $null
                activationProcessId = $ProcessId
                activationProcessPresent = $false
                activationProcessHasSelectedPort = $false
                observedProcessIds = @()
                matchingExpectedPathProcessIds = @()
                portBearingProcessIds = @()
                listenerPids = @()
                processes = @()
            }
        }

        if (-not [bool]$observation.processQuerySucceeded -or -not [bool]$observation.listenerQuerySucceeded) {
            $lifecycleState.QueryFailureCount += 1
        }

        $currentProcessIds = @($observation.observedProcessIds | ForEach-Object { [int]$_ } | Sort-Object -Unique)
        $addedProcessIds = @()
        $removedProcessIds = @()
        if ([bool]$observation.processQuerySucceeded) {
            $addedProcessIds = @($currentProcessIds | Where-Object { $_ -notin $lifecycleState.PreviousProcessIds })
            $removedProcessIds = @($lifecycleState.PreviousProcessIds | Where-Object { $_ -notin $currentProcessIds })
        }

        $fingerprintValue = [ordered]@{
            processQuerySucceeded = [bool]$observation.processQuerySucceeded
            processQueryFailureType = $observation.processQueryFailureType
            listenerQuerySucceeded = [bool]$observation.listenerQuerySucceeded
            listenerQueryFailureType = $observation.listenerQueryFailureType
            activationProcessPresent = [bool]$observation.activationProcessPresent
            activationProcessHasSelectedPort = [bool]$observation.activationProcessHasSelectedPort
            observedProcessIds = $currentProcessIds
            matchingExpectedPathProcessIds = @($observation.matchingExpectedPathProcessIds)
            portBearingProcessIds = @($observation.portBearingProcessIds)
            listenerPids = @($observation.listenerPids)
            processes = @($observation.processes)
        }
        $fingerprint = $fingerprintValue | ConvertTo-Json -Depth 8 -Compress
        if ($fingerprint -ne $lifecycleState.LastFingerprint) {
            $null = $lifecycleState.Transitions.Add([pscustomobject]@{
                    At = $At.ToString('o')
                    SampleNumber = $lifecycleState.SampleCount
                    AddedProcessIds = $addedProcessIds
                    RemovedProcessIds = $removedProcessIds
                    Observation = $observation
                })
            $lifecycleState.LastFingerprint = $fingerprint
        }
        if ([bool]$observation.processQuerySucceeded) {
            $lifecycleState.PreviousProcessIds = $currentProcessIds
        }
        $lifecycleState.LastObservedAt = $At.ToString('o')
        $lifecycleState.LastObservation = $observation
    }

    $addTransition = {
        param([string]$Stage, [DateTime]$At)
        if ($Stage -ne $transitionState.Last) {
            $transitions.Add([pscustomobject]@{ Stage = $Stage; At = $At.ToString('o') })
            $transitionState.Last = $Stage
        }
    }
    $finish = {
        param([bool]$Succeeded, [string]$FailureStage, [string]$FailureReason, $CdpIdentity, [DateTime]$FinishedAt)
        & $captureLifecycle $FinishedAt $true
        $listenerOwningPid = if ($null -ne $lastObservation) { $lastObservation.ListenerOwningPid } else { $null }
        $listenerOwnerRelation = Get-FssListenerOwnerRelation `
            -ListenerOwningPid $listenerOwningPid `
            -ActivationProcessId $ProcessId `
            -Processes $(if ($null -ne $lifecycleState.LastObservation) { @($lifecycleState.LastObservation.processes) } else { @() })
        [pscustomobject]@{
            Succeeded = $Succeeded
            FailureStage = $FailureStage
            FailureReason = $FailureReason
            ProcessIdentity = $processIdentity
            PathComparison = Get-FssPathComparisonDiagnostic -ExpectedPath $ExpectedExecutable -ActualPath $(if ($null -ne $processObservation.Identity) { $processObservation.Identity.Path } else { $null })
            CdpIdentity = $CdpIdentity
            ProcessAttempts = $processAttempts
            ReadinessAttempts = $readinessAttempts
            ProcessDetectedAt = if ($null -ne $processDetectedAt) { $processDetectedAt.ToString('o') } else { $null }
            ListenerFirstSeenAt = if ($null -ne $listenerFirstSeenAt) { $listenerFirstSeenAt.ToString('o') } else { $null }
            HttpFirstSuccessAt = if ($null -ne $httpFirstSuccessAt) { $httpFirstSuccessAt.ToString('o') } else { $null }
            BrowserWebSocketFirstSeenAt = if ($null -ne $webSocketFirstSeenAt) { $webSocketFirstSeenAt.ToString('o') } else { $null }
            BrowserIdentityValidatedAt = if ($null -ne $browserIdentityValidatedAt) { $browserIdentityValidatedAt.ToString('o') } else { $null }
            LastObservedStage = if ($null -ne $lastObservation) { "$($lastObservation.Stage)" } else { $null }
            ListenerPids = if ($null -ne $lastObservation -and $null -ne $lastObservation.ListenerPids) { @($lastObservation.ListenerPids) } else { @() }
            HttpFailureType = if ($null -ne $lastObservation) { $lastObservation.HttpFailureType } else { $null }
            ListenerOwningPid = $listenerOwningPid
            ListenerOwnerIsActivationPid = if ($null -ne $listenerOwningPid) { [int]$listenerOwningPid -eq $ProcessId } else { $null }
            ListenerOwnerPathMatchesExpected = if ($null -ne $lastObservation) { $lastObservation.ListenerOwnerPathMatchesExpected } else { $null }
            ListenerOwnerRelation = $listenerOwnerRelation
            HttpAttemptCount = $httpAttemptCount
            LastHttpFailureType = $lastHttpFailureType
            LastHttpStatus = $lastHttpStatus
            LastHttpErrorCode = $lastHttpErrorCode
            FirstHttpAttemptAt = if ($null -ne $firstHttpAttemptAt) { $firstHttpAttemptAt.ToString('o') } else { $null }
            LastHttpAttemptAt = if ($null -ne $lastHttpAttemptAt) { $lastHttpAttemptAt.ToString('o') } else { $null }
            HttpReadyAt = if ($null -ne $httpFirstSuccessAt) { $httpFirstSuccessAt.ToString('o') } else { $null }
            StartedAt = $startedAt.ToString('o')
            FinishedAt = $FinishedAt.ToString('o')
            TotalDurationMilliseconds = [math]::Round(($FinishedAt - $startedAt).TotalMilliseconds, 3)
            ProcessDetectionDurationMilliseconds = if ($null -ne $processDetectedAt) { [math]::Round(($processDetectedAt - $startedAt).TotalMilliseconds, 3) } else { $null }
            CdpReadinessDurationMilliseconds = if ($null -ne $processDetectedAt) { [math]::Round(($FinishedAt - $processDetectedAt).TotalMilliseconds, 3) } else { $null }
            ListenerSeenAfterProcessMilliseconds = if ($null -ne $listenerFirstSeenAt -and $null -ne $processDetectedAt) { [math]::Round(($listenerFirstSeenAt - $processDetectedAt).TotalMilliseconds, 3) } else { $null }
            HttpReadyAfterProcessMilliseconds = if ($null -ne $httpFirstSuccessAt -and $null -ne $processDetectedAt) { [math]::Round(($httpFirstSuccessAt - $processDetectedAt).TotalMilliseconds, 3) } else { $null }
            BrowserIdentityAfterProcessMilliseconds = if ($null -ne $browserIdentityValidatedAt -and $null -ne $processDetectedAt) { [math]::Round(($browserIdentityValidatedAt - $processDetectedAt).TotalMilliseconds, 3) } else { $null }
            Transitions = $transitions.ToArray()
            LifecycleSampleCount = $lifecycleState.SampleCount
            LifecycleQueryFailureCount = $lifecycleState.QueryFailureCount
            LifecycleLastObservedAt = $lifecycleState.LastObservedAt
            LifecycleLastObservation = $lifecycleState.LastObservation
            LifecycleTransitions = $lifecycleState.Transitions.ToArray()
        }
    }

    while ($true) {
        $processAttempts += 1
        $processObservation = & $ProcessObservationProvider $ProcessId $ExpectedExecutable
        $now = & $UtcNowProvider
        & $captureLifecycle $now $false
        & $addTransition "process-$($processObservation.State)" $now
        if ($processObservation.State -eq 'ready') {
            $processIdentity = $processObservation.Identity
            $processDetectedAt = $now
            $processWasSeen = $true
            break
        }
        if ([bool]$processObservation.HardFailure) {
            return & $finish $false 'codex-process-identity' "$($processObservation.State)" $null $now
        }
        if ($now -ge $processDeadline) {
            return & $finish $false 'codex-process-detection' "$($processObservation.State)" $null $now
        }
        & $SleepAction $ProcessPollMilliseconds
    }

    $cdpStartedAt = & $UtcNowProvider
    $cdpDeadline = $cdpStartedAt.AddMilliseconds($CdpTimeoutMilliseconds)
    while ($true) {
        $processObservation = & $ProcessObservationProvider $ProcessId $ExpectedExecutable
        $now = & $UtcNowProvider
        & $captureLifecycle $now $false
        if ($processObservation.State -ne 'ready') {
            $failureStage = if ($processWasSeen -and $processObservation.State -eq 'not-detected') { 'codex-process-exited' } else { 'codex-process-identity' }
            return & $finish $false $failureStage "$($processObservation.State)" $null $now
        }

        $readinessAttempts += 1
        $httpAttemptStartedAt = $now
        $lastObservation = & $CdpObservationProvider $Port $ExpectedExecutable
        $now = & $UtcNowProvider
        & $addTransition "cdp-$($lastObservation.Stage)" $now
        if ([bool]$lastObservation.ListenerSeen -and $null -eq $listenerFirstSeenAt) { $listenerFirstSeenAt = $now }
        if ([bool]$lastObservation.HttpAttempted) {
            $httpAttemptCount += 1
            if ($null -eq $firstHttpAttemptAt) { $firstHttpAttemptAt = $httpAttemptStartedAt }
            $lastHttpAttemptAt = $now
            if ($null -ne $lastObservation.HttpFailureType) { $lastHttpFailureType = "$($lastObservation.HttpFailureType)" }
            if ($null -ne $lastObservation.HttpStatus) { $lastHttpStatus = $lastObservation.HttpStatus }
            if ($null -ne $lastObservation.HttpErrorCode) { $lastHttpErrorCode = $lastObservation.HttpErrorCode }
        }
        if ([bool]$lastObservation.HttpSucceeded -and $null -eq $httpFirstSuccessAt) { $httpFirstSuccessAt = $now }
        if ([bool]$lastObservation.WebSocketSeen -and $null -eq $webSocketFirstSeenAt) { $webSocketFirstSeenAt = $now }
        if ([bool]$lastObservation.BrowserIdentityValid -and $null -eq $browserIdentityValidatedAt) { $browserIdentityValidatedAt = $now }
        if ([bool]$lastObservation.Ready) {
            return & $finish $true $null $null $lastObservation.Identity $now
        }
        if ([bool]$lastObservation.HardFailure) {
            return & $finish $false 'cdp-listener-identity' "$($lastObservation.Stage)" $null $now
        }
        if ($now -ge $cdpDeadline) {
            $timeoutStage = switch -Regex ("$($lastObservation.Stage)") {
                '^listener-' { 'cdp-listener-readiness'; break }
                '^http-' { 'cdp-http-readiness'; break }
                '^(browser-websocket|browser-identity)' { 'cdp-browser-endpoint-validation'; break }
                default { 'cdp-readiness'; break }
            }
            return & $finish $false $timeoutStage "$($lastObservation.Stage)" $null $now
        }
        & $SleepAction $CdpPollMilliseconds
    }
}

function Get-FssCdpIdentity {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$ExpectedExecutable
    )

    $observation = Get-FssCdpReadinessObservation -Port $Port -ExpectedExecutable $ExpectedExecutable
    if (-not $observation.Ready) { return $null }
    return $observation.Identity
}

function Stop-FssOwnedProcess {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][string]$ExpectedPath,
        [Parameter(Mandatory = $true)][string]$ExpectedStartedAt,
        [int]$WaitSeconds = 5
    )

    $identity = Get-FssProcessIdentity -ProcessId $ProcessId
    if ($null -eq $identity) { return $true }
    if (-not $identity.Path -or -not (Test-FssPathEqual -Left $identity.Path -Right $ExpectedPath) -or
        "$($identity.StartedAt)" -ne $ExpectedStartedAt) {
        throw "Refused to stop PID $ProcessId because its identity no longer matches the recorded process."
    }

    Stop-Process -Id $ProcessId -ErrorAction Stop
    $deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
    while ((Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 100
    }
    return -not [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function ConvertTo-FssNativeArgument {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value)
    if ($Value -notmatch '[\s"]') { return $Value }
    return '"{0}"' -f ($Value.Replace('"', '\"'))
}
