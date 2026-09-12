import { isThemeApplied } from '../../shared/applied-state.mjs';
export function themeActions(theme, {activeTheme,selectedTheme,busy}) {
  const p=theme.management??{}, actions=[];
  if(p.renamable)actions.push({label:'Edit',action:'onEdit'},{label:'Rename',action:'onRename'});
  actions.push({label:p.protected?'Customize a copy':'Duplicate',action:'onDuplicate'});
  if(p.deletable)actions.push({label:'Delete',action:'onDelete',blocked:theme.id===activeTheme||theme.id===selectedTheme});
  return actions.map(a=>({...a,disabled:Boolean(busy||a.blocked)}));
}
const lifetimes=new WeakMap();
export function renderThemeList(container,themes,options) {
  lifetimes.get(container)?.abort();
  const lifetime=new AbortController();lifetimes.set(container,lifetime);
  const doc=container.ownerDocument;let opened=null;
  const close=()=>{if(opened){opened.hidePopover();opened=null;}};
  container.addEventListener('scroll',close,{signal:lifetime.signal});
  doc.defaultView?.addEventListener('resize',close,{signal:lifetime.signal});
  container.replaceChildren();
  for(const theme of themes){
    const row=doc.createElement('div');row.className='theme-row';row.setAttribute('role','listitem');
    const button=doc.createElement('button');button.type='button';button.className='theme-item';
    button.disabled=Boolean(options.busy);button.dataset.themeId=theme.id;button.title=theme.name;
    button.setAttribute('aria-pressed',String(theme.id===options.selectedTheme));
    const name=doc.createElement('span');name.className='theme-item-name';name.textContent=theme.name;name.title=theme.name;
    const version=doc.createElement('span');version.className='theme-item-version';
    version.textContent='v'+theme.version+' · '+(theme.management?.origin??'unknown');version.title=version.textContent;
    button.append(name,version);
    if(theme.id===options.activeTheme){
      const badge=doc.createElement('span');badge.className='active-badge';
      badge.textContent=isThemeApplied(theme,options.activeTheme,options.applied)?'APPLIED':'Changes not applied';button.append(badge);
    }
    button.addEventListener('click',()=>{close();options.onSelect(theme.id);});
    const trigger=doc.createElement('button');trigger.type='button';trigger.className='theme-menu-trigger';
    trigger.textContent='…';trigger.disabled=Boolean(options.busy);
    trigger.setAttribute('aria-label','Actions for '+theme.name);trigger.setAttribute('aria-expanded','false');
    const menu=doc.createElement('div');menu.className='theme-action-menu';menu.setAttribute('popover','auto');
    menu.setAttribute('role','group');menu.setAttribute('aria-label','Actions for '+theme.name);
    for(const action of themeActions(theme,options)){
      const item=doc.createElement('button');item.type='button';item.textContent=action.label;item.disabled=action.disabled;
      if(action.blocked)item.title='Select/apply another theme before deletion';
      item.addEventListener('click',()=>{close();options[action.action](theme);});menu.append(item);
    }
    menu.addEventListener('toggle',event=>trigger.setAttribute('aria-expanded',String(event.newState==='open')));
    trigger.addEventListener('click',()=>{
      if(menu.matches(':popover-open')){close();return;}
      close();opened=menu;menu.showPopover();
      const r=trigger.getBoundingClientRect(),s=menu.getBoundingClientRect(),w=doc.defaultView;
      menu.style.left=Math.max(8,Math.min(r.right-s.width,w.innerWidth-s.width-8))+'px';
      menu.style.top=Math.max(8,Math.min(r.bottom+4,w.innerHeight-s.height-8))+'px';
      menu.querySelector('button:not(:disabled)')?.focus();
    });
    row.append(button,trigger,menu);container.append(row);
  }
}
