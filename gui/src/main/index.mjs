import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, protocol, session } from "electron";
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
  installPreviewProtocol(protocol, catalog);
  return {
    catalog,
    configStore: new AppConfigStore({ configPath: paths.configPath }),
    actions: new CodexActions(paths),
  };
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
