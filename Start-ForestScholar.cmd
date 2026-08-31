@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-ForestScholarSkin.ps1" -Mode Auto
if errorlevel 1 pause
