import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadThemePackage } from "../scripts/theme-loader.mjs";
import { loadThemePayload } from "../scripts/theme-payload.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(testDirectory);
const universalTheme = path.join(projectRoot, "themes", "universal-demo");
const requiredVariables = [
  "--codex-skin-surface",
  "--codex-skin-main-wash",
  "--codex-skin-sidebar-surface",
  "--codex-skin-chrome-surface",
  "--codex-skin-main-content-surface",
  "--codex-skin-foreground",
  "--codex-skin-accent",
  "--codex-skin-background-scrim",
  "--codex-skin-chrome-track-surface",
  "--codex-skin-chrome-selected-surface",
  "--codex-skin-foreground-muted",
  "--codex-skin-work-gradient-strong",
  "--codex-skin-work-gradient-middle",
  "--codex-skin-work-gradient-clear",
];

function extractRule(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `Missing CSS selector: ${selector}`);
  const bodyStart = css.indexOf("{", start) + 1;
  const bodyEnd = css.indexOf("}", bodyStart);
  return css.slice(bodyStart, bodyEnd);
}

function cssRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
  }));
}

function normalizeSelector(selector) {
  return selector.replace(/\s+/g, " ").trim();
}

test("schemaVersion 2 universal demo loads one image with no theme CSS", async () => {
  const theme = await loadThemePackage(universalTheme);
  assert.equal(theme.manifest.schemaVersion, 2);
  assert.deepEqual(theme.manifest.styles, []);
  assert.deepEqual(theme.styles, []);
  assert.deepEqual(theme.supportedAppearances, ["light", "dark"]);
  assert.strictEqual(theme.backgrounds.light, theme.backgrounds.dark);
  assert.equal(theme.backgrounds.light.relativePath, "assets/background.png");
});

test("Light and Dark adaptations define every universal variable", async () => {
  const css = await fs.readFile(path.join(projectRoot, "styles", "base.css"), "utf8");
  for (const adaptation of ["light", "dark"]) {
    const rule = extractRule(css, `html.forest-scholar-skin:where([data-skin-adaptation="${adaptation}"])`) +
      extractRule(css, `html.forest-scholar-skin:where([data-skin-visual-adaptation="universal"][data-skin-adaptation="${adaptation}"])`);
    for (const variable of requiredVariables) {
      assert.match(rule, new RegExp(`${variable.replaceAll("-", "\\-")}:\\s*[^;]+;`), `${adaptation} is missing ${variable}`);
    }
  }
});

test("scrim remains non-interactive and uses the universal variable", async () => {
  const css = await fs.readFile(path.join(projectRoot, "styles", "base.css"), "utf8");
  const rule = extractRule(css, "#forest-scholar-skin-background::after");
  assert.match(rule, /pointer-events:\s*none/);
  assert.match(rule, /background:\s*var\(--codex-skin-background-scrim,\s*transparent\)/);
  assert.match(css, /data-skin-adaptation="light"[\s\S]*--codex-skin-background-scrim:\s*rgba\(255, 255, 255, 0\.08\)/);
  assert.match(css, /data-skin-adaptation="dark"[\s\S]*--codex-skin-background-scrim:\s*rgba\(0, 0, 0, 0\.12\)/);
});

test("universal demo builds Light and Dark payloads from one data URL", async () => {
  const lightPayload = await loadThemePayload(projectRoot, universalTheme, "Light");
  const darkPayload = await loadThemePayload(projectRoot, universalTheme, "Dark");
  assert.equal(lightPayload.mode, "Light");
  assert.equal(darkPayload.mode, "Dark");
  assert.equal(lightPayload.theme.visualAdaptation, "universal");
  assert.equal(darkPayload.theme.visualAdaptation, "universal");
  assert.equal(lightPayload.images.Light.dataUrl, lightPayload.images.Dark.dataUrl);
  assert.equal(darkPayload.images.Light.dataUrl, darkPayload.images.Dark.dataUrl);
  assert.match(lightPayload.css, /data-skin-adaptation="light"/);
  assert.match(darkPayload.css, /data-skin-adaptation="dark"/);
});

