import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolveRuntimeMode,themeVisible,applicationInfo} from '../src/shared/runtime-mode.mjs';
import {ThemeCatalog} from '../src/main/services/theme-catalog.mjs';
import {registerIpcHandlers} from '../src/main/ipc.mjs';
import {IPC_CHANNELS} from '../src/shared/contracts.mjs';
test('CMD entrypoints delegate to explicit npm modes in the same relative GUI directory',async()=>{
 const development=await readFile(new URL('../../Start-ThemeManager.cmd',import.meta.url),'utf8');
 const production=await readFile(new URL('../../Start-ThemeManager-Production.cmd',import.meta.url),'utf8');
 assert.match(development,/call npm start\r?\n/);
 assert.doesNotMatch(development,/call npm run start:production/);
 assert.match(production,/call npm run start:production\r?\n/);
 for(const source of [development,production]){
  assert.ok(source.includes('set "FSS_GUI_DIR=%~dp0gui"'));
  assert.ok(source.includes('set "FSS_EXIT_CODE=%ERRORLEVEL%"'));
  assert.ok(source.includes('exit /b %FSS_EXIT_CODE%'));
 }
});
test('mode defaults and packaged production cannot be overridden by environment',()=>{
 assert.equal(resolveRuntimeMode(),'development');
 assert.equal(resolveRuntimeMode({requested:'production'}),'production');
 assert.equal(resolveRuntimeMode({isPackaged:true,requested:'development'}),'production');
 assert.throws(()=>resolveRuntimeMode({requested:'other'}));
 for(const origin of ['user','builtin'])for(const mode of ['development','production'])assert.equal(themeVisible({origin},mode),true);
 assert.equal(themeVisible({origin:'development'},'production'),false);
});
test('actual production catalog hides dev metadata from listing and preview, preserves builtin/user',async()=>{
 const themesRoot=fileURLToPath(new URL('../../themes',import.meta.url));
 const dev=new ThemeCatalog({themesRoot}),prod=new ThemeCatalog({themesRoot,mode:'production'});
 const d=await dev.scan(),p=await prod.scan();
 assert.ok(d.themes.filter(t=>t.management.origin==='development').length>=2);
 for(const theme of d.themes){
  const visible=theme.management.origin!=='development';
  assert.equal(prod.has(theme.id),visible);
  assert.equal(p.themes.some(t=>t.id===theme.id),visible);
  if(!visible)assert.equal(prod.getPreviewAsset(theme.id,'light'),null);
 }
});
test('production IPC blocks developer rescan and hidden mutations before services execute',async()=>{
 const handlers=new Map();let calls=0;
 registerIpcHandlers({ipcMain:{handle:(c,h)=>handlers.set(c,h)},authorizedWebContentsId:1,runtimeInfo:applicationInfo('0.4.0','production'),
 catalog:{scan:async()=>({themes:[]}),has:()=>false},editor:{load:()=>{calls++;}},duplicator:{duplicate:()=>{calls++;}}});
 const event={sender:{id:1},senderFrame:{parent:null}};
 for(const channel of [IPC_CHANNELS.rescanThemes,IPC_CHANNELS.loadEditor,IPC_CHANNELS.duplicateTheme,IPC_CHANNELS.exportDiagnostics]){
  assert.equal((await handlers.get(channel)(event,'hidden-theme')).ok,false);
 }
 assert.equal(calls,0);
});
test('About attribution/version and build scripts are single-source; developer UI starts hidden',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 const info=applicationInfo(pkg.version,'production');
 assert.equal(info.author,'TREe191');assert.equal(info.github,'https://github.com/TREe191/forest-scholar-skin');
 assert.equal(info.version,pkg.version);assert.equal(info.developerControls,false);
 assert.equal(applicationInfo(pkg.version,'development').developerControls,true);
 assert.match(pkg.scripts.package,/package production/);assert.match(pkg.scripts.make,/make production/);
 const html=await readFile(new URL('../src/renderer/index.html',import.meta.url),'utf8');
 assert.match(html,/id="rescan-button" data-developer-only hidden/);
 const main=await readFile(new URL('../src/main/index.mjs',import.meta.url),'utf8');
 assert.match(main,/applicationInfo\(app.getVersion\(\),runtimeMode,buildIdentity\)/);
 assert.match(main,/devTools:runtimeMode==='development'/);
 assert.match(html,/id="build-identity" class="build-identity"/);
 for(const id of ['about-version','about-build','about-commit','support-build'])assert.ok(html.includes(`id="${id}"`));
});
