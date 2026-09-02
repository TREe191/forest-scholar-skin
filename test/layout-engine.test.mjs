import test from "node:test";
import assert from "node:assert/strict";
import { calculateBackgroundLayout, resolveLayoutConfig } from "../scripts/layout-engine.mjs";

const image16x9 = { width: 1600, height: 900 };
const base = (mode, overrides = {}) => ({
  mode,
  focalRegion: { x: 0.35, y: 0.25, width: 0.3, height: 0.5 },
  anchor: { x: 0.5, y: 0.5 },
  safePadding: { left: 0, right: 0, top: 0, bottom: 0 },
  focusTolerance: 0.08,
  scale: 1,
  minScale: null,
  maxScale: null,
  offset: { x: 0, y: 0 },
  ...overrides,
});
const close = (actual, expected, epsilon = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be close to ${expected}`);
};

test("16:9 image to 16:9 viewport has exact fit", () => {
  const result = calculateBackgroundLayout(image16x9, { width: 1280, height: 720 }, base("cover"));
  close(result.scale, 0.8);
  close(result.renderedWidth, 1280);
  close(result.renderedHeight, 720);
  close(result.crop.left + result.crop.right + result.crop.top + result.crop.bottom, 0);
});

test("16:9 image to narrow portrait viewport covers and crops horizontally", () => {
  const result = calculateBackgroundLayout(image16x9, { width: 600, height: 1000 }, base("cover"));
  assert.ok(result.renderedWidth > 600);
  close(result.renderedHeight, 1000);
  assert.ok(result.crop.left > 0);
  assert.ok(result.crop.right > 0);
});

test("16:9 image to ultrawide viewport covers and crops vertically", () => {
  const result = calculateBackgroundLayout(image16x9, { width: 2400, height: 700 }, base("cover"));
  close(result.renderedWidth, 2400);
  assert.ok(result.renderedHeight > 700);
  assert.ok(result.crop.top > 0);
  assert.ok(result.crop.bottom > 0);
});

test("right-side focal region is preserved by focus-lock", () => {
  const config = base("focus-lock", {
    focalRegion: { x: 0.75, y: 0.2, width: 0.2, height: 0.5 },
    anchor: { x: 0, y: 0.5 },
    safePadding: { left: 20, right: 20, top: 20, bottom: 20 },
  });
  const result = calculateBackgroundLayout(image16x9, { width: 600, height: 1000 }, config);
  close(result.focal.safeVisibleRatio, 1);
  assert.equal(result.constraintSatisfied, true);
  assert.ok(result.offsetX < result.diagnostics.preferredOffset.x);
});

test("upper-left focal region is preserved without theme-specific assumptions", () => {
  const config = base("focus-lock", {
    focalRegion: { x: 0.03, y: 0.03, width: 0.18, height: 0.2 },
    anchor: { x: 1, y: 1 },
  });
  const result = calculateBackgroundLayout(image16x9, { width: 700, height: 900 }, config);
  close(result.focal.visibleRatio, 1);
  assert.equal(result.constraintSatisfied, true);
});

test("central focal region remains visible", () => {
  const result = calculateBackgroundLayout(
    image16x9,
    { width: 700, height: 700 },
    base("focus-lock", { focalRegion: { x: 0.4, y: 0.35, width: 0.2, height: 0.3 } }),
  );
  close(result.focal.visibleRatio, 1);
  assert.equal(result.constraintSatisfied, true);
});

test("focus-lock reports a satisfiable constraint", () => {
  const result = calculateBackgroundLayout(
    { width: 1000, height: 1000 },
    { width: 800, height: 600 },
    base("focus-lock", { focalRegion: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 } }),
  );
  assert.equal(result.diagnostics.fullFocusFeasible, true);
  assert.equal(result.constraintSatisfied, true);
});

test("focus-lock explicitly reports an impossible full-focus constraint", () => {
  const result = calculateBackgroundLayout(
    image16x9,
    { width: 400, height: 900 },
    base("focus-lock", { focalRegion: { x: 0, y: 0, width: 1, height: 1 } }),
  );
  assert.equal(result.diagnostics.fullFocusFeasible, false);
  assert.equal(result.constraintSatisfied, false);
  assert.ok(result.focal.safeVisibleRatio < 1);
});

test("focus-soft does not adjust an anchor that already satisfies tolerance", () => {
  const result = calculateBackgroundLayout(
    image16x9,
    { width: 900, height: 900 },
    base("focus-soft", { focalRegion: { x: 0.4, y: 0.3, width: 0.2, height: 0.3 } }),
  );
  close(result.diagnostics.focusAdjustment, 0);
  close(result.offsetX, result.diagnostics.preferredOffset.x);
  assert.equal(result.constraintSatisfied, true);
});

test("focus-soft applies only the partial correction needed to meet tolerance", () => {
  const result = calculateBackgroundLayout(
    image16x9,
    { width: 600, height: 1000 },
    base("focus-soft", {
      focalRegion: { x: 0.75, y: 0.2, width: 0.2, height: 0.5 },
      anchor: { x: 0, y: 0.5 },
      focusTolerance: 0.08,
    }),
  );
  assert.ok(result.diagnostics.focusAdjustment > 0);
  assert.ok(result.diagnostics.focusAdjustment < 1);
  assert.ok(result.focal.safeVisibleRatio >= 0.92 - 1e-6);
  assert.equal(result.constraintSatisfied, true);
});

test("contain never crops the source image", () => {
  const result = calculateBackgroundLayout(image16x9, { width: 600, height: 1000 }, base("contain"));
  close(result.crop.left, 0);
  close(result.crop.right, 0);
  close(result.crop.top, 0);
  close(result.crop.bottom, 0);
  assert.ok(result.renderedWidth <= 600 + 1e-6);
  assert.ok(result.renderedHeight <= 1000 + 1e-6);
});

test("cover always fills the viewport", () => {
  for (const viewport of [{ width: 300, height: 1200 }, { width: 2200, height: 500 }]) {
    const result = calculateBackgroundLayout(image16x9, viewport, base("cover"));
    assert.ok(result.renderedWidth >= viewport.width - 1e-6);
    assert.ok(result.renderedHeight >= viewport.height - 1e-6);
  }
});

test("min and max scale constraints are explicit and preserve mode invariants", () => {
  const enlarged = calculateBackgroundLayout(
    { width: 1000, height: 1000 },
    { width: 500, height: 500 },
    base("cover", { minScale: 0.75 }),
  );
  close(enlarged.scale, 0.75);
  assert.equal(enlarged.diagnostics.scaleConstraintConflict, false);

  const conflicting = calculateBackgroundLayout(
    { width: 1000, height: 1000 },
    { width: 500, height: 500 },
    base("cover", { maxScale: 0.25 }),
  );
  close(conflicting.scale, 0.5);
  assert.equal(conflicting.diagnostics.scaleConstraintConflict, true);
  assert.equal(conflicting.constraintSatisfied, false);
});

test("extremely small viewport remains finite and reports collapsed safe padding", () => {
  const result = calculateBackgroundLayout(
    { width: 300, height: 200 },
    { width: 8, height: 6 },
    base("focus-soft", { safePadding: { left: 24, right: 24, top: 24, bottom: 24 } }),
  );
  for (const value of [result.scale, result.renderedWidth, result.renderedHeight, result.offsetX, result.offsetY]) {
    assert.equal(Number.isFinite(value), true);
  }
  assert.equal(result.diagnostics.safePaddingCollapsed, true);
});

test("invalid configuration is rejected rather than silently accepted", () => {
  assert.throws(
    () => calculateBackgroundLayout(image16x9, { width: 800, height: 600 }, base("focus-soft", {
      focalRegion: { x: 0.9, y: 0, width: 0.2, height: 1 },
    })),
    /normalized image bounds/,
  );
  assert.throws(
    () => calculateBackgroundLayout(image16x9, { width: 800, height: 600 }, base("unknown")),
    /Unsupported layout mode/,
  );
});

test("variant configuration resolves without embedding a theme in the engine", () => {
  const resolved = resolveLayoutConfig({
    schemaVersion: 1,
    shared: base("focus-soft"),
    variants: { Light: {}, Dark: { anchor: { x: 0.7 } } },
  }, "Dark");
  close(resolved.anchor.x, 0.7);
  close(resolved.anchor.y, 0.5);
});
