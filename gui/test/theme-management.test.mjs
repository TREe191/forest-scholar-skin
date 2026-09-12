import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ThemeCreator} from '../src/main/services/theme-creator.mjs';
import {ThemeManagement,readManagement} from '../src/main/services/theme-management.mjs';
import {WallpaperDrafts} from '../src/main/services/wallpaper-drafts.mjs';
import {ThemeCatalog} from '../src/main/services/theme-catalog.mjs';
import {registerIpcHandlers} from '../src/main/ipc.mjs';
import {IPC_CHANNELS} from '../src/shared/contracts.mjs';
import {makeTemporaryDirectory,removeTemporaryDirectory,tinyPng} from './helpers.mjs';

test('management metadata controls capabilities, reserved builtins remain protected',async()=>{
 const temp=await makeTemporaryDirectory('policy');try{
  const p={schemaVersion:1,origin:'user',protected:false,deletable:true,renamable:true};
  await fs.writeFile(path.join(temp,'management.json'),JSON.stringify(p));
  assert.equal((await readManagement(temp,{id:'no-prefix'})).deletable,true);
  for(const id of ['forest-scholar','phainon'])assert.equal((await readManagement(temp,{id})).deletable,false);
  for(const id of ['universal-demo','universal-dark-test'])assert.equal((await readManagement(temp,{id})).deletable,true);
  await fs.writeFile(path.join(temp,'management.json'),'bad');assert.equal((await readManagement(temp,{id:'unknown'})).protected,true);
 }finally{await removeTemporaryDirectory(temp);}
});

test('rename preserves id/assets, delete blocks active/pending, cancel preserves and deletion is recoverable',async()=>{
 const temp=await makeTemporaryDirectory('管理 中文');try{
  const themesRoot=path.join(temp,'themes');await fs.mkdir(themesRoot);
  const source=path.join(temp,'a.png');await fs.writeFile(source,tinyPng);
  const creator=new ThemeCreator({themesRoot,validateImage:()=>{},convertJpeg:()=>tinyPng});
  const {id}=await creator.create('Before',source);let activeTheme='phainon',confirm=true;
  const management=new ThemeManagement({themesRoot,configStore:{read:async()=>({activeTheme})},confirmDelete:async()=>confirm});
  await management.rename(id,'新名称');
  const manifest=JSON.parse(await fs.readFile(path.join(themesRoot,id,'theme.json'),'utf8'));assert.equal(manifest.name,'新名称');assert.equal(manifest.id,id);
  const catalog=new ThemeCatalog({themesRoot});assert.equal((await catalog.scan()).themes[0].name,'新名称');
  assert.deepEqual(catalog.getPreviewAsset(id,'light').bytes,tinyPng);
  const broken=new ThemeManagement({themesRoot,renameFile:async()=>{throw Error('write failure');}});
  await assert.rejects(broken.rename(id,'Lost'));assert.equal(JSON.parse(await fs.readFile(path.join(themesRoot,id,'theme.json'))).name,'新名称');
  activeTheme=id;await assert.rejects(management.delete(id,'phainon'),/active or selected/);
  activeTheme='phainon';await assert.rejects(management.delete(id,id),/active or selected/);
  confirm=false;assert.equal((await management.delete(id,'phainon')).canceled,true);
  confirm=true;await management.delete(id,'phainon');assert.equal((await catalog.scan()).themes.length,0);
  const recovered=await fs.readdir(path.join(temp,'runtime/deleted-themes'));assert.equal(recovered.length,1);
  assert.deepEqual(await fs.readFile(path.join(temp,'runtime/deleted-themes',recovered[0],'assets/background.png')),tinyPng);
  await assert.rejects(management.target('../outside'));
 }finally{await removeTemporaryDirectory(temp);}
});

test('draft selection previews without publishing; token and cancel guard creation',async()=>{
 const temp=await makeTemporaryDirectory('draft');try{
  const themesRoot=path.join(temp,'themes');await fs.mkdir(themesRoot);
  const drafts=new WallpaperDrafts(new ThemeCreator({themesRoot,validateImage:()=>{},convertJpeg:()=>tinyPng}));
  const image=await drafts.prepare('wallpaper.png',tinyPng);
  assert.match(image.preview,/^skin-preview:\/\/draft\//);assert.equal('path' in image,false);
  assert.deepEqual(drafts.asset(image.token).bytes,tinyPng);assert.deepEqual(await fs.readdir(themesRoot),[]);
  await assert.rejects(drafts.create('Wrong','unknown'));
  await assert.rejects(drafts.prepare('../bad.png',tinyPng));
  await assert.rejects(drafts.prepare('bad.jpg',tinyPng));
  const created=await drafts.create('Confirmed',image.token);assert.ok(created.id);assert.equal(drafts.asset(image.token),null);
  const second=await drafts.prepare('other.png',tinyPng);drafts.clear();await assert.rejects(drafts.create('Canceled',second.token));
 }finally{await removeTemporaryDirectory(temp);}
});

test('Apply cannot race an in-progress deletion confirmation',async()=>{
 const handlers=new Map();let release,applied=false;
 registerIpcHandlers({ipcMain:{handle:(k,v)=>handlers.set(k,v)},authorizedWebContentsId:1,
  catalog:{scan:async()=>({themes:[]}),has:()=>true,supportsAppearance:()=>true},
  configStore:{read:async()=>({activeTheme:'phainon'}),apply:async()=>{applied=true;}},
  management:{delete:()=>new Promise(r=>{release=r;})},actions:{}});
 const event={sender:{id:1},senderFrame:{parent:null}};
 const deletion=handlers.get(IPC_CHANNELS.deleteTheme)(event,{id:'universal-demo',pendingId:'phainon'});
 const apply=await handlers.get(IPC_CHANNELS.applyConfig)(event,{activeTheme:'universal-demo',appearance:'auto'});
 assert.equal(apply.ok,false);assert.equal(applied,false);release({canceled:true});assert.equal((await deletion).canceled,true);
});

test('active configuration changed during confirmation blocks removal',async()=>{
 const temp=await makeTemporaryDirectory('delete-recheck');try{
  const themesRoot=path.join(temp,'themes');await fs.mkdir(themesRoot);
  const source=path.join(temp,'a.png');await fs.writeFile(source,tinyPng);
  const creator=new ThemeCreator({themesRoot,validateImage:()=>{},convertJpeg:()=>tinyPng});const {id}=await creator.create('Safe',source);
  let activeTheme='phainon';const manager=new ThemeManagement({themesRoot,configStore:{read:async()=>({activeTheme})},confirmDelete:async()=>{activeTheme=id;return true;}});
  await assert.rejects(manager.delete(id,'phainon'),/active or selected/);
  assert.ok((await fs.stat(path.join(themesRoot,id))).isDirectory());
 }finally{await removeTemporaryDirectory(temp);}
});
