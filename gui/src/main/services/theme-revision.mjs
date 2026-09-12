import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
// Hash validated content, not timestamps, absolute paths or obsolete image files.
export function themeContentRevision(pkg) {
  const backgrounds = {};
  for (const mode of ['light', 'dark']) {
    const image = pkg.backgrounds[mode];
    backgrounds[mode] = image ? createHash('sha256').update(image.bytes).digest('hex') : null;
  }
  const content = {
    manifest: pkg.manifest, layouts: pkg.layoutConfig, backgrounds,
    styles: pkg.styles.map(style => ({path:style.relativePath, content:style.content})),
  };
  return createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex');
}
