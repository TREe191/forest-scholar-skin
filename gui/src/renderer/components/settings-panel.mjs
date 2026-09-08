export function renderSettingsPanel(elements, { skinAdaptation, dirty, busy, theme }) {
  const supported = theme?.supportedAppearances || [];
  const validAdaptation = skinAdaptation === "follow-codex" ||
    (skinAdaptation === "force-light" && supported.includes("light")) ||
    (skinAdaptation === "force-dark" && supported.includes("dark"));
  for (const input of elements.adaptationInputs) {
    input.checked = input.value === skinAdaptation;
    const forcedAppearance = input.value === "force-light" ? "light" : input.value === "force-dark" ? "dark" : null;
    input.disabled = busy || Boolean(forcedAppearance && !supported.includes(forcedAppearance));
  }
  if (skinAdaptation !== "follow-codex") elements.advanced.open = true;
  elements.pendingNotice.hidden = !dirty;
  elements.forceWarning.hidden = skinAdaptation === "follow-codex";
  elements.compatibilityWarning.hidden = !theme || supported.length === 2;
  elements.compatibilityWarning.textContent = theme && supported.length === 1
    ? `This theme supports ${supported[0] === "dark" ? "Dark" : "Light"} Codex appearance only. Follow Codex will fail closed when Codex uses the unsupported appearance.`
    : "";
  elements.applyButton.disabled = busy || !dirty || !theme || !validAdaptation;
  elements.launchButton.disabled = busy || dirty || !theme || !validAdaptation;
  elements.restoreButton.disabled = busy;
}
