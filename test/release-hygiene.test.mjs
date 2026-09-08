import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("shortcut targets exist and the primary entry opens Theme Manager", async () => {
  const installer = await fs.readFile(path.join(root, "Install-Shortcuts.ps1"), "utf8");
  const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
  const targets = [...installer.matchAll(/Launcher\s*=\s*'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(targets, ["Start-ThemeManager.cmd", "Restore-ForestScholarSkin.cmd"]);
  for (const target of targets) assert.ok((await fs.stat(path.join(root, target))).isFile());
  assert.doesNotMatch(`${installer}\n${readme}`, /Start-ForestScholar(?:-Light|-Dark)?\.cmd/);
  const entry = await fs.readFile(path.join(root, targets[0]), "utf8");
  assert.match(entry, /call npm start/);
  assert.doesNotMatch(entry, /Start-ForestScholarSkin\.ps1|remote-debugging/);
});

test("shortcut remover covers every installed shortcut name", async () => {
  const installer = await fs.readFile(path.join(root, "Install-Shortcuts.ps1"), "utf8");
  const remover = await fs.readFile(path.join(root, "Remove-Shortcuts.ps1"), "utf8");
  for (const [, name] of installer.matchAll(/Name\s*=\s*'([^']+)'/g)) {
    assert.ok(remover.includes(`'${name}.lnk'`));
  }
});

test("Git includes formal tests but excludes diagnostic launchers and runtime", async () => {
  const formalTests = (await fs.readdir(path.join(root, "test")))
    .filter((name) => /\.test\.(mjs|ps1)$/.test(name));
  assert.ok(formalTests.includes("universal-adapter.test.mjs"));
  for (const name of formalTests) {
    const result = spawnSync("git", ["check-ignore", "--no-index", `test/${name}`], { cwd: root, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 1, `${name} must not be ignored: ${result.stdout} ${result.stderr}`);
  }
  for (const ignored of ["test/Enable-BackgroundProbe-A.cmd", "runtime/history/example/session.json", "gui/test/.tmp/example"]) {
    const result = spawnSync("git", ["check-ignore", "--no-index", ignored], { cwd: root, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, `${ignored} must remain ignored: ${result.stderr}`);
  }
});
