import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { findProjectRoot } from "../src/main/paths.mjs";
import { makeTemporaryDirectory, removeTemporaryDirectory } from "./helpers.mjs";

async function makeSentinels(root) {
  await Promise.all([
    fs.mkdir(path.join(root, "config"), { recursive: true }),
    fs.mkdir(path.join(root, "themes"), { recursive: true }),
    fs.mkdir(path.join(root, "scripts"), { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(path.join(root, "config", "app.schema.json"), "{}"),
    fs.writeFile(path.join(root, "themes", "theme.schema.json"), "{}"),
    fs.writeFile(path.join(root, "scripts", "Start-ForestScholarSkin.ps1"), ""),
    fs.writeFile(path.join(root, "scripts", "Restore-ForestScholarSkin.ps1"), ""),
  ]);
}

test("resolves a project root through Chinese and space-containing paths", async () => {
  const temporary = await makeTemporaryDirectory("paths");
  const root = path.join(temporary, "中文 Theme Manager Project");
  const nested = path.join(root, "gui", "src", "main");
  try {
    await makeSentinels(root);
    await fs.mkdir(nested, { recursive: true });
    assert.equal(await findProjectRoot(nested), root);
  } finally { await removeTemporaryDirectory(temporary); }
});

test("fails closed when project sentinels are missing", async () => {
  const root = await makeTemporaryDirectory("missing-root");
  try { await assert.rejects(findProjectRoot(root, { maximumDepth: 1 }), /could not be resolved/); }
  finally { await removeTemporaryDirectory(root); }
});
