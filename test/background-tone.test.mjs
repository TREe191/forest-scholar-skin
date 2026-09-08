import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { classifyBrightness, sampleBackgroundTone, analyzePngTone } from '../scripts/background-tone.mjs';
import { loadThemePayload } from '../scripts/theme-payload.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('brightness thresholds and invalid values', () => {
  for (const [v, tone] of [[0,'dark'],[0.349,'dark'],[0.35,'medium'],[0.699,'medium'],[0.70,'light'],[1,'light']]) assert.equal(classifyBrightness(v), tone);
  for (const v of [-1, 2, NaN, Infinity]) assert.throws(() => classifyBrightness(v));
});
test('pure sampler weights alpha and limits samples', () => {
  assert.equal(sampleBackgroundTone(Uint8Array.from([255,255,255,255,0,0,0,0]),2,1).tone,'light');
  assert.equal(sampleBackgroundTone(new Uint8Array(4),1,1).fallback,'transparent-image');
  assert.equal(sampleBackgroundTone(new Uint8Array(128*128*4).fill(255),128,128).samples,4096);
  assert.throws(() => sampleBackgroundTone([],1,1));
});

// Build synthetic RGB/RGBA rows, independently encoding each PNG filter.
function png(channels, filter) {
  const chunk = (name, data) => {
    const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); out.write(name,4); data.copy(out,8);
    // CRC is irrelevant to this optional sampler; package validation is separate.
    return out;
  };
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(2); ihdr.writeUInt32BE(2,4); ihdr[8]=8; ihdr[9]=channels===4?6:2;
  const pixels=[[240,230,220,255],[200,210,220,255],[180,190,200,255],[230,220,210,255]];
  const raw=[]; let prev=new Array(2*channels).fill(0);
  for(let y=0;y<2;y++) {
    const row=pixels.slice(y*2,y*2+2).flatMap(p=>p.slice(0,channels)); raw.push(filter);
    for(let x=0;x<row.length;x++) {
      const a=x>=channels?row[x-channels]:0,b=prev[x],c=x>=channels?prev[x-channels]:0;
      const predictors=[0,a,b,Math.floor((a+b)/2)];
      const target=a+b-c;
      const paeth=[a,b,c].reduce((best,v)=>Math.abs(target-v)<Math.abs(target-best)?v:best,a);
      raw.push((row[x]-(filter===4?paeth:predictors[filter])+256)%256);
    }
    prev=row;
  }
  return {bytes:Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from(raw))),chunk('IEND',Buffer.alloc(0))]),expected:sampleBackgroundTone(Uint8Array.from(pixels.flat()),2,2)};
}
test('PNG RGB/RGBA decode covers all five filters', () => {
  for(const channels of [3,4]) for(let filter=0;filter<=4;filter++) {
    const {bytes,expected}=png(channels,filter); assert.deepEqual(analyzePngTone(bytes),expected);
  }
});
test('unsupported, truncated and oversized analysis fail to neutral medium', () => {
  const {bytes}=png(3,0);
  const unsupported=Buffer.from(bytes); unsupported[28]=1;
  assert.equal(analyzePngTone(unsupported).fallback,'unsupported-png-encoding');
  const oversized=Buffer.from(bytes); oversized.writeUInt32BE(9_000_000,16);
  assert.equal(analyzePngTone(oversized).fallback,'analysis-size-limit');
  assert.equal(analyzePngTone(bytes.subarray(0,40)).tone,'medium');
  assert.equal(analyzePngTone(Buffer.from('invalid')).tone,'medium');
});
test('payload analyzes Universal once per background; Custom has no tone data', async () => {
  const payload=await loadThemePayload(root,root+'themes/universal-demo','Auto');
  assert.strictEqual(payload.backgroundTones.Light,payload.backgroundTones.Dark);
  assert.equal(payload.backgroundTones.Light.tone,'light');
  assert.equal(payload.backgroundTones.Light.fallback,null);
  for(const id of ['forest-scholar','phainon']) {
    const custom=await loadThemePayload(root,root+'themes/'+id,'Auto');
    assert.equal(custom.theme.visualAdaptation,'custom');
    assert.equal(Object.hasOwn(custom,'backgroundTones'),false);
  }
});
test('tone CSS is Universal Dark only and changes only five surface variables', async () => {
  const css=await fs.readFile(root+'styles/base.css','utf8');
  const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m=>m[1].includes('data-skin-background-tone'));
  assert.equal(rules.length,2);
  for(const [,selector,body] of rules) {
    assert.ok(selector.includes('[data-skin-visual-adaptation="universal"]'));
    assert.ok(selector.includes('[data-skin-adaptation="dark"]'));
    assert.deepEqual([...body.matchAll(/(--[\w-]+):/g)].map(m=>m[1]).sort(),[
      '--codex-skin-background-scrim','--codex-skin-main-wash','--codex-skin-chrome-surface','--codex-skin-sidebar-surface','--codex-skin-main-content-surface'].sort());
  }
});
test('root tone is mode-specific, observed, verified, bounded-healed and cleaned', async () => {
  const source=await fs.readFile(root+'scripts/injector.mjs','utf8');
  assert.match(source,/payload\.backgroundTones\?\.\[mode\]\?\.tone/);
  assert.match(source,/getAttribute\(toneAttribute\) === toneForMode\(targetMode\)/);
  assert.match(source,/setAttribute\(toneAttribute, toneForMode\(targetMode\)\)/);
  assert.match(source,/visualAdaptationAttribute, toneAttribute, 'style'/);
  assert.match(source,/backgroundToneMissing\) repaired\.push\('background-tone'\)/);
  assert.match(source,/visualAdaptationAttributeCorrect && backgroundToneCorrect &&/);
  assert.ok([...source.matchAll(/removeAttribute\(toneAttribute\)/g)].length>=4);
  assert.match(source,/removeAttribute\('data-skin-background-tone'\)/);
});

test('light-tone Dark restores reading wash without increasing chrome or scrim', async () => {
  const css=await fs.readFile(root+'styles/base.css','utf8');
  const selector='html.forest-scholar-skin:where([data-skin-visual-adaptation="universal"][data-skin-adaptation="dark"][data-skin-background-tone="light"])';
  const rule=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(m=>m[1].trim().endsWith(selector));
  assert.ok(rule);
  const values=Object.fromEntries([...rule[2].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m=>[m[1],m[2]]));
  assert.deepEqual(values, {
    '--codex-skin-background-scrim':'rgba(0, 0, 0, 0.03)',
    '--codex-skin-main-wash':'rgba(18, 20, 24, 0.18)',
    '--codex-skin-chrome-surface':'rgba(20, 22, 26, 0.72)',
    '--codex-skin-sidebar-surface':'rgba(20, 22, 26, 0.80)',
    '--codex-skin-main-content-surface':'rgba(18, 20, 24, 0.66)',
  });
  // Conservative flat-white backdrop, using only the main surface (no scrim
  // or additional wash). This is a numerical guard, not a visual acceptance test.
  const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4)
    .reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
  const alpha=Number(values['--codex-skin-main-content-surface'].match(/, ([\d.]+)\)$/)[1]);
  const backdrop=[18,20,24].map(v=>v*alpha+255*(1-alpha));
  for(const foreground of [[238,241,243],[232,229,215]]) {
    assert.ok((luminance(foreground)+0.05)/(luminance(backdrop)+0.05)>=4.5);
  }
});
