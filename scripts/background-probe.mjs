import fs from "node:fs/promises";
import path from "node:path";

const IDENTIFIER = /^[A-Za-z0-9._-]{1,200}$/;

function parseArgs(argv) {
  const options = { port: null, browserId: null, root: null, stateFile: null, mode: null, themeMode: "Dark" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--browser-id") options.browserId = argv[++index];
    else if (arg === "--root") options.root = argv[++index];
    else if (arg === "--state-file") options.stateFile = argv[++index];
    else if (arg === "--mode") options.mode = argv[++index];
    else if (arg === "--theme-mode") options.themeMode = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 49152 || options.port > 65535) {
    throw new Error("The CDP port must be a high port between 49152 and 65535.");
  }
  if (!IDENTIFIER.test(options.browserId ?? "")) throw new Error("Invalid browser ID.");
  if (!options.root || !options.stateFile) throw new Error("--root and --state-file are required.");
  if (!["A", "B", "C", "D", "Restore"].includes(options.mode)) throw new Error("Mode must be A, B, C, D, or Restore.");
  if (!["Light", "Dark"].includes(options.themeMode)) throw new Error("Theme mode must be Light or Dark.");
  return options;
}

function validatedWsUrl(value, port, kind, identifier) {
  const url = new URL(value);
  if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1" || Number(url.port) !== port ||
      url.username || url.password || url.search || url.hash ||
      url.pathname !== `/devtools/${kind}/${identifier}`) {
    throw new Error("Rejected a CDP WebSocket URL outside the recorded 127.0.0.1 endpoint.");
  }
  return url.href;
}

async function fetchJson(port, endpoint) {
  const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`CDP ${endpoint} returned HTTP ${response.status}.`);
  return response.json();
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP WebSocket open timed out.")), 5000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP WebSocket open failed.")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error("CDP command failed."));
      else pending.resolve(message.result);
    });
    await this.send("Runtime.enable");
    return this;
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (result.exceptionDetails) throw new Error("The background probe failed in the renderer.");
    return result.result?.value;
  }

  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("CDP session closed."));
    }
    this.pending.clear();
    try { this.ws?.close(); } catch { }
  }
}

function buildProbeExpression(mode, testImageDataUrl = null) {
  return `(() => {
    const probeStateKey = '__FOREST_SCHOLAR_BACKGROUND_PROBE__';
    const node = document.getElementById('forest-scholar-skin-background');
    const touchedProperties = [
      'position', 'inset', 'top', 'right', 'bottom', 'left', 'z-index',
      'opacity', 'pointer-events', 'display', 'visibility', 'background-image',
      'background-size', 'background-position', 'background-repeat'
    ];
    const snapshot = (element) => {
      if (!element) return { exists: false };
      const computed = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const backgroundImage = computed.backgroundImage;
      return {
        exists: true,
        tagName: element.tagName,
        id: element.id,
        className: typeof element.className === 'string' ? element.className : '',
        rect: {
          x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          right: rect.right, bottom: rect.bottom
        },
        position: computed.position,
        inset: computed.inset,
        top: computed.top,
        right: computed.right,
        bottom: computed.bottom,
        left: computed.left,
        zIndex: computed.zIndex,
        opacity: computed.opacity,
        display: computed.display,
        visibility: computed.visibility,
        pointerEvents: computed.pointerEvents,
        backgroundImageIsNone: backgroundImage === 'none',
        backgroundImageIsDataImage: /^url\\(["']?data:image/i.test(backgroundImage),
        backgroundImageLength: backgroundImage.length,
        backgroundImageHasBase64Marker: backgroundImage.includes('base64,'),
        backgroundSize: computed.backgroundSize,
        backgroundPosition: computed.backgroundPosition,
        backgroundRepeat: computed.backgroundRepeat
      };
    };
    const result = { mode: ${JSON.stringify(mode)}, before: snapshot(node), restored: false };
    if (!node) return result;

    if (${JSON.stringify(mode)} === 'Restore') {
      const state = window[probeStateKey];
      if (state && state.nodeId === node.id && state.original) {
        for (const property of touchedProperties) {
          const original = state.original[property];
          if (original.value) node.style.setProperty(property, original.value, original.priority);
          else node.style.removeProperty(property);
        }
        delete window[probeStateKey];
        result.restored = true;
      }
      result.after = snapshot(node);
      return result;
    }

    if (!window[probeStateKey]) {
      const original = {};
      for (const property of touchedProperties) {
        original[property] = {
          value: node.style.getPropertyValue(property),
          priority: node.style.getPropertyPriority(property)
        };
      }
      window[probeStateKey] = { nodeId: node.id, original };
    }

    for (const [property, value] of Object.entries({
      position: 'fixed', inset: '0', top: '0', right: '0', bottom: '0', left: '0',
      'z-index': '2147483000', opacity: ${JSON.stringify(mode)} === 'B' ? '0.5' : '1',
      'pointer-events': 'none', display: 'block', visibility: 'visible'
    })) node.style.setProperty(property, value, 'important');
    if (${JSON.stringify(mode)} === 'B') {
      node.style.setProperty('background-image', 'linear-gradient(135deg, #ff00ff 0%, #00ffff 100%)', 'important');
    } else if (${JSON.stringify(mode)} === 'C' || ${JSON.stringify(mode)} === 'D') {
      node.style.setProperty('background-image', 'url("' + ${JSON.stringify(testImageDataUrl)} + '")', 'important');
      node.style.setProperty('background-size', 'cover', 'important');
      node.style.setProperty('background-position', 'center', 'important');
      node.style.setProperty('background-repeat', 'no-repeat', 'important');
    } else {
      const originalBackground = window[probeStateKey].original['background-image'];
      if (originalBackground.value) {
        node.style.setProperty('background-image', originalBackground.value, originalBackground.priority);
      } else {
        node.style.removeProperty('background-image');
      }
    }
    result.stateCaptured = true;
    result.after = snapshot(node);
    return result;
  })()`;
}

