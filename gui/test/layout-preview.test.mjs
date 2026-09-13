import test from 'node:test';
import assert from 'node:assert/strict';
import {bindLayoutPreview} from '../src/renderer/components/layout-preview.mjs';
import {editorLayoutConfig} from '../src/shared/wallpaper-layout.mjs';
import {calculateBackgroundLayout} from '../../scripts/layout-engine.mjs';
import {draftFingerprint} from '../src/renderer/components/editor-exit-guard.mjs';

test('preview renders exact existing engine geometry for each mode and resize, cleans observers',()=>{
 let queued,resize,disconnected=0;
 const viewport={clientWidth:300,clientHeight:160};
 const win={requestAnimationFrame:f=>{queued=f;return 1;},cancelAnimationFrame:()=>{queued=null;},ResizeObserver:class{constructor(f){resize=f;}observe(){}disconnect(){disconnected++;}}};
 const image={style:{},naturalWidth:1600,naturalHeight:900,parentElement:viewport,ownerDocument:{defaultView:win},addEventListener(){},removeEventListener(){}};
 for(const mode of ['contain','cover','focus-soft']){
  const config=editorLayoutConfig({layoutMode:mode});
  const cleanup=bindLayoutPreview(image,config);
  queued();
  let result=calculateBackgroundLayout({width:1600,height:900},{width:viewport.clientWidth,height:viewport.clientHeight},config);
  assert.equal(image.style.width,`${result.renderedWidth}px`);assert.equal(image.style.left,`${result.offsetX}px`);
  viewport.clientWidth=180;resize();queued();
  result=calculateBackgroundLayout({width:1600,height:900},{width:180,height:160},config);
  assert.equal(image.style.height,`${result.renderedHeight}px`);assert.equal(image.style.top,`${result.offsetY}px`);
  cleanup();
 }
 assert.ok(disconnected>=3);
});
test('layout mode is part of unsaved editor fingerprint',()=>{
 const draft={name:'X',mode:'single',images:{},layoutMode:'contain'};
 assert.notEqual(draftFingerprint(draft),draftFingerprint({...draft,layoutMode:'cover'}));
});
