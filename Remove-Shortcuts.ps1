[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
if (-not $desktop -or -not (Test-Path -LiteralPath $desktop -PathType Container)) {
    throw 'Windows Desktop folder could not be resolved.'
}

$shortcutNames = @(
    'Forest Scholar.lnk',
    'Restore Forest Scholar.lnk',
    'Forest Scholar Light.lnk',
    'Forest Scholar Dark.lnk'
)

foreach ($shortcutName in $shortcutNames) {
    $shortcutPath = Join-Path $desktop $shortcutName
    if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
        Remove-Item -LiteralPath $shortcutPath -Force
        Write-Host "Removed: $shortcutPath"
    }
}

Write-Host 'Forest Scholar desktop shortcuts removed.'
