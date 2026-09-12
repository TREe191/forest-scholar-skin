function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
export function draftFingerprint(draft) {
  const slots=draft.mode==='single'?['single']:['light','dark'];
  return JSON.stringify(canonical({
    name:draft.name.trim(), mode:draft.mode,
    images:Object.fromEntries(slots.map(slot=>[slot,draft.images[slot]?.token??null])),
    paletteOverrides:draft.paletteOverrides,
  }));
}
export function createEditorExitGuard({readDraft,ask,save,close}) {
  let initial=null, pending=false;
  const dirty=()=>initial!==null && draftFingerprint(readDraft())!==initial;
  return {
    begin(){initial=draftFingerprint(readDraft());},
    dirty,
    async request(){
      if(pending)return false;
      pending=true;
      try {
        if(!dirty()){close();return true;}
        const choice=await ask();
        if(choice==='discard'){close();return true;}
        if(choice==='save')return Boolean(await save());
        return false;
      } finally {pending=false;}
    },
  };
}
