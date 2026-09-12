import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ThemeCatalog } from "../src/main/services/theme-catalog.mjs";
import { loadThemePayload } from "../../scripts/theme-payload.mjs";
import { makeTemporaryDirectory, removeTemporaryDirectory, tinyPng } from "./helpers.mjs";

const guiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const projectRoot = path.dirname(guiRoot);

test("scans custom and universal themes through the shared Theme Loader", async () => {
  const catalog = new ThemeCatalog({ themesRoot: path.join(projectRoot, "themes") });
  const snapshot = await catalog.scan();
  const ids = snapshot.themes.map(theme => theme.id);
  for (const id of ["forest-scholar", "phainon", "universal-dark-test", "universal-demo"]) assert.ok(ids.includes(id));
  assert.equal(snapshot.invalidThemes.length, 0);
  assert.match(snapshot.themes[0].previews.light, /^skin-preview:\/\/theme\//);
  assert.equal("rootPath" in snapshot.themes[0], false);
  assert.equal(catalog.getPreviewAsset("phainon", "dark").mimeType, "image/png");
  assert.equal(catalog.supportsAppearance("phainon", "light"), true);
  assert.equal(catalog.supportsAppearance("phainon", "dark"), true);
  assert.equal(catalog.supportsAppearance("missing", "dark"), false);
  assert.equal(snapshot.themes.find((theme) => theme.id === "forest-scholar").visualAdaptation, "custom");
  assert.equal(snapshot.themes.find((theme) => theme.id === "phainon").visualAdaptation, "custom");
  assert.equal(snapshot.themes.find((theme) => theme.id === "universal-demo").visualAdaptation, "universal");
});

test("experimental dark theme is selectable, previewable and uses Universal dark tone", async () => {
  const catalog = new ThemeCatalog({ themesRoot: path.join(projectRoot, "themes") });
  const snapshot = await catalog.scan();
  const theme = snapshot.themes.find((entry) => entry.id === "universal-dark-test");
  assert.equal(theme.name, "Universal Dark Test");
  assert.equal(theme.visualAdaptation, "universal");
  assert.equal(catalog.has(theme.id), true);
  const original = await fs.readFile(path.join(projectRoot, "themes/phainon/assets/dark.png"));
  for (const variant of ["light", "dark"]) {
    assert.equal(catalog.supportsAppearance(theme.id, variant), true);
    assert.equal(theme.previews[variant], `skin-preview://theme/${theme.id}/${variant}`);
    const preview = catalog.getPreviewAsset(theme.id, variant);
    assert.equal(preview.mimeType, "image/png");
    assert.deepEqual(preview.bytes, original);
  }
  const payload = await loadThemePayload(projectRoot, path.join(projectRoot, "themes", theme.id), "Auto");
  assert.equal(payload.theme.visualAdaptation, "universal");
  assert.equal(payload.images.Light.dataUrl, payload.images.Dark.dataUrl);
  for (const variant of ["Light", "Dark"]) {
    assert.equal(payload.backgroundTones[variant].tone, "dark");
    assert.ok(payload.images[variant].width > 0);
    assert.ok(payload.images[variant].height > 0);
  }
});

test("isolates an invalid package without hiding valid themes", async () => {
  const root = await makeTemporaryDirectory("catalog");
  try {
    const fixture = path.join(projectRoot, "test", "fixtures", "minimal-theme");
    const valid = path.join(root, "valid");
    await fs.cp(fixture, valid, { recursive: true });
    await fs.mkdir(path.join(valid, "assets"), { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(valid, "assets", "light.png"), tinyPng),
      fs.writeFile(path.join(valid, "assets", "dark.png"), tinyPng),
    ]);
    const invalid = path.join(root, "invalid-package");
    await fs.mkdir(invalid);
    await fs.writeFile(path.join(invalid, "theme.json"), "{", "utf8");

    const catalog = new ThemeCatalog({ themesRoot: root });
    const snapshot = await catalog.scan();
    assert.deepEqual(snapshot.themes.map((theme) => theme.id), ["minimal-theme"]);
    assert.equal(snapshot.invalidThemes.length, 1);
    assert.equal(snapshot.invalidThemes[0].folder, "invalid-package");
    assert.equal(snapshot.invalidThemes[0].message.includes(root), false);
  } finally {
    await removeTemporaryDirectory(root);
  }
});
