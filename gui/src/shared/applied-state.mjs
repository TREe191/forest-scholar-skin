export function isThemeApplied(theme, activeTheme, applied) {
  return Boolean(theme?.contentRevision && applied &&
    theme.id === activeTheme && applied.themeId === theme.id &&
    applied.contentRevision === theme.contentRevision);
}
export function isSelectionDirty(theme, activeTheme, appearance, applied) {
  return !isThemeApplied(theme, activeTheme, applied) || appearance !== applied?.appearance;
}