test("injector installs and verifies the payload visual adaptation root marker", async () => {
  const forestTheme = path.join(projectRoot, "themes", "forest-scholar");
  const [universalPayload, customPayload, injector] = await Promise.all([
    loadThemePayload(projectRoot, universalTheme, "Auto"),
    loadThemePayload(projectRoot, forestTheme, "Auto"),
    fs.readFile(path.join(projectRoot, "scripts", "injector.mjs"), "utf8"),
  ]);
  assert.equal(universalPayload.theme.visualAdaptation, "universal");
  assert.equal(customPayload.theme.visualAdaptation, "custom");
  assert.match(injector, /const expectedVisualAdaptation = payload\.theme\.visualAdaptation;/);
  assert.match(injector, /setAttribute\(visualAdaptationAttribute, expectedVisualAdaptation\)/);
  assert.match(injector, /visualAdaptationAttributeCorrect/);
});

test("visual adaptation root marker participates in self-heal and cleanup", async () => {
  const injector = await fs.readFile(path.join(projectRoot, "scripts", "injector.mjs"), "utf8");
  assert.match(injector, /attributeFilter:[^\]]*visualAdaptationAttribute/);
  assert.match(injector, /const visualAdaptationMissing = currentMode === targetMode/);
  assert.match(injector, /repairCounts\.visualAdaptation \+= 1/);
  assert.match(injector, /repaired\.push\('visual-adaptation'\)/);
  assert.ok([...injector.matchAll(/removeAttribute\(visualAdaptationAttribute\)/g)].length >= 3);
  assert.match(injector, /hasAttribute\(\$\{JSON\.stringify\(VISUAL_ADAPTATION_ATTRIBUTE\)\}\)/);
});

