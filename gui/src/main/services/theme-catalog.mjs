import fs from "node:fs/promises";
import path from "node:path";
import { loadThemePackage } from "../../../../scripts/theme-loader.mjs";

const PREVIEW_SCHEME = "skin-preview";

function safeValidationMessage(error, packagePath) {
  if (!(error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError)) {
    return "Theme package could not be read safely.";
  }
  const message = String(error.message || "Theme package failed validation.")
    .split(packagePath).join("<theme-package>")
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n"']+/g, "<local-path>")
    .slice(0, 300);
  return message || "Theme package failed validation.";
}

function publicTheme(theme) {
  const { manifest } = theme;
  return Object.freeze({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    description: manifest.description,
    schemaVersion: manifest.schemaVersion,
    supportedAppearances: [...theme.supportedAppearances],
    visualAdaptation: theme.styles.length === 0 ? "universal" : "custom",
    previews: {
      light: theme.supportedAppearances.includes("light")
        ? `${PREVIEW_SCHEME}://theme/${encodeURIComponent(manifest.id)}/light`
        : null,
      dark: theme.supportedAppearances.includes("dark")
        ? `${PREVIEW_SCHEME}://theme/${encodeURIComponent(manifest.id)}/dark`
        : null,
    },
  });
}

export class ThemeCatalog {
  #themesRoot;
  #fileSystem;
  #loader;
  #packages = new Map();
  #themes = [];
  #invalidThemes = [];

  constructor({ themesRoot, fileSystem = fs, loader = loadThemePackage }) {
    if (!path.isAbsolute(themesRoot)) throw new TypeError("themesRoot must be absolute.");
    this.#themesRoot = themesRoot;
    this.#fileSystem = fileSystem;
    this.#loader = loader;
  }

  async scan() {
    const entries = await this.#fileSystem.readdir(this.#themesRoot, { withFileTypes: true });
    const packages = new Map();
    const themes = [];
    const invalidThemes = [];

    for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const packagePath = path.join(this.#themesRoot, entry.name);
      try {
        const loaded = await this.#loader(packagePath);
        const id = loaded.manifest.id;
        if (packages.has(id)) throw new RangeError(`Duplicate theme identifier: ${id}.`);
        packages.set(id, loaded);
        themes.push(publicTheme(loaded));
      } catch (error) {
        invalidThemes.push(Object.freeze({
          folder: entry.name,
          message: safeValidationMessage(error, packagePath),
        }));
      }
    }

    this.#packages = packages;
    this.#themes = Object.freeze(themes);
    this.#invalidThemes = Object.freeze(invalidThemes);
    return this.snapshot();
  }

  snapshot() {
    return {
      themes: [...this.#themes],
      invalidThemes: [...this.#invalidThemes],
    };
  }

  has(themeId) {
    return this.#packages.has(themeId);
  }

  supportsAppearance(themeId, appearance) {
    if (!["light", "dark"].includes(appearance)) return false;
    return this.#packages.get(themeId)?.supportedAppearances.includes(appearance) ?? false;
  }

  getPreviewAsset(themeId, variant) {
    if (!themeId || !["light", "dark"].includes(variant)) return null;
    const theme = this.#packages.get(themeId);
    if (!theme) return null;
    const background = theme.backgrounds[variant];
    if (!background) return null;
    return {
      bytes: background.bytes,
      mimeType: background.mimeType,
    };
  }
}
