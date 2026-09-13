import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {loadThemePackage} from '../../../../scripts/theme-loader.mjs';
import {validatePaletteOverrides} from '../../../../scripts/palette-overrides.mjs';
import {validateThemeName} from './theme-creator.mjs';
import {USER_MANAGEMENT} from './theme-management.mjs';
import {copyThemeDependencies} from './theme-duplicate.mjs';
import {withWallpaperMode} from '../../shared/wallpaper-layout.mjs';
const revision=text=>createHash('sha256').update(text).digest('hex');
export class ThemeEditor {
  constructor({creator,drafts,management,commit=fs.rename}){Object.assign(this,{creator,drafts,management,commit});}
  async load(id){
    const t=await this.management.target(id);
    if(!t.policy.renamable)throw Error('Only user themes can be edited.');
    const pkg=await loadThemePackage(t.directory);
    this.drafts.clear();
    const mode=pkg.manifest.variants||Object.keys(pkg.manifest.background?.overrides??{}).length?'dual':'single';
    const images={};
    if(mode==='single') images.single=await this.drafts.prepare('background.png',(pkg.backgrounds.light??pkg.backgrounds.dark).bytes);
    else for(const side of ['light','dark']) if(pkg.manifest.variants?.[side]||pkg.manifest.background?.overrides?.[side]) images[side]=await this.drafts.prepare(`${side}.png`,pkg.backgrounds[side].bytes);
    const layout=JSON.parse(await fs.readFile(path.join(t.directory,pkg.manifest.layout),'utf8'));
    return {id,name:pkg.manifest.name,mode,images,layout,customStyles:pkg.styles.length>0,paletteOverrides:validatePaletteOverrides(pkg.manifest.paletteOverrides),revision:revision(await fs.readFile(t.manifestPath))};
  }
  async save(model){
    if(!model||Object.keys(model).some(k=>!['id','name','mode','tokens','paletteOverrides','revision','layoutMode'].includes(k)))throw Error('Invalid editor model');
    const name=validateThemeName(model.name),palette=validatePaletteOverrides(model.paletteOverrides);
    if(!['single','dual'].includes(model.mode)||!model.tokens||typeof model.tokens!=='object'||Array.isArray(model.tokens)||Object.keys(model.tokens).some(k=>!['single','light','dark'].includes(k)))throw Error('Invalid wallpaper mode');
    const slots=model.mode==='single'?['single']:['light','dark'];
    const bytes={};
    for(const slot of slots){const token=model.tokens[slot];if(token){const asset=this.drafts.asset(token);if(!asset)throw Error('Image selection expired; choose it again.');bytes[slot]=asset.bytes;}}
    if(!Object.keys(bytes).length)throw Error('Choose at least one wallpaper.');
    const root=await fs.realpath(this.creator.themesRoot);
    let t=null;
    if(model.id){t=await this.management.target(model.id);if(!t.policy.renamable)throw Error('Theme is protected');const pkg=await loadThemePackage(t.directory);if(pkg.styles.length && (Object.keys(palette.light??{}).length||Object.keys(palette.dark??{}).length))throw Error('Universal palette overrides cannot replace Custom CSS.');if(revision(await fs.readFile(t.manifestPath))!==model.revision)throw Error('Theme changed; reopen Edit.');}
    const id=t?.manifest.id??`user-${randomUUID()}`,generation=`edit-${randomUUID()}`;
    const stagingRoot=path.join(path.dirname(root),'runtime','theme-creation');await fs.mkdir(stagingRoot,{recursive:true});
    const stage=await fs.mkdtemp(path.join(stagingRoot,'editor-'));
    let installedAssets=null,committed=false;
    try{
      const assetDir=path.join(stage,'assets',generation);await fs.mkdir(assetDir,{recursive:true});
      const refs={};for(const [slot,data]of Object.entries(bytes)){refs[slot]=`assets/${generation}/${slot}.png`;await fs.writeFile(path.join(stage,refs[slot]),data,{flag:'wx'});}
      const background=model.mode==='single'?{default:refs.single}:{default:refs.light??refs.dark,overrides:{...refs}};
      const manifest={...(t?.manifest??{$schema:'../theme.schema.json',schemaVersion:2,id,version:'0.1.0',author:'Local user',description:'User-created Universal wallpaper theme.'}),schemaVersion:2,name,compatibility:{codexAppearances:['light','dark']},background,paletteOverrides:palette,layout:t?.manifest.layout??'layout.json'};
      delete manifest.variants;delete manifest.capabilities;
      if(t?.manifest.styles?.length)delete manifest.paletteOverrides;
      const layout=withWallpaperMode(t?JSON.parse(await fs.readFile(path.join(t.directory,t.manifest.layout),'utf8')):undefined,model.layoutMode);
      // Publish edited layout with its asset generation; the atomic manifest
      // pointer commits images and layout together, leaving old readers intact.
      if(t&&model.layoutMode!==undefined)manifest.layout=`assets/${generation}/layout.json`;
      if(t)await copyThemeDependencies(t.directory,stage,t.manifest);
      await fs.mkdir(path.dirname(path.join(stage,manifest.layout)),{recursive:true});
      await fs.writeFile(path.join(stage,manifest.layout),JSON.stringify(layout,null,2));
      await fs.writeFile(path.join(stage,'management.json'),JSON.stringify(USER_MANAGEMENT,null,2));
      await fs.writeFile(path.join(stage,'theme.json'),JSON.stringify(manifest,null,2));
      await loadThemePackage(stage);
      if(!t)await this.commit(stage,path.join(root,id));
      else {
        if(revision(await fs.readFile(t.manifestPath))!==model.revision)throw Error('Theme changed; reopen Edit.');
        const assets=path.join(t.directory,'assets');await fs.mkdir(assets,{recursive:true});
        if(await fs.realpath(assets)!==assets)throw Error('Unsafe asset directory');
        installedAssets=path.join(assets,generation);await fs.rename(assetDir,installedAssets);
        // Only the manifest pointer changes atomically. Old images/layout remain
        // intact for in-flight readers and rollback if commit fails.
        await this.commit(path.join(stage,'theme.json'),t.manifestPath);
      }
      committed=true;this.drafts.clear();return {id};
    }finally{if(installedAssets&&!committed)await fs.rm(installedAssets,{recursive:true,force:true});await fs.rm(stage,{recursive:true,force:true});}
  }
}