test("segmented control mapping is scoped to Universal adaptation only", async () => {
  const css = await fs.readFile(path.join(projectRoot, "styles", "codex-compat.css"), "utf8");
  const rules = cssRules(css).filter((rule) => rule.selector.includes("@container/home-mode-toggle"));
  assert.equal(rules.length, 4);
  assert.ok(rules.every((rule) => rule.selector.includes('[data-skin-visual-adaptation="universal"]')));
  assert.ok(rules.every((rule) => !rule.selector.includes("home-main-content") && !rule.selector.includes("thread-scroll-container")));
  assert.ok(rules.every((rule) => normalizeSelector(rule.selector).includes(
    'div[class*="@container/home-mode-toggle"] div[role="group"] >',
  )));
  assert.doesNotMatch(css, /div\[role="group"\]\[class\*="@container\/home-mode-toggle"\]/);

  const track = rules.find((rule) => rule.selector.includes("bg-background-mode-toggle-track"));
  const indicator = rules.find((rule) => rule.selector.includes('[class*="_indicator_"]'));
  const selected = rules.find((rule) => rule.selector.includes('[aria-pressed="true"]'));
  const unselected = rules.find((rule) => rule.selector.includes('[aria-pressed="false"]'));
  assert.match(track?.body ?? "", /background-color:\s*var\(--codex-skin-chrome-track-surface\)/);
  assert.match(indicator?.body ?? "", /background-color:\s*var\(--codex-skin-chrome-selected-surface\)/);
  assert.match(indicator?.body ?? "", /border-color:\s*color-mix\([^;]*var\(--codex-skin-accent\)/);
  assert.match(selected?.body ?? "", /color:\s*var\(--codex-skin-foreground\)/);
  assert.match(unselected?.body ?? "", /color:\s*var\(--codex-skin-foreground-muted\)/);
  assert.doesNotMatch(`${selected?.body}${unselected?.body}`, /background(?:-color)?:/);
  assert.doesNotMatch(indicator?.body ?? "", /(?:box-shadow|transform|transition|width|height)\s*:/);
});

test("Work Composer maps only its local surface variable and excludes Home", async () => {
  const css = await fs.readFile(path.join(projectRoot, "styles", "codex-compat.css"), "utf8");
  const rules = cssRules(css).filter((rule) => rule.selector.includes("_ComposerLayoutRoot_"));
  assert.equal(rules.length, 1);
  assert.equal(normalizeSelector(rules[0].selector),
    'html.forest-scholar-skin[data-skin-visual-adaptation="universal"] [role="presentation"][class*="_ComposerLayoutRoot_"]:not([data-composer-utility-bar-variant="home"])');
  assert.equal(rules[0].body.trim(), '--composer-layout-surface-background: var(--codex-skin-chrome-surface) !important;');
  assert.doesNotMatch(css, /--color-background-primary-soft\s*:/);
});

test("Work Output maps only the floating card background, not the native global token", async () => {
  const css = await fs.readFile(path.join(projectRoot, "styles", "codex-compat.css"), "utf8");
  const rules = cssRules(css).filter((rule) => rule.selector.includes("--thread-floating-content-top-inset"));
  assert.equal(rules.length, 1);
  assert.equal(normalizeSelector(rules[0].selector),
    'html.forest-scholar-skin[data-skin-visual-adaptation="universal"] div[class*="--thread-floating-content-top-inset"] div.bg-surface-elevated-secondary.rounded-3xl');
  assert.equal(rules[0].body.trim(), 'background-color: var(--codex-skin-chrome-surface) !important;');
  assert.doesNotMatch(css, /--color-surface-elevated-secondary\s*:/);
});

test("Work surface mappings remain Universal-only in Light/Dark and Custom payloads", async () => {
  for (const themeId of ["universal-demo", "forest-scholar", "phainon"]) {
    for (const mode of ["Light", "Dark"]) {
      const payload = await loadThemePayload(projectRoot, path.join(projectRoot, "themes", themeId), mode);
      assert.equal(payload.theme.visualAdaptation, themeId === "universal-demo" ? "universal" : "custom");
      const rules = cssRules(payload.css).filter((rule) =>
        rule.selector.includes("_ComposerLayoutRoot_") || rule.selector.includes("--thread-floating-content-top-inset"));
      assert.equal(rules.length, 2);
      for (const rule of rules) {
        assert.ok(normalizeSelector(rule.selector).startsWith('html.forest-scholar-skin[data-skin-visual-adaptation="universal"] '));
        assert.doesNotMatch(rule.selector, /,|data-skin-adaptation/);
        assert.doesNotMatch(rule.body, /(?:box-shadow|background-image|opacity|filter|transform|height|width)\s*:/);
      }
    }
  }
});

test("application header has no whole-surface mapping", async () => {
  const css = await fs.readFile(path.join(projectRoot, "styles", "codex-compat.css"), "utf8");
  const rules = cssRules(css).filter((rule) => /\bheader\b/.test(rule.selector));
  assert.equal(rules.length, 2);
  for (const rule of rules) {
    assert.match(rule.body.trim(), /^color: var\(--codex-skin-foreground(?:-muted)?\) !important;$/);
    for (const selector of rule.selector.split(',')) {
      assert.match(normalizeSelector(selector), / button\./);
      assert.ok(normalizeSelector(selector).startsWith('html.forest-scholar-skin[data-skin-visual-adaptation="universal"] header[data-app-shell-application-menu-bar="true"] '));
    }
  }
});

test("application menu text maps only diagnosed Universal menu buttons", async () => {
  const selector = 'html.forest-scholar-skin[data-skin-visual-adaptation="universal"] div[class*="_ApplicationMenuTopBar_"] > div[role="menubar"] > button[role="menuitem"].text-tertiary';
  for (const themeId of ['universal-demo', 'forest-scholar', 'phainon']) {
    for (const mode of ['Light', 'Dark']) {
      const payload = await loadThemePayload(projectRoot, path.join(projectRoot, 'themes', themeId), mode);
      assert.equal(payload.theme.visualAdaptation, themeId === 'universal-demo' ? 'universal' : 'custom');
      const rules = cssRules(payload.css).filter(rule => rule.selector.includes('ApplicationMenuTopBar') && rule.selector.includes('menuitem'));
      assert.equal(rules.length, 1);
      assert.equal(normalizeSelector(rules[0].selector), selector);
      // A single Universal-only selector, with no comma escape, excludes Custom
      // roots, window controls, navigation buttons and the hidden menu anchor.
      assert.equal(rules[0].body.trim(), 'color: var(--codex-skin-foreground) !important;');
    }
  }
});

test("independent topbar surface is Universal-only and does not change layout", async () => {
  const base = await fs.readFile(path.join(projectRoot, 'styles', 'base.css'), 'utf8');
  const declarations = cssRules(base).filter(rule => rule.body.includes('--codex-skin-topbar-surface:'));
  assert.equal(declarations.length, 2);
  for (const [mode, value] of [['light', 'rgba(248, 248, 246, 0.94)'], ['dark', 'rgba(20, 22, 26, 0.94)']]) {
    const rule = declarations.find(rule => rule.selector === `html.forest-scholar-skin:where([data-skin-visual-adaptation="universal"][data-skin-adaptation="${mode}"])`);
    assert.ok(rule?.body.includes(`--codex-skin-topbar-surface: ${value};`));
  }
  for (const themeId of ['universal-demo', 'forest-scholar', 'phainon']) {
    const payload = await loadThemePayload(projectRoot, path.join(projectRoot, 'themes', themeId), 'Auto');
    const rules = cssRules(payload.css).filter(rule => rule.body.includes('var(--codex-skin-topbar-surface)'));
    assert.equal(rules.length, 1);
    assert.equal(normalizeSelector(rules[0].selector), 'html.forest-scholar-skin[data-skin-visual-adaptation="universal"] div[class*="_ApplicationMenuTopBar_"]');
    assert.equal(rules[0].body.trim(), 'background-color: var(--codex-skin-topbar-surface) !important;');
    assert.equal(payload.theme.visualAdaptation, themeId === 'universal-demo' ? 'universal' : 'custom');
  }
});

test("top foreground mapping targets diagnosed title, selected actions and tertiary buttons only", async () => {
  const css = await fs.readFile(path.join(projectRoot, "styles", "codex-compat.css"), "utf8");
  const prefix = 'html.forest-scholar-skin[data-skin-visual-adaptation="universal"] header[data-app-shell-application-menu-bar="true"] ';
  const mappings = cssRules(css).filter((rule) => rule.selector.includes('data-app-shell-application-menu-bar'))
    .flatMap((rule) => rule.selector.split(',').map((selector) => [normalizeSelector(selector), rule.body.trim()]));
  assert.deepEqual(mappings, [
    [prefix + '[data-app-shell-header-toolbar] button.text-default.text-start', 'color: var(--codex-skin-foreground) !important;'],
    [prefix + 'button.text-default.aspect-square[aria-pressed="true"]', 'color: var(--codex-skin-foreground) !important;'],
    [prefix + 'button.text-tertiary', 'color: var(--codex-skin-foreground-muted) !important;'],
  ]);
  for (const themeId of ['universal-demo', 'forest-scholar', 'phainon']) {
    for (const mode of ['Light', 'Dark']) {
      const payload = await loadThemePayload(projectRoot, path.join(projectRoot, 'themes', themeId), mode);
      assert.equal(payload.theme.visualAdaptation, themeId === 'universal-demo' ? 'universal' : 'custom');
      const headerRules = cssRules(payload.css).filter((rule) => rule.selector.includes('data-app-shell-application-menu-bar'));
      assert.equal(headerRules.length, 2);
      assert.ok(headerRules.every((rule) => rule.selector.split(',').every((selector) => normalizeSelector(selector).startsWith(prefix))));
    }
  }
});

test("Universal segmented surfaces stay lightweight in Light and Dark", async () => {
  const css = await fs.readFile(path.join(projectRoot, "styles", "base.css"), "utf8");
  const light = extractRule(css, 'html.forest-scholar-skin:where([data-skin-adaptation="light"])');
  const dark = extractRule(css, 'html.forest-scholar-skin:where([data-skin-adaptation="dark"])');
  assert.match(light, /--codex-skin-chrome-track-surface:\s*rgba\(82, 104, 122, 0\.06\)/);
  assert.match(light, /--codex-skin-chrome-selected-surface:\s*rgba\(32, 36, 40, 0\.08\)/);
  assert.match(dark, /--codex-skin-chrome-track-surface:\s*rgba\(147, 175, 196, 0\.07\)/);
  assert.match(dark, /--codex-skin-chrome-selected-surface:\s*rgba\(238, 241, 243, 0\.12\)/);
});

test("payload order lets partial theme CSS override universal defaults", async () => {
  const forestTheme = path.join(projectRoot, "themes", "forest-scholar");
  const payload = await loadThemePayload(projectRoot, forestTheme, "Auto");
  const universalIndex = payload.css.indexOf("data-skin-adaptation=\"light\"");
  const compatibilityIndex = payload.css.indexOf('html.forest-scholar-skin main.main-surface');
  const themeOverrideIndex = payload.css.indexOf("--codex-skin-accent: #6aaf90");
  assert.ok(universalIndex >= 0 && compatibilityIndex > universalIndex && themeOverrideIndex > compatibilityIndex);
  const themeCss = await fs.readFile(path.join(forestTheme, "styles", "theme.css"), "utf8");
  assert.doesNotMatch(themeCss, /--codex-skin-background-scrim/);
  assert.equal(payload.theme.visualAdaptation, "custom");
});

test("only Universal receives default scrim; both Custom packages retain transparent fallback", async () => {
  for (const themeId of ["universal-demo", "forest-scholar", "phainon"]) {
    for (const mode of ["Light", "Dark"]) {
      const payload = await loadThemePayload(projectRoot, path.join(projectRoot, "themes", themeId), mode);
      const declarations = cssRules(payload.css).filter((rule) => /--codex-skin-background-scrim\s*:/.test(rule.body));
      const fallback = declarations.filter((rule) => rule.selector === "html.forest-scholar-skin");
      assert.equal(fallback.length, 1);
      assert.match(fallback[0].body, /--codex-skin-background-scrim:\s*transparent;/);
      const scoped = declarations.filter((rule) => rule.selector !== "html.forest-scholar-skin");
      assert.equal(scoped.length, 4);
      assert.ok(scoped.every(rule => rule.selector.includes('[data-skin-visual-adaptation="universal"]')));
      for (const adaptation of ["light", "dark"]) {
        const selector = `html.forest-scholar-skin:where([data-skin-visual-adaptation="universal"][data-skin-adaptation="${adaptation}"])`;
        const rule = scoped.find((candidate) => candidate.selector === selector);
        assert.ok(rule, `Missing Universal-only ${adaptation} scrim`);
        const expected = adaptation === "light" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.12)";
        assert.ok(rule.body.includes(`--codex-skin-background-scrim: ${expected};`));
      }
      assert.equal(payload.theme.visualAdaptation, themeId === "universal-demo" ? "universal" : "custom");
      // Every nontransparent default requires the universal marker. Custom roots
      // cannot match these selectors and inherit only the transparent fallback.
    }
  }
});

