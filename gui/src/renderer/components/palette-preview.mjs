export const PALETTE_TOKEN_DESCRIPTIONS=Object.freeze({
  accent:'Buttons and selected states',foreground:'Primary text and labels',foregroundMuted:'Secondary and muted text',
  sidebarSurface:'Sidebar background',mainContentSurface:'Conversation background',chromeSurface:'Composer and floating panels',
  topbarSurface:'Topbar background',divider:'Sidebar and panel dividers',scrim:'Background dimming overlay',
  topFade:'Top edge fade',bottomFade:'Composer-area bottom fade',
});

export const PALETTE_PREVIEW_TARGETS=Object.freeze({
  accent:['accent'],foreground:['primary-text'],foregroundMuted:['muted-text'],sidebarSurface:['sidebar'],
  mainContentSurface:['main-content'],chromeSurface:['chrome'],topbarSurface:['topbar'],divider:['divider'],
  scrim:['scrim'],topFade:['top-fade'],bottomFade:['bottom-fade'],
});

// Preview-only copies of the stable Universal values in styles/base.css. Top fade
// has no base variable, so its explanatory fallback follows the matching work fade.
export const UNIVERSAL_PREVIEW_FALLBACKS=Object.freeze({
  light:Object.freeze({
    accent:{color:'#52687a',alpha:1},foreground:{color:'#202428',alpha:1},foregroundMuted:{color:'#202428',alpha:.68},
    sidebarSurface:{color:'#f8f8f6',alpha:.9},mainContentSurface:{color:'#fafaf8',alpha:.1},chromeSurface:{color:'#f8f8f6',alpha:.84},
    topbarSurface:{color:'#f8f8f6',alpha:.94},divider:{color:'#202428',alpha:.1},scrim:{color:'#ffffff',alpha:.08},
    topFade:{color:'#f8f8f6',alpha:.6},bottomFade:{color:'#f8f8f6',alpha:.6},
  }),
  dark:Object.freeze({
    accent:{color:'#93afc4',alpha:1},foreground:{color:'#eef1f3',alpha:1},foregroundMuted:{color:'#eef1f3',alpha:.72},
    sidebarSurface:{color:'#14161a',alpha:.9},mainContentSurface:{color:'#121418',alpha:.12},chromeSurface:{color:'#14161a',alpha:.84},
    topbarSurface:{color:'#14161a',alpha:.94},divider:{color:'#b4bcc4',alpha:.045},scrim:{color:'#000000',alpha:.12},
    topFade:{color:'#14161a',alpha:.6},bottomFade:{color:'#14161a',alpha:.6},
  }),
});

export function alphaToPercent(alpha){return Math.round(Math.max(0,Math.min(1,Number(alpha) || 0))*100);}
export function percentToAlpha(percent){return Math.max(0,Math.min(100,Number(percent) || 0))/100;}

export function palettePreviewValue(palette,mode,token){
  return palette?.[mode]?.[token]??UNIVERSAL_PREVIEW_FALLBACKS[mode][token];
}
function rgba({color,alpha}){
  const hex=color.slice(1),number=Number.parseInt(hex,16);
  return `rgba(${number>>16}, ${(number>>8)&255}, ${number&255}, ${alpha})`;
}
export function palettePreviewVariables(palette,mode){
  const variables={
    '--palette-preview-base':mode==='dark'?'#17191c':'#f4f4f2',
  };
  for(const token of Object.keys(PALETTE_TOKEN_DESCRIPTIONS))variables[`--palette-preview-${token}`]=rgba(palettePreviewValue(palette,mode,token));
  return variables;
}
export function renderPalettePreview(root,{palette,mode,highlightedToken=null}){
  root.dataset.previewMode=mode;
  for(const [name,value] of Object.entries(palettePreviewVariables(palette,mode)))root.style.setProperty(name,value);
  for(const region of root.querySelectorAll('[data-palette-regions]')){
    const tokens=region.dataset.paletteRegions.split(/\s+/);
    region.classList.toggle('is-token-highlighted',Boolean(highlightedToken&&tokens.includes(highlightedToken)));
  }
}

export function renderPalettePreviewLayout(card,buttons,layout='sticky'){
  const resolved=layout==='normal'?'normal':'sticky';
  card.dataset.previewLayout=resolved;
  card.classList.toggle('is-sticky',resolved==='sticky');
  for(const button of buttons)button.setAttribute('aria-pressed',String(button.dataset.palettePreviewLayout===resolved));
  return resolved;
}
