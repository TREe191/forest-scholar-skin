import { inflateSync } from 'node:zlib';

export function classifyBrightness(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Invalid brightness');
  return value < 0.35 ? 'dark' : value < 0.70 ? 'medium' : 'light';
}

// Pure, bounded grid sampling. Transparent pixels contribute no weight.
export function sampleBackgroundTone(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      rgba.length !== width * height * 4) throw new RangeError('Invalid RGBA dimensions');
  let sum = 0, weight = 0, samples = 0;
  const nx = Math.min(64, width), ny = Math.min(64, height);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = (Math.floor((y + 0.5) * height / ny) * width + Math.floor((x + 0.5) * width / nx)) * 4;
    const alpha = rgba[i + 3] / 255;
    sum += (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255 * alpha;
    weight += alpha;
    samples++;
  }
  if (!weight) return { tone: 'medium', brightness: null, samples, fallback: 'transparent-image' };
  const brightness = Math.max(0, Math.min(1, sum / weight));
  return { tone: classifyBrightness(brightness), brightness, samples, fallback: null };
}

// Optional analysis, not package validation. Unsupported encodings retain the
// neutral defaults rather than making a previously valid theme unloadable.
export function analyzePngTone(bytes) {
  const fallback = reason => ({ tone: 'medium', brightness: null, samples: 0, fallback: reason });
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return fallback('invalid-png');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), type = bytes[25];
  if (bytes[24] !== 8 || ![2, 6].includes(type) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) return fallback('unsupported-png-encoding');
  if (!width || !height || width * height > 8_000_000) return fallback('analysis-size-limit');
  const channels = type === 6 ? 4 : 3, stride = width * channels;
  try {
    const chunks = [];
    let ended = false;
    for (let p = 8; p + 12 <= bytes.length;) {
      const size = bytes.readUInt32BE(p), name = bytes.toString('ascii', p + 4, p + 8);
      if (p + size + 12 > bytes.length) return fallback('invalid-png-chunks');
      if (name === 'tRNS' || name === 'acTL') return fallback('unsupported-png-encoding');
      if (name === 'IDAT') chunks.push(bytes.subarray(p + 8, p + 8 + size));
      if (name === 'IEND') { ended = true; break; }
      p += size + 12;
    }
    if (!ended || !chunks.length) return fallback('invalid-png-chunks');
    const raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: (stride + 1) * height });
    if (raw.length !== (stride + 1) * height) return fallback('invalid-png-data');
    const rgba = new Uint8Array(width * height * 4);
    let previous = new Uint8Array(stride);
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)], row = new Uint8Array(stride);
      if (filter > 4) return fallback('invalid-png-filter');
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? row[x - channels] : 0, b = previous[x], c = x >= channels ? previous[x - channels] : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        row[x] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255;
      }
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4, j = x * channels;
        rgba[i] = row[j]; rgba[i + 1] = row[j + 1]; rgba[i + 2] = row[j + 2];
        rgba[i + 3] = channels === 4 ? row[j + 3] : 255;
      }
      previous = row;
    }
    return sampleBackgroundTone(rgba, width, height);
  } catch {
    return fallback('png-analysis-failed');
  }
}
