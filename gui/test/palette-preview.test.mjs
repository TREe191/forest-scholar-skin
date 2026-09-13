import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  PALETTE_PREVIEW_TARGETS,PALETTE_TOKEN_DESCRIPTIONS,UNIVERSAL_PREVIEW_FALLBACKS,
  alphaToPercent,palettePreviewValue,palettePreviewVariables,percentToAlpha,renderPalettePreview,renderPalettePreviewLayout,
} from '../src/renderer/components/palette-preview.mjs';

const tokens=['accent','foreground','foregroundMuted','sidebarSurface','mainContentSurface','chromeSurface','topbarSurface','divider','scrim','topFade','bottomFade'];

test('preview covers every existing palette schema token and maps it to a visible region',async()=>{
  const schema=JSON.parse(await readFile(new URL('../../themes/palette.schema.json',import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(schema.$defs.palette.properties),tokens);
  assert.deepEqual(Object.keys(PALETTE_TOKEN_DESCRIPTIONS),tokens);
  assert.deepEqual(Object.keys(PALETTE_PREVIEW_TARGETS),tokens);
  for(const token of tokens)assert.ok(PALETTE_PREVIEW_TARGETS[token].length>0);
});

test('unchecked values use stable light/dark Universal fallbacks; overrides update computed CSS',()=>{
  assert.deepEqual(palettePreviewValue({},'light','accent'),{color:'#52687a',alpha:1});
  assert.deepEqual(palettePreviewValue({},'dark','sidebarSurface'),{color:'#14161a',alpha:.9});
  const palette={light:{accent:{color:'#123456',alpha:.25}}};
  assert.deepEqual(palettePreviewValue(palette,'light','accent'),palette.light.accent);
  const variables=palettePreviewVariables(palette,'light');
  assert.equal(variables['--palette-preview-accent'],'rgba(18, 52, 86, 0.25)');
  assert.equal(variables['--palette-preview-foreground'],'rgba(32, 36, 40, 1)');
});

test('preview fallbacks remain aligned with the Universal base variables',async()=>{
  const css=await readFile(new URL('../../styles/base.css',import.meta.url),'utf8');
  for(const [mode,expected] of [['light',['#52687a','rgba(32, 36, 40, 0.68)','rgba(248, 248, 246, 0.94)']],['dark',['#93afc4','rgba(238, 241, 243, 0.72)','rgba(20, 22, 26, 0.94)']]]){
    for(const value of expected)assert.ok(css.includes(value),`${mode} Universal fallback ${value}`);
    assert.ok(UNIVERSAL_PREVIEW_FALLBACKS[mode].topFade);
  }
});

test('percentage opacity round-trips to the unchanged 0-1 storage meaning',()=>{
  assert.equal(alphaToPercent(.37),37);assert.equal(percentToAlpha(37),.37);
  assert.equal(alphaToPercent(2),100);assert.equal(percentToAlpha(-4),0);
});

test('render applies current values and highlights all matching regions only',()=>{
  const classes=()=>{const values=new Set();return {toggle:(name,on)=>on?values.add(name):values.delete(name),has:name=>values.has(name)};};
  const regions=[
    {dataset:{paletteRegions:'accent foreground'},classList:classes()},
    {dataset:{paletteRegions:'sidebarSurface divider'},classList:classes()},
  ];
  const values={};
  const root={dataset:{},style:{setProperty:(name,value)=>{values[name]=value;}},querySelectorAll:()=>regions};
  renderPalettePreview(root,{palette:{dark:{accent:{color:'#abcdef',alpha:.5}}},mode:'dark',highlightedToken:'accent'});
  assert.equal(root.dataset.previewMode,'dark');assert.equal(values['--palette-preview-accent'],'rgba(171, 205, 239, 0.5)');
  assert.equal(regions[0].classList.has('is-token-highlighted'),true);assert.equal(regions[1].classList.has('is-token-highlighted'),false);
});

test('preview layout defaults safely to sticky and can return to normal flow',()=>{
  const values=new Set(),attributes={};
  const card={dataset:{},classList:{toggle:(name,on)=>on?values.add(name):values.delete(name)}};
  const buttons=['sticky','normal'].map(layout=>({dataset:{palettePreviewLayout:layout},setAttribute:(name,value)=>{attributes[`${layout}:${name}`]=value;}}));
  assert.equal(renderPalettePreviewLayout(card,buttons),'sticky');
  assert.equal(card.dataset.previewLayout,'sticky');assert.ok(values.has('is-sticky'));
  assert.equal(attributes['sticky:aria-pressed'],'true');assert.equal(attributes['normal:aria-pressed'],'false');
  assert.equal(renderPalettePreviewLayout(card,buttons,'normal'),'normal');assert.equal(values.has('is-sticky'),false);
  assert.equal(attributes['sticky:aria-pressed'],'false');assert.equal(attributes['normal:aria-pressed'],'true');
});

test('Advanced mock contains the named Codex regions and immediate input bindings',async()=>{
  const html=await readFile(new URL('../src/renderer/index.html',import.meta.url),'utf8');
  const app=await readFile(new URL('../src/renderer/app.mjs',import.meta.url),'utf8');
  const component=await readFile(new URL('../src/renderer/components/palette-preview.mjs',import.meta.url),'utf8');
  for(const marker of ['palette-preview-topbar','palette-preview-sidebar','palette-preview-main','palette-preview-composer','palette-preview-top-fade','palette-preview-bottom-fade'])assert.ok(html.includes(marker));
  for(const token of tokens)assert.ok(html.includes(`data-palette-regions="${token}`)||html.includes(` ${token}`)||app.includes(`token=${token}`));
  assert.match(app,/color\.addEventListener\('input',update\)/);assert.match(app,/alpha\.addEventListener\('input',update\)/);
  assert.match(app,/percentToAlpha\(r\.alpha\.value\)/);assert.doesNotMatch(component,/launchCodex|CDP|webSocket|chat content/i);
});

test('sticky preview is default, scoped to the Advanced scroll container, and exposes Normal mode',async()=>{
  const html=await readFile(new URL('../src/renderer/index.html',import.meta.url),'utf8');
  const css=await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8');
  const app=await readFile(new URL('../src/renderer/app.mjs',import.meta.url),'utf8');
  assert.match(html,/data-palette-preview-layout="sticky" aria-pressed="true">Sticky preview/);
  assert.match(html,/data-palette-preview-layout="normal" aria-pressed="false">Normal preview/);
  assert.match(css,/\.modal-content \{[^}]*overflow-y:auto/);assert.match(css,/\.palette-preview-card\.is-sticky \{ position:sticky; top:10px; z-index:6;/);
  assert.match(app,/palettePreviewLayout='sticky'/);assert.match(app,/renderPalettePreviewLayout\(palettePreviewCard/);
  assert.doesNotMatch(css,/body[^{}]*\{[^}]*position:sticky/s);
});
