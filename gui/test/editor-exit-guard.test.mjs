import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditorExitGuard,draftFingerprint} from '../src/renderer/components/editor-exit-guard.mjs';
const draft=()=>({name:'Initial name',mode:'dual',images:{light:{token:'light',preview:'preview1'},dark:{token:'dark'}},paletteOverrides:{schemaVersion:1,light:{},dark:{}}});
function fixture(choice='stay',saveSuccess=true){
  const model=draft(),events=[];
  const guard=createEditorExitGuard({
    readDraft:()=>model,
    ask:async()=>{events.push('ask');return choice;},
    save:async()=>{events.push('save');if(saveSuccess)events.push('close');return saveSuccess;},
    close:()=>events.push('close'),
  });
  guard.begin();return {model,events,guard};
}
test('unchanged Create/Edit exits without prompting; preview metadata is not dirty',async()=>{
  const {model,events,guard}=fixture();
  model.images.light.preview='loaded-preview';model.images.light.name='display filename';
  assert.equal(guard.dirty(),false);
  assert.equal(await guard.request(),true);
  assert.deepEqual(events,['close']);
  model.name='Auto generated name';guard.begin();
  assert.equal(guard.dirty(),false);
});
for(const [name,change] of [
  ['rename',m=>m.name='Changed'],
  ['light image',m=>m.images.light={token:'new'}],
  ['dark image',m=>m.images.dark={token:'new'}],
  ['mode',m=>m.mode='single'],
  ['palette',m=>m.paletteOverrides.dark.accent={color:'#123456',alpha:0.5}],
]){
  test(name+' prompts; Cancel/Stay preserves draft',async()=>{
    const {model,events,guard}=fixture();change(model);
    assert.equal(guard.dirty(),true);
    assert.equal(await guard.request(),false);
    assert.deepEqual(events,['ask']);
    assert.equal(guard.dirty(),true);
  });
}
test('Discard closes without calling save',async()=>{
  const {model,events,guard}=fixture('discard');model.name='changed';
  assert.equal(await guard.request(),true);
  assert.deepEqual(events,['ask','close']);
});
test('Save success closes; failure keeps editor dirty/open',async()=>{
  for(const success of [true,false]){
    const {model,events,guard}=fixture('save',success);model.name='changed';
    assert.equal(await guard.request(),success);
    assert.deepEqual(events,success?['ask','save','close']:['ask','save']);
    if(!success)assert.equal(guard.dirty(),true);
  }
});
test('reverting edits restores clean; duplicate exit requests cannot prompt twice',async()=>{
  const model=draft(),initial=draftFingerprint(model);model.name='change';model.name='Initial name';
  assert.equal(draftFingerprint(model),initial);
  let resolve,asks=0;
  const guard=createEditorExitGuard({readDraft:()=>model,ask:()=>{asks++;return new Promise(r=>resolve=r);},save:async()=>true,close(){}});
  guard.begin();model.name='change';
  const first=guard.request();
  assert.equal(await guard.request(),false);
  resolve('stay');await first;assert.equal(asks,1);
});
