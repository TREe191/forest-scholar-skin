import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadThemePackage} from '../../../../scripts/theme-loader.mjs';
import {USER_MANAGEMENT} from './theme-management.mjs';

// Copy only declared dependencies. Theme CSS cannot import further resources.
export async function copyThemeDependencies(directory, destination, manifest) {
  const refs=new Set([manifest.layout,...(manifest.styles??[]),
    ...Object.values(manifest.variants??{}).map(v=>v.background),
    manifest.background?.default,...Object.values(manifest.background?.overrides??{})].filter(Boolean));
  const root=await fs.realpath(directory);
  for(const ref of refs){
    const source=path.resolve(root,ref),real=await fs.realpath(source);
    if(path.isAbsolute(ref)||path.relative(root,real).startsWith('..')||real!==source || !(await fs.stat(real)).isFile())
      throw Error('Unsafe package dependency');
    const target=path.resolve(destination,ref);
    if(path.relative(destination,target).startsWith('..'))throw Error('Unsafe dependency destination');
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.copyFile(source,target,fs.constants.COPYFILE_EXCL);
  }
}
export class ThemeDuplicator {
  constructor({management,catalog,commit=fs.rename}){Object.assign(this,{management,catalog,commit});}
  async duplicate(sourceId){
    const source=await this.management.target(sourceId);
    await loadThemePackage(source.directory);
    const {themes}=await this.catalog.scan();
    const names=new Set(themes.map(t=>t.name.toLocaleLowerCase()));
    let index=1,name;
    do {const suffix=index===1?' Copy':` Copy (${index})`;name=source.manifest.name.slice(0,80-suffix.length).trimEnd()+suffix;index++;}
    while(names.has(name.toLocaleLowerCase()));
    const id='user-'+randomUUID();
    const destinationRoot=await fs.realpath(this.management.themesRoot);
    const staging=path.join(path.dirname(destinationRoot),'runtime','theme-creation');
    await fs.mkdir(staging,{recursive:true});
    const stage=await fs.mkdtemp(path.join(staging,'duplicate-'));
    try {
      await copyThemeDependencies(source.directory,stage,source.manifest);
      await fs.writeFile(path.join(stage,'theme.json'),JSON.stringify({...source.manifest,id,name},null,2),{flag:'wx'});
      await fs.writeFile(path.join(stage,'management.json'),JSON.stringify(USER_MANAGEMENT,null,2),{flag:'wx'});
      await loadThemePackage(stage);
      await this.commit(stage,path.join(destinationRoot,id));
      return {id};
    } finally {await fs.rm(stage,{recursive:true,force:true});}
  }
}
