export const LAYOUT_MODES = Object.freeze([
  "contain",
  "cover",
  "focus-lock",
  "focus-soft",
]);

export function calculateBackgroundLayout(image, viewport, config) {
  const MODES = new Set(["contain", "cover", "focus-lock", "focus-soft"]);
  const EPSILON = 1e-7;
  const finite = (value, label) => {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number.`);
    return value;
  };
  const positive = (value, label) => {
    finite(value, label);
    if (value <= 0) throw new RangeError(`${label} must be greater than zero.`);
    return value;
  };
  const unit = (value, label) => {
    finite(value, label);
    if (value < 0 || value > 1) throw new RangeError(`${label} must be between 0 and 1.`);
    return value;
  };
  const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
  const clampToInterval = (value, low, high) => clamp(value, Math.min(low, high), Math.max(low, high));
  const intersect = (a, b) => {
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    return {
      x: left,
      y: top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  };
  const area = (rect) => rect.width * rect.height;

  if (!image || typeof image !== "object") throw new TypeError("image must be an object.");
  if (!viewport || typeof viewport !== "object") throw new TypeError("viewport must be an object.");
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("config must be an object.");
  }

  const imageWidth = positive(image.width, "image.width");
  const imageHeight = positive(image.height, "image.height");
  const viewportWidth = positive(viewport.width, "viewport.width");
  const viewportHeight = positive(viewport.height, "viewport.height");
  const mode = config.mode;
  if (!MODES.has(mode)) throw new RangeError(`Unsupported layout mode: ${String(mode)}.`);

  const focalInput = config.focalRegion ?? { x: 0, y: 0, width: 1, height: 1 };
  if (!focalInput || typeof focalInput !== "object" || Array.isArray(focalInput)) {
    throw new TypeError("config.focalRegion must be an object.");
  }
  const focalRegion = {
    x: unit(focalInput.x, "config.focalRegion.x"),
    y: unit(focalInput.y, "config.focalRegion.y"),
    width: positive(focalInput.width, "config.focalRegion.width"),
    height: positive(focalInput.height, "config.focalRegion.height"),
  };
  if (focalRegion.width > 1 || focalRegion.height > 1 ||
      focalRegion.x + focalRegion.width > 1 + EPSILON ||
      focalRegion.y + focalRegion.height > 1 + EPSILON) {
    throw new RangeError("config.focalRegion must stay within normalized image bounds.");
  }

  const anchorInput = config.anchor ?? { x: 0.5, y: 0.5 };
  const anchor = {
    x: unit(anchorInput.x, "config.anchor.x"),
    y: unit(anchorInput.y, "config.anchor.y"),
  };
  const paddingInput = config.safePadding ?? {};
  const safePadding = {
    left: finite(paddingInput.left ?? 0, "config.safePadding.left"),
    right: finite(paddingInput.right ?? 0, "config.safePadding.right"),
    top: finite(paddingInput.top ?? 0, "config.safePadding.top"),
    bottom: finite(paddingInput.bottom ?? 0, "config.safePadding.bottom"),
  };
  for (const [side, value] of Object.entries(safePadding)) {
    if (value < 0) throw new RangeError(`config.safePadding.${side} cannot be negative.`);
  }
  const focusTolerance = unit(config.focusTolerance ?? 0, "config.focusTolerance");
  const scaleMultiplier = positive(config.scale ?? 1, "config.scale");
  const minScale = config.minScale == null ? null : positive(config.minScale, "config.minScale");
  const maxScale = config.maxScale == null ? null : positive(config.maxScale, "config.maxScale");
  if (minScale != null && maxScale != null && minScale > maxScale) {
    throw new RangeError("config.minScale cannot exceed config.maxScale.");
  }
  const offsetInput = config.offset ?? { x: 0, y: 0 };
  const manualOffset = {
    x: finite(offsetInput.x ?? 0, "config.offset.x"),
    y: finite(offsetInput.y ?? 0, "config.offset.y"),
  };

  const containScale = Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight);
  const coverScale = Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
  const baseScale = mode === "contain" ? containScale : coverScale;
  let scale = baseScale * scaleMultiplier;
  if (minScale != null) scale = Math.max(scale, minScale);
  if (maxScale != null) scale = Math.min(scale, maxScale);

  let scaleConstraintConflict = false;
  if (mode === "contain" && scale > containScale + EPSILON) {
    scale = containScale;
    scaleConstraintConflict = true;
  }
  if (mode !== "contain" && scale < coverScale - EPSILON) {
    scale = coverScale;
    scaleConstraintConflict = true;
  }

  const renderedWidth = imageWidth * scale;
  const renderedHeight = imageHeight * scale;
  const bounds = mode === "contain"
    ? {
        minX: 0,
        maxX: Math.max(0, viewportWidth - renderedWidth),
        minY: 0,
        maxY: Math.max(0, viewportHeight - renderedHeight),
      }
    : {
        minX: Math.min(0, viewportWidth - renderedWidth),
        maxX: 0,
        minY: Math.min(0, viewportHeight - renderedHeight),
        maxY: 0,
      };
  const preferredOffset = {
    x: clampToInterval((viewportWidth - renderedWidth) * anchor.x + manualOffset.x * viewportWidth, bounds.minX, bounds.maxX),
    y: clampToInterval((viewportHeight - renderedHeight) * anchor.y + manualOffset.y * viewportHeight, bounds.minY, bounds.maxY),
  };

  const collapsedAxes = [];
  let safeLeft = safePadding.left;
  let safeRight = viewportWidth - safePadding.right;
  let safeTop = safePadding.top;
  let safeBottom = viewportHeight - safePadding.bottom;
  if (safeRight <= safeLeft) {
    safeLeft = 0;
    safeRight = viewportWidth;
    collapsedAxes.push("x");
  }
  if (safeBottom <= safeTop) {
    safeTop = 0;
    safeBottom = viewportHeight;
    collapsedAxes.push("y");
  }
  const viewportRect = { x: 0, y: 0, width: viewportWidth, height: viewportHeight };
  const safeRect = { x: safeLeft, y: safeTop, width: safeRight - safeLeft, height: safeBottom - safeTop };
  const focalLocal = {
    x: focalRegion.x * renderedWidth,
    y: focalRegion.y * renderedHeight,
    width: focalRegion.width * renderedWidth,
    height: focalRegion.height * renderedHeight,
  };
  const focalArea = Math.max(EPSILON, focalLocal.width * focalLocal.height);

  const metricsAt = (x, y) => {
    const renderedRect = {
      x: x + focalLocal.x,
      y: y + focalLocal.y,
      width: focalLocal.width,
      height: focalLocal.height,
    };
    const visibleRect = intersect(renderedRect, viewportRect);
    const safeVisibleRect = intersect(renderedRect, safeRect);
    return {
      renderedRect,
      visibleRect,
      safeVisibleRect,
      visibleRatio: clamp(area(visibleRect) / focalArea, 0, 1),
      safeVisibleRatio: clamp(area(safeVisibleRect) / focalArea, 0, 1),
    };
  };

  const bestAxisOffset = (preferred, minBound, maxBound, localStart, localLength, safeStart, safeEnd, viewportLength) => {
    const candidates = [
      preferred,
      minBound,
      maxBound,
      safeStart - localStart,
      safeEnd - localStart - localLength,
      ((safeStart + safeEnd) - localLength) / 2 - localStart,
      -localStart,
      viewportLength - localStart - localLength,
      (viewportLength - localLength) / 2 - localStart,
    ].map((value) => clampToInterval(value, minBound, maxBound));
    let best = candidates[0];
    let bestScore = null;
    for (const candidate of candidates) {
      const start = candidate + localStart;
      const end = start + localLength;
      const visible = Math.max(0, Math.min(end, viewportLength) - Math.max(start, 0));
      const safeVisible = Math.max(0, Math.min(end, safeEnd) - Math.max(start, safeStart));
      const score = [safeVisible, visible, -Math.abs(candidate - preferred)];
      if (!bestScore || score[0] > bestScore[0] + EPSILON ||
          (Math.abs(score[0] - bestScore[0]) <= EPSILON && score[1] > bestScore[1] + EPSILON) ||
          (Math.abs(score[0] - bestScore[0]) <= EPSILON && Math.abs(score[1] - bestScore[1]) <= EPSILON && score[2] > bestScore[2])) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  };

  const fullXLow = Math.max(bounds.minX, safeLeft - focalLocal.x);
  const fullXHigh = Math.min(bounds.maxX, safeRight - focalLocal.x - focalLocal.width);
  const fullYLow = Math.max(bounds.minY, safeTop - focalLocal.y);
  const fullYHigh = Math.min(bounds.maxY, safeBottom - focalLocal.y - focalLocal.height);
  const fullFocusFeasible = fullXLow <= fullXHigh + EPSILON && fullYLow <= fullYHigh + EPSILON;
  const focusLockedOffset = fullFocusFeasible
    ? {
        x: clampToInterval(preferredOffset.x, fullXLow, fullXHigh),
        y: clampToInterval(preferredOffset.y, fullYLow, fullYHigh),
      }
    : {
        x: bestAxisOffset(preferredOffset.x, bounds.minX, bounds.maxX, focalLocal.x, focalLocal.width, safeLeft, safeRight, viewportWidth),
        y: bestAxisOffset(preferredOffset.y, bounds.minY, bounds.maxY, focalLocal.y, focalLocal.height, safeTop, safeBottom, viewportHeight),
      };

  let offsetX = preferredOffset.x;
  let offsetY = preferredOffset.y;
  let focusAdjustment = 0;
  const targetVisibleRatio = mode === "focus-lock" ? 1 : mode === "focus-soft" ? 1 - focusTolerance : null;
  if (mode === "focus-lock") {
    offsetX = focusLockedOffset.x;
    offsetY = focusLockedOffset.y;
    focusAdjustment = 1;
  } else if (mode === "focus-soft") {
    const preferredMetrics = metricsAt(preferredOffset.x, preferredOffset.y);
    const lockedMetrics = metricsAt(focusLockedOffset.x, focusLockedOffset.y);
    if (preferredMetrics.safeVisibleRatio + EPSILON < targetVisibleRatio) {
      if (lockedMetrics.safeVisibleRatio + EPSILON >= targetVisibleRatio) {
        let low = 0;
        let high = 1;
        for (let index = 0; index < 30; index += 1) {
          const middle = (low + high) / 2;
          const x = preferredOffset.x + (focusLockedOffset.x - preferredOffset.x) * middle;
          const y = preferredOffset.y + (focusLockedOffset.y - preferredOffset.y) * middle;
          if (metricsAt(x, y).safeVisibleRatio + EPSILON >= targetVisibleRatio) high = middle;
          else low = middle;
        }
        focusAdjustment = high;
        offsetX = preferredOffset.x + (focusLockedOffset.x - preferredOffset.x) * high;
        offsetY = preferredOffset.y + (focusLockedOffset.y - preferredOffset.y) * high;
      } else {
        focusAdjustment = 1;
        offsetX = focusLockedOffset.x;
        offsetY = focusLockedOffset.y;
      }
    }
  }

  const focalMetrics = metricsAt(offsetX, offsetY);
  const sourceVisibleLeft = clamp(-offsetX / scale, 0, imageWidth);
  const sourceVisibleTop = clamp(-offsetY / scale, 0, imageHeight);
  const sourceVisibleRight = clamp((viewportWidth - offsetX) / scale, 0, imageWidth);
  const sourceVisibleBottom = clamp((viewportHeight - offsetY) / scale, 0, imageHeight);
  const crop = {
    left: sourceVisibleLeft,
    right: imageWidth - sourceVisibleRight,
    top: sourceVisibleTop,
    bottom: imageHeight - sourceVisibleBottom,
    sourceRect: {
      x: sourceVisibleLeft,
      y: sourceVisibleTop,
      width: Math.max(0, sourceVisibleRight - sourceVisibleLeft),
      height: Math.max(0, sourceVisibleBottom - sourceVisibleTop),
    },
  };
  const renderedFocal = focalMetrics.renderedRect;
  const focalCropped = {
    left: clamp(-renderedFocal.x, 0, renderedFocal.width),
    right: clamp(renderedFocal.x + renderedFocal.width - viewportWidth, 0, renderedFocal.width),
    top: clamp(-renderedFocal.y, 0, renderedFocal.height),
    bottom: clamp(renderedFocal.y + renderedFocal.height - viewportHeight, 0, renderedFocal.height),
  };
  const focalConstraintSatisfied = targetVisibleRatio == null ||
    focalMetrics.safeVisibleRatio + EPSILON >= targetVisibleRatio;
  const constraintSatisfied = focalConstraintSatisfied && !scaleConstraintConflict;

  return {
    mode,
    scale,
    renderedWidth,
    renderedHeight,
    offsetX,
    offsetY,
    crop,
    focal: {
      normalizedRegion: { ...focalRegion },
      renderedRect: focalMetrics.renderedRect,
      visibleRect: focalMetrics.visibleRect,
      safeVisibleRect: focalMetrics.safeVisibleRect,
      visibleRatio: focalMetrics.visibleRatio,
      safeVisibleRatio: focalMetrics.safeVisibleRatio,
      croppedRatio: 1 - focalMetrics.visibleRatio,
      cropped: focalCropped,
      targetVisibleRatio,
    },
    constraintSatisfied,
    diagnostics: {
      baseScale,
      containScale,
      coverScale,
      requestedScale: baseScale * scaleMultiplier,
      minScale,
      maxScale,
      scaleConstraintConflict,
      preferredOffset,
      focusLockedOffset,
      focusAdjustment,
      fullFocusFeasible,
      safeRect,
      safePaddingCollapsed: collapsedAxes.length > 0,
      safePaddingCollapsedAxes: collapsedAxes,
      constraintMetric: targetVisibleRatio == null ? null : "safe-visible-area",
    },
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeLayout(base, override) {
  const result = { ...base, ...override };
  for (const key of ["focalRegion", "anchor", "safePadding", "offset"]) {
    if (base[key] || override[key]) result[key] = { ...(base[key] ?? {}), ...(override[key] ?? {}) };
  }
  return result;
}

export function resolveLayoutConfig(document, variant) {
  if (!isPlainObject(document)) throw new TypeError("The layout configuration document must be an object.");
  if (document.schemaVersion !== 1) throw new RangeError("Unsupported layout schemaVersion.");
  if (!isPlainObject(document.shared)) throw new TypeError("layout.shared must be an object.");
  if (!isPlainObject(document.variants)) throw new TypeError("layout.variants must be an object.");
  if (!Object.hasOwn(document.variants, variant)) throw new RangeError(`Missing layout variant: ${variant}.`);
  const override = document.variants[variant];
  if (!isPlainObject(override)) throw new TypeError(`layout.variants.${variant} must be an object.`);
  const resolved = mergeLayout(document.shared, override);
  calculateBackgroundLayout({ width: 1, height: 1 }, { width: 1, height: 1 }, resolved);
  return resolved;
}
