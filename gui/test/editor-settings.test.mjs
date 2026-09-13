import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {beginEditorSettings,changeEditorPolicy,themeSettingsAction,saveUnifiedDraft} from '../src/renderer/components/editor-settings.mjs';
import {createEditorExitGuard} from '../src/renderer/components/editor-exit-guard.mjs';

test('user entry edits, protected/development entry copies, no selection does nothing',()=>{
 assert.equal(themeSettingsAction({management:{renamable:true}}),'edit');
 assert.equal(themeSettingsAction({management:{protected:true,renamable:false}}),'copy');
 assert.equal(themeSettingsAction({management:{origin:'development',renamable:false}}),'copy');
 assert.equal(themeSettingsAction(null),'none');
});
test('Advanced back preserves draft; policy dirty guard supports Stay/Discard without publishing',async()=>{
 const settings=beginEditorSettings('follow-codex');let choice='stay',closed=false;
 const guard=createEditorExitGuard({readDraft:()=>({name:'X',mode:'single',images:{},policy:settings.policy}),ask:async()=>choice,save:async()=>false,close:()=>{closed=true;}});
 guard.begin();settings.view='advanced';assert.equal(guard.dirty(),false);
 changeEditorPolicy(settings,'force-dark');settings.view='basic';assert.equal(settings.policy,'force-dark');assert.equal(guard.dirty(),true);
 assert.equal(await guard.request(),false);assert.equal(closed,false);
 choice='discard';assert.equal(await guard.request(),true);assert.equal(closed,true);
});
test('policy only accepted after whole theme save succeeds; failure/cancel retain pending state',async()=>{
 const draft=beginEditorSettings('force-light');let pending='follow-codex';
 for(const result of [null,{canceled:true}]){
  await saveUnifiedDraft(draft,async()=>result,p=>{pending=p;});assert.equal(pending,'follow-codex');
 }
 await assert.rejects(saveUnifiedDraft(draft,async()=>{throw Error('disk');},p=>{pending=p;}));
 assert.equal(pending,'follow-codex');
 await saveUnifiedDraft(draft,async()=>({ok:true}),p=>{pending=p;});assert.equal(pending,'force-light');
});
test('single editor shares menu and right entry, never persists policy into theme model',async()=>{
 const source=await readFile(new URL('../src/renderer/app.mjs',import.meta.url),'utf8');
 assert.match(source,/onEdit: openEditor/);assert.match(source,/else if\(theme\)void openEditor\(theme\)/);
 assert.match(source,/saveUnifiedDraft\(editorSettings/);
 assert.match(source,/policy:editorSettings.policy/);
 const model=source.match(/const model=\{id:editorModel.id[^\n]+/)[0];
 assert.doesNotMatch(model,/policy|skinAdaptation/);
});
