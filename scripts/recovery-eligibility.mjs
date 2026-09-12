import path from 'node:path';

const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const validPid = value => Number.isSafeInteger(value) && value > 0;
const executable = value => typeof value === 'string' && path.win32.isAbsolute(value)
  ? path.win32.normalize(value).toLowerCase() : null;

/**
 * Pure evidence assessment, NOT a termination permit or an OS evidence collector.
 * Never infers ownership from executable name, inactivity, missing listener or PID alone.
 * Callers must supply independently collected records; see recovery-eligibility.md.
 */
export function assessRecoveryEligibility(evidence) {
  const reasons = [];
  const reject = (status, code, pid) => reasons.push({status, code, ...(pid === undefined ? {} : {pid})});
  const result = () => ({
    status: reasons.some(r=>r.status==='ineligible') ? 'ineligible' : reasons.length ? 'uncertain' : 'eligible',
    reasons: reasons.length ? reasons : [{status:'eligible',code:'all-required-evidence-matches'}],
  });
  const e = evidence;
  if (!e || typeof e !== 'object') {reject('uncertain','missing-evidence');return result();}
  const launch = e.launch ?? {}, snapshot = e.snapshot ?? {};
  const start = timestamp(launch.requestedAt), end = timestamp(snapshot.observedAt), now = timestamp(e.assessedAt);
  if (!launch.id || !validPid(launch.activationPid) || !validPid(launch.launcherPid) ||
      !executable(launch.expectedExecutable) || !launch.expectedPackageFullName ||
      !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(now) || end < start || now < end) {
    reject('uncertain','invalid-launch-or-observation');return result();
  }
  if(now-end>2000)reject('uncertain','stale-snapshot');
  if(e.failureStage!=='cdp-listener-readiness')reject('ineligible','not-listener-failure');
  if(e.listenerNeverSeen!==true)reject('uncertain','listener-history-not-confirmed');
  if(e.preLaunch?.complete!==true)reject('uncertain','prelaunch-inventory-incomplete');
  if(!Array.isArray(e.preLaunch?.codexPids))reject('uncertain','prelaunch-inventory-missing');
  else if(e.preLaunch.codexPids.length)reject('ineligible','pre-existing-codex');
  if(snapshot.complete!==true)reject('uncertain','process-inventory-incomplete');
  if(!Array.isArray(snapshot.processes) || !Array.isArray(e.recordedProcesses)){
    reject('uncertain','process-records-missing');return result();
  }
  const records = new Map(), current = new Map();
  for(const [items,map] of [[e.recordedProcesses,records],[snapshot.processes,current]]) {
    for(const process of items){
      if(!process || !validPid(process.pid) || map.has(process.pid)){
        reject('uncertain','invalid-or-duplicate-pid');continue;
      }
      map.set(process.pid,process);
    }
  }
  const root=current.get(launch.activationPid), recordedRoot=records.get(launch.activationPid);
  if(!root || !recordedRoot){reject('uncertain','activation-root-missing');return result();}
  const rootStart=timestamp(recordedRoot.startedAt);
  if(!Number.isFinite(rootStart)){reject('uncertain','root-start-missing');return result();}
  if(rootStart<start)reject('ineligible','activation-predates-launch',root.pid);
  if(root.parentPid!==launch.launcherPid)reject('ineligible','activation-parent-mismatch',root.pid);
  if(root.debugAddress!=='127.0.0.1' || !Number.isInteger(launch.port) || launch.port<49152 || launch.port>65535 ||
      root.debugPort!==launch.port)reject('ineligible','activation-debug-arguments-mismatch',root.pid);

  // Examine every descendant plus every Codex candidate. Unknown provenance is never skipped.
  const descendants=new Set([root.pid]);
  let changed=true;
  while(changed){
    changed=false;
    for(const p of current.values()) if(descendants.has(p.parentPid) && !descendants.has(p.pid)){
      descendants.add(p.pid);changed=true;
    }
  }
  for(const p of current.values()){
    const candidate = descendants.has(p.pid) || p.codexCandidate===true ||
      executable(p.executablePath)===executable(launch.expectedExecutable);
    if(!candidate)continue;
    const old=records.get(p.pid), born=timestamp(p.startedAt);
    if(!Number.isFinite(born))reject('uncertain','start-time-unavailable',p.pid);
    else if(born<rootStart || born<start)reject('ineligible','process-predates-activation',p.pid);
    else if(born>end)reject('uncertain','process-start-after-snapshot',p.pid);
    if(!old)reject('uncertain','process-not-recorded-this-launch',p.pid);
    else {
      if(!Number.isFinite(timestamp(old.startedAt)))reject('uncertain','recorded-start-unavailable',p.pid);
      else if(p.startedAt!==old.startedAt)reject('ineligible','pid-reuse-or-start-mismatch',p.pid);
      if(old.parentPid!==p.parentPid)reject('ineligible','parent-changed',p.pid);
      if(executable(old.executablePath)!==executable(p.executablePath))reject('ineligible','recorded-path-changed',p.pid);
    }
    if(!executable(p.executablePath))reject('uncertain','path-unavailable',p.pid);
    else if(executable(p.executablePath)!==executable(launch.expectedExecutable))reject('ineligible','non-codex-or-path-mismatch',p.pid);
    const pkg=p.packageIdentity;
    if(pkg?.source!=='process-handle' || !pkg.fullName ||
        pkg.pid!==p.pid || pkg.startedAt!==p.startedAt)
      reject('uncertain','process-package-identity-unverified',p.pid);
    else if(pkg.fullName!==launch.expectedPackageFullName)reject('ineligible','package-mismatch',p.pid);
    let node=p;
    const visited=new Set();
    while(node.pid!==root.pid){
      if(visited.has(node.pid)){reject('uncertain','ancestor-cycle',p.pid);break;}
      visited.add(node.pid);
      const parent=current.get(node.parentPid);
      if(!parent){reject('uncertain','ancestor-chain-broken',p.pid);break;}
      if(timestamp(parent.startedAt)>timestamp(node.startedAt))reject('ineligible','parent-newer-than-child',p.pid);
      node=parent;
    }
  }
  // Absence of input, window focus or CDP is NOT evidence of no user activity.
  const use=e.userUseEvidence;
  if(use?.state==='in-use')reject('ineligible','user-is-using-instance');
  else if(use?.state!=='not-in-use' || use.source!=='explicit-user-confirmation' ||
      use.launchId!==launch.id || use.activationPid!==root.pid || use.rootStartedAt!==recordedRoot.startedAt ||
      !Number.isFinite(timestamp(use.confirmedAt)) || timestamp(use.confirmedAt)<end || timestamp(use.confirmedAt)>now)
    reject('uncertain','user-use-not-confirmed-for-this-instance');
  return result();
}
