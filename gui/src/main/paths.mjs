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
} = {}) {
  const moduleDirectory = path.dirname(fileURLToPath(moduleUrl));
  const projectRoot = isPackaged
    ? path.join(resourcesPath, "skin-core")
    : await findProjectRoot(moduleDirectory);

  if (!(await isProjectRoot(projectRoot))) {
    throw new Error("The resolved Codex Skin project root is incomplete.");
  }

  return Object.freeze({
    projectRoot,
    themesRoot: path.join(projectRoot, "themes"),
    configPath: path.join(projectRoot, "config", "app.json"),
    scriptsRoot: path.join(projectRoot, "scripts"),
    startScript: path.join(projectRoot, "scripts", "Start-ForestScholarSkin.ps1"),
    restoreScript: path.join(projectRoot, "scripts", "Restore-ForestScholarSkin.ps1"),
  });
}
