import { IPC_CHANNELS, isAppearance, isThemeId } from "../shared/contracts.mjs";

function publicError(error) {
  const message = (error instanceof Error ? error.message : "The operation failed.")
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n"']+/g, "<local-path>");
  return { ok: false, error: message.slice(0, 400) };
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

export function registerIpcHandlers({ ipcMain, authorizedWebContentsId, catalog, configStore, actions }) {
  const handle = (channel, operation) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        authorize(event, authorizedWebContentsId);
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
      ...catalogState,
      config,
      activeThemeValid: catalog.has(config.activeTheme),
    };
  };

  handle(IPC_CHANNELS.getState, buildState);
  handle(IPC_CHANNELS.rescanThemes, buildState);
  handle(IPC_CHANNELS.applyConfig, async (selection) => {
    if (!selection || !isThemeId(selection.activeTheme) || !isAppearance(selection.appearance)) {
      throw new RangeError("The requested theme selection is invalid.");
    }
    assertThemeAppearanceCompatibility(catalog, selection);
    const config = await configStore.apply(selection, { themeExists: (id) => catalog.has(id) });
    return { ok: true, config };
  });
  handle(IPC_CHANNELS.launchCodex, async () => ({ ok: true, result: await actions.launch() }));
  handle(IPC_CHANNELS.restoreCodex, async () => ({ ok: true, result: await actions.restore() }));

  return () => {
    for (const channel of Object.values(IPC_CHANNELS)) ipcMain.removeHandler(channel);
  };
}
