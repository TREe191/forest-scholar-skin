import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderThemePreview } from '../src/renderer/components/theme-preview.mjs';

function elements() {
  return Object.fromEntries(['image','placeholder','name','version','author','adaptation','description','subtitle']
    .map(key=>[key,{hidden:false,complete:false,naturalWidth:0,removeAttribute(name){delete this[name];}}]));
}
function theme(light='skin-preview://theme/light',dark=light) {
  return {name:'Test',version:'1',author:'test',previews:{light,dark}};
}
function loaded(e) {e.image.naturalWidth=100;e.image.onload();}

test('single wallpaper: both variants hide empty overlay after successful load',()=>{
  const e=elements(), t=theme();
  renderThemePreview(e,t,'light');loaded(e);
  assert.equal(e.placeholder.hidden,true);
  assert.equal(e.image.hidden,false);
  renderThemePreview(e,t,'dark');
  assert.equal(e.placeholder.hidden,true);
  assert.equal(e.image.hidden,false);
});
test('dual wallpapers: switch and ignore stale load/error callbacks',()=>{
  const e=elements(),t=theme('skin-preview://theme/light','skin-preview://theme/dark');
  renderThemePreview(e,t,'light');
  const staleError=e.image.onerror,staleLoad=e.image.onload;
  renderThemePreview(e,t,'dark');loaded(e);
  staleError();
  assert.equal(e.placeholder.hidden,true);
  e.image.onerror();
  staleLoad();
  assert.equal(e.placeholder.hidden,false);
  renderThemePreview(e,t,'light');loaded(e);
  assert.equal(e.placeholder.hidden,true);
});
test('missing theme or preview and load failure show empty state; valid selection recovers',()=>{
  const e=elements();
  renderThemePreview(e,null,'light');
  assert.equal(e.placeholder.hidden,false);
  renderThemePreview(e,{name:'Missing',previews:{}},'light');
  assert.equal(e.placeholder.hidden,false);
  renderThemePreview(e,theme(),'light');e.image.onerror();
  assert.equal(e.image.hidden,true);
  assert.equal(e.placeholder.hidden,false);
  renderThemePreview(e,null,'light');
  renderThemePreview(e,theme(),'light');loaded(e);
  assert.equal(e.placeholder.hidden,true);
});
test('cached loaded image hides overlay and hidden styles override grid/block',async()=>{
  const e=elements();e.image.complete=true;e.image.naturalWidth=120;
  renderThemePreview(e,theme(),'light');
  assert.equal(e.placeholder.hidden,true);
  const css=await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8');
  assert.match(css,/\.preview-canvas img\[hidden\], \.preview-placeholder\[hidden\]\s*\{\s*display:\s*none;/);
});
