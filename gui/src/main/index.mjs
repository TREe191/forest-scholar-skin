import path from "node:path";
import {readFileSync} from 'node:fs';
import {DiagnosticsExporter} from './services/diagnostics-export.mjs';
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, protocol, session, dialog, nativeImage } from "electron";
import { ThemeCreator } from './services/theme-creator.mjs';
import { ThemeManagement } from './services/theme-management.mjs';
import { WallpaperDrafts } from './services/wallpaper-drafts.mjs';
import { ThemeEditor } from './services/theme-editor.mjs';
import { ThemeDuplicator } from './services/theme-duplicate.mjs';
import { GuiPreferences } from './services/gui-preferences.mjs';
import { translate } from '../shared/i18n.mjs';
import {resolveRuntimeMode,applicationInfo} from '../shared/runtime-mode.mjs';
import {createBuildIdentity} from '../shared/build-identity.mjs';
import { resolvePathContext,initializeUserData } from "./paths.mjs";
import { ThemeCatalog } from "./services/theme-catalog.mjs";
import { AppConfigStore } from "./services/app-config.mjs";
import { CodexActions } from "./services/codex-actions.mjs";
import { installPreviewProtocol, registerPreviewScheme } from "./preview-protocol.mjs";
import { registerIpcHandlers } from "./ipc.mjs";

registerPreviewScheme(protocol);

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let removeIpcHandlers = null;
let services = null;
let runtimeMode = null;
let buildIdentity = null;

function startupErrorDetail(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.trim().slice(0, 800) || "Unknown startup error.";
}

async function createServices() {
  const paths = await resolvePathContext({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userDataPath:app.getPath('userData'),
  });
  await initializeUserData(paths);
  const catalog = new ThemeCatalog({ themesRoot: paths.themesRoot,builtinThemesRoot:paths.builtinThemesRoot,mode:runtimeMode });
  await catalog.scan();
  const creator = new ThemeCreator({ themesRoot: paths.themesRoot,
      validateImage: bytes => {
        const image = nativeImage.createFromBuffer(bytes), size = image.getSize();
        if (image.isEmpty() || !size.width || !size.height || size.width * size.height > 8_000_000) throw new RangeError('Image must decode correctly and contain at most 8 million pixels.');
      },
      convertJpeg: bytes => nativeImage.createFromBuffer(bytes).toPNG(),
    });
  const drafts = new WallpaperDrafts(creator);
  const configStore = new AppConfigStore({ configPath: paths.configPath });
  const guiPreferences = new GuiPreferences({filePath:path.join(path.dirname(paths.configPath),'.gui-settings.json')});
  installPreviewProtocol(protocol, catalog, drafts);
  const result = {
    creator, drafts, configStore, guiPreferences,
    runtimeInfo:applicationInfo(app.getVersion(),runtimeMode,buildIdentity),
    diagnostics:new DiagnosticsExporter({historyRoot:path.join(paths.runtimeRoot,'history'),info:applicationInfo(app.getVersion(),runtimeMode,buildIdentity),chooseDestination:async defaultPath=>{
      const result=await dialog.showSaveDialog({title:translate('Export diagnostics',(await guiPreferences.read()).language),defaultPath,filters:[{name:'ZIP',extensions:['zip']}]});
      return result.canceled?null:result.filePath;
    }}),
    management: new ThemeManagement({themesRoot:paths.themesRoot,builtinThemesRoot:paths.builtinThemesRoot,configStore,confirmDelete:async name=>{
      const {language}=await guiPreferences.read();
      const answer=await dialog.showMessageBox({type:'warning',buttons:['Cancel','Delete theme'].map(s=>translate(s,language)),defaultId:0,cancelId:0,message:translate(`Delete “${name}”?`,language),detail:translate('The package will be moved out of the theme list into runtime/deleted-themes for recovery.',language)});
      return answer.response===1;
    }}),
    pickWallpaper: async () => {
      const {language}=await guiPreferences.read();
      const result = await dialog.showOpenDialog({ title: translate('Add Wallpaper',language), properties: ['openFile'], filters: [{ name: translate('Wallpaper (PNG / JPG)',language), extensions: ['png','jpg','jpeg'] }] });
      return result.canceled ? null : result.filePaths[0];
    },
    catalog,
    actions: new CodexActions(paths),
  };
  result.editor=new ThemeEditor({creator,drafts,management:result.management});
  result.duplicator=new ThemeDuplicator({management:result.management,catalog});
  return result;
}

async function createMainWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 620,
    show: false,
    title: "Codex Skin Theme Manager",
    backgroundColor: "#121916",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDirectory, "..", "preload", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      devTools:runtimeMode==='development',
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  removeIpcHandlers = registerIpcHandlers({
    ipcMain,
    authorizedWebContentsId: window.webContents.id,
    ...services,
  });

  window.once("ready-to-show", () => window.show());
  await window.loadFile(path.join(currentDirectory, "..", "renderer", "index.html"));
  window.on("closed", () => {
    removeIpcHandlers?.();
    removeIpcHandlers = null;
  });
  return window;
}

async function startApplication() {
  const packagedBuild=app.isPackaged?JSON.parse(readFileSync(new URL('./build-mode.json',import.meta.url),'utf8')):null;
  const packagedMode=packagedBuild?.mode;
  runtimeMode=resolveRuntimeMode({isPackaged:app.isPackaged,requested:process.env.THEME_MANAGER_MODE,packagedMode});
  buildIdentity=app.isPackaged?createBuildIdentity(runtimeMode,packagedBuild?.gitCommit):createBuildIdentity(runtimeMode,process.env.THEME_MANAGER_GIT_COMMIT);
  await app.whenReady();
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  services = await createServices();
  await createMainWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createMainWindow();
  });
}

startApplication().catch((error) => {
  const detail = startupErrorDetail(error);
  console.error("Theme Manager failed to start:", detail);
  try {
    if (runtimeMode === "beta" || app.isPackaged) {
      const issueKind = runtimeMode === "beta" ? "Beta issue" : "startup issue";
      dialog.showErrorBox(
        "Theme Manager could not start",
        `Restart Theme Manager once. If it fails again, report this ${issueKind} and include the message below:\n\n${detail}`,
      );
    }
  } catch (dialogError) {
    console.error("Theme Manager could not show its startup error dialog:", startupErrorDetail(dialogError));
  } finally {
    app.exit(1);
  }
});

app.on("window-all-closed", () => app.quit());
