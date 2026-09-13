import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createBuildIdentity,buildModeLabel,normalizeGitCommit} from '../src/shared/build-identity.mjs';
import {resolveGitCommit} from '../scripts/git-commit.mjs';
import {stampBuildMode} from '../forge.config.mjs';
import {makeTemporaryDirectory,removeTemporaryDirectory} from './helpers.mjs';

const commit='cd772344949f5ede91c3113f0ebf02f7f836dc01';

test('development, beta and production identities are stable and labeled',()=>{
 for(const [mode,label] of [['development','Development'],['beta','Beta'],['production','Production']]){
  const identity=createBuildIdentity(mode,commit);
  assert.deepEqual(identity,{schemaVersion:1,mode,gitCommit:commit,shortCommit:'cd77234'});
  assert.equal(buildModeLabel(mode),label);
 }
});

test('missing or invalid commit uses explicit unavailable fallback',()=>{
 for(const value of [undefined,'','not-a-commit','cd77234'])assert.equal(normalizeGitCommit(value),'unavailable');
 assert.deepEqual(createBuildIdentity('development'),{schemaVersion:1,mode:'development',gitCommit:'unavailable',shortCommit:'unavailable'});
 assert.equal(resolveGitCommit({cwd:'X:\\absent',spawn:()=>({status:1,stdout:''})}),'unavailable');
});

test('packaged build stamp carries identity without a .git directory',async()=>{
 const root=await makeTemporaryDirectory('packaged identity '),previousMode=process.env.THEME_MANAGER_MODE,previousCommit=process.env.THEME_MANAGER_GIT_COMMIT;
 try{
  await fs.mkdir(path.join(root,'src/main'),{recursive:true});
  process.env.THEME_MANAGER_MODE='beta';process.env.THEME_MANAGER_GIT_COMMIT=commit;
  await stampBuildMode({},root);
  assert.equal(await fs.access(path.join(root,'.git')).then(()=>true,()=>false),false);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'src/main/build-mode.json'),'utf8')),createBuildIdentity('beta',commit));
 }finally{
  if(previousMode===undefined)delete process.env.THEME_MANAGER_MODE;else process.env.THEME_MANAGER_MODE=previousMode;
  if(previousCommit===undefined)delete process.env.THEME_MANAGER_GIT_COMMIT;else process.env.THEME_MANAGER_GIT_COMMIT=previousCommit;
  await removeTemporaryDirectory(root);
 }
});

test('Forge wrapper passes resolved commit and package hook writes the stable stamp',async()=>{
 const wrapper=await fs.readFile(new URL('../scripts/forge-mode.mjs',import.meta.url),'utf8');
 const forge=await fs.readFile(new URL('../forge.config.mjs',import.meta.url),'utf8');
 assert.match(wrapper,/resolveGitCommit\(\{cwd:projectRoot\}\)/);
 assert.match(wrapper,/THEME_MANAGER_GIT_COMMIT:gitCommit/);
 assert.match(forge,/packageAfterCopy/);
 assert.match(forge,/src\/main\/build-mode\.json/);
 assert.match(forge,/createBuildIdentity\(mode,process\.env\.THEME_MANAGER_GIT_COMMIT\)/);
});
