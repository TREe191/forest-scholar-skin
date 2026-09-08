export function resolveSkinAdaptation(launchMode, detectedMode, supportedAppearances) {
  const appearances = ["light", "dark"];
  const launchModes = ["Auto", "Light", "Dark"];
  if (!launchModes.includes(launchMode)) throw new RangeError("Launch mode must be Auto, Light, or Dark.");
  if (!Array.isArray(supportedAppearances) || supportedAppearances.length === 0) {
    throw new RangeError("Theme supportedAppearances must not be empty.");
  }
  const supported = [...new Set(supportedAppearances.map((value) => String(value).toLowerCase()))];
  if (supported.some((value) => !appearances.includes(value))) {
    throw new RangeError("Theme supportedAppearances contains an unsupported value.");
  }

  if (launchMode !== "Auto") {
    const forced = launchMode.toLowerCase();
    if (!supported.includes(forced)) {
      throw new RangeError(`Force ${forced} skin is unavailable because this theme does not support ${forced} adaptation.`);
    }
    return { mode: launchMode, adaptation: forced, source: "forced" };
  }

  const detected = detectedMode == null ? null : String(detectedMode).toLowerCase();
  if (detected && !appearances.includes(detected)) throw new RangeError("Detected Codex appearance is invalid.");
  if (detected && !supported.includes(detected)) {
    throw new RangeError(`This theme is incompatible with the current Codex appearance: ${detected}.`);
  }
  const adaptation = detected || (supported.includes("dark") ? "dark" : supported[0]);
  return {
    mode: adaptation === "light" ? "Light" : "Dark",
    adaptation,
    source: detected ? "follow-codex" : "auto-fallback",
  };
}
