import test from "node:test";
import assert from "node:assert/strict";
import {
  legacyAppearanceToSkinAdaptation,
  skinAdaptationToLegacyAppearance,
} from "../src/shared/contracts.mjs";

test("maps schemaVersion 1 appearance values to Skin adaptation semantics", () => {
  assert.equal(legacyAppearanceToSkinAdaptation("auto"), "follow-codex");
  assert.equal(legacyAppearanceToSkinAdaptation("light"), "force-light");
  assert.equal(legacyAppearanceToSkinAdaptation("dark"), "force-dark");
});

test("writes Skin adaptation through the legacy app.json appearance field", () => {
  assert.equal(skinAdaptationToLegacyAppearance("follow-codex"), "auto");
  assert.equal(skinAdaptationToLegacyAppearance("force-light"), "light");
  assert.equal(skinAdaptationToLegacyAppearance("force-dark"), "dark");
});
