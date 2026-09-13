import {resolveLayoutConfig} from '../../../scripts/layout-engine.mjs';

export const WALLPAPER_LAYOUT_MODES=['contain','cover','focus-soft'];
export function defaultWallpaperLayout(){
  return {schemaVersion:1,shared:{mode:'contain',focalRegion:{x:0.25,y:0.15,width:0.5,height:0.7},anchor:{x:0.5,y:0.5},safePadding:{left:0,right:0,top:0,bottom:0},focusTolerance:0.08,scale:1,minScale:null,maxScale:null,offset:{x:0,y:0}},variants:{light:{},dark:{}}};
}
// Omission means preserve legacy documents, including per-variant parameters.
// Explicit selection changes the mode for both images, never their focal geometry.
export function withWallpaperMode(document,mode){
  const result=structuredClone(document??defaultWallpaperLayout());
  if(mode!==undefined){
    if(!WALLPAPER_LAYOUT_MODES.includes(mode))throw new TypeError('Invalid wallpaper layout mode');
    result.shared.mode=mode;
    for(const variant of ['light','dark'])delete result.variants[variant].mode;
  }
  for(const variant of ['light','dark'])resolveLayoutConfig(result,variant);
  return result;
}
export function editorLayoutConfig(model,variant='light'){
  return resolveLayoutConfig(withWallpaperMode(model.layout,model.layoutMode),variant);
}
