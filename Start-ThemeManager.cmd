@echo off
setlocal
set "FSS_GUI_DIR=%~dp0gui"
if not exist "%FSS_GUI_DIR%\package.json" (
  echo Theme Manager files were not found next to this launcher.
  exit /b 1
)
pushd "%FSS_GUI_DIR%" || exit /b 1
call npm start
set "FSS_EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %FSS_EXIT_CODE%
