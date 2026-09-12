import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {themeActions,renderThemeList} from '../src/renderer/components/theme-list.mjs';
const user={id:'user-test',name:'Long '.repeat(80),version:'1.0',contentRevision:'r',management:{origin:'user',renamable:true,deletable:true,protected:false}};
test('protected/user/development menus retain existing permissions and delete safety',()=>{
  const options={activeTheme:'other',selectedTheme:'other',busy:false};
  assert.deepEqual(themeActions({...user,management:{protected:true}},options).map(a=>a.label),['Customize a copy']);
  assert.deepEqual(themeActions(user,options).map(a=>a.label),['Edit','Rename','Duplicate','Delete']);
  assert.deepEqual(themeActions({...user,management:{origin:'development',deletable:true}},options).map(a=>a.label),['Duplicate','Delete']);
  assert.equal(themeActions(user,{...options,selectedTheme:user.id}).at(-1).disabled,true);
  assert.equal(themeActions(user,{...options,activeTheme:user.id}).at(-1).disabled,true);
  assert.ok(themeActions(user,{...options,busy:true}).every(a=>a.disabled));
});
class Element {
  constructor(doc){this.ownerDocument=doc;this.children=[];this.dataset={};this.attrs={};this.events={};this.style={};}
  append(...items){this.children.push(...items);}
  replaceChildren(){this.children=[];}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(k,v){this.events[k]=v;}
  matches(){return Boolean(this.open);}
  showPopover(){this.open=true;}
  hidePopover(){this.open=false;}
  getBoundingClientRect(){return {right:240,bottom:600,width:180,height:170};}
  querySelector(){return this.children.find(c=>!c.disabled);}
  focus(){this.focused=true;}
}
test('compact rows display status/title; menu actions do not select and scroll dismisses',()=>{
  const doc={createElement:()=>new Element(doc),defaultView:{innerWidth:1000,innerHeight:650,addEventListener(){}}};
  const container=new Element(doc),calls=[];
  const options={selectedTheme:user.id,activeTheme:user.id,applied:{themeId:user.id,contentRevision:'r'},
    onSelect:id=>calls.push(['select',id]),onEdit:t=>calls.push(['edit',t.id]),onRename(){},onDelete(){},onDuplicate(){}};
  renderThemeList(container,[user],options);
  const [button,trigger,menu]=container.children[0].children;
  assert.equal(button.children[0].title,user.name);
  assert.equal(button.children[2].textContent,'APPLIED');
  assert.equal(button.attrs['aria-pressed'],'true');
  assert.equal(trigger.textContent,'…');
  trigger.events.click();assert.equal(menu.open,true);
  assert.deepEqual(calls,[]);
  assert.equal(menu.style.top,'472px');
  container.events.scroll();assert.equal(menu.open,false);
  trigger.events.click();menu.children[0].events.click();
  assert.deepEqual(calls,[['edit',user.id]]);
  assert.equal(menu.open,false);
  renderThemeList(container,[{...user,contentRevision:'changed'}],options);
  assert.equal(container.children[0].children[0].children[2].textContent,'Changes not applied');
});
test('left column is bounded, list alone scrolls and creation is outside list at bottom',async()=>{
  const css=await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8');
  const html=await readFile(new URL('../src/renderer/index.html',import.meta.url),'utf8');
  assert.match(css,/\.app-shell\s*\{[^}]*height: 100vh/s);
  assert.match(css,/\.workspace\s*\{[^}]*grid-template-columns: 240px/s);
  assert.match(css,/\.theme-list\s*\{[^}]*min-height:0;[^}]*overflow-y:auto; overflow-x:hidden/s);
  assert.match(css,/\.theme-item-name\s*\{[^}]*text-overflow:ellipsis; white-space:nowrap/s);
  assert.match(html,/id="theme-list"[^>]*><\/div>\s*<div id="invalid-themes"[^>]*><\/div>\s*<button id="create-theme"/);
  assert.doesNotMatch(css,/\.theme-actions\s*\{/);
});
