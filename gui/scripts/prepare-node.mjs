import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import extract from 'extract-zip';
import {NODE_RUNTIME as pin} from './node-runtime.mjs';
const root=fileURLToPath(new URL('../out/node-download/',import.meta.url));
await fs.mkdir(root,{recursive:true});
// A build-host binary is reusable only if it exactly matches the pinned bytes.
// This is build-time preparation, never a runtime PATH fallback.
const hostBytes=await fs.readFile(process.execPath);
if(createHash('sha256').update(hostBytes).digest('hex')===pin.sha256){
  const response=await fetch(`https://raw.githubusercontent.com/nodejs/node/${pin.version}/LICENSE`,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Official Node license download failed');
  const license=Buffer.from(await response.arrayBuffer());
  if(createHash('sha256').update(license).digest('hex')!==pin.licenseSha256)throw Error('Node license hash mismatch');
  const destination=path.join(root,'extracted',`node-${pin.version}-win-${pin.arch}`);
  await fs.mkdir(destination,{recursive:true});
  await fs.writeFile(path.join(destination,'node.exe'),hostBytes);
  await fs.writeFile(path.join(destination,'LICENSE'),license);
  console.log(`Verified pinned ${pin.version} runtime and official license; build-host bytes copied, no installation changed.`);
  process.exit(0);
}
const archive=path.join(root,pin.archive);
let data;try{data=await fs.readFile(archive);}catch(error){if(error.code!=='ENOENT')throw error;}
if(!data){
  const response=await fetch(`https://nodejs.org/dist/${pin.version}/${pin.archive}`,{signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw Error('Official Node archive download failed');
  data=Buffer.from(await response.arrayBuffer());
}
if(createHash('sha256').update(data).digest('hex')!==pin.archiveSha256)throw Error('Node archive hash mismatch');
await fs.writeFile(archive,data);
await extract(archive,{dir:path.join(root,'extracted')});
const source=path.join(root,'extracted',`node-${pin.version}-win-${pin.arch}`);
if(createHash('sha256').update(await fs.readFile(path.join(source,'node.exe'))).digest('hex')!==pin.sha256)throw Error('Node executable hash mismatch');
if(!(await fs.readFile(path.join(source,'LICENSE'),'utf8')).includes('Node.js'))throw Error('Node license is missing');
console.log(`Verified ${pin.version} Windows ${pin.arch} runtime and license. No system installation changed.`);
