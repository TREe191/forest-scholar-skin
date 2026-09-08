import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(testDirectory);

test("PowerShell 5.1 CDP readiness state machine passes offline scenarios", { skip: process.platform !== "win32" }, () => {
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR;
  assert.ok(windowsRoot, "Windows system root is unavailable.");
  const powerShell = path.win32.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const result = spawnSync(powerShell, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(testDirectory, "cdp-readiness.test.ps1"),
  ], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /RESULT passed=13 failed=0/);
});
