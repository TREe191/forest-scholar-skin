import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('Windows PowerShell 5.1 path diagnostics preserve strict comparison and scripts parse', {skip:process.platform!=='win32'},()=>{
  const executable=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const r=spawnSync(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./path-diagnostics.test.ps1',import.meta.url))],{encoding:'utf8',windowsHide:true});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/RESULT passed=7 failed=0/);
});
