const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = Object.freeze({
  getGuiPreferences:'theme-manager:get-gui-preferences',saveGuiPreferences:'theme-manager:save-gui-preferences',
  duplicateTheme:'theme-manager:duplicate-theme',
  loadEditor:'theme-manager:load-editor',saveEditor:'theme-manager:save-editor',
  pickImage:'theme-manager:pick-image',dropImage:'theme-manager:drop-image',clearImage:'theme-manager:clear-image',
  renameTheme:'theme-manager:rename-theme',deleteTheme:'theme-manager:delete-theme',
  createTheme: "theme-manager:create-theme",
  getState: "theme-manager:get-state",
  rescanThemes: "theme-manager:rescan-themes",
  applyConfig: "theme-manager:apply-config",
  launchCodex: "theme-manager:launch-codex",
  restoreCodex: "theme-manager:restore-codex",
});

contextBridge.exposeInMainWorld("themeManager", Object.freeze({
  getGuiPreferences:()=>ipcRenderer.invoke(CHANNELS.getGuiPreferences),
  saveGuiPreferences:value=>ipcRenderer.invoke(CHANNELS.saveGuiPreferences,value),
  duplicateTheme:id=>ipcRenderer.invoke(CHANNELS.duplicateTheme,id),
  loadEditor:id=>ipcRenderer.invoke(CHANNELS.loadEditor,id),
  saveEditor:model=>ipcRenderer.invoke(CHANNELS.saveEditor,model),
  createTheme: (name,token) => ipcRenderer.invoke(CHANNELS.createTheme, {name,token}),
  pickImage:()=>ipcRenderer.invoke(CHANNELS.pickImage),
  dropImage:(name,bytes)=>ipcRenderer.invoke(CHANNELS.dropImage,{name,bytes}),
  clearImage:token=>ipcRenderer.invoke(CHANNELS.clearImage,token),
  renameTheme:(id,name)=>ipcRenderer.invoke(CHANNELS.renameTheme,{id,name}),
  deleteTheme:(id,pendingId)=>ipcRenderer.invoke(CHANNELS.deleteTheme,{id,pendingId}),
  getState: () => ipcRenderer.invoke(CHANNELS.getState),
  rescanThemes: () => ipcRenderer.invoke(CHANNELS.rescanThemes),
  applyConfig: (selection) => ipcRenderer.invoke(CHANNELS.applyConfig, {
    activeTheme: selection?.activeTheme,
    appearance: selection?.appearance,
  }),
  launchCodex: () => ipcRenderer.invoke(CHANNELS.launchCodex),
  restoreCodex: () => ipcRenderer.invoke(CHANNELS.restoreCodex),
}));
