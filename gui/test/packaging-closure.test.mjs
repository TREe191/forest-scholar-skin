import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildCore,closeGuiModules,ignoreGuiFile,preparedNodeRoot,projectRoot} from '../scripts/package-resources.mjs';
import {resolvePathContext,initializeUserData} from '../src/main/paths.mjs';
import {CodexActions,resolveWindowsPowerShell} from '../src/main/services/codex-actions.mjs';
import {ThemeCatalog} from '../src/main/services/theme-catalog.mjs';
import {ThemeCreator} from '../src/main/services/theme-creator.mjs';
import {ThemeManagement} from '../src/main/services/theme-management.mjs';
import {ThemeDuplicator} from '../src/main/services/theme-duplicate.mjs';
import {DiagnosticsExporter} from '../src/main/services/diagnostics-export.mjs';
import {applicationInfo} from '../src/shared/runtime-mode.mjs';
import {makeTemporaryDirectory,removeTemporaryDirectory,tinyPng} from './helpers.mjs';
const execute=promisify(execFile);
async function files(root){const all=[];for(const e of await fs.readdir(root,{withFileTypes:true})){const p=path.join(root,e.name);if(e.isDirectory())all.push(...await files(p));else all.push(p);}return all;}
test('app staging retains all relative imports inside closed GUI/core tree, rejects build/test/local files',async()=>{
 const root=await makeTemporaryDirectory('asar topology 中文 ');
 try{
  await fs.cp(path.join(projectRoot,'gui/src'),path.join(root,'src'),{recursive:true});
  await fs.copyFile(path.join(projectRoot,'gui/package.json'),path.join(root,'package.json'));
  await closeGuiModules(root);
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).main,'gui/src/main/index.mjs');
  for(const file of (await files(root)).filter(f=>f.endsWith('.mjs'))){
   const source=await fs.readFile(file,'utf8');
   for(const match of source.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)){
    const target=path.resolve(path.dirname(file),match[1]);assert.ok(!path.relative(root,target).startsWith('..'),file+' escapes bundle');
    await fs.access(target);
   }
  }
  const module=await import(pathToFileURL(path.join(root,'gui/src/main/services/theme-catalog.mjs')));
  assert.equal(typeof module.ThemeCatalog,'function');
  for(const file of ['/out/a','/test/a','/node_modules/a','/runtime/history/a','/.env','/scripts/forge-mode.mjs'])assert.equal(ignoreGuiFile(file),true);
  for(const file of ['','/src','/src/renderer/styles.css','/package.json'])assert.equal(ignoreGuiFile(file),false);
 }finally{await removeTemporaryDirectory(root);}
});
const prepared=await fs.access(path.join(preparedNodeRoot,'node.exe')).then(()=>true,()=>false);
test('detached beta/production resources + userData work with no system Node/PATH', {skip:!prepared?'Run npm run prepare:node first':false},async()=>{
 const root=await makeTemporaryDirectory('发行资源 中文 space');
 try{
  const resourcesPath=path.join(root,'read only resources'),resourceRoot=path.join(resourcesPath,'skin-core');
  await buildCore(resourceRoot);
  const resourceNames=(await files(resourceRoot)).map(f=>path.relative(resourceRoot,f).replaceAll('\\','/'));
  assert.ok(resourceNames.includes('node/LICENSE'));
  assert.ok(resourceNames.includes('node/runtime.json'));
  assert.ok(!resourceNames.some(f=>/runtime\/|user-|universal-demo|universal-dark-test|config\/app.json|\.log$/.test(f)));
  const builtinManifest=await fs.readFile(path.join(resourceRoot,'themes/forest-scholar/theme.json'));
  const detached=await import(pathToFileURL(path.join(resourceRoot,'scripts/theme-payload.mjs')));
  const payload=await detached.loadThemePayload(resourceRoot,path.join(resourceRoot,'themes/phainon'),'Auto');
  assert.equal(payload.theme.id,'phainon');
  for(const mode of ['beta','production']){
   const paths=await resolvePathContext({isPackaged:true,resourcesPath,userDataPath:path.join(root,mode+' 用户数据'),moduleUrl:'file:///absent/source/gui/src/main/paths.mjs'});
   await initializeUserData(paths);
   assert.equal(paths.resourceRoot,resourceRoot);assert.equal(paths.configPath,path.join(paths.dataRoot,'config/app.json'));
   const catalog=new ThemeCatalog({themesRoot:paths.themesRoot,builtinThemesRoot:paths.builtinThemesRoot,mode});
   const snapshot=await catalog.scan();assert.deepEqual(snapshot.themes.map(t=>t.id).sort(),['forest-scholar','phainon']);
   const creator=new ThemeCreator({themesRoot:paths.themesRoot,validateImage:()=>{}});
   const wallpaper=path.join(root,'input.png');await fs.writeFile(wallpaper,tinyPng);
   const created=await creator.create('User test',wallpaper);await fs.access(path.join(paths.themesRoot,created.id,'theme.json'));
   const management=new ThemeManagement({themesRoot:paths.themesRoot,builtinThemesRoot:paths.builtinThemesRoot});
   await assert.rejects(management.rename('forest-scholar','No'));
   const copy=await new ThemeDuplicator({management,catalog}).duplicate('forest-scholar');
   await fs.access(path.join(paths.themesRoot,copy.id,'theme.json'));
   assert.equal((await management.target(copy.id)).policy.renamable,true);
   const calls=[];const actions=new CodexActions({...paths,environment:{SystemRoot:process.env.SystemRoot,PATH:'',NODE_OPTIONS:'bad'},executor:async(...args)=>{calls.push(args);return {exitCode:0};}});
   await actions.launch();await actions.restore();
   for(const [,args,options] of calls){assert.equal(args[args.indexOf('-DataRoot')+1],paths.dataRoot);assert.equal(options.cwd,paths.dataRoot);assert.equal(options.env.PATH,'');assert.equal(options.env.NODE_OPTIONS,undefined);}
   if(process.platform==='win32'){
    const node=await execute(paths.nodePath,['--version'],{env:{...process.env,PATH:''}});assert.match(node.stdout,/v24\.15\.0/);
    const shell=resolveWindowsPowerShell();
    const checked=await execute(shell,['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./packaged-storage.ps1',import.meta.url)),'-ResourceRoot',paths.resourceRoot,'-DataRoot',paths.dataRoot]);
    assert.match(checked.stdout,/BUNDLED_NODE_NO_PATH_OK/);
    // No session: Restore must exit without querying/stopping/restarting Codex.
    await execute(shell,['-NoProfile','-ExecutionPolicy','Bypass','-File',paths.restoreScript,'-DataRoot',paths.dataRoot],{env:{...process.env,PATH:''}});
   }
   const history=path.join(paths.runtimeRoot,'history/2026-09-12_000000_001');await fs.mkdir(history,{recursive:true});
   await fs.writeFile(path.join(history,'session.json'),JSON.stringify({failureStage:'renderer-readiness'}));
   const diagnostics=new DiagnosticsExporter({historyRoot:path.join(paths.runtimeRoot,'history'),info:applicationInfo('0.4.0',mode),chooseDestination:async()=>path.join(paths.dataRoot,'support.zip')});
   if(mode==='beta')assert.equal((await diagnostics.exportLatest()).exported,true);else await assert.rejects(diagnostics.exportLatest());
   await fs.writeFile(paths.configPath,JSON.stringify({schemaVersion:1,activeTheme:created.id,appearance:'dark'}));await initializeUserData(paths);
   assert.equal(JSON.parse(await fs.readFile(paths.configPath,'utf8')).activeTheme,created.id);
  }
  assert.deepEqual(await fs.readFile(path.join(resourceRoot,'themes/forest-scholar/theme.json')),builtinManifest);
  assert.deepEqual((await files(resourceRoot)).map(f=>path.relative(resourceRoot,f).replaceAll('\\','/')),resourceNames);
  await assert.rejects(resolvePathContext({isPackaged:true,resourcesPath,userDataPath:path.join(resourcesPath,'unsafe')}));
 }finally{await removeTemporaryDirectory(root);}
});
