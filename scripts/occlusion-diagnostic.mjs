import fs from "node:fs/promises";
import path from "node:path";

const IDENTIFIER = /^[A-Za-z0-9._-]{1,200}$/;

function parseArgs(argv) {
  const options = { port: null, browserId: null, root: null, stateFile: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--browser-id") options.browserId = argv[++index];
    else if (arg === "--root") options.root = argv[++index];
    else if (arg === "--state-file") options.stateFile = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 49152 || options.port > 65535) {
    throw new Error("The CDP port must be a high port between 49152 and 65535.");
  }
  if (!IDENTIFIER.test(options.browserId ?? "")) throw new Error("Invalid browser ID.");
  if (!options.root || !options.stateFile) throw new Error("--root and --state-file are required.");
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
    if (result.exceptionDetails) throw new Error("The read-only DOM diagnostic failed in the renderer.");
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

function buildReportExpression() {
  return `(() => {
    const backgroundId = 'forest-scholar-skin-background';
    const background = document.getElementById(backgroundId);
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const main = document.querySelector('[role="main"]');
    const normalizeClassName = (element) => typeof element.className === 'string' ? element.className : '';
    const describe = (element) => {
      if (!element) return null;
      const tagName = element.tagName;
      const className = normalizeClassName(element);
      const role = element.getAttribute('role');
      const special = element.id === backgroundId ? '#' + backgroundId : '';
      return { tagName, className, role, special };
    };
    const alphaFromColor = (value) => {
      if (!value || value === 'transparent') return 0;
      const rgba = value.match(/^rgba?\\(([^)]+)\\)$/i);
      if (!rgba) return 1;
      const parts = rgba[1].split(',').map((part) => part.trim());
      return parts.length >= 4 ? Number(parts[3]) : 1;
    };
    const geometry = (rect) => ({
      x: Math.round(rect.x * 100) / 100,
      y: Math.round(rect.y * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
      right: Math.round(rect.right * 100) / 100,
      bottom: Math.round(rect.bottom * 100) / 100
    });
    const all = Array.from(document.querySelectorAll('*'));
    const records = [];
    for (const element of all) {
      const rect = element.getBoundingClientRect();
      const coversViewport = rect.width >= viewport.width * 0.60 && rect.height >= viewport.height * 0.60;
      const coversMain = Boolean(main && element.contains(main) && rect.width >= viewport.width * 0.35 && rect.height >= viewport.height * 0.60);
      if (element !== background && !coversViewport && !coversMain) continue;
      const computed = getComputedStyle(element);
      const backgroundAlpha = alphaFromColor(computed.backgroundColor);
      records.push({
        element,
        descriptor: describe(element),
        parentDescriptor: describe(element.parentElement),
        rect: geometry(rect),
        backgroundColor: computed.backgroundColor,
        backgroundAlpha,
        opacity: computed.opacity,
        position: computed.position,
        zIndex: computed.zIndex,
        display: computed.display,
        visibility: computed.visibility,
        coversViewport,
        coversMain,
        isBackgroundNode: element === background,
        opaqueBackground: backgroundAlpha >= 0.98 && Number(computed.opacity) >= 0.98,
        stackingByAllowedProperties: Number(computed.opacity) < 1 ||
          ((computed.position !== 'static') && computed.zIndex !== 'auto')
      });
    }

    const recordByElement = new Map(records.map((record, index) => [record.element, { record, index }]));
    const samples = [];
    for (const xRatio of [0.10, 0.30, 0.50, 0.70, 0.90]) {
      for (const yRatio of [0.10, 0.30, 0.50, 0.70, 0.90]) {
        const x = Math.max(0, Math.min(viewport.width - 1, viewport.width * xRatio));
        const y = Math.max(0, Math.min(viewport.height - 1, viewport.height * yRatio));
        samples.push(document.elementsFromPoint(x, y));
      }
    }

    for (const record of records) {
      let parent = record.element.parentElement;
      record.parentCandidateIndex = null;
      while (parent) {
        const parentRecord = recordByElement.get(parent);
        if (parentRecord) { record.parentCandidateIndex = parentRecord.index; break; }
        parent = parent.parentElement;
      }
      record.sampleCoverageCount = 0;
      record.sampleAboveBackgroundCount = 0;
      for (const stack of samples) {
        const elementIndex = stack.indexOf(record.element);
        if (elementIndex >= 0) record.sampleCoverageCount += 1;
        const backgroundIndex = background ? stack.indexOf(background) : -1;
        if (elementIndex >= 0 && backgroundIndex >= 0 && elementIndex < backgroundIndex) {
          record.sampleAboveBackgroundCount += 1;
        }
      }
    }

    const candidates = records.map((record, index) => ({
      index,
      ...record,
      element: undefined,
      sampleCount: samples.length
    }));
    const opaqueLarge = candidates
      .filter((record) => !record.isBackgroundNode && record.opaqueBackground &&
        record.display !== 'none' && record.visibility !== 'hidden' && record.sampleCoverageCount > 0)
      .sort((left, right) => right.sampleCoverageCount - left.sampleCoverageCount ||
        (right.rect.width * right.rect.height) - (left.rect.width * left.rect.height));
    return {
      viewport,
      backgroundFound: Boolean(background),
      backgroundCandidateIndex: candidates.findIndex((record) => record.isBackgroundNode),
      candidates,
      likelyOpaqueBlockers: opaqueLarge.map((record) => record.index)
    };
  })()`;
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8");
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
const browserWs = validatedWsUrl(version.webSocketDebuggerUrl, options.port, "browser", options.browserId);
if (!browserWs || state?.port !== options.port || state?.browserId !== options.browserId ||
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
const session = await new CdpSession(targetWs).open();
try {
  const report = await session.evaluate(buildReportExpression());
  const outputPath = path.join(options.root, "runtime", "occlusion-report.json");
  await writeJsonAtomic(outputPath, { schemaVersion: 1, checkedAt: new Date().toISOString(), ...report });
  process.stdout.write(`${outputPath}\n`);
} finally {
  session.close();
}
