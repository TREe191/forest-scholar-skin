import test from 'node:test';
import assert from 'node:assert/strict';
import {renderWallpaperSlots, switchWallpaperMode, replaceWallpaper} from '../src/renderer/components/wallpaper-slots.mjs';
class Element {
  constructor(tag,doc){this.tag=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.events={};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(){this.children=[];}
  addEventListener(name,fn){this.events[name]=fn;}
}
const doc={createElement:tag=>new Element(tag,doc)};
const image=token=>({token,name:token+'.png',preview:'skin-preview://draft/'+token+'/image'});
function render(model,busy=false){
  const root=doc.createElement('div'), calls=[];
  renderWallpaperSlots(root,model,{busy,choose:s=>calls.push(['choose',s]),clear:s=>calls.push(['clear',s]),drop:s=>calls.push(['drop',s])});
  return {root,calls};
}
test('single has one slot; existing dual has two independent previews and actions',()=>{
  assert.equal(render({mode:'single',images:{}}).root.children.length,1);
  const {root,calls}=render({mode:'dual',images:{light:image('L'),dark:image('D')}});
  assert.deepEqual(root.children.map(c=>c.children[0].textContent),['Light wallpaper','Dark wallpaper']);
  assert.deepEqual(root.children.map(c=>c.children[1].children[0].src),[image('L').preview,image('D').preview]);
  root.children[0].children[3].events.click();
  root.children[1].children[4].events.click();
  root.children[1].events.drop({preventDefault(){},stopPropagation(){}});
  assert.deepEqual(calls,[['choose','light'],['clear','dark'],['drop','dark']]);
});
test('empty dual slot states fallback; busy slots cannot accept drops',()=>{
  const {root,calls}=render({mode:'dual',images:{light:image('L')}},true);
  const dark=root.children[1];
  assert.equal(dark.children[2].textContent,'Not set — uses the other wallpaper as fallback');
  assert.equal(dark.children[1].children[0].hidden,false);
  assert.equal(dark.children[1].children[0].src,image('L').preview);
  assert.equal(dark.children[3].disabled,true);
  dark.events.drop({preventDefault(){},stopPropagation(){}});
  assert.equal(calls.length,0);
});
test('mode round trips retain both images and never revoke shared tokens',()=>{
  const model={mode:'dual',images:{light:image('L'),dark:image('D')}};
  switchWallpaperMode(model,'single');
  assert.equal(model.images.single.token,'L');
  switchWallpaperMode(model,'dual');
  assert.equal(replaceWallpaper(model,'light',image('new')),null);
  assert.equal(model.images.dark.token,'D');
  assert.equal(model.images.single.token,'L');
  assert.equal(replaceWallpaper(model,'dark',null),'D');
  switchWallpaperMode(model,'single');
  assert.equal(model.images.single.token,'L');
  switchWallpaperMode(model,'dual');
  assert.equal(model.images.light.token,'new');
  assert.equal(model.images.dark,undefined);
});
test('single seeds empty dual, while populated slots are preserved',()=>{
  const model={mode:'single',images:{single:image('S')}};
  switchWallpaperMode(model,'dual');
  assert.equal(model.images.light.token,'S');
  assert.equal(replaceWallpaper(model,'light',image('L')),null);
  switchWallpaperMode(model,'single');switchWallpaperMode(model,'dual');
  assert.equal(model.images.light.token,'L');
  assert.throws(()=>switchWallpaperMode(model,'invalid'));
});
