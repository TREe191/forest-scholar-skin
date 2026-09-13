@echo off
setlocal
rem Local production-mode preview; uses the same GUI source, not a packaged build.
set "FSS_GUI_DIR=%~dp0gui"
if not exist "%FSS_GUI_DIR%\package.json" (
  echo Theme Manager files were not found next to this launcher.
  exit /b 1
)
pushd "%FSS_GUI_DIR%" || exit /b 1
call npm run start:production
set "FSS_EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %FSS_EXIT_CODE%
