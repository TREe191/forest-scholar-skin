import fs from "node:fs/promises";
import path from "node:path";
import { resolveLayoutConfig } from "./layout-engine.mjs";
import { validatePaletteOverrides } from './palette-overrides.mjs';

const SUPPORTED_THEME_SCHEMA_VERSIONS = new Set([1, 2]);
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_LAYOUT_BYTES = 256 * 1024;
const MAX_CSS_BYTES = 1024 * 1024;
const MAX_TOTAL_CSS_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const THEME_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new RangeError(`${label} contains unsupported property: ${key}.`);
  }
}

function assertString(value, label, maximumLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    throw new TypeError(`${label} must be a non-empty string no longer than ${maximumLength} characters.`);
  }
}

function pathIsInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function validatePackageRelativePath(value, label = "package path") {
  assertString(value, label, 500);
  if (value.includes("\0")) throw new RangeError(`${label} contains a NUL character.`);
  if (value.includes("\\")) throw new RangeError(`${label} must use forward slashes, not backslashes.`);
  if (value.startsWith("//") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new RangeError(`${label} must not be an absolute or UNC path.`);
  }
  if (URI_SCHEME.test(value)) throw new RangeError(`${label} must not contain a URI scheme.`);
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new RangeError(`${label} contains an empty, current-directory, or parent-directory segment.`);
  }
  return segments.join("/");
}

async function readBoundedFile(filePath, maximumBytes, label) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new RangeError(`${label} must be a regular file.`);
  if (stat.size <= 0 || stat.size > maximumBytes) {
    throw new RangeError(`${label} size is outside the allowed range.`);
  }
  return fs.readFile(filePath);
}

async function resolvePackageFile(rootPath, declaredPath, label) {
  const normalized = validatePackageRelativePath(declaredPath, label);
  const lexicalPath = path.resolve(rootPath, ...normalized.split("/"));
  if (!pathIsInside(rootPath, lexicalPath)) throw new RangeError(`${label} escapes the theme package root.`);
  let realPath;
  try {
    realPath = await fs.realpath(lexicalPath);
  } catch (error) {
    if (error?.code === "ENOENT") throw new RangeError(`${label} does not exist.`);
    throw error;
  }
  if (!pathIsInside(rootPath, realPath)) throw new RangeError(`${label} resolves outside the theme package root.`);
  const stat = await fs.stat(realPath);
  if (!stat.isFile()) throw new RangeError(`${label} must resolve to a regular file.`);
  return { relativePath: normalized, absolutePath: realPath };
}

function parseJson(buffer, label) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new SyntaxError(`${label} is not valid JSON: ${error.message}`);
  }
}

function validateCommonManifest(manifest) {
  if (Object.hasOwn(manifest, "$schema") && typeof manifest.$schema !== "string") {
    throw new TypeError("theme.$schema must be a string when present.");
  }
  assertString(manifest.id, "theme.id", 80);
  if (!THEME_ID.test(manifest.id)) throw new RangeError("theme.id is not a valid machine-readable identifier.");
  assertString(manifest.name, "theme.name", 120);
  assertString(manifest.version, "theme.version", 80);
  if (!SEMVER.test(manifest.version)) throw new RangeError("theme.version must be a valid semantic version.");
  assertString(manifest.author, "theme.author", 120);
  assertString(manifest.description, "theme.description", 1000);
  validatePackageRelativePath(manifest.layout, "theme.layout");
  if (path.posix.extname(manifest.layout) !== ".json") throw new RangeError("theme.layout must be a .json file.");
  const styles = manifest.styles ?? [];
  if (!Array.isArray(styles) || styles.length > 8) throw new RangeError("theme.styles must contain at most eight entries.");
  if (new Set(styles).size !== styles.length) throw new RangeError("theme.styles must not contain duplicates.");
  for (const [index, stylePath] of styles.entries()) {
    validatePackageRelativePath(stylePath, `theme.styles[${index}]`);
    if (path.posix.extname(stylePath) !== ".css") throw new RangeError(`theme.styles[${index}] must be a .css file.`);
  }
  return styles;
}

function validatePngPath(value, label) {
  const normalized = validatePackageRelativePath(value, label);
  if (path.posix.extname(normalized) !== ".png") throw new RangeError(`${label} must use a lowercase .png extension.`);
  return normalized;
}

