const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = Object.freeze({
  getState: "theme-manager:get-state",
  rescanThemes: "theme-manager:rescan-themes",
  applyConfig: "theme-manager:apply-config",
  launchCodex: "theme-manager:launch-codex",
  restoreCodex: "theme-manager:restore-codex",
});

contextBridge.exposeInMainWorld("themeManager", Object.freeze({
  getState: () => ipcRenderer.invoke(CHANNELS.getState),
  rescanThemes: () => ipcRenderer.invoke(CHANNELS.rescanThemes),
  applyConfig: (selection) => ipcRenderer.invoke(CHANNELS.applyConfig, {
    activeTheme: selection?.activeTheme,
    appearance: selection?.appearance,
  }),
  launchCodex: () => ipcRenderer.invoke(CHANNELS.launchCodex),
  restoreCodex: () => ipcRenderer.invoke(CHANNELS.restoreCodex),
}));
