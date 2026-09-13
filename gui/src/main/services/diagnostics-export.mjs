import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const FILES=['session.json','launcher.log','injector.log','injector-error.log','ready.json','injection-state.json'];
const HISTORY=/^\d{4}-\d{2}-\d{2}_\d{6}_\d{3}(?:-\d+)?$/;
const EVENTS=new Set(('launcher-start node-process-start expected-path-source existing-codex-check cdp-port-selected codex-launch-request codex-activation-returned codex-process-start activation-path-comparison path-mismatch-registration-recheck readiness-transition codex-process-lifecycle cdp-readiness-summary codex-launch-metadata injector-identity-verification renderer-wait renderer-discovery-start initial-app-target-detected renderer-stable-attach first-install verification final-ready failure launcher-failed launcher-ready renderer-readiness install-verification install-start install-ready self-heal').split(' '));
const VALUES=new Set(('starting success succeeded failed ready timeout passed rejected uncertain eligible ineligible starting stopped Light Dark Auto auto light dark follow-codex force-light force-dark universal custom cdp-listener-readiness cdp-http-readiness cdp-browser-readiness renderer-readiness codex-process-identity path-mismatch node-runtime-check injector-process-identity install-verification launcher-preflight renderer-install ordinal-ignore-case OrdinalIgnoreCase connection-refused connection-reset socket-transport-error http-non-2xx malformed-json missing-browser-websocket invalid-browser-websocket invalid-browser-identity listener-ownership-changed unknown activation child descendant unrelated').split(' '));
const SCALARS=new Set(('pid processid parentpid activationpid launcherpid injectorp id port listenerpid ownerpid listenerowningpid attempt attempts httpattemptcount retry retrycount elapsedms durationms timeoutms lasthttpstatus lasthttperrorcode selfhealcount repaircount installed accepted sidebar mainrole composer shell protocolisapp detectedcount matchingexpectedexecutablecount launchallowed processpackageidentityverified crosslaunchpathcacheused listenerownerisactivationpid listenerownerpathmatchesexpected success verified pathmatches identityverified ready backgroundexists styleexists width height').replace('injectorp id','injectorpid').split(' '));
const CONTAINERS=new Set('details stages timeline transitions process processes readiness verification diagnostics runtime result'.split(' '));
for(const event of 'app-target-discovered cdp-port-ready injector-ready-written renderer-ready renderer-wait-complete renderer-wait-progress renderer-wait-semantic-pass renderer-wait-stage renderer-wait-ambiguous renderer-wait-failed self-heal-count'.split(' '))EVENTS.add(event);
for(const key of 'succeeded processattempts readinessattempts listenerafterprocessmilliseconds httpafterprocessmilliseconds browseridentityafterprocessmilliseconds totaldurationmilliseconds lifecyclesamplecount lifecyclequeryfailurecount lifecycletransitioncount activationprocesspresentatend activationprocesshasselectedportatend budgetms poll targetcount stablecandidatecount elapsedmilliseconds'.split(' '))SCALARS.add(key);
for(const value of 'initial-app-target real-ui-renderer semantic-shell stable-attach deadline discovery-error'.split(' '))VALUES.add(value);
// Only known field/type pairs survive. Unknown text, IDs, paths, URLs and
// command lines never pass through, including unexpected numeric account data.
export function sanitizeDiagnostic(input,depth=0){
  if(depth>8||!input||typeof input!=='object'||Array.isArray(input))return {};
  const out={};
  for(const [key,value] of Object.entries(input)){
    const k=key.toLowerCase();
    if(SCALARS.has(k)&&(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||value===null))out[key]=value;
    else if((k==='at'||k.endsWith('at'))&&/^(?:at|startedat|finishedat|observedat|launcherat|launcherstartedat|listenerfirstseenat|httpfirstsuccessat|firsthttpattemptat|lasthttpattemptat|httpreadyat|browserwebsocketfirstseenat|readyat|attachat)$/.test(k)&&
      (value===null||typeof value==='string'&&/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(value)))out[key]=value;
    else if(k==='lasthttperrorcode'&&typeof value==='string'&&/^(?:ECONNRESET|ETIMEDOUT|ECONNREFUSED|ConnectionReset|TimedOut|ConnectionRefused)$/.test(value))out[key]=value;
    else if(k==='event'&&EVENTS.has(value))out[key]=value;
    else if(['status','failurestage','mode','requestedmode','configuredappearance','stage','comparisonmode','mismatchreason','reason','lasthttpfailuretype','httpfailuretype','listenerownerrelation'].includes(k)&&VALUES.has(value))out[key]=value;
    else if(CONTAINERS.has(k)&&value&&typeof value==='object')out[key]=Array.isArray(value)?value.slice(0,500).map(v=>sanitizeDiagnostic(v,depth+1)):sanitizeDiagnostic(value,depth+1);
  }
  for(const prefix of ['','normalized']){
    const expected=input[prefix? 'normalizedExpectedPath':'expectedPath'];
    const actual=input[prefix?'normalizedActualPath':'actualPath'];
    if(typeof expected==='string'||typeof actual==='string'){
      out[prefix+'PathEvidence']={expectedAvailable:typeof expected==='string',actualAvailable:typeof actual==='string',equal:typeof expected==='string'&&typeof actual==='string'?expected.toLowerCase()===actual.toLowerCase():null};
    }
  }
  for(const field of ['expectedPath','actualPath','installLocation','packageFullName']){
    const value=input[field];
    if(typeof value==='string'){
      const match=value.match(/OpenAI\.Codex_(\d+\.\d+\.\d+\.\d+)_(x64|arm64|x86)__/);
      if(match)out[field+'PackageVersion']={version:match[1],architecture:match[2]};
    }
  }
  return out;
}
export function sanitizedFile(text,json){
  const records=[];let omitted=0;
  const lines=json?[text]:text.split(/\r?\n/).slice(0,10000);
  for(const line of lines){
    if(!line.trim())continue;
    try{
      const start=line.indexOf('{');if(start<0)throw Error();
      const record=sanitizeDiagnostic(JSON.parse(line.slice(start)));
      if(Object.keys(record).length)records.push(record);else omitted++;
    }catch{omitted++;}
  }
  return {records,omitted};
}
// Minimal ZIP STORE writer: fixed generated filenames, no filesystem traversal.
export function diagnosticsZip(report){
  const name=Buffer.from('diagnostics.json'),data=Buffer.from(JSON.stringify(report,null,2));
  let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(46+name.length,12);end.writeUInt32LE(30+name.length+data.length,16);
  return Buffer.concat([local,name,data,central,name,end]);
}
export class DiagnosticsExporter{
  constructor({historyRoot,info,chooseDestination,commit=fs.rename}){Object.assign(this,{historyRoot,info,chooseDestination,commit});}
  async exportLatest(){
    if(!this.info.supportDiagnostics)throw Error('Diagnostics export is unavailable in this build.');
    const root=await fs.realpath(this.historyRoot);
    const entries=(await fs.readdir(root,{withFileTypes:true})).filter(e=>e.isDirectory()&&HISTORY.test(e.name)).sort((a,b)=>b.name.localeCompare(a.name));
    if(!entries.length)throw Error('No startup diagnostics are available.');
    const source=path.join(root,entries[0].name);
    if(await fs.realpath(source)!==source)throw Error('Unsafe diagnostic directory.');
    const sources={};
    for(const file of FILES){
      const target=path.join(source,file);
      try{
        const stat=await fs.lstat(target);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024||await fs.realpath(target)!==target){sources[file]={omitted:true};continue;}
        sources[file]=sanitizedFile(await fs.readFile(target,'utf8'),file.endsWith('.json'));
      }catch(error){if(error.code!=='ENOENT')throw error;sources[file]={missing:true};}
    }
    const report={schemaVersion:1,appVersion:this.info.version,buildMode:this.info.buildMode??this.info.mode,gitCommit:this.info.gitCommit??'unavailable',shortCommit:this.info.shortCommit??'unavailable',session:entries[0].name,exportedAt:new Date().toISOString(),privacy:'Allowlisted startup metadata only. Raw logs, text, paths, commands, theme names and user content are excluded.',sources};
    const version=this.info.version.replace(/[^0-9A-Za-z.-]/g,'_');
    const destination=await this.chooseDestination(`theme-manager-diagnostics-${version}-${new Date().toISOString().replace(/[:.]/g,'-')}.zip`);
    if(!destination)return {canceled:true};
    if(!path.isAbsolute(destination)||path.extname(destination).toLowerCase()!=='.zip')throw Error('Choose a ZIP destination.');
    const parent=await fs.realpath(path.dirname(destination));
    const rel=path.relative(root,parent);if(rel===''||!rel.startsWith('..')&&!path.isAbsolute(rel))throw Error('Export outside the startup history directory.');
    const final=path.join(parent,path.basename(destination)),temp=path.join(parent,`.diagnostics-${randomUUID()}.tmp`);
    try{await fs.writeFile(temp,diagnosticsZip(report),{flag:'wx'});await this.commit(temp,final);}
    finally{await fs.rm(temp,{force:true});}
    return {exported:true};
  }
}
