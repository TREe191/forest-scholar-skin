import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { AppConfigStore } from "../src/main/services/app-config.mjs";
import { makeTemporaryDirectory, removeTemporaryDirectory } from "./helpers.mjs";

const initialConfig = { schemaVersion: 1, activeTheme: "forest-scholar", appearance: "auto" };
const themeExists = (id) => ["forest-scholar", "phainon"].includes(id);

async function fixture(fileSystem = fs) {
  const root = await makeTemporaryDirectory("config");
  const configPath = path.join(root, "app.json");
  await fs.writeFile(configPath, `${JSON.stringify(initialConfig, null, 2)}\n`, "utf8");
  return { root, configPath, store: new AppConfigStore({ configPath, fileSystem }) };
}

test("reads app.json and applies activeTheme plus appearance", async () => {
  const item = await fixture();
  try {
    assert.deepEqual(await item.store.read(), initialConfig);
    const result = await item.store.apply(
      { activeTheme: "phainon", appearance: "dark" },
      { themeExists },
    );
    assert.equal(result.activeTheme, "phainon");
    assert.equal(result.appearance, "dark");
    assert.deepEqual(JSON.parse(await fs.readFile(item.configPath, "utf8")), result);
  } finally { await removeTemporaryDirectory(item.root); }
});

test("rejects unsupported Apply fields and unknown themes", async () => {
  const item = await fixture();
  try {
    await assert.rejects(
      item.store.apply({ activeTheme: "phainon", appearance: "light", extra: true }, { themeExists }),
      /only activeTheme and appearance/,
    );
    await assert.rejects(
      item.store.apply({ activeTheme: "missing-theme", appearance: "light" }, { themeExists }),
      /not a valid loaded Theme Package/,
    );
    assert.deepEqual(JSON.parse(await fs.readFile(item.configPath, "utf8")), initialConfig);
  } finally { await removeTemporaryDirectory(item.root); }
});

test("preserves the old configuration when atomic rename fails", async () => {
  const failingFileSystem = Object.create(fs);
  failingFileSystem.rename = async () => { throw Object.assign(new Error("simulated rename failure"), { code: "EPERM" }); };
  const item = await fixture(failingFileSystem);
  try {
    await assert.rejects(
      item.store.apply({ activeTheme: "phainon", appearance: "dark" }, { themeExists }),
      /simulated rename failure/,
    );
    assert.deepEqual(JSON.parse(await fs.readFile(item.configPath, "utf8")), initialConfig);
  } finally { await removeTemporaryDirectory(item.root); }
});

test("serializes concurrent Apply requests", async () => {
  const item = await fixture();
  try {
    const first = item.store.apply({ activeTheme: "phainon", appearance: "light" }, { themeExists });
    const second = item.store.apply({ activeTheme: "forest-scholar", appearance: "dark" }, { themeExists });
    await Promise.all([first, second]);
    assert.deepEqual(JSON.parse(await fs.readFile(item.configPath, "utf8")), {
      schemaVersion: 1,
      activeTheme: "forest-scholar",
      appearance: "dark",
    });
  } finally { await removeTemporaryDirectory(item.root); }
});
