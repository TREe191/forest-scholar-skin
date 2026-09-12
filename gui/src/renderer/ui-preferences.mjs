import {translate} from '../shared/i18n.mjs';
export const resolveManagerAppearance=(setting,systemDark)=>setting==='system'?(systemDark?'dark':'light'):setting;
export function translatedRecord(previous,value,language){
  const source=previous && value===previous.output?previous.source:value;
  const trimmed=source.trim(),output=trimmed?source.replace(trimmed,()=>translate(trimmed,language)):source;
  return {source,output};
}

// One translation boundary for static HTML and newly rendered components.
// Retains original English so switching back is lossless; does not edit inputs.
export function installUiPreferences(doc,api){
  const language=doc.querySelector('#manager-language'),appearance=doc.querySelector('#manager-appearance');
  const modes=[...appearance.querySelectorAll('[data-manager-mode]')];
  function setBusy(busy){language.disabled=busy;for(const button of modes)button.disabled=busy;}
  const error=doc.querySelector('#manager-settings-error');
  const media=doc.defaultView.matchMedia('(prefers-color-scheme: dark)');
  const sources=new WeakMap();
  let preferences={language:'en',appearance:'system'};
  const skip='#theme-name, #theme-description, .theme-item-name, .wallpaper-filename, [data-i18n-skip], script, style';
  function translateValue(node,key,value){
    let record=sources.get(node);if(!record){record={};sources.set(node,record);}
    record[key]=translatedRecord(record[key],value,preferences.language);return record[key].output;
  }
  function localize(){
    observer.disconnect();
    const walker=doc.createTreeWalker(doc.body,4);
    let node;
    while((node=walker.nextNode())){
      if(node.parentElement?.closest(skip))continue;
      const value=translateValue(node,'text',node.nodeValue);
      if(node.nodeValue!==value)node.nodeValue=value;
    }
    for(const element of doc.body.querySelectorAll('[title],[aria-label]')){
      if(element.closest(skip)||element.matches('.theme-item'))continue;
      for(const key of ['title','aria-label'])if(element.hasAttribute(key)){
        const value=translateValue(element,key,element.getAttribute(key));if(value!==element.getAttribute(key))element.setAttribute(key,value);
      }
    }
    observer.observe(doc.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','aria-label']});
  }
  const observer=new MutationObserver(localize);
  function apply(){
    doc.documentElement.lang=preferences.language==='zh'?'zh-CN':'en';
    doc.documentElement.dataset.managerAppearance=resolveManagerAppearance(preferences.appearance,media.matches);
    language.value=preferences.language;
    for(const button of modes)button.setAttribute('aria-pressed',String(button.dataset.managerMode===preferences.appearance));
    localize();
  }
  media.addEventListener('change',apply);
  async function save(event){
    const mode=event.currentTarget.dataset.managerMode??preferences.appearance;
    setBusy(true);error.textContent='';
    try{
      const result=await api.saveGuiPreferences({language:language.value,appearance:mode});
      if(!result.ok)throw Error(result.error);
      preferences=result.preferences;
    }catch{error.textContent='Settings could not be saved.';}
    finally{setBusy(false);apply();}
  }
  language.addEventListener('change',save);for(const button of modes)button.addEventListener('click',save);
  setBusy(true);apply();
  api.getGuiPreferences().then(result=>{
    if(!result.ok)throw Error(result.error);
    preferences=result.preferences;
  }).catch(()=>{error.textContent='Settings could not be loaded.';})
    .finally(()=>{setBusy(false);apply();});
  return ()=>{observer.disconnect();media.removeEventListener('change',apply);language.removeEventListener('change',save);for(const button of modes)button.removeEventListener('click',save);};
}
