import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {GuiPreferences,validateGuiPreferences} from '../src/main/services/gui-preferences.mjs';
import {translate,zh} from '../src/shared/i18n.mjs';
import {resolveManagerAppearance,translatedRecord} from '../src/renderer/ui-preferences.mjs';
import {makeTemporaryDirectory,removeTemporaryDirectory} from './helpers.mjs';

test('GUI settings persist independently on Chinese/space paths; invalid input rejected',async()=>{
  const root=await makeTemporaryDirectory('界面 settings');
  try{
    const filePath=path.join(root,'.gui-settings.json'),store=new GuiPreferences({filePath});
    assert.deepEqual(await store.read(),{appearance:'system',language:'en'});
    await store.save({appearance:'light',language:'zh'});
    assert.deepEqual(await new GuiPreferences({filePath}).read(),{appearance:'light',language:'zh'});
    assert.throws(()=>store.save({appearance:'auto',language:'zh'}));
    assert.throws(()=>validateGuiPreferences({appearance:'system',language:'en',activeTheme:'x'}));
    assert.deepEqual(await fs.readdir(root),['.gui-settings.json']);
  }finally{await removeTemporaryDirectory(root);}
});
test('atomic preferences failure keeps old value; concurrent writes serialize',async()=>{
  const root=await makeTemporaryDirectory('preferences-failure');
  try{
    const filePath=path.join(root,'settings.json'),store=new GuiPreferences({filePath});
    await store.save({appearance:'dark',language:'en'});
    const broken=new GuiPreferences({filePath,fileSystem:{...fs,rename:async()=>{throw Error('disk failure');}}});
    await assert.rejects(broken.save({appearance:'light',language:'zh'}));
    assert.deepEqual(await store.read(),{appearance:'dark',language:'en'});
    await Promise.all([store.save({appearance:'system',language:'zh'}),store.save({appearance:'light',language:'en'})]);
    assert.deepEqual(await store.read(),{appearance:'light',language:'en'});
    assert.deepEqual(await fs.readdir(root),['settings.json']);
  }finally{await removeTemporaryDirectory(root);}
});
test('System follows current OS signal; explicit modes ignore that signal',()=>{
  assert.equal(resolveManagerAppearance('system',true),'dark');
  assert.equal(resolveManagerAppearance('system',false),'light');
  assert.equal(resolveManagerAppearance('light',true),'light');
  assert.equal(resolveManagerAppearance('dark',false),'dark');
});
test('shared i18n covers core UI and preserves inserted user names',()=>{
  for(const key of ['Themes','Preview','Apply changes','Launch Codex','Restore Codex','Advanced adaptation',
    'Create Theme / Add Wallpaper','Edit Theme','Duplicate','Rename','Delete theme','Changes not applied',
    'No valid theme selected','Settings could not be saved.','Codex UI preview','Illustrative mock — no Codex window or chat content is used.',
    'Hover or select a token to highlight its UI region.','Buttons and selected states','Composer and floating panels',
    'Preview scroll behavior','Sticky preview','Normal preview','Created by TREe191',
    'This is an unofficial community project and is not affiliated with or endorsed by OpenAI or HoYoverse.']){
    assert.ok(zh[key]);assert.notEqual(translate(key,'zh'),key);assert.equal(translate(key,'en'),key);
  }
  assert.equal(translate('Delete “My Theme / 我的主题”？','en'),'Delete “My Theme / 我的主题”？');
  assert.equal(translate('Delete “Rename”?','zh'),'删除“Rename”？');
  assert.equal(translate('Active: Rename · Follow Codex','zh'),'已应用：Rename · 跟随 Codex');
});
test('localization preserves source and responds to new renders without looping',()=>{
  const chinese=translatedRecord(null,'  Preview  ','zh');
  assert.equal(chinese.output,'  预览  ');
  assert.deepEqual(translatedRecord(chinese,chinese.output,'zh'),chinese);
  assert.equal(translatedRecord(chinese,chinese.output,'en').output,'  Preview  ');
  assert.equal(translatedRecord(chinese,'Themes','zh').output,'主题');
});
test('GUI appearance/language controls are separate from preview/adaptation and protect theme text',async()=>{
  const html=await fs.readFile(new URL('../src/renderer/index.html',import.meta.url),'utf8');
  const source=await fs.readFile(new URL('../src/renderer/ui-preferences.mjs',import.meta.url),'utf8');
  assert.match(html,/id="manager-appearance"/);assert.match(html,/id="manager-language"/);
  assert.match(source,/prefers-color-scheme: dark/);assert.match(source,/addEventListener\('change',apply\)/);
  assert.match(source,/#theme-name, #theme-description, \.theme-item-name, \.wallpaper-filename/);
  assert.doesNotMatch(source,/applyConfig|previewVariant|launchCodex|saveEditor/);
});
