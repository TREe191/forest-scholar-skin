export function renderStatusBar(elements, { tone = "ready", message, activeThemeName, skinAdaptation }) {
  elements.bar.dataset.tone = tone;
  elements.message.textContent = message;
  elements.summary.textContent = activeThemeName
    ? `Active: ${activeThemeName} · ${skinAdaptation === "follow-codex" ? "Follow Codex" : skinAdaptation === "force-light" ? "Force light skin" : "Force dark skin"}`
    : "No valid active theme";
}
