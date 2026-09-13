import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SENTINELS = Object.freeze([
  ["config", "app.schema.json"],
  ["themes", "theme.schema.json"],
  ["scripts", "Start-ForestScholarSkin.ps1"],
  ["scripts", "Restore-ForestScholarSkin.ps1"],
]);

async function isProjectRoot(candidate, fileSystem = fs) {
  try {
    const results = await Promise.all(
      SENTINELS.map(async (segments) => (await fileSystem.stat(path.join(candidate, ...segments))).isFile()),
    );
    return results.every(Boolean);
  } catch {
    return false;
  }
}

export async function findProjectRoot(startDirectory, { fileSystem = fs, maximumDepth = 8 } = {}) {
  if (!path.isAbsolute(startDirectory)) throw new TypeError("startDirectory must be absolute.");
  let candidate = path.resolve(startDirectory);
  for (let depth = 0; depth <= maximumDepth; depth += 1) {
    if (await isProjectRoot(candidate, fileSystem)) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error("The Codex Skin project root could not be resolved from the GUI location.");
}

export async function resolvePathContext({
  moduleUrl = import.meta.url,
  isPackaged = false,
  resourcesPath = process.resourcesPath,
  userDataPath,
} = {}) {
  const projectRoot = isPackaged
    ? path.join(resourcesPath, "skin-core")
    : await findProjectRoot(path.dirname(fileURLToPath(moduleUrl)));

  if (!(await isProjectRoot(projectRoot))) {
    throw new Error("The resolved Codex Skin project root is incomplete.");
  }
  if(isPackaged && (!userDataPath||!path.isAbsolute(userDataPath)))throw Error('Absolute userData path is required.');
  const dataRoot=isPackaged?path.resolve(userDataPath):projectRoot;
  if(isPackaged){
    const relative=path.relative(path.resolve(resourcesPath),dataRoot);
    if(!relative||!relative.startsWith('..')&&!path.isAbsolute(relative))throw Error('User data must be outside installation resources.');
  }

  return Object.freeze({
    projectRoot,
    resourceRoot:projectRoot,
    dataRoot,
    isPackaged,
    themesRoot: path.join(dataRoot, "themes"),
    builtinThemesRoot:isPackaged?path.join(projectRoot,'themes'):null,
    runtimeRoot:path.join(dataRoot,'runtime'),
    nodePath:isPackaged?path.join(projectRoot,'node','node.exe'):null,
    configPath: path.join(dataRoot, "config", "app.json"),
    scriptsRoot: path.join(projectRoot, "scripts"),
    startScript: path.join(projectRoot, "scripts", "Start-ForestScholarSkin.ps1"),
    restoreScript: path.join(projectRoot, "scripts", "Restore-ForestScholarSkin.ps1"),
  });
}

export async function initializeUserData(paths){
  if(!paths.isPackaged)return;
  await fs.mkdir(paths.dataRoot,{recursive:true});
  const realData=await fs.realpath(paths.dataRoot),realResources=await fs.realpath(path.dirname(paths.resourceRoot));
  const relative=path.relative(realResources,realData);
  if(!relative||!relative.startsWith('..')&&!path.isAbsolute(relative))throw Error('User data resolves inside installation resources.');
  // Never overwrite an existing user's config or import the developer's config.
  for(const folder of ['config','themes','runtime','runtime/temp']){
    const target=path.join(paths.dataRoot,folder);await fs.mkdir(target,{recursive:true});
    if(await fs.realpath(target)!==path.join(realData,folder))throw Error('Linked user data folders are not supported.');
  }
  const source=path.join(paths.resourceRoot,'config','default-app.json');
  try{await fs.copyFile(source,paths.configPath,fs.constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;}
  if(!(await fs.stat(paths.nodePath)).isFile())throw Error('Bundled Node runtime is missing.');
}
