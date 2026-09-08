import test from "node:test";
import assert from "node:assert/strict";
import { assertThemeAppearanceCompatibility } from "../src/main/ipc.mjs";

const darkOnlyCatalog = {
  supportsAppearance(_themeId, appearance) {
    return appearance === "dark";
  },
};

test("GUI Apply allows Follow Codex for a single-mode theme", () => {
  assert.doesNotThrow(() => assertThemeAppearanceCompatibility(darkOnlyCatalog, {
    activeTheme: "dark-only",
    appearance: "auto",
  }));
});

test("GUI Apply allows a supported forced skin adaptation", () => {
  assert.doesNotThrow(() => assertThemeAppearanceCompatibility(darkOnlyCatalog, {
    activeTheme: "dark-only",
    appearance: "dark",
  }));
});

test("GUI Apply rejects an unsupported forced skin adaptation", () => {
  assert.throws(() => assertThemeAppearanceCompatibility(darkOnlyCatalog, {
    activeTheme: "dark-only",
    appearance: "light",
  }), /does not support light skin adaptation/);
});
