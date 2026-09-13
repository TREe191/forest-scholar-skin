import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { CodexActions, readLatestFailureStage, resolveWindowsPowerShell } from "../src/main/services/codex-actions.mjs";
import {makeTemporaryDirectory,removeTemporaryDirectory} from './helpers.mjs';

function makeActions(calls, result = { exitCode: 0, signal: null, stdout: "ok", stderr: "" }, overrides = {}) {
  const projectRoot = path.resolve("C:/portable path/主题 skin");
  return new CodexActions({
    projectRoot,
    startScript: path.join(projectRoot, "scripts", "Start-ForestScholarSkin.ps1"),
    restoreScript: path.join(projectRoot, "scripts", "Restore-ForestScholarSkin.ps1"),
    environment: { SystemRoot: "C:\\Windows" },
    executor: async (...args) => { calls.push(args); return result; },
    ...overrides,
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

test("latest launch failure exposes only a safe failureStage from diagnostics", async () => {
  const root=await makeTemporaryDirectory('launch stage ');
  try{
    const older=path.join(root,'history','2026-09-12_000000_001');
    const latest=path.join(root,'history','2026-09-13_000000_001');
    await fs.mkdir(older,{recursive:true});await fs.mkdir(latest);
    await fs.writeFile(path.join(older,'session.json'),JSON.stringify({failureStage:'existing-codex-check'}));
    await fs.writeFile(path.join(latest,'session.json'),JSON.stringify({failureStage:'cdp-http-readiness'}));
    assert.equal(await readLatestFailureStage(root),'cdp-http-readiness');
    assert.equal(await readLatestFailureStage(root,fs,Date.now()+1000),null);
    await fs.writeFile(path.join(latest,'session.json'),JSON.stringify({failureStage:'unsafe stage'}));
    assert.equal(await readLatestFailureStage(root),null);
  }finally{await removeTemporaryDirectory(root);}
});

test("failed launch attaches the current diagnostic failureStage", async () => {
  const root=await makeTemporaryDirectory('current launch stage '),calls=[];
  try{
    const runtimeRoot=path.join(root,'runtime');
    const executor=async (...args)=>{
      calls.push(args);
      const sessionRoot=path.join(runtimeRoot,'history','2026-09-13_000000_001');
      await fs.mkdir(sessionRoot,{recursive:true});
      await fs.writeFile(path.join(sessionRoot,'session.json'),JSON.stringify({failureStage:'existing-codex-check'}));
      return {exitCode:9,signal:null,stdout:'',stderr:''};
    };
    await assert.rejects(makeActions(calls,undefined,{runtimeRoot,executor}).launch(),error=>error.failureStage==='existing-codex-check');
  }finally{await removeTemporaryDirectory(root);}
});
