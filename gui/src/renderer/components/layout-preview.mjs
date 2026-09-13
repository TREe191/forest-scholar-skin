import {calculateBackgroundLayout} from '../../../../scripts/layout-engine.mjs';

const bindings=new WeakMap();
// Renderer-only adapter; all geometry belongs to the existing pure engine.
export function bindLayoutPreview(image,config){
  const viewport=image.parentElement;
  if(!viewport||!image.style)return ()=>{};
  bindings.get(image)?.();
  const win=image.ownerDocument.defaultView;
  let frame=0;
  const update=()=>{
    frame=0;
    if(!image.naturalWidth||!image.naturalHeight||!viewport.clientWidth||!viewport.clientHeight)return;
    const result=calculateBackgroundLayout({width:image.naturalWidth,height:image.naturalHeight},
      {width:viewport.clientWidth,height:viewport.clientHeight},config);
    Object.assign(image.style,{position:'absolute',width:`${result.renderedWidth}px`,height:`${result.renderedHeight}px`,left:`${result.offsetX}px`,top:`${result.offsetY}px`,maxWidth:'none'});
  };
  const schedule=()=>{if(!frame)frame=win.requestAnimationFrame(update);};
  const observer=new win.ResizeObserver(schedule);observer.observe(viewport);
  image.addEventListener('load',schedule);schedule();
  const cleanup=()=>{observer.disconnect();image.removeEventListener('load',schedule);if(frame)win.cancelAnimationFrame(frame);};
  bindings.set(image,cleanup);return cleanup;
}
