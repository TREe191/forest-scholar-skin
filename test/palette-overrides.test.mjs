import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PALETTE_TOKENS,validatePaletteOverrides,paletteOverridesCss} from '../scripts/palette-overrides.mjs';
import {loadThemePayload} from '../scripts/theme-payload.mjs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
test('palette validates all controlled tokens and rejects CSS/unknown data',()=>{
 for(const token of Object.keys(PALETTE_TOKENS))for(const alpha of [0,0.5,1])assert.equal(validatePaletteOverrides({schemaVersion:1,light:{[token]:{color:'#123aBC',alpha}}}).light[token].alpha,alpha);
 for(const value of [{schemaVersion:2},{schemaVersion:1,css:'body{}'},{schemaVersion:1,light:{unknown:{color:'#ffffff',alpha:1}}},...['red','#fff','#ffffff;url(x)'].map(color=>({schemaVersion:1,light:{accent:{color,alpha:1}}})),...[-1,2,NaN,'0.5'].map(alpha=>({schemaVersion:1,dark:{scrim:{color:'#ffffff',alpha}}}))])assert.throws(()=>validatePaletteOverrides(value));
 assert.equal(paletteOverridesCss(undefined),'');
});
test('generated overrides are Universal scoped, local fade tokens override tone-specific rules',()=>{
 const css=paletteOverridesCss({schemaVersion:1,light:{bottomFade:{color:'#ffffff',alpha:0.3},topFade:{color:'#123456',alpha:0.6}},dark:{foreground:{color:'#eeeeee',alpha:1}}});
 assert.match(css,/data-skin-visual-adaptation="universal"/);assert.match(css,/data-skin-adaptation="light"\]\[data-skin-background-tone\]/);
 assert.match(css,/work-gradient-middle: rgba\(255, 255, 255, 0.1\)/);
 assert.match(css,/MainContentTopFade/);assert.doesNotMatch(css,/url\(|@import|height:|position:/);
});
test('palette schema token set matches validator; Custom payload order is unchanged',async()=>{
 const schema=JSON.parse(await fs.readFile(root+'themes/palette.schema.json','utf8'));
 assert.deepEqual(Object.keys(schema.$defs.palette.properties).sort(),Object.keys(PALETTE_TOKENS).sort());
 for(const id of ['forest-scholar','phainon']){const p=await loadThemePayload(root,root+'themes/'+id,'Auto');assert.equal(p.theme.visualAdaptation,'custom');assert.equal(p.backgroundTones,undefined);}
});
