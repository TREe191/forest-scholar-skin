import { IPC_CHANNELS, isAppearance, isThemeId } from "../shared/contracts.mjs";
import { validateThemeName } from './services/theme-creator.mjs';

function publicError(error) {
  const message = (error instanceof Error ? error.message : "The operation failed.")
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n"']+/g, "<local-path>");
  const failureStage = typeof error?.failureStage === 'string' && /^[a-z0-9-]{1,80}$/.test(error.failureStage)
    ? error.failureStage
    : undefined;
  return { ok: false, error: message.slice(0, 400), ...(failureStage ? {failureStage} : {}) };
}

function authorize(event, authorizedWebContentsId) {
  if (event.sender.id !== authorizedWebContentsId || !event.senderFrame || event.senderFrame.parent !== null) {
    throw new Error("Unauthorized IPC sender.");
  }
}

export function assertThemeAppearanceCompatibility(catalog, selection) {
  if (selection.appearance !== "auto" && !catalog.supportsAppearance(selection.activeTheme, selection.appearance)) {
    throw new RangeError(`The selected theme does not support ${selection.appearance} skin adaptation.`);
  }
}

export function registerIpcHandlers({ ipcMain, authorizedWebContentsId, catalog, configStore, actions, creator, pickWallpaper, drafts, management, editor, duplicator, guiPreferences, runtimeInfo, diagnostics }) {
  let creating = false;
  let mutation = false;
  const exclusive = async fn => {
    if(mutation) throw Error('Another theme operation is in progress.');
    mutation=true;try{return await fn();}finally{mutation=false;}
  };
  const handle = (channel, operation) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        authorize(event, authorizedWebContentsId);
        if(runtimeInfo && runtimeInfo.mode!=='development'){
          if(channel===IPC_CHANNELS.rescanThemes)throw Error('Developer controls are unavailable in production.');
          const id=channel===IPC_CHANNELS.loadEditor||channel===IPC_CHANNELS.duplicateTheme?args[0]:
            [IPC_CHANNELS.renameTheme,IPC_CHANNELS.deleteTheme,IPC_CHANNELS.saveEditor].includes(channel)?args[0]?.id:null;
          if(id){await catalog.scan();if(!catalog.has(id))throw Error('Theme is unavailable in this build.');}
        }
        return await operation(...args);
      } catch (error) {
        return publicError(error);
      }
    });
  };

  const buildState = async () => {
    const catalogState = await catalog.scan();
    const config = await configStore.read();
    return {
      ok: true,
      runtimeInfo,
      ...catalogState,
      config,
      applied: await configStore.readApplied?.() ?? null,
      activeThemeValid: catalog.has(config.activeTheme),
    };
  };

  handle(IPC_CHANNELS.getState, buildState);
  handle(IPC_CHANNELS.exportDiagnostics,()=>exclusive(async()=>{
    if(!runtimeInfo?.supportDiagnostics)throw Error('Diagnostics export is unavailable in this build.');
    return {ok:true,...await diagnostics.exportLatest()};
  }));
  handle(IPC_CHANNELS.getGuiPreferences,async()=>({ok:true,preferences:await guiPreferences.read()}));
  handle(IPC_CHANNELS.saveGuiPreferences,async value=>({ok:true,preferences:await guiPreferences.save(value)}));
  handle(IPC_CHANNELS.duplicateTheme,id=>exclusive(async()=>{
    const created=await duplicator.duplicate(id);return {...await buildState(),created};
  }));
  handle(IPC_CHANNELS.rescanThemes, buildState);
  handle(IPC_CHANNELS.loadEditor, id=>exclusive(async()=>({ok:true,model:await editor.load(id)})));
  handle(IPC_CHANNELS.saveEditor, model=>exclusive(async()=>{const created=await editor.save(model);return {...await buildState(),created};}));
  handle(IPC_CHANNELS.pickImage,async()=>{const source=await pickWallpaper();return source?{ok:true,image:await drafts.fromPath(source)}:{ok:true,canceled:true};});
  handle(IPC_CHANNELS.dropImage,async request=>({ok:true,image:await drafts.prepare(request?.name,request?.bytes)}));
  handle(IPC_CHANNELS.clearImage,async token=>{if(typeof token==='string')drafts.images.delete(token);else drafts.clear();return {ok:true};});
  handle(IPC_CHANNELS.renameTheme,request=>exclusive(async()=>{
    await management.rename(request?.id,request?.name);return await buildState();
  }));
  handle(IPC_CHANNELS.deleteTheme,request=>exclusive(async()=>{
    if(!request || !isThemeId(request.pendingId))throw Error('Current selection is required.');
    const result=await management.delete(request.id,request.pendingId);
    return {...await buildState(),...result};
  }));
  handle(IPC_CHANNELS.createTheme, async request => {
    if (!request || Object.keys(request).some(key => !['name','token'].includes(key))) throw new RangeError('Invalid create request');
    const name = validateThemeName(request.name);
    if (creating) throw new Error('Theme creation is already in progress.');
    creating = true;
    try {
      if(drafts) {
        const created=await drafts.create(name,request.token);
        return {...await buildState(),created};
      }
      const source = await pickWallpaper();
      if (!source) return {ok:true,canceled:true};
      const created = await creator.create(name,source);
      return {...await buildState(),created};
    } finally { creating = false; }
  });
  handle(IPC_CHANNELS.applyConfig, (selection) => exclusive(async () => {
    if (!selection || !isThemeId(selection.activeTheme) || !isAppearance(selection.appearance)) {
      throw new RangeError("The requested theme selection is invalid.");
    }
    const catalogState = await catalog.scan();
    const contentRevision = catalogState.themes.find(theme=>theme.id===selection.activeTheme)?.contentRevision;
    assertThemeAppearanceCompatibility(catalog, selection);
    const config = await configStore.apply(selection, { themeExists: (id) => catalog.has(id), contentRevision });
    return { ok: true, config, ...catalogState, applied: await configStore.readApplied?.() ?? null };
  }));
  handle(IPC_CHANNELS.launchCodex, async () => {
    if(runtimeInfo && runtimeInfo.mode!=='development'){
      await catalog.scan();const config=await configStore.read();
      if(!catalog.has(config.activeTheme))throw Error('Choose and Apply an available theme before launching.');
    }
    return {ok:true,result:await actions.launch()};
  });
  handle(IPC_CHANNELS.restoreCodex, async () => ({ ok: true, result: await actions.restore() }));

  return () => {
    for (const channel of Object.values(IPC_CHANNELS)) ipcMain.removeHandler(channel);
  };
}
