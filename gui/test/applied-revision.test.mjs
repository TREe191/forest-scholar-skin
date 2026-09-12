import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { themeContentRevision } from '../src/main/services/theme-revision.mjs';
import { isSelectionDirty } from '../src/shared/applied-state.mjs';
import { AppConfigStore } from '../src/main/services/app-config.mjs';
import { makeTemporaryDirectory, removeTemporaryDirectory } from './helpers.mjs';

const fixture=()=>({
  manifest:{id:'test',paletteOverrides:{light:{accent:{color:'#123456',alpha:1}}}},
  layoutConfig:{light:{mode:'contain'},dark:{mode:'cover'}},
  backgrounds:{light:{bytes:Buffer.from('light')},dark:{bytes:Buffer.from('dark')}},
  styles:[{relativePath:'styles/theme.css',content:'original'}],
});
const selected=pkg=>({id:'test',contentRevision:themeContentRevision(pkg)});
test('stable revision ignores object key order/paths, detects wallpaper/layout/palette/CSS changes',()=>{
  const base=fixture(), hash=themeContentRevision(base);
  assert.equal(hash,themeContentRevision(fixture()));
  base.rootPath='different machine';base.mtime=Date.now();
  assert.equal(hash,themeContentRevision(base));
  for(const mutate of [
    p=>p.backgrounds.light.bytes=Buffer.from('new light'),
    p=>p.backgrounds.dark.bytes=Buffer.from('new dark'),
    p=>p.layoutConfig.light.mode='cover',
    p=>p.manifest.paletteOverrides.light.accent.alpha=0.5,
    p=>p.styles[0].content='changed',
  ]){
    const pkg=fixture();mutate(pkg);
    assert.notEqual(themeContentRevision(pkg),hash);
    assert.equal(isSelectionDirty(selected(pkg),'test','auto',{themeId:'test',appearance:'auto',contentRevision:hash}),true);
  }
});
test('same ID/revision is clean; switching away and back preserves correct state',()=>{
  const t=selected(fixture()), applied={themeId:'test',appearance:'auto',contentRevision:t.contentRevision};
  assert.equal(isSelectionDirty(t,'test','auto',applied),false);
  assert.equal(isSelectionDirty({...t,id:'other'},'test','auto',applied),true);
  assert.equal(isSelectionDirty(t,'test','auto',applied),false);
  assert.equal(isSelectionDirty(t,'test','dark',applied),true);
  assert.equal(isSelectionDirty(t,'test','auto',null),true);
});
test('Apply persists revision across reopen and clears dirty; failed receipt write rolls config back',async()=>{
  const root=await makeTemporaryDirectory('applied-revision');
  try {
    const configPath=path.join(root,'app.json');
    await fs.writeFile(configPath,JSON.stringify({schemaVersion:1,activeTheme:'test',appearance:'auto'}));
    const store=new AppConfigStore({configPath}), t=selected(fixture());
    assert.equal(await store.readApplied(),null);
    await store.apply({activeTheme:'test',appearance:'auto'},{themeExists:()=>true,contentRevision:t.contentRevision});
    const applied=await new AppConfigStore({configPath}).readApplied();
    assert.equal(isSelectionDirty(t,'test','auto',applied),false);
    const broken=new AppConfigStore({configPath,fileSystem:{...fs,writeFile:async()=>{throw Error('disk failure');}}});
    await assert.rejects(broken.apply({activeTheme:'test',appearance:'dark'},{themeExists:()=>true,contentRevision:t.contentRevision}));
    assert.equal((await store.read()).appearance,'auto');
    assert.deepEqual(await store.readApplied(),applied);
  } finally {await removeTemporaryDirectory(root);}
});
