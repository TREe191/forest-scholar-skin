import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ThemeCreator, validateThemeName } from '../src/main/services/theme-creator.mjs';
import { ThemeCatalog } from '../src/main/services/theme-catalog.mjs';
import { registerIpcHandlers } from '../src/main/ipc.mjs';
import { IPC_CHANNELS } from '../src/shared/contracts.mjs';
import { loadThemePayload } from '../../scripts/theme-payload.mjs';
import { makeTemporaryDirectory, removeTemporaryDirectory, tinyPng } from './helpers.mjs';
const project = fileURLToPath(new URL('../../',import.meta.url));

test('PNG creates unique user packages, catalog previews, and Universal profiles on Chinese space paths', async () => {
  const temp = await makeTemporaryDirectory('创建 theme ');
  try {
    const themesRoot=path.join(temp,'themes'); await fs.mkdir(themesRoot);
    const source=path.join(temp,'背景 图片.PNG'); await fs.writeFile(source,tinyPng);
    const creator=new ThemeCreator({themesRoot,validateImage:()=>{},convertJpeg:()=>{throw Error('PNG must not convert');}});
    const results=await Promise.all([creator.create('同名 Theme',source),creator.create('同名 Theme',source)]);
    assert.notEqual(results[0].id,results[1].id);
    const catalog=new ThemeCatalog({themesRoot}); const snapshot=await catalog.scan();
    assert.equal(snapshot.themes.length,2); assert.equal(snapshot.invalidThemes.length,0);
    for(const {id} of results) {
      assert.match(id,/^user-[a-f0-9-]+$/);
      assert.equal(catalog.has(id),true);
      assert.deepEqual(catalog.getPreviewAsset(id,'light').bytes,tinyPng);
      const payload=await loadThemePayload(project,path.join(themesRoot,id),'Auto');
      assert.equal(payload.theme.visualAdaptation,'universal');
      assert.ok(payload.adaptationProfiles.Light);
      assert.equal(payload.layouts.Light.mode,'contain');
    }
    assert.deepEqual(await fs.readFile(source),tinyPng);
    assert.deepEqual(await fs.readdir(path.join(temp,'runtime/theme-creation')),[]);
  } finally {await removeTemporaryDirectory(temp);}
});

test('JPG uses converter, invalid files and publish failure leave no partial theme',async()=>{
  const temp=await makeTemporaryDirectory('creator-fail');
  try {
    const themesRoot=path.join(temp,'themes');await fs.mkdir(themesRoot);
    const source=path.join(temp,'image.jpg'), jpeg=Buffer.from([255,216,255,1]);await fs.writeFile(source,jpeg);
    let converted=0;
    const creator=new ThemeCreator({themesRoot,validateImage:()=>{},convertJpeg:bytes=>{assert.deepEqual(bytes,jpeg);converted++;return tinyPng;}});
    const created=await creator.create('JPG',source);assert.equal(created.converted,true);assert.equal(converted,1);
    assert.deepEqual(await fs.readFile(source),jpeg);
    const failed=new ThemeCreator({themesRoot,validateImage:()=>{},convertJpeg:()=>tinyPng,publish:()=>{throw Error('publish failed');}});
    await assert.rejects(failed.create('Failure',source),/publish failed/);
    await fs.writeFile(source,'not JPEG');await assert.rejects(creator.create('Invalid',source),/content/);
    assert.equal((await fs.readdir(themesRoot)).length,1);
    assert.deepEqual(await fs.readdir(path.join(temp,'runtime/theme-creation')),[]);
    for(const name of ['',null,'x'.repeat(81),'a\n']) assert.throws(()=>validateThemeName(name));
  } finally {await removeTemporaryDirectory(temp);}
});

test('creation IPC rejects paths/untrusted senders, handles cancel, serializes dialog, refreshes catalog',async()=>{
  const handlers=new Map();let release;let calls=0;
  const remove=registerIpcHandlers({ipcMain:{handle:(k,v)=>handlers.set(k,v),removeHandler:k=>handlers.delete(k)},authorizedWebContentsId:7,
    catalog:{scan:async()=>({themes:[{id:'user-test'}],invalidThemes:[]}),has:()=>true},configStore:{read:async()=>({activeTheme:'phainon',appearance:'auto'})},actions:{},
    pickWallpaper:()=>new Promise(resolve=>{release=resolve;}),creator:{create:async(name,source)=>{calls++;assert.equal(source,'main-only');return {id:'user-test'};}}});
  const handler=handlers.get(IPC_CHANNELS.createTheme),event={sender:{id:7},senderFrame:{parent:null}};
  assert.equal((await handler(event,{name:'x',sourcePath:'bad'})).ok,false);
  assert.equal((await handler({...event,sender:{id:8}},{name:'x'})).ok,false);
  const cancel=handler(event,{name:'x'});
  assert.equal((await handler(event,{name:'x'})).ok,false);release(null);assert.equal((await cancel).canceled,true);assert.equal(calls,0);
  const create=handler(event,{name:'x'});release('main-only');const result=await create;
  assert.equal(result.created.id,'user-test');assert.equal(result.themes.length,1);assert.equal(result.config.activeTheme,'phainon');
  remove();assert.equal(handlers.size,0);
});
