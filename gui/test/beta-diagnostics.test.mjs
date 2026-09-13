import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {resolveRuntimeMode,applicationInfo,themeVisible} from '../src/shared/runtime-mode.mjs';
import {DiagnosticsExporter,sanitizeDiagnostic} from '../src/main/services/diagnostics-export.mjs';
import {stampBuildMode} from '../forge.config.mjs';
import {makeTemporaryDirectory,removeTemporaryDirectory} from './helpers.mjs';
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
test('build hook writes beta into staging only, rejects development package',async()=>{
 const root=await makeTemporaryDirectory('beta-build'),previous=process.env.THEME_MANAGER_MODE;
 try{
  await fs.mkdir(path.join(root,'src/main'),{recursive:true});
  process.env.THEME_MANAGER_MODE='beta';await stampBuildMode({},root);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'src/main/build-mode.json'),'utf8')),{mode:'beta'});
  process.env.THEME_MANAGER_MODE='development';await assert.rejects(stampBuildMode({},root));
 }finally{if(previous===undefined)delete process.env.THEME_MANAGER_MODE;else process.env.THEME_MANAGER_MODE=previous;await removeTemporaryDirectory(root);}
});
test('privacy allowlist excludes secrets, free text, full paths, commands, URLs and theme names',()=>{
 const result=sanitizeDiagnostic({failureStage:'cdp-listener-readiness',port:55555,details:{processPackageIdentityVerified:true,commandLine:'secret',textContent:'secret',cookie:'secret',accountId:1234},expectedPath:'C:/Users/secret/app.exe',actualPath:'C:/Users/secret/other.exe',activeTheme:'secret',status:'secret'});
 assert.equal(result.failureStage,'cdp-listener-readiness');assert.equal(result.PathEvidence.equal,false);
 assert.doesNotMatch(JSON.stringify(result),/secret|accountId|textContent|commandLine/);
});
test('export ZIP captures latest single incomplete session; cancellation and failed publish preserve logs',async()=>{
 const root=await makeTemporaryDirectory('beta 中文 export');
 try{
  const historyRoot=path.join(root,'history'),older=path.join(historyRoot,'2026-09-01_000000_001'),latest=path.join(historyRoot,'2026-09-02_000000_002');
  await fs.mkdir(older,{recursive:true});await fs.mkdir(latest);
  const original=JSON.stringify({failureStage:'renderer-readiness',launcherPid:123,commandLine:'SECRET'});
  await fs.writeFile(path.join(latest,'session.json'),original);
  await fs.writeFile(path.join(latest,'launcher.log'),JSON.stringify({event:'launcher-start',at:'2026-09-02T00:00:00Z',details:{port:55111}}));
  await fs.writeFile(path.join(latest,'injector-error.log'),'SECRET raw error\n');
  const destination=path.join(root,'out.zip');let filename;
  const options={historyRoot,info:applicationInfo('0.4.0','beta'),chooseDestination:async name=>{filename=name;return destination;}};
  assert.deepEqual(await new DiagnosticsExporter(options).exportLatest(),{exported:true});
  assert.match(filename,/0\.4\.0.*\.zip$/);
  const zip=await fs.readFile(destination);assert.equal(zip.readUInt32LE(0),0x04034b50);
  const start=30+zip.readUInt16LE(26),report=JSON.parse(zip.subarray(start,start+zip.readUInt32LE(18)));
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
