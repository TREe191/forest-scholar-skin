import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, protocol, session, dialog, nativeImage } from "electron";
import { ThemeCreator } from './services/theme-creator.mjs';
import { ThemeManagement } from './services/theme-management.mjs';
import { WallpaperDrafts } from './services/wallpaper-drafts.mjs';
import { ThemeEditor } from './services/theme-editor.mjs';
import { ThemeDuplicator } from './services/theme-duplicate.mjs';
import { GuiPreferences } from './services/gui-preferences.mjs';
import { translate } from '../shared/i18n.mjs';
import { resolvePathContext } from "./paths.mjs";
import { ThemeCatalog } from "./services/theme-catalog.mjs";
import { AppConfigStore } from "./services/app-config.mjs";
import { CodexActions } from "./services/codex-actions.mjs";
import { installPreviewProtocol, registerPreviewScheme } from "./preview-protocol.mjs";
import { registerIpcHandlers } from "./ipc.mjs";

registerPreviewScheme(protocol);

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let removeIpcHandlers = null;
let services = null;

async function createServices() {
  const paths = await resolvePathContext({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
  const catalog = new ThemeCatalog({ themesRoot: paths.themesRoot });
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
    management: new ThemeManagement({themesRoot:paths.themesRoot,configStore,confirmDelete:async name=>{
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

app.whenReady().then(async () => {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  services = await createServices();
  await createMainWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createMainWindow();
  });
}).catch((error) => {
  console.error("Theme Manager failed to start:", error instanceof Error ? error.message : error);
  app.exit(1);
});

app.on("window-all-closed", () => app.quit());