function validateManifestV1(manifest, styles) {
  assertAllowedKeys(manifest, new Set([
    "$schema", "schemaVersion", "id", "name", "version", "author", "description",
    "variants", "layout", "styles", "capabilities",
  ]), "theme.json");
  assertPlainObject(manifest.variants, "theme.variants");
  assertAllowedKeys(manifest.variants, new Set(["light", "dark"]), "theme.variants");
  const backgroundPaths = {};
  for (const variantName of ["light", "dark"]) {
    const variant = manifest.variants[variantName];
    if (!variant) throw new RangeError(`theme.variants.${variantName} is required.`);
    assertPlainObject(variant, `theme.variants.${variantName}`);
    assertAllowedKeys(variant, new Set(["background"]), `theme.variants.${variantName}`);
    backgroundPaths[variantName] = validatePngPath(
      variant.background,
      `theme.variants.${variantName}.background`,
    );
  }
  assertPlainObject(manifest.capabilities, "theme.capabilities");
  assertAllowedKeys(manifest.capabilities, new Set(["light", "dark", "autoAppearance"]), "theme.capabilities");
  for (const capability of ["light", "dark", "autoAppearance"]) {
    if (typeof manifest.capabilities[capability] !== "boolean") {
      throw new TypeError(`theme.capabilities.${capability} must be boolean.`);
    }
  }
  if (!manifest.capabilities.light || !manifest.capabilities.dark || !manifest.capabilities.autoAppearance) {
    throw new RangeError("Theme schemaVersion 1 requires light, dark, and autoAppearance capabilities.");
  }
  return {
    manifest: { ...manifest, styles },
    supportedAppearances: ["light", "dark"],
    backgroundPaths,
  };
}

function validateManifestV2(manifest, styles) {
  assertAllowedKeys(manifest, new Set([
    "$schema", "schemaVersion", "id", "name", "version", "author", "description",
    "compatibility", "background", "layout", "styles", "paletteOverrides",
  ]), "theme.json");
  assertPlainObject(manifest.compatibility, "theme.compatibility");
  if(Object.hasOwn(manifest,'paletteOverrides')) {
    if(styles.length)throw new RangeError('Palette overrides require Universal adaptation (no styles).');
    validatePaletteOverrides(manifest.paletteOverrides);
  }
  assertAllowedKeys(manifest.compatibility, new Set(["codexAppearances"]), "theme.compatibility");
  const declaredAppearances = manifest.compatibility.codexAppearances;
  if (!Array.isArray(declaredAppearances) || declaredAppearances.length < 1 || declaredAppearances.length > 2) {
    throw new RangeError("theme.compatibility.codexAppearances must contain one or two appearances.");
  }
  const supportedAppearances = [...new Set(declaredAppearances)];
  if (supportedAppearances.length !== declaredAppearances.length ||
      supportedAppearances.some((value) => !["light", "dark"].includes(value))) {
    throw new RangeError("theme.compatibility.codexAppearances must contain unique light and/or dark values.");
  }

  assertPlainObject(manifest.background, "theme.background");
  assertAllowedKeys(manifest.background, new Set(["default", "overrides"]), "theme.background");
  const defaultBackground = Object.hasOwn(manifest.background, "default")
    ? validatePngPath(manifest.background.default, "theme.background.default")
    : null;
  const overrides = Object.hasOwn(manifest.background, "overrides")
    ? manifest.background.overrides
    : {};
  assertPlainObject(overrides, "theme.background.overrides");
  assertAllowedKeys(overrides, new Set(["light", "dark"]), "theme.background.overrides");
  const normalizedOverrides = {};
  for (const appearance of Object.keys(overrides)) {
    if (!supportedAppearances.includes(appearance)) {
      throw new RangeError(`theme.background.overrides.${appearance} is declared for an unsupported Codex appearance.`);
    }
    normalizedOverrides[appearance] = validatePngPath(
      overrides[appearance],
      `theme.background.overrides.${appearance}`,
    );
  }
  const backgroundPaths = {};
  for (const appearance of supportedAppearances) {
    const resolved = normalizedOverrides[appearance] ?? defaultBackground;
    if (!resolved) throw new RangeError(`No background resolves for supported Codex appearance: ${appearance}.`);
    backgroundPaths[appearance] = resolved;
  }
  return {
    manifest: {
      ...manifest,
      styles,
      compatibility: { codexAppearances: supportedAppearances },
      background: {
        ...(defaultBackground ? { default: defaultBackground } : {}),
        ...(Object.keys(normalizedOverrides).length > 0 ? { overrides: normalizedOverrides } : {}),
      },
    },
    supportedAppearances,
    backgroundPaths,
  };
}

function validateManifest(manifest) {
  assertPlainObject(manifest, "theme.json");
  if (!SUPPORTED_THEME_SCHEMA_VERSIONS.has(manifest.schemaVersion)) {
    throw new RangeError(`Unsupported theme schemaVersion: ${String(manifest.schemaVersion)}.`);
  }
  const styles = validateCommonManifest(manifest);
  return manifest.schemaVersion === 1
    ? validateManifestV1(manifest, styles)
    : validateManifestV2(manifest, styles);
}

