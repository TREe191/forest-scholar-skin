import { renderThemeList } from "./components/theme-list.mjs";
import { renderThemePreview } from "./components/theme-preview.mjs";
import { renderSettingsPanel } from "./components/settings-panel.mjs";
import { renderStatusBar } from "./components/status-bar.mjs";
import { legacyAppearanceToSkinAdaptation, skinAdaptationToLegacyAppearance } from "../shared/contracts.mjs";

const api = window.themeManager;
const elements = {
  themeList: document.querySelector("#theme-list"),
  themeCount: document.querySelector("#theme-count"),
  invalidThemes: document.querySelector("#invalid-themes"),
  rescanButton: document.querySelector("#rescan-button"),
  previewButtons: [...document.querySelectorAll("[data-preview-variant]")],
  preview: {
    image: document.querySelector("#theme-preview"),
    placeholder: document.querySelector("#preview-placeholder"),
    name: document.querySelector("#theme-name"),
    version: document.querySelector("#theme-version"),
    author: document.querySelector("#theme-author"),
    adaptation: document.querySelector("#theme-adaptation"),
    description: document.querySelector("#theme-description"),
    subtitle: document.querySelector("#preview-subtitle"),
  },
  settings: {
    adaptationInputs: [...document.querySelectorAll('input[name="skin-adaptation"]')],
    advanced: document.querySelector("#advanced-adaptation"),
    compatibilityWarning: document.querySelector("#compatibility-warning"),
    forceWarning: document.querySelector("#force-warning"),
    pendingNotice: document.querySelector("#pending-notice"),
    applyButton: document.querySelector("#apply-button"),
    launchButton: document.querySelector("#launch-button"),
    restoreButton: document.querySelector("#restore-button"),
  },
  status: {
    bar: document.querySelector("#status-bar"),
    message: document.querySelector("#status-message"),
    summary: document.querySelector("#active-summary"),
  },
};

const state = {
  themes: [],
  invalidThemes: [],
  selectedTheme: null,
  activeTheme: null,
  previewVariant: "light",
  skinAdaptation: "follow-codex",
  appliedSkinAdaptation: "follow-codex",
  operation: "loading",
  statusTone: "busy",
  statusMessage: "Loading Theme Packages…",
};

function selectedTheme() {
  return state.themes.find((theme) => theme.id === state.selectedTheme) || null;
}

function activeThemeName() {
  return state.themes.find((theme) => theme.id === state.activeTheme)?.name || null;
}

function isDirty() {
  return state.selectedTheme !== state.activeTheme || state.skinAdaptation !== state.appliedSkinAdaptation;
}

function isBusy() {
  return !["idle", "error"].includes(state.operation);
}

function renderInvalidThemes() {
  const count = state.invalidThemes.length;
  elements.invalidThemes.hidden = count === 0;
  elements.invalidThemes.replaceChildren();
  if (count === 0) return;
  const title = document.createElement("strong");
  title.textContent = `${count} invalid package${count === 1 ? "" : "s"}`;
  const detail = document.createElement("div");
  detail.textContent = state.invalidThemes.map((theme) => theme.folder).join(", ");
  elements.invalidThemes.append(title, detail);
  elements.invalidThemes.title = state.invalidThemes.map((theme) => `${theme.folder}: ${theme.message}`).join("\n");
}

function render() {
  const dirty = isDirty();
  const busy = isBusy();
  const theme = selectedTheme();
  if (theme && !theme.supportedAppearances.includes(state.previewVariant)) {
    state.previewVariant = theme.supportedAppearances[0];
  }
  elements.themeCount.textContent = String(state.themes.length);
  renderThemeList(elements.themeList, state.themes, {
    selectedTheme: state.selectedTheme,
    activeTheme: state.activeTheme,
    onSelect: (themeId) => {
      state.selectedTheme = themeId;
      setStatus("ready", dirtyMessage());
      render();
    },
  });
  renderInvalidThemes();
  for (const button of elements.previewButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.previewVariant === state.previewVariant));
    button.disabled = busy || !theme || !theme.supportedAppearances.includes(button.dataset.previewVariant);
  }
  renderThemePreview(elements.preview, theme, state.previewVariant);
  renderSettingsPanel(elements.settings, {
    skinAdaptation: state.skinAdaptation,
    dirty,
    busy,
    theme,
  });
  elements.rescanButton.disabled = busy;
  renderStatusBar(elements.status, {
    tone: state.statusTone,
    message: state.statusMessage,
    activeThemeName: activeThemeName(),
    skinAdaptation: state.appliedSkinAdaptation,
  });
}

