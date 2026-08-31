@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Restore-ForestScholarSkin.ps1"
if errorlevel 1 pause
