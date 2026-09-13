import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ThemeCreator} from '../src/main/services/theme-creator.mjs';
import {ThemeManagement} from '../src/main/services/theme-management.mjs';
import {WallpaperDrafts} from '../src/main/services/wallpaper-drafts.mjs';
import {ThemeEditor} from '../src/main/services/theme-editor.mjs';
import {loadThemePackage} from '../../scripts/theme-loader.mjs';
import {loadThemePayload} from '../../scripts/theme-payload.mjs';
import {editorLayoutConfig,withWallpaperMode} from '../src/shared/wallpaper-layout.mjs';
import {ThemeCatalog} from '../src/main/services/theme-catalog.mjs';
import {makeTemporaryDirectory,removeTemporaryDirectory,tinyPng} from './helpers.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
test('layout modes save for single/dual, edit atomically, catalog/payload/preview agree',async()=>{
 const s=await setup();try{
  for(const mode of ['single','dual'])for(const layoutMode of ['contain','cover','focus-soft']){
   const tokens={};for(const slot of mode==='single'?['single']:['light','dark'])tokens[slot]=(await s.drafts.prepare(slot+'.png',tinyPng)).token;
   const {id}=await s.editor.save({name:'Layout',mode,tokens,layoutMode});
   const loaded=await s.editor.load(id),dir=path.join(s.themesRoot,id),pkg=await loadThemePackage(dir);
   for(const side of ['light','dark'])assert.deepEqual(editorLayoutConfig(loaded,side),pkg.layoutConfig[side]);
   assert.equal(pkg.layoutConfig.light.mode,layoutMode);
   const next=layoutMode==='cover'?'contain':'cover';
   const model={id,name:loaded.name,mode,revision:loaded.revision,tokens:Object.fromEntries(Object.entries(loaded.images).map(([k,v])=>[k,v.token])),layoutMode:next};
   const before=await fs.readFile(path.join(dir,'theme.json'));
   await assert.rejects(new ThemeEditor({...s,commit:async()=>{throw Error('disk');}}).save(model));
   assert.deepEqual(await fs.readFile(path.join(dir,'theme.json')),before);
   await s.editor.save(model);
   const saved=await loadThemePackage(dir),catalog=await new ThemeCatalog({themesRoot:s.themesRoot}).scan();
   assert.deepEqual(catalog.themes.find(t=>t.id===id).layoutConfig,saved.layoutConfig);
   for(const side of ['light','dark'])assert.deepEqual(saved.layoutConfig[side],editorLayoutConfig({...loaded,layoutMode:next},side));
   assert.deepEqual(saved.layoutConfig.light.focalRegion,pkg.layoutConfig.light.focalRegion);
   assert.match(saved.manifest.layout,/assets\/edit-.*\/layout.json/);
   await loadThemePayload(project,dir,'Auto');
  }
 }finally{await removeTemporaryDirectory(s.temp);}
});
test('legacy focal layouts remain intact, only explicit mode changes; invalid selection rejected',async()=>{
 for(const id of ['forest-scholar','phainon']){
  const doc=JSON.parse(await fs.readFile(path.join(project,'themes',id,'layout.json'),'utf8'));
  assert.deepEqual(withWallpaperMode(doc),doc);
  const next=withWallpaperMode(doc,'cover');
  assert.deepEqual(next.shared.focalRegion,doc.shared.focalRegion);
  assert.deepEqual(next.shared.anchor,doc.shared.anchor);
  assert.deepEqual(next.shared.safePadding,doc.shared.safePadding);
  assert.equal(next.shared.focusTolerance,doc.shared.focusTolerance);
 }
 assert.equal(editorLayoutConfig({}).mode,'contain');
 assert.throws(()=>withWallpaperMode(undefined,'bogus'));
});
async function setup(){const temp=await makeTemporaryDirectory('editor 中文 ');const themesRoot=path.join(temp,'themes');await fs.mkdir(themesRoot);const creator=new ThemeCreator({themesRoot,validateImage:()=>{},convertJpeg:()=>tinyPng});const drafts=new WallpaperDrafts(creator),management=new ThemeManagement({themesRoot});return {temp,themesRoot,creator,drafts,management,editor:new ThemeEditor({creator,drafts,management})};}
test('shared editor saves single, dual and either-side fallback with Universal palette',async()=>{
 const s=await setup();try{
  for(const slots of [['single'],['light'],['dark'],['light','dark']]){
   const tokens={};for(const slot of slots)tokens[slot]=(await s.drafts.prepare(`${slot}.png`,tinyPng)).token;
   const palette={schemaVersion:1,light:{accent:{color:'#123456',alpha:0.5}},dark:{chromeSurface:{color:'#234567',alpha:0.8}}};
   const {id}=await s.editor.save({name:'Test',mode:slots[0]==='single'?'single':'dual',tokens,paletteOverrides:palette});
   const dir=path.join(s.themesRoot,id),pkg=await loadThemePackage(dir),payload=await loadThemePayload(project,dir,'Auto');
   assert.equal(pkg.styles.length,0);assert.equal(payload.theme.visualAdaptation,'universal');assert.ok(payload.adaptationProfiles.Light);
   assert.deepEqual(pkg.backgrounds.light.bytes,tinyPng);assert.deepEqual(pkg.backgrounds.dark.bytes,tinyPng);
   if(slots.length===1)assert.strictEqual(pkg.backgrounds.light,pkg.backgrounds.dark);
   else assert.notEqual(pkg.backgrounds.light.relativePath,pkg.backgrounds.dark.relativePath);
   assert.match(payload.css,/--codex-skin-accent: rgba\(18, 52, 86, 0.5\)/);
   const loaded=await s.editor.load(id);assert.deepEqual(loaded.paletteOverrides,palette);
   assert.equal(loaded.mode,slots[0]==='single'?'single':'dual');
  }
 }finally{await removeTemporaryDirectory(s.temp);}
});
test('edit retains ID/layout, failed commit preserves original, stale revision rejected',async()=>{
 const s=await setup();try{
  const image=await s.drafts.prepare('a.png',tinyPng);
  const {id}=await s.editor.save({name:'Before',mode:'single',tokens:{single:image.token}});
  const dir=path.join(s.themesRoot,id),before=await fs.readFile(path.join(dir,'theme.json')),layout=await fs.readFile(path.join(dir,'layout.json'));
  const loaded=await s.editor.load(id);const model={id,name:'After',mode:loaded.mode,revision:loaded.revision,tokens:{single:loaded.images.single.token},paletteOverrides:{schemaVersion:1,dark:{scrim:{color:'#111111',alpha:0.2}}}};
  const broken=new ThemeEditor({...s,commit:async()=>{throw Error('commit failed');}});
  await assert.rejects(broken.save(model),/commit failed/);assert.deepEqual(await fs.readFile(path.join(dir,'theme.json')),before);
  const result=await s.editor.save(model);assert.equal(result.id,id);assert.deepEqual(await fs.readFile(path.join(dir,'layout.json')),layout);
  assert.equal((await loadThemePackage(dir)).manifest.name,'After');
  const fresh=await s.editor.load(id);await assert.rejects(s.editor.save({...model,tokens:{single:fresh.images.single.token}}),/changed/);
 }finally{await removeTemporaryDirectory(s.temp);}
});
test('no image, unknown tokens, and unsafe editor data do not publish a theme',async()=>{
 const s=await setup();try{
  await assert.rejects(s.editor.save({name:'No',mode:'dual',tokens:{}}));
  await assert.rejects(s.editor.save({name:'Bad',mode:'single',tokens:{single:'expired'}}));
  await assert.rejects(s.editor.save({name:'Bad',mode:'single',tokens:{},path:'../x'}));
  assert.deepEqual(await fs.readdir(s.themesRoot),[]);
 }finally{await removeTemporaryDirectory(s.temp);}
});
