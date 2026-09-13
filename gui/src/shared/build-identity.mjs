const MODES = new Set(["development", "beta", "production"]);
const FULL_COMMIT = /^[0-9a-f]{40}$/i;

export function normalizeGitCommit(value) {
  return typeof value === "string" && FULL_COMMIT.test(value.trim()) ? value.trim().toLowerCase() : "unavailable";
}

export function createBuildIdentity(mode, gitCommit) {
  if (!MODES.has(mode)) throw new TypeError("Invalid build identity mode.");
  const normalizedCommit = normalizeGitCommit(gitCommit);
  return Object.freeze({
    schemaVersion: 1,
    mode,
    gitCommit: normalizedCommit,
    shortCommit: normalizedCommit === "unavailable" ? "unavailable" : normalizedCommit.slice(0, 7),
  });
}

export function buildModeLabel(mode) {
  return ({development:"Development",beta:"Beta",production:"Production"})[mode] || "Unavailable";
}