test("Forest Scholar and Phainon still override Universal Dark defaults", async () => {
  for (const [themeId, expectedSurface, expectedAccent] of [
    ["forest-scholar", "#15231d", "#6aaf90"],
    ["phainon", "#090f24", "#86a9ff"],
  ]) {
    const themeDirectory = path.join(projectRoot, "themes", themeId);
    const payload = await loadThemePayload(projectRoot, themeDirectory, "Dark");
    const universalIndex = payload.css.indexOf("--codex-skin-surface: #17191c");
    const themeIndex = payload.css.indexOf(`--codex-skin-surface: ${expectedSurface}`);
    const accentIndex = payload.css.indexOf(`--codex-skin-accent: ${expectedAccent}`);
    assert.ok(universalIndex >= 0 && themeIndex > universalIndex && accentIndex > universalIndex);
    assert.equal(payload.theme.visualAdaptation, "custom");
  }
});

test("sidebar boundary changes only Universal main left border color", async () => {
  const base = await fs.readFile(path.join(projectRoot, 'styles', 'base.css'), 'utf8');
  const declarations = cssRules(base).filter(rule => rule.body.includes('--codex-skin-sidebar-divider:'));
  assert.equal(declarations.length, 2);
  for (const [mode, value] of [['light', 'rgba(32, 36, 40, 0.10)'], ['dark', 'rgba(180, 188, 196, 0.045)']]) {
    const rule = declarations.find(rule => rule.selector === `html.forest-scholar-skin:where([data-skin-visual-adaptation="universal"][data-skin-adaptation="${mode}"])`);
    assert.ok(rule?.body.includes(`--codex-skin-sidebar-divider: ${value};`));
  }
  for (const id of ['universal-demo', 'forest-scholar', 'phainon']) {
    for (const mode of ['Light', 'Dark']) {
      const payload = await loadThemePayload(projectRoot, path.join(projectRoot, 'themes', id), mode);
      const rules = cssRules(payload.css).filter(rule => rule.body.includes('var(--codex-skin-sidebar-divider)'));
      assert.equal(rules.length, 1);
      assert.equal(normalizeSelector(rules[0].selector), 'html.forest-scholar-skin[data-skin-visual-adaptation="universal"] main[class*="_MainContentSurface_"].border-l-hairline');
      assert.equal(rules[0].body.trim(), 'border-left-color: var(--codex-skin-sidebar-divider) !important;');
      assert.equal(payload.theme.visualAdaptation, id === 'universal-demo' ? 'universal' : 'custom');
    }
  }
});

