export const policyLabel=policy=>({'follow-codex':'Follow Codex','force-light':'Force light skin','force-dark':'Force dark skin'}[policy]);
export function beginEditorSettings(policy){return {policy,view:'basic'};}
export function changeEditorPolicy(draft,policy){
  if(!policyLabel(policy))throw Error('Invalid adaptation policy');
  draft.policy=policy;
}
export function themeSettingsAction(theme){
  return !theme?'none':theme.management?.renamable?'edit':'copy';
}
export async function saveUnifiedDraft(draft,saveTheme,acceptPolicy){
  const policy=draft.policy;
  const result=await saveTheme();
  if(result && !result.canceled)acceptPolicy(policy);
  return result;
}
