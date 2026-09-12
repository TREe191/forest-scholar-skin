export const PALETTE_TOKENS = Object.freeze({
  accent:'--codex-skin-accent', foreground:'--codex-skin-foreground',
  foregroundMuted:'--codex-skin-foreground-muted', sidebarSurface:'--codex-skin-sidebar-surface',
  mainContentSurface:'--codex-skin-main-content-surface', chromeSurface:'--codex-skin-chrome-surface',
  topbarSurface:'--codex-skin-topbar-surface', divider:'--codex-skin-sidebar-divider',
  scrim:'--codex-skin-background-scrim', topFade:'--codex-skin-user-top-fade',bottomFade:'--codex-skin-work-gradient-strong',
});
function object(value){if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Palette must be an object');}
export function validatePaletteOverrides(value) {
  if(value===undefined)return {schemaVersion:1,light:{},dark:{}};
  object(value);
  if(value.schemaVersion!==1||Object.keys(value).some(k=>!['schemaVersion','light','dark'].includes(k)))throw new RangeError('Unsupported palette schema');
  const result={schemaVersion:1,light:{},dark:{}};
  for(const mode of ['light','dark']){
    const entries=value[mode]??{};object(entries);
    for(const [key,entry] of Object.entries(entries)){
      if(!Object.hasOwn(PALETTE_TOKENS,key))throw new RangeError('Unknown palette token');
      object(entry);
      if(Object.keys(entry).some(k=>!['color','alpha'].includes(k))||!/^#[0-9a-f]{6}$/i.test(entry.color)||typeof entry.color!=='string'||!Number.isFinite(entry.alpha)||entry.alpha<0||entry.alpha>1)throw new RangeError('Invalid palette color or alpha');
      result[mode][key]={color:entry.color.toLowerCase(),alpha:entry.alpha};
    }
  }
  return result;
}
const rgba=(entry,scale=1)=>`rgba(${[1,3,5].map(i=>parseInt(entry.color.slice(i,i+2),16)).join(', ')}, ${Number((entry.alpha*scale).toFixed(6))})`;
export function paletteOverridesCss(value){
  const palette=validatePaletteOverrides(value),rules=[];
  for(const mode of ['light','dark']){
    const root=`html.forest-scholar-skin[data-skin-visual-adaptation="universal"][data-skin-adaptation="${mode}"]`;
    const entries=palette[mode];
    const declarations=Object.entries(entries).filter(([k])=>!['bottomFade','topFade'].includes(k)).map(([k,v])=>`${PALETTE_TOKENS[k]}: ${rgba(v)};`);
    if(declarations.length)rules.push(`${root} { ${declarations.join(' ')} }`);
    // Existing local tone rules are more specific than root inheritance.
    if(entries.bottomFade)rules.push(`${root}[data-skin-background-tone] .thread-scroll-container div[class~="bg-gradient-to-t"][class~="from-surface"][class~="via-surface"] { --codex-skin-work-gradient-strong: ${rgba(entries.bottomFade)}; --codex-skin-work-gradient-middle: ${rgba(entries.bottomFade,1/3)}; --codex-skin-work-gradient-clear: ${rgba(entries.bottomFade,0)}; }`);
    if(entries.topFade)rules.push(`${root} div[class*="MainContentTopFade"] { background-image: linear-gradient(to bottom, ${rgba(entries.topFade)} 0%, ${rgba(entries.topFade,0)} 100%) !important; }`);
  }
  return rules.join('\n');
}
