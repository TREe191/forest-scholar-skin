import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installUiPreferences} from '../src/renderer/ui-preferences.mjs';
import {translate} from '../src/shared/i18n.mjs';

test('appearance buttons persist modes, System reacts, failed save restores selection',async()=>{
  const element=(dataset={})=>({dataset,handlers:{},attrs:{},addEventListener(k,f){this.handlers[k]=f;},removeEventListener(k){delete this.handlers[k];},setAttribute(k,v){this.attrs[k]=v;}});
  const buttons=['dark','system','light'].map(mode=>element({managerMode:mode}));
  const language=element(),group={querySelectorAll:()=>buttons},error={};
  const media=element();media.matches=false;
  const doc={querySelector:s=>({'#manager-language':language,'#manager-appearance':group,'#manager-settings-error':error}[s]),
    defaultView:{matchMedia:()=>media},documentElement:{dataset:{}},body:{querySelectorAll:()=>[]},createTreeWalker:()=>({nextNode:()=>null})};
  const original=globalThis.MutationObserver;
  globalThis.MutationObserver=class{disconnect(){} observe(){}};
  const writes=[];let fail=false;
  try{
    const cleanup=installUiPreferences(doc,{getGuiPreferences:async()=>({ok:true,preferences:{language:'en',appearance:'system'}}),
      saveGuiPreferences:async p=>{writes.push(p);return fail?{ok:false,error:'disk'}:{ok:true,preferences:p};}});
    await new Promise(resolve=>setImmediate(resolve));
    for(const button of buttons){
      await button.handlers.click({currentTarget:button});
      assert.equal(writes.at(-1).appearance,button.dataset.managerMode);
      assert.equal(button.attrs['aria-pressed'],'true');
      assert.equal(button.disabled,false);
    }
    await buttons[1].handlers.click({currentTarget:buttons[1]});
    media.matches=true;media.handlers.change();assert.equal(doc.documentElement.dataset.managerAppearance,'dark');
    assert.equal(buttons[1].attrs['aria-pressed'],'true');
    fail=true;await buttons[2].handlers.click({currentTarget:buttons[2]});
    assert.equal(buttons[1].attrs['aria-pressed'],'true');
    assert.equal(doc.documentElement.dataset.managerAppearance,'dark');
    cleanup();assert.equal(buttons[0].handlers.click,undefined);
  }finally{globalThis.MutationObserver=original;}
});

test('compact icon order and translated tooltips; language remains a select',async()=>{
  const html=await readFile(new URL('../src/renderer/index.html',import.meta.url),'utf8');
  assert.match(html,/<select id="manager-language"/);
  assert.doesNotMatch(html,/<select id="manager-appearance"/);
  assert.deepEqual([...html.matchAll(/data-manager-mode="(.*?)"/g)].map(m=>m[1]),['dark','system','light']);
  for(const [key,value] of [['Dark','深色'],['System','跟随系统'],['Light','浅色']]){
    assert.ok(html.includes(`title="${key}" aria-label="${key}"`));assert.equal(translate(key,'zh'),value);
  }
});

test('editor and Advanced scroll internally with footer outside; portrait previews bounded',async()=>{
  const html=await readFile(new URL('../src/renderer/index.html',import.meta.url),'utf8');
  const css=await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8');
  for(const id of ['create-dialog']){
    const dialog=html.match(new RegExp(`<dialog id="${id}"[\\s\\S]*?</dialog>`))[0];
    assert.match(dialog,/class="modal-content"[\s\S]*<\/div>\s*<div class="modal-actions">/);
  }
  assert.match(css,/\.modal-content\s*\{[^}]*min-height:0;[^}]*overflow-y:auto;[^}]*overflow-x:hidden/);
  assert.match(css,/\.modal-actions\s*\{[^}]*flex-shrink:0/);
  assert.match(css,/#create-dialog, #adaptation-dialog\s*\{[^}]*100dvh - 32px[^}]*overflow:hidden/);
  assert.match(css,/\.wallpaper-slot img\s*\{[^}]*height:160px;[^}]*object-fit:contain/);
  assert.match(css,/\.theme-list\s*\{[^}]*overflow-y:auto;[^}]*overflow-x:hidden/);
});
