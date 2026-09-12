$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\Common.ps1')
$base = 'C:\Program Files\WindowsApps\OpenAI.Codex_1_x64\app\ChatGPT.exe'
$cases = @(
    @{Actual=$base; Reason=$null},
    @{Actual=$base.ToLowerInvariant(); Reason=$null},
    @{Actual='C:/Program Files/WindowsApps/OpenAI.Codex_1_x64/app/../app/ChatGPT.exe'; Reason=$null},
    @{Actual='C:\Program Files\WindowsApps\OpenAI.Codex_2_x64\app\ChatGPT.exe'; Reason='windowsapps-package-directory-different'},
    @{Actual='C:\Program Files\WindowsApps\OpenAI.Codex_1_x64\app\Other.exe'; Reason='executable-name-different'},
    @{Actual=$null; Reason='actual-path-unavailable'},
    @{Actual='C:\Other\ChatGPT.exe'; Reason='normalized-path-different'}
)
foreach($case in $cases) {
    $d = Get-FssPathComparisonDiagnostic -ExpectedPath $base -ActualPath $case.Actual
    if ($d.mismatchReason -ne $case.Reason) {throw "Unexpected diagnostic: $($d | ConvertTo-Json -Compress)"}
    if($case.Actual) {
        $equal = Test-FssPathEqual -Left $case.Actual -Right $base
        if($equal -ne ($null -eq $d.mismatchReason)){throw 'Diagnostic and unchanged safety comparator disagree'}
    }
}
foreach($file in @('Common.ps1','Start-ForestScholarSkin.ps1')) {
    $tokens=$null; $errors=$null
    $null=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Split-Path -Parent $PSScriptRoot) "scripts\$file"),[ref]$tokens,[ref]$errors)
    if(@($errors).Count){throw "Syntax errors: $file"}
}
Write-Output 'RESULT passed=7 failed=0'