export function validateThemeCss(css, label = "theme CSS") {
  if (typeof css !== "string") throw new TypeError(`${label} must be text.`);
  if (css.includes("\0")) throw new RangeError(`${label} contains a NUL character.`);
  if (css.includes("\\")) throw new RangeError(`${label} contains a forbidden backslash escape.`);
  const inspected = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const forbidden = [
    [/@\s*import\b/i, "@import"],
    [/\burl\s*\(/i, "url()"],
    [/@\s*font-face\b/i, "@font-face"],
    [/(?:http|https|file|data|blob)\s*:/i, "external or embedded URI"],
    [/\bexpression\s*\(/i, "expression()"],
    [/\bbehavior\s*:/i, "behavior:"],
    [/(?:-webkit-)?image-set\s*\(/i, "image-set()"],
  ];
  for (const [pattern, description] of forbidden) {
    if (pattern.test(inspected)) throw new RangeError(`${label} contains forbidden ${description} syntax.`);
  }
  return css;
}

function decodePng(buffer, label) {
  if (buffer.length < 33 || buffer.length > MAX_IMAGE_BYTES) {
    throw new RangeError(`${label} size is outside the allowed PNG range.`);
  }
  if (!PNG_SIGNATURE.every((value, index) => buffer[index] === value)) {
    throw new RangeError(`${label} has an invalid PNG signature.`);
  }
  if (buffer.readUInt32BE(8) !== 13 || buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new RangeError(`${label} has an invalid PNG IHDR chunk.`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) throw new RangeError(`${label} has invalid intrinsic dimensions.`);
  return { width, height };
}

export async function loadThemePackage(themePath) {
  assertString(themePath, "themePath", 32767);
  const rootPath = await fs.realpath(themePath);
  const rootStat = await fs.stat(rootPath);
  if (!rootStat.isDirectory()) throw new RangeError("themePath must resolve to a directory.");

  let manifestFile;
  try {
    manifestFile = await resolvePackageFile(rootPath, "theme.json", "theme.json");
  } catch (error) {
    if (String(error?.message || "").includes("does not exist")) {
      throw new RangeError("The theme package is missing theme.json.");
    }
    throw error;
  }
  let manifestBuffer;
  try {
    manifestBuffer = await readBoundedFile(manifestFile.absolutePath, MAX_MANIFEST_BYTES, "theme.json");
  } catch (error) {
    if (error?.code === "ENOENT") throw new RangeError("The theme package is missing theme.json.");
    throw error;
  }
  const normalizedManifest = validateManifest(parseJson(manifestBuffer, "theme.json"));
  const { manifest, supportedAppearances, backgroundPaths } = normalizedManifest;

  const layoutFile = await resolvePackageFile(rootPath, manifest.layout, "theme.layout");
  const layoutDocument = parseJson(
    await readBoundedFile(layoutFile.absolutePath, MAX_LAYOUT_BYTES, "theme layout"),
    "theme layout",
  );
  const layouts = {
    light: resolveLayoutConfig(layoutDocument, "light"),
    dark: resolveLayoutConfig(layoutDocument, "dark"),
  };

  const variants = {};
  const backgrounds = {};
  const backgroundCache = new Map();
  for (const appearance of supportedAppearances) {
    const declaredPath = backgroundPaths[appearance];
    let background = backgroundCache.get(declaredPath);
    if (!background) {
      const file = await resolvePackageFile(rootPath, declaredPath, `${appearance} background`);
      const bytes = await readBoundedFile(file.absolutePath, MAX_IMAGE_BYTES, `${appearance} background`);
      const dimensions = decodePng(bytes, `${appearance} background`);
      background = {
        relativePath: file.relativePath,
        absolutePath: file.absolutePath,
        bytes,
        mimeType: "image/png",
        width: dimensions.width,
        height: dimensions.height,
      };
      backgroundCache.set(declaredPath, background);
    }
    backgrounds[appearance] = background;
    variants[appearance] = { background, layoutConfig: layouts[appearance] };
  }

  const styles = [];
  let totalCssBytes = 0;
  for (const [index, declaredPath] of manifest.styles.entries()) {
    const file = await resolvePackageFile(rootPath, declaredPath, `theme.styles[${index}]`);
    const bytes = await readBoundedFile(file.absolutePath, MAX_CSS_BYTES, `theme.styles[${index}]`);
    totalCssBytes += bytes.length;
    if (totalCssBytes > MAX_TOTAL_CSS_BYTES) throw new RangeError("Theme CSS exceeds the total size limit.");
    const content = bytes.toString("utf8");
    validateThemeCss(content, `theme.styles[${index}]`);
    styles.push({ relativePath: file.relativePath, absolutePath: file.absolutePath, content });
  }

  return {
    manifest,
    rootPath,
    supportedAppearances,
    backgrounds,
    variants,
    layoutConfig: layouts,
    styles,
  };
}
