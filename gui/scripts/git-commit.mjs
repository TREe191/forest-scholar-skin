import {spawnSync} from 'node:child_process';
import {normalizeGitCommit} from '../src/shared/build-identity.mjs';

export function resolveGitCommit({cwd,spawn=spawnSync}={}){
  try{
    const result=spawn('git',['rev-parse','HEAD'],{cwd,encoding:'utf8',shell:false,windowsHide:true});
    if(result.status!==0)return 'unavailable';
    return normalizeGitCommit(result.stdout);
  }catch{return 'unavailable';}
}
