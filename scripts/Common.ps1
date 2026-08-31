Set-StrictMode -Version Latest

$script:FssSchemaVersion = 1

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
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $command) {
        throw 'Node.js was not found in PATH. Forest Scholar Skin did not download or install anything.'
    }

    $versionText = (& $command.Source --version 2>$null).Trim()
    $match = [regex]::Match($versionText, '^v(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)')
    if (-not $match.Success) {
        throw "Unable to parse Node.js version: $versionText"
    }

    $major = [int]$match.Groups['major'].Value
    if ($major -lt 22) {
        throw "Node.js 22 or newer is required. Found $versionText. No runtime was downloaded or changed."
    }

    return [pscustomobject]@{
        Path = $command.Source
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

    $runtimeDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime'
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

function Get-FssCdpIdentity {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$ExpectedExecutable
    )

    if (-not (Test-FssListenerOwnership -Port $Port -ExpectedExecutable $ExpectedExecutable)) {
        return $null
    }

    try {
        $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 -MaximumRedirection 0 -ErrorAction Stop
        $webSocketUrl = "$($version.webSocketDebuggerUrl)"
        if (-not (Test-FssWebSocketUrl -Value $webSocketUrl -Port $Port -Kind browser)) {
            return $null
        }
        $browserId = ([Uri]$webSocketUrl).AbsolutePath.Split('/')[-1]
        if ($browserId -notmatch '^[A-Za-z0-9._-]{1,200}$') { return $null }
        if (-not (Test-FssListenerOwnership -Port $Port -ExpectedExecutable $ExpectedExecutable)) {
            return $null
        }
        return [pscustomobject]@{
            BrowserId = $browserId
            BrowserWebSocketDebuggerUrl = $webSocketUrl
            Browser = "$($version.Browser)"
        }
    }
    catch {
        return $null
    }
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