test("Codex compatibility colors are supplied through variables", async () => {
  const css = await fs.readFile(path.join(projectRoot, "styles", "codex-compat.css"), "utf8");
  // Local gradient tokens are intentionally scoped to the diagnosed overlay.
  // Actual CSS color properties must still consume tokens, not literal colors.
  const propertyBodies = cssRules(css).map(rule => rule.body.replace(/--codex-skin-work-gradient-(?:strong|middle|clear):[^;]+;/g, '')).join('\n');
  assert.doesNotMatch(propertyBodies, /#[0-9a-f]{3,8}\b|rgba?\s*\(/i);
  for (const variable of [
    "--codex-skin-main-wash",
    "--codex-skin-sidebar-surface",
    "--codex-skin-chrome-surface",
    "--codex-skin-main-content-surface",
    "--codex-skin-chrome-track-surface",
    "--codex-skin-chrome-selected-surface",
    "--codex-skin-foreground-muted",
    "--codex-skin-work-gradient-strong",
    "--codex-skin-work-gradient-middle",
    "--codex-skin-work-gradient-clear",
  ]) {
    assert.match(css, new RegExp(`var\\(${variable.replaceAll("-", "\\-")}\\)`));
  }
});

test("bottom fade alpha override is local, Universal Dark only and preserves stops", async () => {
  const suffix = '.thread-scroll-container div[class~="bg-gradient-to-t"][class~="from-surface"][class~="via-surface"]';
  const selector = 'html.forest-scholar-skin[data-skin-visual-adaptation="universal"][data-skin-adaptation="dark"] ' + suffix;
  for (const id of ['universal-demo', 'forest-scholar', 'phainon']) {
    for (const mode of ['Light', 'Dark']) {
      const payload = await loadThemePayload(projectRoot, path.join(projectRoot, 'themes', id), mode);
      const rules = cssRules(payload.css).filter(rule => normalizeSelector(rule.selector) === selector);
      assert.equal(rules.length, 1);
      const mask = 'linear-gradient(to right, transparent 0%, black min(28px, 50%), black max(calc(100% - 28px), 50%), transparent 100%)';
      assert.equal(normalizeSelector(rules[0].body), '--codex-skin-work-gradient-strong: rgba(20, 22, 26, 0.30); --codex-skin-work-gradient-middle: rgba(20, 22, 26, 0.10); --codex-skin-work-gradient-clear: rgba(20, 22, 26, 0); ' + `-webkit-mask-image: ${mask}; mask-image: ${mask};`);
      assert.equal(payload.theme.visualAdaptation, id === 'universal-demo' ? 'universal' : 'custom');
      const original = cssRules(payload.css).find(rule => normalizeSelector(rule.selector) === 'html.forest-scholar-skin ' + suffix);
      assert.equal(normalizeSelector(original.body), 'background-image: linear-gradient( to top, var(--codex-skin-work-gradient-strong) 0%, var(--codex-skin-work-gradient-middle) 50%, var(--codex-skin-work-gradient-clear) 100% ) !important;');
    }
  }
});

test("Light dark-tone bottom fade changes only local gradient tokens", async () => {
  const suffix = '.thread-scroll-container div[class~="bg-gradient-to-t"][class~="from-surface"][class~="via-surface"]';
  const selector = 'html.forest-scholar-skin[data-skin-visual-adaptation="universal"][data-skin-adaptation="light"][data-skin-background-tone="dark"] ' + suffix;
  for (const id of ['universal-dark-test', 'universal-demo', 'forest-scholar', 'phainon']) {
    const payload = await loadThemePayload(projectRoot, path.join(projectRoot, 'themes', id), 'Auto');
    const rules = cssRules(payload.css).filter(rule => normalizeSelector(rule.selector) === selector);
    assert.equal(rules.length, 1);
    assert.equal(normalizeSelector(rules[0].body), '--codex-skin-work-gradient-strong: rgba(248, 248, 246, 0.20); --codex-skin-work-gradient-middle: rgba(248, 248, 246, 0.06); --codex-skin-work-gradient-clear: rgba(248, 248, 246, 0);');
    // Exact selector requires all three root attributes: Custom, Dark UI,
    // and Light UI on medium/light artwork cannot match this override.
    const eligible = payload.theme.visualAdaptation === 'universal' && payload.backgroundTones?.Light?.tone === 'dark';
    assert.equal(eligible, id === 'universal-dark-test');
    const original = cssRules(payload.css).find(rule => normalizeSelector(rule.selector) === 'html.forest-scholar-skin ' + suffix);
    assert.equal(normalizeSelector(original.body), 'background-image: linear-gradient( to top, var(--codex-skin-work-gradient-strong) 0%, var(--codex-skin-work-gradient-middle) 50%, var(--codex-skin-work-gradient-clear) 100% ) !important;');
  }
});
