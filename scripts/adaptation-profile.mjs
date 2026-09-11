// Pure policy boundary: analysis measurements -> a versioned UI preset.
// No PNG decoding, DOM, CSS mutation, filesystem or theme-specific data.
// Future regional/contrast analyzers may add measurements without changing
// theme manifests. CSS currently owns the preset's actual variable values.
export function resolveAdaptationProfile(analysis, appearance) {
  if (!['light', 'dark'].includes(appearance)) throw new RangeError('Invalid appearance');
  const tone = !analysis?.fallback && ['light', 'medium', 'dark'].includes(analysis?.tone)
    ? analysis.tone : 'medium';
  return {
    schemaVersion: 1,
    strategy: 'global-tone-v1',
    appearance,
    preset: `${appearance}-${tone}`,
    tone,
  };
}
