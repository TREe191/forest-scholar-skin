import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isThemeId } from '../../shared/contracts.mjs';
import { validateThemeName } from './theme-creator.mjs';
import { loadThemePackage } from '../../../../scripts/theme-loader.mjs';

export const USER_MANAGEMENT = {schemaVersion:1,origin:'user',protected:false,deletable:true,renamable:true};
const bundled = {
  'forest-scholar': {origin:'builtin',protected:true,deletable:false,renamable:false},
  phainon: {origin:'builtin',protected:true,deletable:false,renamable:false},
  'universal-demo': {origin:'development',protected:false,deletable:true,renamable:false},
  'universal-dark-test': {origin:'development',protected:false,deletable:true,renamable:false},
};
export async function readManagement(directory, manifest) {
  if (bundled[manifest.id]) return {...bundled[manifest.id]};
  try {
    const m=JSON.parse(await fs.readFile(path.join(directory,'management.json'),'utf8'));
    if(m.schemaVersion!==1 || !['user','builtin','development'].includes(m.origin) ||
      !['protected','deletable','renamable'].every(k=>typeof m[k]==='boolean')) throw Error('Invalid management metadata');
    return {...m,deletable:!m.protected && m.deletable,renamable:!m.protected && m.origin==='user' && m.renamable};
  } catch(error) {
    // Compatibility for packages created before management metadata existed.
    if(error.code==='ENOENT' && /^user-[0-9a-f-]{36}$/.test(manifest.id) && manifest.author==='Local user') return {...USER_MANAGEMENT};
    return {origin:'unknown',protected:true,deletable:false,renamable:false};
  }
}

export class ThemeManagement {
  constructor({themesRoot,builtinThemesRoot=null,configStore,confirmDelete,renameFile=fs.rename}) {Object.assign(this,{themesRoot,builtinThemesRoot,configStore,confirmDelete,renameFile});}
  async target(id) {
    if(!isThemeId(id)) throw Error('Invalid theme ID');
    let selectedRoot=this.themesRoot,builtin=false;
    if(this.builtinThemesRoot){
      try{await fs.lstat(path.join(this.builtinThemesRoot,id));selectedRoot=this.builtinThemesRoot;builtin=true;}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
    const root=await fs.realpath(selectedRoot),directory=path.join(root,id);
    const stat=await fs.lstat(directory);
    if(stat.isSymbolicLink() || !stat.isDirectory() || await fs.realpath(directory)!==directory) throw Error('Unsafe theme directory');
    const manifestPath=path.join(directory,'theme.json');
    if((await fs.lstat(manifestPath)).isSymbolicLink()) throw Error('Unsafe manifest');
    const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
    if(manifest.id!==id) throw Error('Theme identity mismatch');
    const policy=await readManagement(directory,manifest);
    if(builtin)Object.assign(policy,{origin:'builtin',protected:true,renamable:false,deletable:false});
    return {root,directory,manifestPath,manifest,policy};
  }
  async rename(id,name) {
    name=validateThemeName(name);
    const t=await this.target(id);
    if(!t.policy.renamable) throw Error('This theme cannot be renamed.');
    await loadThemePackage(t.directory);
    const tmp=path.join(t.directory,`.rename-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(tmp,JSON.stringify({...t.manifest,name},null,2),{flag:'wx'});
      await this.renameFile(tmp,t.manifestPath);
    } finally {await fs.rm(tmp,{force:true});}
  }
  async delete(id,pendingId) {
    let t=await this.target(id);
    if(!t.policy.deletable) throw Error('This theme is protected.');
    const check=async()=>{if((await this.configStore.read()).activeTheme===id || pendingId===id) throw Error('Theme is active or selected. Apply/select another theme before deleting.');};
    await check();
    if(!await this.confirmDelete(t.manifest.name)) return {canceled:true};
    t=await this.target(id); await check();
    if(!t.policy.deletable) throw Error('This theme is protected.');
    const trash=path.join(path.dirname(t.root),'runtime','deleted-themes');
    await fs.mkdir(trash,{recursive:true});
    // Recoverable removal from catalog; never recursively delete theme contents.
    await this.renameFile(t.directory,path.join(trash,`${id}-${randomUUID()}`));
    return {canceled:false};
  }
}
