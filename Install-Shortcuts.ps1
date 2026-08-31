[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = $PSScriptRoot
$desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
if (-not $desktop -or -not (Test-Path -LiteralPath $desktop -PathType Container)) {
    throw 'Windows Desktop folder could not be resolved.'
}

$definitions = @(
    [pscustomobject]@{
        Name = 'Forest Scholar'
        Launcher = 'Start-ForestScholar.cmd'
        Description = 'Start Codex with Forest Scholar and follow its current appearance'
    },
    [pscustomobject]@{
        Name = 'Restore Forest Scholar'
        Launcher = 'Restore-ForestScholarSkin.cmd'
        Description = 'Restore stock Codex without Forest Scholar Skin or CDP'
    }
)

$shell = New-Object -ComObject WScript.Shell
foreach ($definition in $definitions) {
    $target = Join-Path $projectRoot $definition.Launcher
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
        throw "Required launcher is missing: $target"
    }

    $shortcutPath = Join-Path $desktop ($definition.Name + '.lnk')
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $target
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.Description = $definition.Description
    $shortcut.WindowStyle = 1
    $shortcut.Save()
    Write-Host "Created: $shortcutPath"
}

Write-Host 'Forest Scholar desktop shortcuts installed. No administrator privileges were used.'
