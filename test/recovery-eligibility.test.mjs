import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRecoveryEligibility} from '../scripts/recovery-eligibility.mjs';
const exe='C:\\Codex\\ChatGPT.exe', pkg='OpenAI.Codex_test_x64';
function process(pid,parentPid,second){
  const startedAt='2026-09-12T00:00:0'+second+'.0000000Z';
  return {pid,parentPid,startedAt,executablePath:exe,codexCandidate:true,
    debugAddress:'127.0.0.1',debugPort:55000,
    packageIdentity:{source:'process-handle',fullName:pkg,pid,startedAt}};
}
function fixture(){
  const processes=[process(100,50,1),process(101,100,2),process(102,101,3)];
  return {failureStage:'cdp-listener-readiness',listenerNeverSeen:true,
    launch:{id:'launch-1',activationPid:100,launcherPid:50,requestedAt:'2026-09-12T00:00:00Z',port:55000,expectedExecutable:exe,expectedPackageFullName:pkg},
    preLaunch:{complete:true,codexPids:[]},
    recordedProcesses:structuredClone(processes),
    snapshot:{complete:true,observedAt:'2026-09-12T00:00:50Z',processes},
    assessedAt:'2026-09-12T00:00:51Z',
    userUseEvidence:{state:'not-in-use',source:'explicit-user-confirmation',launchId:'launch-1',activationPid:100,rootStartedAt:processes[0].startedAt,confirmedAt:'2026-09-12T00:00:51Z'}};
}
test('complete verified tree is eligible, assessment is pure and returns no kill list',()=>{
  const e=fixture(),before=structuredClone(e);
  assert.equal(assessRecoveryEligibility(e).status,'eligible');
  assert.deepEqual(e,before);
  assert.deepEqual(Object.keys(assessRecoveryEligibility(e)).sort(),['reasons','status']);
});
for(const [name,status,code,change] of [
  ['existing instance','ineligible','pre-existing-codex',e=>e.preLaunch.codexPids=[9]],
  ['old Codex mixed in','ineligible','process-predates-activation',e=>{const p=process(9,8,0);e.snapshot.processes.push(p);e.recordedProcesses.push(structuredClone(p));}],
  ['broken parent','uncertain','ancestor-chain-broken',e=>{e.snapshot.processes[2].parentPid=999;e.recordedProcesses[2].parentPid=999;}],
  ['PID reuse','ineligible','pid-reuse-or-start-mismatch',e=>e.snapshot.processes[1].startedAt='2026-09-12T00:00:02.0000001Z'],
  ['package unknown','uncertain','process-package-identity-unverified',e=>delete e.snapshot.processes[1].packageIdentity],
  ['registration is not process package evidence','uncertain','process-package-identity-unverified',e=>e.snapshot.processes[1].packageIdentity.source='appx-registration'],
  ['wrong package','ineligible','package-mismatch',e=>e.snapshot.processes[1].packageIdentity.fullName='Other'],
  ['non-Codex child','ineligible','non-codex-or-path-mismatch',e=>{e.snapshot.processes[2].executablePath='C:\\Other.exe';e.recordedProcesses[2].executablePath='C:\\Other.exe';}],
  ['user use unknown','uncertain','user-use-not-confirmed-for-this-instance',e=>delete e.userUseEvidence],
  ['user actively using','ineligible','user-is-using-instance',e=>e.userUseEvidence.state='in-use'],
  ['confirmation for other launch','uncertain','user-use-not-confirmed-for-this-instance',e=>e.userUseEvidence.launchId='old'],
  ['missing root','uncertain','activation-root-missing',e=>e.snapshot.processes.shift()],
  ['unrecorded child','uncertain','process-not-recorded-this-launch',e=>e.recordedProcesses.pop()],
  ['snapshot incomplete','uncertain','process-inventory-incomplete',e=>e.snapshot.complete=false],
  ['stale snapshot','uncertain','stale-snapshot',e=>e.assessedAt='2026-09-12T00:01:00Z'],
  ['wrong root port','ineligible','activation-debug-arguments-mismatch',e=>e.snapshot.processes[0].debugPort=55001],
  ['nonlocal address','ineligible','activation-debug-arguments-mismatch',e=>e.snapshot.processes[0].debugAddress='0.0.0.0'],
  ['other failure stage','ineligible','not-listener-failure',e=>e.failureStage='renderer-readiness'],
]){
  test(name+' fails closed',()=>{
    const e=fixture();change(e);const result=assessRecoveryEligibility(e);
    assert.equal(result.status,status);assert.ok(result.reasons.some(r=>r.code===code));
  });
}
test('unrelated non-Codex process is not included or granted termination authority',()=>{
  const e=fixture();e.snapshot.processes.push({pid:800,parentPid:799,codexCandidate:false,executablePath:'C:\\Unrelated.exe'});
  assert.equal(assessRecoveryEligibility(e).status,'eligible');
});
test('missing evidence is uncertain',()=>assert.equal(assessRecoveryEligibility(null).status,'uncertain'));
