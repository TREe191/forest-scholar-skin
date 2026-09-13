import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const [command,mode]=process.argv.slice(2);
if(!['start','package','make'].includes(command)||!['development','beta','production'].includes(mode)||command!=='start'&&mode==='development')throw Error('Invalid build command/mode');
const child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/@electron-forge/cli/dist/electron-forge.js',import.meta.url)),command],{
  cwd:fileURLToPath(new URL('../',import.meta.url)),shell:false,stdio:'inherit',env:{...process.env,THEME_MANAGER_MODE:mode}
});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
