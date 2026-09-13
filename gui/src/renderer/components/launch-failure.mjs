const MESSAGES = Object.freeze({
  "existing-codex-check": "Codex is still running. Fully exit Codex, wait for its background processes to end, then try again.",
  "cdp-http-readiness": "Codex started, but the debugging connection did not finish getting ready. Fully exit Codex and try again; if the problem continues, export diagnostics.",
});

export function launchFailureMessage(failureStage, fallback = "Codex could not be launched. Please try again.") {
  return MESSAGES[failureStage] || fallback;
}
