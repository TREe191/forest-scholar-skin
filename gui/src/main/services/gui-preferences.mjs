import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export const DEFAULT_GUI_PREFERENCES=Object.freeze({appearance:'system',language:'en'});
export function validateGuiPreferences(value){
  if(!value || Object.keys(value).length!==2 || !['system','light','dark'].includes(value.appearance) || !['en','zh'].includes(value.language))
    throw new TypeError('Invalid Theme Manager settings.');
  return {appearance:value.appearance,language:value.language};
}
export class GuiPreferences {
  constructor({filePath,fileSystem=fs}){this.filePath=filePath;this.fs=fileSystem;this.queue=Promise.resolve();}
  async read(){
    try{return validateGuiPreferences(JSON.parse(await this.fs.readFile(this.filePath,'utf8')));}
    catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError||error instanceof TypeError)return {...DEFAULT_GUI_PREFERENCES};throw error;}
  }
  save(value){
    const next=validateGuiPreferences(value);
    const operation=this.queue.then(async()=>{
      await this.fs.mkdir(path.dirname(this.filePath),{recursive:true});
      const temp=this.filePath+'.'+randomUUID()+'.tmp';
      try{
        await this.fs.writeFile(temp,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600});
        await this.fs.rename(temp,this.filePath);
        return next;
      }finally{await this.fs.rm(temp,{force:true}).catch(()=>{});}
    });
    this.queue=operation.catch(()=>{});return operation;
  }
}
