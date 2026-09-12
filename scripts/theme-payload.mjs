import fs from "node:fs/promises";
import path from "node:path";
import { loadThemePackage } from "./theme-loader.mjs";
import { analyzePngTone } from "./background-tone.mjs";
import { resolveAdaptationProfile } from "./adaptation-profile.mjs";
import { paletteOverridesCss } from './palette-overrides.mjs';

function encodeImage(background) {
  const base64 = background.bytes.toString("base64");
  const dataUrl = `data:${background.mimeType};base64,${base64}`;
  return {
    dataUrl,
    width: background.width,
    height: background.height,
    stats: {
      sourceBytes: background.bytes.length,
      width: background.width,
      height: background.height,
      base64Length: base64.length,
      dataUrlLength: dataUrl.length,
      mimeType: background.mimeType,
      base64HasNewline: /[\r\n]/.test(base64),
      dataUrlHasQuote: /["']/.test(dataUrl),
      dataUrlHasBackslash: /\\/.test(dataUrl),
      base64LengthModulo4: base64.length % 4,
      base64HasPadding: base64.endsWith("="),
    },
  };
}

export async function loadThemePayload(root, themePackage, mode) {
  const realRoot = await fs.realpath(root);
  const theme = await loadThemePackage(themePackage);
  const [baseCss, compatibilityCss] = await Promise.all([
    fs.readFile(path.join(realRoot, "styles", "base.css"), "utf8"),
    fs.readFile(path.join(realRoot, "styles", "codex-compat.css"), "utf8"),
  ]);
  const images = {};
  const layouts = {};
  const imageStats = {};
  const encodedByBackground = new Map();
  const visualAdaptation = theme.styles.length === 0 ? "universal" : "custom";
  const backgroundTones = {};
  const adaptationProfiles = {};
  for (const appearance of theme.supportedAppearances) {
    const modeName = appearance === "light" ? "Light" : "Dark";
    const background = theme.backgrounds[appearance];
    let encoded = encodedByBackground.get(background);
    if (!encoded) {
      encoded = encodeImage(background);
      if (visualAdaptation === "universal") encoded.toneAnalysis = analyzePngTone(background.bytes);
      encodedByBackground.set(background, encoded);
    }
    images[modeName] = { dataUrl: encoded.dataUrl, width: encoded.width, height: encoded.height };
    layouts[modeName] = theme.variants[appearance].layoutConfig;
    imageStats[modeName] = encoded.stats;
    if (encoded.toneAnalysis) {
      adaptationProfiles[modeName] = resolveAdaptationProfile(encoded.toneAnalysis, appearance);
      // Keep the renderer's existing tone contract. Preserve shared analysis
      // identity when policy does not change its classified tone.
      backgroundTones[modeName] = adaptationProfiles[modeName].tone === encoded.toneAnalysis.tone
        ? encoded.toneAnalysis : { ...encoded.toneAnalysis, tone: adaptationProfiles[modeName].tone };
    }
  }
  return {
    theme: {
      id: theme.manifest.id,
      name: theme.manifest.name,
      version: theme.manifest.version,
      visualAdaptation,
    },
    css: [baseCss, compatibilityCss, ...(visualAdaptation==='universal' && theme.manifest.paletteOverrides ? [paletteOverridesCss(theme.manifest.paletteOverrides)] : []), ...theme.styles.map((style) => style.content)].join("\n\n"),
    supportedAppearances: theme.supportedAppearances,
    images,
    layouts,
    imageStats,
    ...(visualAdaptation === "universal" ? { backgroundTones, adaptationProfiles } : {}),
    mode,
  };
}
