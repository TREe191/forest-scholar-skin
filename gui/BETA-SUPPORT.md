# Beta / internal test

`npm start` is development; `npm run start:beta` previews Beta. `npm run package:beta` / `npm run make:beta` build Beta. Default package/make remain production. No source tree duplication.

Forge packageAfterCopy writes src/main/build-mode.json into the staging directory. Packaged main reads this stamp and accepts only beta/production, never runtime environment escalation to development. Unpackaged runs accept THEME_MANAGER_MODE. Missing/invalid packaged stamp fails closed.

Beta and production hide development-origin themes, Rescan and DevTools. Beta (also development) offers Diagnostics / Support in the status bar. Production denies export IPC, even if its hidden control is manually invoked. Existing history capture continues unchanged in all modes.

Export automatically selects only the most recent timestamped history directory (no arbitrary session/path input from renderer). Main reads only session.json, launcher.log, injector.log, injector-error.log, ready.json and injection-state.json, with per-file size limits and link rejection. It never copies them raw. A ZIP containing diagnostics.json holds only allowlisted numeric/boolean evidence, stage/event enums and timestamps. Full paths are reduced to availability/equality evidence and recognizable Codex package version/architecture; commands, theme names, free-text errors, URLs and arbitrary fields are excluded. Missing files and omitted records are explicitly marked. An in-progress session is a best-effort snapshot, not a claim of completion.

The standard save dialog chooses the ZIP destination. The filename includes export timestamp and GUI version. Cancel writes nothing. Export stages a new temporary file, then renames it; failures clean the temporary file and never change input logs. Exports inside history are rejected. ZIP uses STORE format (no extra runtime/npm/PowerShell dependency). No network upload is performed.

No Codex DOM, account/storage/cookies, chat, wallpaper, unrelated user files or network bodies are collected. Sanitization deliberately omits unfamiliar error text rather than risk leakage; some cases may require a subsequent targeted diagnostic change.

This does not resolve the existing packaging resource-closure blockers. No standalone Beta distribution is claimed ready until that separate work and clean-machine testing are complete.
