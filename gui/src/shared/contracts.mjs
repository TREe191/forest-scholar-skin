export const IPC_CHANNELS = Object.freeze({
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

export const APPEARANCES = Object.freeze(["auto", "light", "dark"]);
export const SKIN_ADAPTATIONS = Object.freeze(["follow-codex", "force-light", "force-dark"]);
export const THEME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isAppearance(value) {
  return APPEARANCES.includes(value);
}

export function isThemeId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 80 && THEME_ID_PATTERN.test(value);
}

export function legacyAppearanceToSkinAdaptation(value) {
  const mapping = { auto: "follow-codex", light: "force-light", dark: "force-dark" };
  if (!Object.hasOwn(mapping, value)) throw new RangeError("Legacy appearance is invalid.");
  return mapping[value];
}

export function skinAdaptationToLegacyAppearance(value) {
  const mapping = { "follow-codex": "auto", "force-light": "light", "force-dark": "dark" };
  if (!Object.hasOwn(mapping, value)) throw new RangeError("Skin adaptation is invalid.");
  return mapping[value];
}

export function isSkinAdaptation(value) {
  return SKIN_ADAPTATIONS.includes(value);
}
