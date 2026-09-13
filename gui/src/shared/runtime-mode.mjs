import {createBuildIdentity} from './build-identity.mjs';

export function resolveRuntimeMode({isPackaged=false,requested,packagedMode='production'}={}){
  if(isPackaged){if(!['beta','production'].includes(packagedMode))throw Error('Invalid packaged mode');return packagedMode;}
  if(requested===undefined||requested==='')return 'development';
  if(!['development','beta','production'].includes(requested))throw Error('Invalid Theme Manager mode');
  return requested;
}
export const themeVisible=(management,mode)=>mode==='development'||management?.origin!=='development';
export function applicationInfo(version,mode,identity=createBuildIdentity(mode)){
  const build=createBuildIdentity(mode,identity?.gitCommit);
  return Object.freeze({version,mode,buildMode:mode,gitCommit:build.gitCommit,shortCommit:build.shortCommit,author:'TREe191',github:'https://github.com/TREe191/forest-scholar-skin',developerControls:mode==='development',supportDiagnostics:mode==='beta'||mode==='development'});
}
