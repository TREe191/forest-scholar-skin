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
  for (const ignored of ["test/Enable-BackgroundProbe-A.cmd", "runtime/history/example/session.json", "runtime/preserved/example/session.json", "gui/test/.tmp/example",
    "themes/user-example/theme.json", "theme-manager-diagnostics-1.0.0-beta.1-example.zip", "local-archive.zip"]) {
    const result = spawnSync("git", ["check-ignore", "--no-index", ignored], { cwd: root, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, `${ignored} must remain ignored: ${result.stderr}`);
  }
});

test("release tree excludes local state, user themes, diagnostics and unrelated root archives", async () => {
  const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(tracked.status, 0, tracked.stderr);
  const files = tracked.stdout.split("\0").filter(Boolean).map(name=>name.replaceAll("\\","/"));
  for(const name of files){
    assert.doesNotMatch(name,/^themes\/user-/i);
    assert.doesNotMatch(name,/(^|\/)theme-manager-diagnostics-.*\.zip$/i);
    assert.doesNotMatch(name,/^runtime\//i);
    assert.doesNotMatch(name,/^[^/]+\.(?:zip|7z|rar|tar|tar\.gz)$/i);
  }
  const config=JSON.parse(await fs.readFile(path.join(root,"config/app.json"),"utf8"));
  assert.deepEqual(config,{schemaVersion:1,activeTheme:"phainon",appearance:"auto"});
});

test("repository declares code-only MIT scope and separate asset rights", async () => {
  const license=await fs.readFile(path.join(root,"LICENSE"),"utf8");
  const assets=await fs.readFile(path.join(root,"ASSETS.md"),"utf8");
  assert.match(license,/MIT License/);assert.match(license,/applies only to original software code/);
  assert.match(assets,/does not automatically apply to artwork/);
  assert.match(assets,/does not claim that those rights\s+belong to TREe191/);
  assert.match(assets,/not affiliated with or endorsed\s+by OpenAI or HoYoverse/);
});
