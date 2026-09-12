import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ThemeDuplicator} from '../src/main/services/theme-duplicate.mjs';
import {ThemeManagement,USER_MANAGEMENT} from '../src/main/services/theme-management.mjs';
import {ThemeCatalog} from '../src/main/services/theme-catalog.mjs';
import {ThemeCreator} from '../src/main/services/theme-creator.mjs';
import {ThemeEditor} from '../src/main/services/theme-editor.mjs';
import {WallpaperDrafts} from '../src/main/services/wallpaper-drafts.mjs';
import {loadThemePackage} from '../../scripts/theme-loader.mjs';
import {makeTemporaryDirectory,removeTemporaryDirectory,tinyPng} from './helpers.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
async function fixture(){
  const root=await makeTemporaryDirectory('duplicate 中文 space'),themesRoot=path.join(root,'themes');
  await fs.mkdir(themesRoot);
  for(const id of ['forest-scholar','phainon'])await fs.cp(path.join(project,'themes',id),path.join(themesRoot,id),{recursive:true});
  const management=new ThemeManagement({themesRoot}),catalog=new ThemeCatalog({themesRoot});
  return {root,themesRoot,management,catalog,duplicator:new ThemeDuplicator({management,catalog})};
}
async function snapshot(dir){
  const result={};
  for(const e of await fs.readdir(dir,{withFileTypes:true})){
    const target=path.join(dir,e.name);
    result[e.name]=e.isDirectory()?await snapshot(target):(await fs.readFile(target)).toString('base64');
  }return result;
}
test('protected and user duplicates retain all dependencies, unique IDs/names and source bytes',async()=>{
  const s=await fixture();
  try{
    const original=await snapshot(s.themesRoot);
    for(const sourceId of ['forest-scholar','phainon']){
      const source=await loadThemePackage(path.join(s.themesRoot,sourceId));
      const first=await s.duplicator.duplicate(sourceId),second=await s.duplicator.duplicate(sourceId);
      assert.notEqual(first.id,second.id);assert.match(first.id,/^user-[0-9a-f-]{36}$/);
      const dir=path.join(s.themesRoot,first.id),copy=await loadThemePackage(dir);
      assert.equal(copy.manifest.name,source.manifest.name+' Copy');
      assert.equal((await loadThemePackage(path.join(s.themesRoot,second.id))).manifest.name,source.manifest.name+' Copy (2)');
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'management.json'))),USER_MANAGEMENT);
      assert.deepEqual(copy.layoutConfig,source.layoutConfig);
      for(const mode of ['light','dark'])assert.deepEqual(copy.backgrounds[mode].bytes,source.backgrounds[mode].bytes);
      assert.deepEqual(copy.styles.map(s=>s.content),source.styles.map(s=>s.content));
      const third=await s.duplicator.duplicate(first.id);
      assert.notEqual(third.id,first.id);
      assert.deepEqual(await snapshot(path.join(s.themesRoot,sourceId)),original[sourceId]);
    }
  }finally{await removeTemporaryDirectory(s.root);}
});
test('Universal palette/default/dual wallpaper and layout survive an independent copy',async()=>{
  const s=await fixture();
  try{
    const creator=new ThemeCreator({themesRoot:s.themesRoot,validateImage:()=>{}}),drafts=new WallpaperDrafts(creator);
    const editor=new ThemeEditor({creator,drafts,management:s.management});
    const image=await drafts.prepare('one.png',tinyPng);
    const palette={schemaVersion:1,light:{accent:{color:'#123456',alpha:0.7}},dark:{}};
    const source=await editor.save({name:'Palette',mode:'dual',tokens:{light:image.token,dark:image.token},paletteOverrides:palette});
    const copy=await s.duplicator.duplicate(source.id);
    const dir=path.join(s.themesRoot,copy.id),pkg=await loadThemePackage(dir);
    assert.deepEqual(pkg.manifest.paletteOverrides,palette);
    await fs.rename(path.join(s.themesRoot,source.id),path.join(s.root,'removed-source'));
    assert.deepEqual((await loadThemePackage(dir)).backgrounds.dark.bytes,tinyPng);
    assert.deepEqual(await fs.readFile(path.join(dir,pkg.manifest.background.default)),tinyPng);
  }finally{await removeTemporaryDirectory(s.root);}
});
test('failed publish leaves no partial package or staging directory and leaves source intact',async()=>{
  const s=await fixture();
  try{
    const before=await snapshot(s.themesRoot);
    const broken=new ThemeDuplicator({...s,commit:async()=>{throw Error('publish failed');}});
    await assert.rejects(broken.duplicate('forest-scholar'),/publish failed/);
    assert.deepEqual(await snapshot(s.themesRoot),before);
    assert.deepEqual(await fs.readdir(path.join(s.root,'runtime','theme-creation')),[]);
  }finally{await removeTemporaryDirectory(s.root);}
});
test('Custom copy opens and saves in editor without losing CSS/layout or editing protected source',async()=>{
  const s=await fixture();
  try{
    const before=await snapshot(path.join(s.themesRoot,'forest-scholar'));
    const copy=await s.duplicator.duplicate('forest-scholar');
    const creator=new ThemeCreator({themesRoot:s.themesRoot,validateImage:()=>{}}),drafts=new WallpaperDrafts(creator);
    const editor=new ThemeEditor({creator,drafts,management:s.management});
    await assert.rejects(editor.load('forest-scholar'),/Only user/);
    const model=await editor.load(copy.id);assert.equal(model.customStyles,true);assert.equal(model.mode,'dual');
    const pkgBefore=await loadThemePackage(path.join(s.themesRoot,copy.id));
    await editor.save({id:copy.id,name:'Edited copy',mode:model.mode,revision:model.revision,
      tokens:Object.fromEntries(Object.entries(model.images).map(([k,v])=>[k,v.token]))});
    const after=await loadThemePackage(path.join(s.themesRoot,copy.id));
    assert.deepEqual(after.styles.map(s=>s.content),pkgBefore.styles.map(s=>s.content));
    assert.deepEqual(after.layoutConfig,pkgBefore.layoutConfig);
    assert.deepEqual(await snapshot(path.join(s.themesRoot,'forest-scholar')),before);
  }finally{await removeTemporaryDirectory(s.root);}
});
