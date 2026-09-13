# Build / runtime modes

Double-click `Start-ThemeManager.cmd` in the project root for development (calls npm start). `Start-ThemeManager-Production.cmd` previews production locally (calls npm run start:production). Both resolve the same gui directory relative to the launcher and propagate its exit code; neither builds a package nor duplicates the project.

One source tree. `npm start` explicitly selects development. `npm run start:production` previews production restrictions without packaging. `npm run package` and `npm run make` explicitly pass production to Forge. The shell-free Node wrapper sets THEME_MANAGER_MODE and a validated current Git commit (or `unavailable`) for its child only.

Runtime mode is resolved in main: packaged applications read `src/main/build-mode.json`, containing the build-time beta/production mode plus full and short Git commit identity, and ignore environment overrides. Unpackaged apps accept THEME_MANAGER_MODE (development/beta/production), default development, and use only the commit value supplied by the build wrapper. The running Electron app never reads `.git`; missing or invalid commit metadata becomes `unavailable`. No user/theme setting stores this value. See BETA-SUPPORT.md for Beta commands and export privacy rules.

Production excludes management.origin=development from the catalog and preview lookup. It hides manual Rescan, disables Electron DevTools, rejects developer Rescan IPC and operations on hidden packages. Normal automatic scans after CRUD continue. Builtin/user packages remain available. There is no separate diagnostics panel today; future developer controls should use the same runtime capability and main-process IPC guard.

If an existing configuration points to a hidden theme, it is not rewritten silently. Select and Apply an available theme before Launch. Restore remains available. This is a GUI availability check, not a change to the launcher/CDP workflow.

About and Diagnostics / Support show app version, build mode and short commit. The low-weight status-bar identity shows mode plus short commit. Diagnostics exports full and short commit fields. Author TREe191 and the repository URL remain plain selectable text with no external navigation permission. No wallpaper watermark.

This is mode separation and packaging preparation, not a verified standalone distribution. Existing packaged paths still require resources/skin-core and resource packaging/installation validation. No installer or distributable is produced by this change; core deployment and writable installation location remain future packaging work.
