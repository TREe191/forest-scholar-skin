import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadThemePackage, validateThemeCss } from "../scripts/theme-loader.mjs";

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(testRoot);
const fixtureRoot = path.join(testRoot, "fixtures", "minimal-theme");
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("loads the official Forest Scholar theme package", async () => {
  const theme = await loadThemePackage(path.join(projectRoot, "themes", "forest-scholar"));
  assert.equal(theme.manifest.id, "forest-scholar");
  assert.deepEqual(
    [theme.variants.light.background.width, theme.variants.light.background.height],
    [1672, 941],
  );
  assert.equal(theme.styles.length, 1);
  assert.equal(theme.variants.dark.layoutConfig.mode, "focus-soft");
});

async function makePackage(mutator) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "fss-theme-test-"));
  const packageRoot = path.join(temporaryRoot, "theme");
  await fs.cp(fixtureRoot, packageRoot, { recursive: true });
  await fs.mkdir(path.join(packageRoot, "assets"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(packageRoot, "assets", "light.png"), tinyPng),
    fs.writeFile(path.join(packageRoot, "assets", "dark.png"), tinyPng),
  ]);
  if (mutator) await mutator(packageRoot);
  return { temporaryRoot, packageRoot };
}

async function withPackage(mutator, assertion) {
  const fixture = await makePackage(mutator);
  try { await assertion(fixture.packageRoot, fixture.temporaryRoot); }
  finally {
    const temporaryBase = await fs.realpath(os.tmpdir());
    const relative = path.relative(temporaryBase, fixture.temporaryRoot);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Refused to remove a test directory outside the system temporary directory.");
    }
    await fs.rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
}

async function editManifest(packageRoot, edit) {
  const manifestPath = path.join(packageRoot, "theme.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  edit(manifest);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

test("loads and normalizes a valid minimal theme package", async () => {
  await withPackage(null, async (packageRoot) => {
    const theme = await loadThemePackage(packageRoot);
    assert.equal(theme.manifest.id, "minimal-theme");
    assert.equal(theme.variants.light.background.mimeType, "image/png");
    assert.equal(theme.variants.dark.background.width, 1);
    assert.equal(theme.variants.light.layoutConfig.mode, "focus-soft");
  });
});

test("rejects a package without theme.json", async () => {
  await withPackage((root) => fs.rm(path.join(root, "theme.json")), async (root) => {
    await assert.rejects(loadThemePackage(root), /missing theme\.json/);
  });
});

test("rejects an unsupported schemaVersion", async () => {
  await withPackage((root) => editManifest(root, (m) => { m.schemaVersion = 2; }), async (root) => {
    await assert.rejects(loadThemePackage(root), /Unsupported theme schemaVersion/);
  });
});

test("rejects an invalid theme id", async () => {
  await withPackage((root) => editManifest(root, (m) => { m.id = "Invalid Theme"; }), async (root) => {
    await assert.rejects(loadThemePackage(root), /machine-readable identifier/);
  });
});

test("rejects a missing variant", async () => {
  await withPackage((root) => editManifest(root, (m) => { delete m.variants.light; }), async (root) => {
    await assert.rejects(loadThemePackage(root), /variants\.light is required/);
  });
});

test("rejects a missing background resource", async () => {
  await withPackage((root) => fs.rm(path.join(root, "assets", "light.png")), async (root) => {
    await assert.rejects(loadThemePackage(root), /does not exist/);
  });
});

for (const [name, value, pattern] of [
  ["parent traversal", "../outside.png", /parent-directory/],
  ["Windows absolute path", "C:/outside.png", /URI scheme|absolute/],
  ["UNC path", "//server/share/outside.png", /absolute or UNC/],
  ["HTTP URL", "https://example.com/image.png", /URI scheme/],
  ["file URI", "file:///outside.png", /URI scheme/],
]) {
  test(`rejects ${name}`, async () => {
    await withPackage((root) => editManifest(root, (m) => { m.variants.light.background = value; }), async (root) => {
      await assert.rejects(loadThemePackage(root), pattern);
    });
  });
}

test("rejects invalid layout JSON", async () => {
  await withPackage((root) => fs.writeFile(path.join(root, "layout.json"), "{"), async (root) => {
    await assert.rejects(loadThemePackage(root), /theme layout is not valid JSON/);
  });
});

test("rejects an invalid PNG", async () => {
  await withPackage((root) => fs.writeFile(path.join(root, "assets", "dark.png"), "not a png"), async (root) => {
    await assert.rejects(loadThemePackage(root), /PNG/);
  });
});

test("loads validated optional CSS", async () => {
  await withPackage(null, async (root) => {
    const theme = await loadThemePackage(root);
    assert.equal(theme.styles.length, 1);
    assert.match(theme.styles[0].content, /--minimal-surface/);
  });
});

test("rejects CSS @import", () => {
  assert.throws(() => validateThemeCss('@import "remote.css";'), /@import/);
});

test("rejects CSS url()", () => {
  assert.throws(() => validateThemeCss("body { background: url(remote.png); }"), /url\(\)/);
});

test("rejects symlink escape when the platform permits symlink creation", async (t) => {
  await withPackage(null, async (root, temporaryRoot) => {
    const outsideDirectory = path.join(temporaryRoot, "outside-assets");
    await fs.mkdir(outsideDirectory);
    await fs.writeFile(path.join(outsideDirectory, "outside.png"), tinyPng);
    const link = path.join(root, "assets", "escape-directory");
    try { await fs.symlink(outsideDirectory, link, process.platform === "win32" ? "junction" : "dir"); }
    catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) { t.skip("Symlink creation is unavailable."); return; }
      throw error;
    }
    await editManifest(root, (m) => { m.variants.light.background = "assets/escape-directory/outside.png"; });
    await assert.rejects(loadThemePackage(root), /outside the theme package root/);
  });
});

test("omitted styles normalize to an empty array", async () => {
  await withPackage((root) => editManifest(root, (m) => { delete m.styles; }), async (root) => {
    const theme = await loadThemePackage(root);
    assert.deepEqual(theme.styles, []);
    assert.deepEqual(theme.manifest.styles, []);
  });
});