async function appendReport(filePath, entry) {
  let report = { schemaVersion: 1, history: [] };
  try {
    const existing = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (existing?.schemaVersion === 1 && Array.isArray(existing.history)) report = existing;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  report.history.push({ checkedAt: new Date().toISOString(), ...entry });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(report, null, 2), "utf8");
    await fs.rm(filePath, { force: true });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

const options = parseArgs(process.argv.slice(2));
const [version, state, targetList] = await Promise.all([
  fetchJson(options.port, "/json/version"),
  fs.readFile(options.stateFile, "utf8").then(JSON.parse),
  fetchJson(options.port, "/json/list"),
]);
validatedWsUrl(version.webSocketDebuggerUrl, options.port, "browser", options.browserId);
if (state?.port !== options.port || state?.browserId !== options.browserId ||
    !Array.isArray(state?.targets) || state.targets.length !== 1 || !Array.isArray(targetList)) {
  throw new Error("Recorded CDP session identity is inconsistent.");
}
const targetId = state.targets[0]?.targetId;
if (!IDENTIFIER.test(targetId ?? "")) throw new Error("Recorded renderer target ID is invalid.");
const matches = targetList.filter((item) => item?.id === targetId && item?.type === "page" &&
  typeof item.url === "string" && new URL(item.url).protocol === "app:" &&
  typeof item.webSocketDebuggerUrl === "string");
if (matches.length !== 1) throw new Error("Recorded renderer target is not uniquely available.");
const targetWs = validatedWsUrl(matches[0].webSocketDebuggerUrl, options.port, "page", targetId);
let testImageDataUrl = null;
let payloadStats = null;
if (options.mode === "C") {
  const tinySvg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="4" height="8" fill="#ff00ff"/><rect x="4" width="4" height="8" fill="#00ffff"/></svg>';
  const base64 = Buffer.from(tinySvg, "utf8").toString("base64");
  testImageDataUrl = `data:image/svg+xml;base64,${base64}`;
  payloadStats = { mimeType: "image/svg+xml", sourceBytes: Buffer.byteLength(tinySvg), base64Length: base64.length, dataUrlLength: testImageDataUrl.length };
} else if (options.mode === "D") {
  const imageName = options.themeMode === "Light" ? "forest-scholar-light.png" : "forest-scholar-dark.png";
  const image = await fs.readFile(path.join(options.root, "assets", imageName));
  const base64 = image.toString("base64");
  testImageDataUrl = `data:image/png;base64,${base64}`;
  payloadStats = {
    mimeType: "image/png",
    sourceBytes: image.length,
    base64Length: base64.length,
    dataUrlLength: testImageDataUrl.length,
    base64HasNewline: /[\r\n]/.test(base64),
    dataUrlHasQuote: /["']/.test(testImageDataUrl),
    dataUrlHasBackslash: /\\/.test(testImageDataUrl),
    base64LengthModulo4: base64.length % 4,
  };
}
const session = await new CdpSession(targetWs).open();
try {
  const result = await session.evaluate(buildProbeExpression(options.mode, testImageDataUrl));
  const outputPath = path.join(options.root, "runtime", "background-probe.json");
  await appendReport(outputPath, { ...result, payloadStats });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  session.close();
}
