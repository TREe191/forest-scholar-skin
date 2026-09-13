import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {resolveRuntimeMode,applicationInfo,themeVisible} from '../src/shared/runtime-mode.mjs';
import {DiagnosticsExporter,sanitizeDiagnostic} from '../src/main/services/diagnostics-export.mjs';
import {stampBuildMode} from '../forge.config.mjs';
import {makeTemporaryDirectory,removeTemporaryDirectory} from './helpers.mjs';
import {launchFailureMessage} from '../src/renderer/components/launch-failure.mjs';
import {translate} from '../src/shared/i18n.mjs';
import {registerIpcHandlers} from '../src/main/ipc.mjs';
import {IPC_CHANNELS} from '../src/shared/contracts.mjs';
import {createBuildIdentity} from '../src/shared/build-identity.mjs';
const mainSource=await fs.readFile(new URL('../src/main/index.mjs',import.meta.url),'utf8');
test('beta capabilities and immutable packaged stamp ignore runtime environment escalation',()=>{
 assert.equal(resolveRuntimeMode({requested:'beta'}),'beta');
 assert.equal(resolveRuntimeMode({isPackaged:true,packagedMode:'beta',requested:'development'}),'beta');
 assert.throws(()=>resolveRuntimeMode({isPackaged:true,packagedMode:'development'}));
 assert.equal(themeVisible({origin:'development'},'beta'),false);
 for(const origin of ['user','builtin'])assert.equal(themeVisible({origin},'beta'),true);
 assert.equal(applicationInfo('0.4.0','beta').developerControls,false);
 assert.equal(applicationInfo('0.4.0','beta').supportDiagnostics,true);
 assert.equal(applicationInfo('0.4.0','production').supportDiagnostics,false);
});
test('beta startup failures show a bounded actionable native error before exiting',()=>{
 assert.match(mainSource,/function startupErrorDetail\(error\)/);
 assert.match(mainSource,/\.slice\(0, 800\)/);
 assert.match(mainSource,/runtimeMode === "beta" \|\| app\.isPackaged/);
 assert.match(mainSource,/dialog\.showErrorBox\(/);
 assert.match(mainSource,/Restart Theme Manager once\./);
 assert.match(mainSource,/runtimeMode === "beta" \? "Beta issue" : "startup issue"/);
 assert.match(mainSource,/catch \(dialogError\)/);
 assert.match(mainSource,/finally \{\s*app\.exit\(1\);/);
});
test('Beta launch failure stages use human messages and Report issue reuses diagnostics export',async()=>{
 const existing=launchFailureMessage('existing-codex-check');
 const http=launchFailureMessage('cdp-http-readiness');
 assert.equal(translate(existing,'zh'),'检测到 Codex 仍在运行。请完全退出 Codex，并等待后台进程结束后重试。');
 assert.equal(translate(http,'zh'),'Codex 已启动，但调试连接未准备完成。请完全退出 Codex 后重试；如果问题持续，请导出诊断信息。');
 assert.equal(launchFailureMessage('unknown-stage','generic fallback'),'generic fallback');
 const renderer=await fs.readFile(new URL('../src/renderer/app.mjs',import.meta.url),'utf8');
 assert.match(renderer,/textContent='Report issue'/);
 assert.match(renderer,/async function exportDiagnostics/);
 assert.match(renderer,/support-export.*exportDiagnostics\(event\.currentTarget\)/);
 assert.match(renderer,/api\.exportDiagnostics\(\)/);
 assert.match(renderer,/showLaunchFailure/);
});
test('launch IPC preserves a safe failureStage for the Beta renderer',async()=>{
 const handlers=new Map(),failure=Error('Launch Codex failed.');failure.failureStage='existing-codex-check';
 registerIpcHandlers({ipcMain:{handle:(channel,handler)=>handlers.set(channel,handler),removeHandler:()=>{}},authorizedWebContentsId:7,
  runtimeInfo:applicationInfo('0.4.0','beta'),catalog:{scan:async()=>({themes:[]}),has:()=>true},configStore:{read:async()=>({activeTheme:'phainon'})},actions:{launch:async()=>{throw failure;}}});
 const event={sender:{id:7},senderFrame:{parent:null}};
 assert.deepEqual(await handlers.get(IPC_CHANNELS.launchCodex)(event),{ok:false,error:'Launch Codex failed.',failureStage:'existing-codex-check'});
});
test('build hook writes beta identity into staging only, rejects development package',async()=>{
 const root=await makeTemporaryDirectory('beta-build'),previous=process.env.THEME_MANAGER_MODE,previousCommit=process.env.THEME_MANAGER_GIT_COMMIT;
 try{
  await fs.mkdir(path.join(root,'src/main'),{recursive:true});
  process.env.THEME_MANAGER_MODE='beta';process.env.THEME_MANAGER_GIT_COMMIT='cd772344949f5ede91c3113f0ebf02f7f836dc01';await stampBuildMode({},root);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'src/main/build-mode.json'),'utf8')),createBuildIdentity('beta',process.env.THEME_MANAGER_GIT_COMMIT));
  process.env.THEME_MANAGER_MODE='development';await assert.rejects(stampBuildMode({},root));
 }finally{if(previous===undefined)delete process.env.THEME_MANAGER_MODE;else process.env.THEME_MANAGER_MODE=previous;if(previousCommit===undefined)delete process.env.THEME_MANAGER_GIT_COMMIT;else process.env.THEME_MANAGER_GIT_COMMIT=previousCommit;await removeTemporaryDirectory(root);}
});
test('privacy allowlist excludes secrets, free text, full paths, commands, URLs and theme names',()=>{
 const result=sanitizeDiagnostic({failureStage:'cdp-listener-readiness',port:55555,details:{processPackageIdentityVerified:true,commandLine:'secret',textContent:'secret',cookie:'secret',accountId:1234,
  listenerOwningPid:4100,listenerOwnerIsActivationPid:false,listenerOwnerPathMatchesExpected:true,listenerOwnerRelation:'child',httpAttemptCount:15,
  lastHttpFailureType:'connection-refused',lastHttpStatus:null,lastHttpErrorCode:10061,firstHttpAttemptAt:'2026-09-13T03:20:30Z',lastHttpAttemptAt:'2026-09-13T03:21:14Z',httpReadyAt:null},
  expectedPath:'C:/Users/secret/app.exe',actualPath:'C:/Users/secret/other.exe',activeTheme:'secret',status:'secret'});
 assert.equal(result.failureStage,'cdp-listener-readiness');assert.equal(result.PathEvidence.equal,false);
 assert.deepEqual(result.details,{processPackageIdentityVerified:true,listenerOwningPid:4100,listenerOwnerIsActivationPid:false,listenerOwnerPathMatchesExpected:true,listenerOwnerRelation:'child',httpAttemptCount:15,
  lastHttpFailureType:'connection-refused',lastHttpStatus:null,lastHttpErrorCode:10061,firstHttpAttemptAt:'2026-09-13T03:20:30Z',lastHttpAttemptAt:'2026-09-13T03:21:14Z',httpReadyAt:null});
 assert.doesNotMatch(JSON.stringify(result),/secret|accountId|textContent|commandLine/);
});
test('export ZIP captures latest single incomplete session; cancellation and failed publish preserve logs',async()=>{
 const root=await makeTemporaryDirectory('beta 中文 export');
 try{
  const historyRoot=path.join(root,'history'),older=path.join(historyRoot,'2026-09-01_000000_001'),latest=path.join(historyRoot,'2026-09-02_000000_002');
  await fs.mkdir(older,{recursive:true});await fs.mkdir(latest);
  const readiness={listenerOwningPid:4100,listenerOwnerIsActivationPid:false,listenerOwnerPathMatchesExpected:true,listenerOwnerRelation:'descendant',httpAttemptCount:15,
   lastHttpFailureType:'timeout',lastHttpStatus:null,lastHttpErrorCode:10060,firstHttpAttemptAt:'2026-09-02T00:00:01Z',lastHttpAttemptAt:'2026-09-02T00:00:45Z',httpReadyAt:null};
  const original=JSON.stringify({failureStage:'cdp-http-readiness',launcherPid:123,readiness,commandLine:'SECRET',responseBody:'SECRET BODY'});
  await fs.writeFile(path.join(latest,'session.json'),original);
  await fs.writeFile(path.join(latest,'launcher.log'),JSON.stringify({event:'launcher-start',at:'2026-09-02T00:00:00Z',details:{port:55111}}));
  await fs.writeFile(path.join(latest,'injector-error.log'),'SECRET raw error\n');
  const destination=path.join(root,'out.zip');let filename;
  const identity=createBuildIdentity('beta','cd772344949f5ede91c3113f0ebf02f7f836dc01');
  const options={historyRoot,info:applicationInfo('0.4.0','beta',identity),chooseDestination:async name=>{filename=name;return destination;}};
  assert.deepEqual(await new DiagnosticsExporter(options).exportLatest(),{exported:true});
  assert.match(filename,/0\.4\.0.*\.zip$/);
  const zip=await fs.readFile(destination);assert.equal(zip.readUInt32LE(0),0x04034b50);
  const start=30+zip.readUInt16LE(26),report=JSON.parse(zip.subarray(start,start+zip.readUInt32LE(18)));
  assert.deepEqual({appVersion:report.appVersion,buildMode:report.buildMode,gitCommit:report.gitCommit,shortCommit:report.shortCommit},{appVersion:'0.4.0',buildMode:'beta',gitCommit:identity.gitCommit,shortCommit:'cd77234'});
  assert.deepEqual(report.sources['session.json'].records[0].readiness,readiness);
  assert.equal(report.session,path.basename(latest));assert.equal(report.sources['ready.json'].missing,true);
  assert.doesNotMatch(zip.toString(),/SECRET|2026-09-01_000000_001/);
  await assert.rejects(new DiagnosticsExporter({...options,commit:async()=>{throw Error('disk');}}).exportLatest());
  assert.deepEqual(await fs.readFile(destination),zip);
  assert.equal(await fs.readFile(path.join(latest,'session.json'),'utf8'),original);
  assert.deepEqual(await new DiagnosticsExporter({...options,chooseDestination:async()=>null}).exportLatest(),{canceled:true});
  await assert.rejects(new DiagnosticsExporter({...options,info:applicationInfo('0.4.0','production')}).exportLatest());
  assert.equal((await fs.readdir(root)).some(n=>n.endsWith('.tmp')),false);
 }finally{await removeTemporaryDirectory(root);}
});
