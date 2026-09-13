import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
import {prepareCore,closeGuiModules,coreOutput,ignoreGuiFile} from './scripts/package-resources.mjs';
import {createBuildIdentity} from './src/shared/build-identity.mjs';
export async function stampBuildMode(_config,buildPath){
  const mode=process.env.THEME_MANAGER_MODE??'production';
  if(!['beta','production'].includes(mode))throw Error('Only beta/production packages are supported');
  await writeFile(path.join(buildPath,'src/main/build-mode.json'),JSON.stringify(createBuildIdentity(mode,process.env.THEME_MANAGER_GIT_COMMIT)));
}
export default {
  hooks:{prePackage:prepareCore,packageAfterCopy:async(...args)=>{await stampBuildMode(...args);await closeGuiModules(args[1]);}},
  packagerConfig: {
    asar: true,
    name: "Codex Skin Theme Manager",
    executableName: "codex-skin-theme-manager",
    extraResource:[coreOutput],
    ignore:ignoreGuiFile,
    download:{cacheRoot:fileURLToPath(new URL('./out/electron-cache',import.meta.url)),checksums:require('electron/checksums.json')},
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32"],
    },
  ],
};