function dirtyMessage() {
  return isDirty() ? "Selection changed. Apply before launching Codex." : "Ready.";
}

function setStatus(tone, message) {
  state.statusTone = tone;
  state.statusMessage = message;
}

function acceptBootstrap(result, { preserveSelection = false } = {}) {
  if (!result?.ok) throw new Error(result?.error || "Theme Manager state could not be loaded.");
  state.themes = Array.isArray(result.themes) ? result.themes : [];
  state.invalidThemes = Array.isArray(result.invalidThemes) ? result.invalidThemes : [];
  state.activeTheme = result.config.activeTheme;
  state.skinAdaptation = legacyAppearanceToSkinAdaptation(result.config.appearance);
  state.appliedSkinAdaptation = state.skinAdaptation;
  const previousSelectionExists = preserveSelection && state.themes.some((theme) => theme.id === state.selectedTheme);
  state.selectedTheme = previousSelectionExists
    ? state.selectedTheme
    : state.themes.some((theme) => theme.id === state.activeTheme)
      ? state.activeTheme
      : state.themes[0]?.id || null;
  state.previewVariant = state.skinAdaptation === "force-dark" ? "dark" : "light";
  state.operation = "idle";
  if (!result.activeThemeValid) setStatus("error", "The configured activeTheme is not a valid loaded Theme Package.");
  else if (state.invalidThemes.length > 0) setStatus("ready", `Ready. ${state.invalidThemes.length} invalid package${state.invalidThemes.length === 1 ? " was" : "s were"} isolated.`);
  else setStatus("ready", "Ready.");
}

async function bootstrap() {
  try { acceptBootstrap(await api.getState()); }
  catch (error) {
    state.operation = "error";
    setStatus("error", error instanceof Error ? error.message : "Theme Manager failed to load.");
  }
  render();
}

async function runOperation(name, operation, successMessage) {
  state.operation = name;
  setStatus("busy", `${successMessage.replace(/\.$/, "")}…`);
  render();
  try {
    const result = await operation();
    if (!result?.ok) throw new Error(result?.error || `${successMessage} failed.`);
    state.operation = "idle";
    setStatus("ready", successMessage);
    return result;
  } catch (error) {
    state.operation = "error";
    setStatus("error", error instanceof Error ? error.message : "The operation failed.");
    return null;
  } finally {
    render();
  }
}

elements.rescanButton.addEventListener("click", async () => {
  const result = await runOperation("scanning", () => api.rescanThemes(), "Theme Packages rescanned.");
  if (result) acceptBootstrap(result, { preserveSelection: true });
  render();
});

for (const button of elements.previewButtons) {
  button.addEventListener("click", () => {
    state.previewVariant = button.dataset.previewVariant;
    render();
  });
}

for (const input of elements.settings.adaptationInputs) {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    state.skinAdaptation = input.value;
    setStatus("ready", dirtyMessage());
    render();
  });
}

elements.settings.applyButton.addEventListener("click", async () => {
  const result = await runOperation(
    "applying",
    () => api.applyConfig({
      activeTheme: state.selectedTheme,
      appearance: skinAdaptationToLegacyAppearance(state.skinAdaptation),
    }),
    "Theme selection applied.",
  );
  if (result) {
    state.activeTheme = result.config.activeTheme;
    state.appliedSkinAdaptation = legacyAppearanceToSkinAdaptation(result.config.appearance);
  }
  render();
});

elements.settings.launchButton.addEventListener("click", () => runOperation(
  "launching",
  () => api.launchCodex(),
  "Codex launch workflow completed.",
));

elements.settings.restoreButton.addEventListener("click", () => runOperation(
  "restoring",
  () => api.restoreCodex(),
  "Codex restore workflow completed.",
));

bootstrap();
