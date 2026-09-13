import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {NODE_RUNTIME} from './node-runtime.mjs';
import {loadThemePackage} from '../../scripts/theme-loader.mjs';
export const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
export const CORE_MODULES=['injector','theme-loader','theme-payload','layout-engine','background-tone','adaptation-profile','palette-overrides','skin-adaptation','renderer-readiness'].map(n=>`scripts/${n}.mjs`);
export const CORE_FILES=[...CORE_MODULES,...['Start-ForestScholarSkin','Disable-ForestScholarSkin','Restore-ForestScholarSkin','Common'].map(n=>`scripts/${n}.ps1`),
  'styles/base.css','styles/codex-compat.css','config/app.schema.json','themes/theme.schema.json','themes/layout.schema.json','themes/palette.schema.json'];
export const BUILTIN_IDS=['forest-scholar','phainon'];
export const defaultConfig={schemaVersion:1,activeTheme:'forest-scholar',appearance:'auto'};
export const preparedNodeRoot=path.join(projectRoot,'gui/out/node-download/extracted',`node-${NODE_RUNTIME.version}-win-${NODE_RUNTIME.arch}`);
export const coreOutput=path.join(projectRoot,'gui/out/packaging/skin-core');
async function copyFile(source,dest){
  const stat=await fs.lstat(source);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unsafe build resource');
  await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(source,dest);
}
export async function buildCore(destination,{sourceRoot=projectRoot,nodeRoot=preparedNodeRoot,platform='win32',arch='x64'}={}){
  if(platform!==NODE_RUNTIME.platform||arch!==NODE_RUNTIME.arch)throw Error('Only Windows x64 is currently supported by the pinned bundled runtime');
  const nodeBytes=await fs.readFile(path.join(nodeRoot,'node.exe'));
  if(createHash('sha256').update(nodeBytes).digest('hex')!==NODE_RUNTIME.sha256)throw Error('Run npm run prepare:node: pinned runtime missing or mismatched');
  const license=await fs.readFile(path.join(nodeRoot,'LICENSE'));if(createHash('sha256').update(license).digest('hex')!==NODE_RUNTIME.licenseSha256)throw Error('Node license missing or mismatched');
  await fs.mkdir(destination,{recursive:true});
  for(const ref of CORE_FILES)await copyFile(path.join(sourceRoot,ref),path.join(destination,ref));
  for(const id of BUILTIN_IDS){
    const dir=path.join(sourceRoot,'themes',id),pkg=await loadThemePackage(dir),m=pkg.manifest;
    const refs=new Set(['theme.json',m.layout,...m.styles,...Object.values(pkg.backgrounds).filter(Boolean).map(b=>b.relativePath)]);
    for(const ref of refs)await copyFile(path.join(dir,ref),path.join(destination,'themes',id,ref));
    await fs.writeFile(path.join(destination,'themes',id,'management.json'),JSON.stringify({schemaVersion:1,origin:'builtin',protected:true,deletable:false,renamable:false}));
  }
  await fs.writeFile(path.join(destination,'config/default-app.json'),JSON.stringify(defaultConfig,null,2));
  await copyFile(path.join(nodeRoot,'node.exe'),path.join(destination,'node/node.exe'));
  await copyFile(path.join(nodeRoot,'LICENSE'),path.join(destination,'node/LICENSE'));
  await fs.writeFile(path.join(destination,'node/runtime.json'),JSON.stringify(NODE_RUNTIME,null,2));
}
export async function prepareCore(_config,platform,arch){
  const parent=path.dirname(coreOutput);await fs.mkdir(parent,{recursive:true});
  const temporary=await fs.mkdtemp(path.join(parent,'core-'));
  try{
    await buildCore(temporary,{platform,arch});
    // Only this fixed generated output may be replaced, never source/data roots.
    const stat=await fs.lstat(coreOutput).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
    if(stat?.isSymbolicLink())throw Error('Linked build output rejected');
    if(path.dirname(coreOutput)!==parent||path.basename(coreOutput)!=='skin-core')throw Error('Unsafe output');
    await fs.rm(coreOutput,{recursive:true,force:true});await fs.rename(temporary,coreOutput);
  }finally{await fs.rm(temporary,{recursive:true,force:true});}
}
export async function closeGuiModules(buildPath){
  // Preserve gui/../scripts topology in app.asar, with only allowlisted modules.
  await fs.mkdir(path.join(buildPath,'gui'),{recursive:true});
  await fs.rename(path.join(buildPath,'src'),path.join(buildPath,'gui/src'));
  for(const ref of CORE_MODULES)await copyFile(path.join(projectRoot,ref),path.join(buildPath,ref));
  const pkg=JSON.parse(await fs.readFile(path.join(buildPath,'package.json'),'utf8'));
  pkg.main='gui/src/main/index.mjs';delete pkg.scripts;delete pkg.devDependencies;
  await fs.writeFile(path.join(buildPath,'package.json'),JSON.stringify(pkg,null,2));
}
export function ignoreGuiFile(file){
  const rel=file.replaceAll('\\','/').replace(/^\//,'');
  return Boolean(rel)&&rel!=='package.json'&&rel!=='src'&&!rel.startsWith('src/');
}
