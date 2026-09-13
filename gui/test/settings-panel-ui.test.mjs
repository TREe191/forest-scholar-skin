import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderSettingsPanel} from '../src/renderer/components/settings-panel.mjs';
function elements(){
  return {adaptationInputs:['follow-codex','force-light','force-dark'].map(value=>({value})),
    ...Object.fromEntries(['summary','appliedNotice','advancedButton','advanced','pendingNotice','forceWarning','compatibilityWarning','applyButton','launchButton','restoreButton'].map(key=>[key,{}]))};
}
test('compact summary follows pending strategy and existing Apply/Launch dirty behavior',()=>{
  const e=elements(),theme={supportedAppearances:['light','dark']};
  for(const [mode,label] of [['follow-codex','Follow Codex'],['force-light','Force light skin'],['force-dark','Force dark skin']]){
    renderSettingsPanel(e,{skinAdaptation:mode,dirty:true,busy:false,theme});
    assert.equal(e.summary.textContent,'Adaptation: '+label);
    assert.equal(e.pendingNotice.hidden,false);
    assert.equal(e.appliedNotice.hidden,true);
    assert.equal(e.applyButton.disabled,false);
    assert.equal(e.launchButton.disabled,true);
    renderSettingsPanel(e,{skinAdaptation:mode,dirty:false,busy:false,theme});
    assert.equal(e.appliedNotice.hidden,false);
    assert.equal(e.pendingNotice.hidden,true);
    assert.equal(e.launchButton.disabled,false);
  }
});
test('unsupported forced mode and busy state keep original safety restrictions',()=>{
  const e=elements();
  renderSettingsPanel(e,{skinAdaptation:'force-dark',dirty:true,busy:false,theme:{supportedAppearances:['light']}});
  assert.equal(e.applyButton.disabled,true);assert.equal(e.launchButton.disabled,true);
  assert.equal(e.adaptationInputs[2].disabled,true);assert.equal(e.compatibilityWarning.hidden,false);
  renderSettingsPanel(e,{skinAdaptation:'follow-codex',dirty:false,busy:true,theme:{supportedAppearances:['light','dark']}});
  assert.equal(e.advancedButton.disabled,true);assert.equal(e.restoreButton.disabled,true);
});
test('unified editor owns Advanced policy/palette/rescan; primary actions stay outside',async()=>{
  const html=await readFile(new URL('../src/renderer/index.html',import.meta.url),'utf8');
  const dialog=html.match(/<dialog id="create-dialog"[\s\S]*?<\/dialog>/)[0];
  assert.doesNotMatch(html,/<dialog id="adaptation-dialog"/);
  assert.match(dialog,/<section id="editor-advanced" hidden/);
  for(const id of ['editor-basic','editor-policy-summary','editor-palette-summary','palette-fields','editor-advanced-back'])assert.ok(dialog.includes('id="'+id+'"'));
  for(const id of ['skin-adaptation-options','compatibility-warning','force-warning','rescan-button'])
    assert.ok(dialog.includes('id="'+id+'"'));
  assert.ok(dialog.includes('Codex appearance'));assert.ok(dialog.includes('Not detected'));
  for(const id of ['apply-button','launch-button','restore-button','pending-notice','adaptation-summary'])
    assert.ok(!dialog.includes('id="'+id+'"'));
  assert.equal((html.match(/id="rescan-button"/g)||[]).length,1);
});
