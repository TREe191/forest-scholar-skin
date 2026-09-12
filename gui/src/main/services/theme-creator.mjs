import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadThemePackage } from '../../../../scripts/theme-loader.mjs';
export function validateThemeName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw new RangeError('Enter a theme name of 1–80 characters.');
  return name.trim();
}
export class ThemeCreator {
  constructor({ themesRoot, convertJpeg, validateImage, publish = fs.rename }) {
    if (!path.isAbsolute(themesRoot)) throw new TypeError('Absolute themes root required');
    Object.assign(this, { themesRoot, convertJpeg, validateImage, publish });
  }
  // Only main's native file picker supplies sourcePath; never renderer IPC.
  async create(name, sourcePath) {
    name = validateThemeName(name);
    const ext = path.extname(sourcePath).toLowerCase();
    if (!['.png','.jpg','.jpeg'].includes(ext)) throw new RangeError('Select PNG or JPG.');
    const input = await fs.open(sourcePath,'r');
    let bytes;
    try {
      const stat = await input.stat();
      if (!stat.isFile() || stat.size > 20*1024*1024) throw new RangeError('Image must be a file no larger than 20 MB.');
      bytes = await input.readFile();
    } finally { await input.close(); }
    if (bytes.length > 20*1024*1024) throw new RangeError('Image exceeds 20 MB.');
    const png = bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a';
    if (ext === '.png' ? !png : !(bytes[0]===255 && bytes[1]===216 && bytes[2]===255)) throw new RangeError('Image content does not match extension.');
    await this.validateImage(bytes);
    const background = png ? bytes : await this.convertJpeg(bytes);
    const root = await fs.realpath(this.themesRoot);
    const stagingRoot = path.join(path.dirname(root),'runtime','theme-creation');
    await fs.mkdir(stagingRoot,{recursive:true});
    const staging = await fs.mkdtemp(path.join(stagingRoot,'package-'));
    const id = `user-${randomUUID()}`;
    try {
      await fs.mkdir(path.join(staging,'assets'));
      await fs.writeFile(path.join(staging,'assets/background.png'),background,{flag:'wx'});
      const manifest = {$schema:'../theme.schema.json',schemaVersion:2,id,name,version:'0.1.0',author:'Local user',description:'User-created Universal wallpaper theme.',compatibility:{codexAppearances:['light','dark']},background:{default:'assets/background.png'},layout:'layout.json'};
      const layout = {schemaVersion:1,shared:{mode:'contain',focalRegion:{x:0,y:0,width:1,height:1},anchor:{x:0.5,y:0.5},safePadding:{left:0,right:0,top:0,bottom:0},focusTolerance:0,scale:1,minScale:null,maxScale:null,offset:{x:0,y:0}},variants:{light:{},dark:{}}};
      await fs.writeFile(path.join(staging,'theme.json'),JSON.stringify(manifest,null,2));
      await fs.writeFile(path.join(staging,'layout.json'),JSON.stringify(layout,null,2));
      await fs.writeFile(path.join(staging,'management.json'),JSON.stringify({schemaVersion:1,origin:'user',protected:false,deletable:true,renamable:true},null,2));
      await loadThemePackage(staging);
      await this.publish(staging,path.join(root,id));
      return {id,converted:!png};
    } finally {
      // Only our exact mkdtemp-owned directory, never source or themes root.
      await fs.rm(staging,{recursive:true,force:true});
    }
  }
}
