import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ThemeCatalog } from "../src/main/services/theme-catalog.mjs";
import { makeTemporaryDirectory, removeTemporaryDirectory, tinyPng } from "./helpers.mjs";

const guiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const projectRoot = path.dirname(guiRoot);

test("scans custom and universal themes through the shared Theme Loader", async () => {
  const catalog = new ThemeCatalog({ themesRoot: path.join(projectRoot, "themes") });
  const snapshot = await catalog.scan();
  assert.deepEqual(snapshot.themes.map((theme) => theme.id).sort(), ["forest-scholar", "phainon", "universal-demo"]);
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
