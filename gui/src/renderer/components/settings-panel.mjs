export function renderSettingsPanel(elements, { skinAdaptation, dirty, busy, theme }) {
  const label = {'follow-codex':'Follow Codex','force-light':'Force light skin','force-dark':'Force dark skin'}[skinAdaptation];
  elements.summary.textContent = 'Adaptation: ' + label;
  elements.summary.title = dirty ? 'Pending selection — Apply changes to save.' : 'Applied policy';
  elements.appliedNotice.hidden = dirty || !theme;
  elements.advancedButton.disabled = busy;
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
