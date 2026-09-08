import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { CodexActions, resolveWindowsPowerShell } from "../src/main/services/codex-actions.mjs";

function makeActions(calls, result = { exitCode: 0, signal: null, stdout: "ok", stderr: "" }) {
  const projectRoot = path.resolve("C:/portable path/主题 skin");
  return new CodexActions({
    projectRoot,
    startScript: path.join(projectRoot, "scripts", "Start-ForestScholarSkin.ps1"),
    restoreScript: path.join(projectRoot, "scripts", "Restore-ForestScholarSkin.ps1"),
    environment: { SystemRoot: "C:\\Windows" },
    executor: async (...args) => { calls.push(args); return result; },
  });
}

test("resolves PowerShell from SystemRoot without PATH lookup", () => {
  assert.equal(
    resolveWindowsPowerShell({ SystemRoot: "C:\\Windows" }),
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
});

test("Launch uses the fixed existing script and Auto mode", async () => {
  const calls = [];
  await makeActions(calls).launch();
  assert.equal(calls.length, 1);
  const [executable, args, options] = calls[0];
  assert.match(executable, /WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.equal(args.includes("-File"), true);
  assert.deepEqual(args.slice(-2), ["-Mode", "Auto"]);
  assert.match(args[args.indexOf("-File") + 1], /Start-ForestScholarSkin\.ps1$/);
  assert.equal(options.shell, false);
  assert.equal(options.windowsHide, true);
});

test("Restore uses only the fixed restore script", async () => {
  const calls = [];
  await makeActions(calls).restore();
  const [, args, options] = calls[0];
  assert.match(args.at(-1), /Restore-ForestScholarSkin\.ps1$/);
  assert.equal(args.includes("-Mode"), false);
  assert.equal(options.shell, false);
});

test("nonzero process exit becomes a safe failure", async () => {
  const calls = [];
  await assert.rejects(
    makeActions(calls, { exitCode: 9, signal: null, stdout: "", stderr: "sensitive path" }).launch(),
    /exit code 9/,
  );
});
