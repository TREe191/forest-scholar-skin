import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSkinAdaptation } from "../scripts/skin-adaptation.mjs";

test("Follow Codex rejects an unsupported detected appearance", () => {
  assert.throws(
    () => resolveSkinAdaptation("Auto", "Light", ["dark"]),
    /incompatible with the current Codex appearance: light/,
  );
});

test("Force Dark is allowed for a dark-only theme", () => {
  assert.deepEqual(resolveSkinAdaptation("Dark", "Light", ["dark"]), {
    mode: "Dark",
    adaptation: "dark",
    source: "forced",
  });
});

test("Force Light is rejected for a dark-only theme", () => {
  assert.throws(
    () => resolveSkinAdaptation("Light", "Dark", ["dark"]),
    /does not support light adaptation/,
  );
});

test("Follow Codex preserves existing dual-mode behavior", () => {
  assert.equal(resolveSkinAdaptation("Auto", "Light", ["light", "dark"]).mode, "Light");
  assert.equal(resolveSkinAdaptation("Auto", "Dark", ["light", "dark"]).mode, "Dark");
  assert.equal(resolveSkinAdaptation("Auto", null, ["light", "dark"]).mode, "Dark");
});

test("base CSS defines a transparent default background scrim", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const css = await fs.readFile(path.join(path.dirname(testDirectory), "styles", "base.css"), "utf8");
  assert.match(css, /--codex-skin-background-scrim:\s*transparent/);
  assert.match(css, /#forest-scholar-skin-background::after/);
  assert.match(css, /background:\s*var\(--codex-skin-background-scrim,\s*transparent\)/);
});
