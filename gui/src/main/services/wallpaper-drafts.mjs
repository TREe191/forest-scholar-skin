import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export class WallpaperDrafts {
  constructor(creator){this.creator=creator;this.draft=null;this.images=new Map();}
  async fromPath(source){
    const f=await fs.open(source,'r');
    try {const s=await f.stat();if(!s.isFile()||s.size>20*1024*1024)throw Error('Image exceeds 20 MB.');return await this.prepare(path.basename(source),await f.readFile());}
    finally{await f.close();}
  }
  async prepare(name,bytes){
    if(typeof name!=='string'||name.length>255||/[\\/]/.test(name)||!(bytes instanceof Uint8Array)||bytes.length>20*1024*1024)throw Error('Invalid image input.');
    const ext=path.extname(name).toLowerCase(),b=Buffer.from(bytes);
    const png=b.subarray(0,8).toString('hex')==='89504e470d0a1a0a';
    if(!['.png','.jpg','.jpeg'].includes(ext)||(ext==='.png'?!png:!(b[0]===255&&b[1]===216&&b[2]===255)))throw Error('Select a valid PNG/JPG.');
    await this.creator.validateImage(b);
    const data=png?b:await this.creator.convertJpeg(b);
    this.draft={token:randomUUID(),bytes:data,name};
    this.images.set(this.draft.token,this.draft);
    while(this.images.size>6)this.images.delete(this.images.keys().next().value);
    return {token:this.draft.token,name,preview:`skin-preview://draft/${this.draft.token}/image`};
  }
  asset(token){const d=this.images.get(token);return d?{bytes:d.bytes,mimeType:'image/png'}:null;}
  clear(){this.draft=null;this.images.clear();}
  async create(name,token){
    if(this.draft?.token!==token)throw Error('Choose an image again.');
    const bytes=this.draft.bytes;
    const root=path.join(path.dirname(this.creator.themesRoot),'runtime','theme-creation');await fs.mkdir(root,{recursive:true});
    const dir=await fs.mkdtemp(path.join(root,'draft-'));
    try {const file=path.join(dir,'background.png');await fs.writeFile(file,bytes);const result=await this.creator.create(name,file);this.clear();return result;}
    finally{await fs.rm(dir,{recursive:true,force:true});}
  }
}
