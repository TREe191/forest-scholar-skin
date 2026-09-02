import fs from "node:fs/promises";
import path from "node:path";
import { calculateBackgroundLayout } from "./layout-engine.mjs";
import { loadThemePackage } from "./theme-loader.mjs";

const STYLE_ID = "forest-scholar-skin-style";
const LAYER_ID = "forest-scholar-skin-background";
const ROOT_ATTRIBUTE = "data-forest-scholar-app-root";
const STATE_KEY = "__FOREST_SCHOLAR_SKIN_STATE__";
const IDENTIFIER = /^[A-Za-z0-9._-]{1,200}$/;
const RENDERER_PROBE_COUNT = 2;
const RENDERER_PROBE_INTERVAL_MS = 250;
const INSTALL_MAX_ATTEMPTS = 10;
const INSTALL_VERIFY_DELAY_MS = 350;
const SELF_HEAL_DEBOUNCE_MS = 120;
const SELF_HEAL_MAX_REPAIRS = 12;
const DIAGNOSTIC_SIGNATURES = new Set();

function diagnosticOnce(event, details) {
  const message = `[diagnostic] ${event} ${JSON.stringify(details)}`;
  if (DIAGNOSTIC_SIGNATURES.has(message)) return;
  DIAGNOSTIC_SIGNATURES.add(message);
  process.stderr.write(`${message}\n`);
}

function parseArgs(argv) {
  const options = {
    port: null,
    browserId: null,
    root: null,
    themePackage: null,
    mode: "Dark",
    action: "watch",
    stateFile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--browser-id") options.browserId = argv[++index];
    else if (arg === "--root") options.root = argv[++index];
    else if (arg === "--theme-package") options.themePackage = argv[++index];
    else if (arg === "--mode") options.mode = argv[++index];
    else if (arg === "--state-file") options.stateFile = argv[++index];
    else if (arg === "--watch") options.action = "watch";
    else if (arg === "--remove") options.action = "remove";
    else if (arg === "--visibility-on") options.action = "visibility-on";
    else if (arg === "--visibility-off") options.action = "visibility-off";
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.port) || options.port < 49152 || options.port > 65535) {
    throw new Error("The CDP port must be a high port between 49152 and 65535.");
  }
  if (!IDENTIFIER.test(options.browserId ?? "")) throw new Error("Invalid browser ID.");
  if (!options.root) throw new Error("--root is required.");
  if (options.action === "watch" && !options.themePackage) throw new Error("--theme-package is required in watch mode.");
  if (!["Light", "Dark", "Auto"].includes(options.mode)) throw new Error("Mode must be Light, Dark, or Auto.");
  return options;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validatedWsUrl(value, port, kind, identifier = null) {
  const url = new URL(value);
  const expectedPath = identifier
    ? `/devtools/${kind}/${identifier}`
    : new RegExp(`^/devtools/${kind}/[A-Za-z0-9._-]{1,200}$`);
  const pathValid = typeof expectedPath === "string"
    ? url.pathname === expectedPath
    : expectedPath.test(url.pathname);

  if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1" || Number(url.port) !== port ||
      url.username || url.password || url.search || url.hash || !pathValid) {
    throw new Error("Rejected a CDP WebSocket URL outside the exact 127.0.0.1 endpoint.");
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

async function validateBrowserIdentity(port, expectedBrowserId) {
  const version = await fetchJson(port, "/json/version");
  const hasWebSocketDebuggerUrl = typeof version?.webSocketDebuggerUrl === "string" &&
    version.webSocketDebuggerUrl.length > 0;
  let wsUrl;
  try {
    wsUrl = validatedWsUrl(version?.webSocketDebuggerUrl, port, "browser");
  } catch (error) {
    diagnosticOnce("json-version", {
      endpointOk: true,
      hasWebSocketDebuggerUrl,
      webSocketAccepted: false,
      browserIdMatch: false,
    });
    throw error;
  }
  const browserId = new URL(wsUrl).pathname.split("/").at(-1);
  const browserIdMatch = browserId === expectedBrowserId;
  diagnosticOnce("json-version", {
    endpointOk: true,
    hasWebSocketDebuggerUrl,
    webSocketAccepted: true,
    browserIdMatch,
  });
  if (!browserIdMatch) throw new Error("CDP browser identity changed.");
  return { wsUrl, browserId, browser: String(version.Browser ?? "") };
}

function targetUrlScheme(value) {
  if (typeof value !== "string" || value.length === 0) return "missing";
  try { return new URL(value).protocol; }
  catch { return "invalid"; }
}

async function listPageTargets(port) {
  const items = await fetchJson(port, "/json/list");
  if (!Array.isArray(items)) throw new Error("CDP target list is not an array.");
  const targets = [];
  const diagnostics = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const type = typeof item?.type === "string" ? item.type : "missing";
    const scheme = targetUrlScheme(item?.url);
    const typeIsPage = type === "page";
    const urlIsString = typeof item?.url === "string";
    const schemeIsApp = scheme === "app:";
    const titleEmpty = typeof item?.title !== "string" || item.title.length === 0;
    const idValid = IDENTIFIER.test(item?.id ?? "");
    const hasWebSocketDebuggerUrl = typeof item?.webSocketDebuggerUrl === "string" &&
      item.webSocketDebuggerUrl.length > 0;
    let webSocketAccepted = false;
    let wsUrl = null;
    if (idValid && hasWebSocketDebuggerUrl) {
      try {
        wsUrl = validatedWsUrl(item.webSocketDebuggerUrl, port, "page", item.id);
        webSocketAccepted = true;
      } catch {
        // The diagnostic records rejection without recording the URL value.
      }
    }
    const accepted = typeIsPage && urlIsString && schemeIsApp && idValid &&
      hasWebSocketDebuggerUrl && webSocketAccepted;
    const rejectedAt = !typeIsPage ? "type" :
      !urlIsString ? "url-type" :
      !schemeIsApp ? "url-scheme" :
      !idValid ? "target-id" :
      !hasWebSocketDebuggerUrl ? "websocket-missing" :
      !webSocketAccepted ? "websocket-validation" : "none";
    diagnostics.push({
      index,
      type,
      urlScheme: scheme,
      titleEmpty,
      hasWebSocketDebuggerUrl,
      typeIsPage,
      urlIsString,
      schemeIsApp,
      idValid,
      webSocketAccepted,
      accepted,
      rejectedAt,
    });
    if (accepted) targets.push({ id: item.id, url: item.url, wsUrl, diagnosticIndex: index });
  }
  diagnosticOnce("json-list", { endpointOk: true, targetCount: items.length, targets: diagnostics });
  return targets;
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
  }

  async open() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP WebSocket open timed out.")), 5000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP WebSocket open failed.")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => this.onMessage(event));
    this.ws.addEventListener("close", () => this.close());
    this.ws.addEventListener("error", () => this.close());
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    return this;
  }

  onMessage(event) {
    let message;
    try { message = JSON.parse(String(event.data)); }
    catch { this.close(); return; }
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
    else pending.resolve(message.result);
  }

  send(method, params = {}) {
    if (this.closed || !this.ws) return Promise.reject(new Error("CDP session is closed."));
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
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result?.value;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("CDP session closed."));
    }
    this.pending.clear();
    try { this.ws?.close(); } catch { }
  }
}

async function probeCodexRenderer(session) {
  return session.evaluate(`(() => ({
    protocolIsApp: location.protocol === 'app:',
    shell: Boolean(document.querySelector('main.main-surface')),
    sidebar: Boolean(document.querySelector('aside.app-shell-left-panel')),
    composer: Boolean(document.querySelector('.composer-surface-chrome')),
    mainRole: Boolean(document.querySelector('[role="main"]'))
  }))()`);
}

function rendererIsCodex(probe) {
  return Boolean(probe?.protocolIsApp && probe.sidebar && (probe.mainRole || probe.composer));
}

function buildInstallExpression(payload, waitForShell) {
  const serialized = JSON.stringify(payload);
  const calculateLayoutSource = calculateBackgroundLayout.toString();
  return `(() => {
    const payload = ${serialized};
    const calculateBackgroundLayout = ${calculateLayoutSource};
    const styleId = ${JSON.stringify(STYLE_ID)};
    const layerId = ${JSON.stringify(LAYER_ID)};
    const rootAttribute = ${JSON.stringify(ROOT_ATTRIBUTE)};
    const stateKey = ${JSON.stringify(STATE_KEY)};
    let observer = null;
    let timeout = null;
    const stopWaiting = () => {
      if (observer) observer.disconnect();
      observer = null;
      if (timeout) clearTimeout(timeout);
      timeout = null;
    };
    const install = () => {
      const sidebar = document.querySelector('aside.app-shell-left-panel');
      const mainRole = document.querySelector('[role="main"]');
      const composer = document.querySelector('.composer-surface-chrome');
      if (!document.documentElement || !document.body || !sidebar || (!mainRole && !composer)) return false;
      stopWaiting();
      try { window[stateKey]?.cleanup?.(); } catch {}
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = payload.css;
      document.head.appendChild(style);
      const layer = document.createElement('div');
      layer.id = layerId;
      layer.setAttribute('aria-hidden', 'true');
      layer.setAttribute('role', 'presentation');
      layer.style.backgroundRepeat = 'no-repeat';
      document.body.insertBefore(layer, document.body.firstChild);

      const findAppRoot = () => Array.from(document.body?.children || []).find((node) => node.id !== layerId) || null;
      let appRoot = findAppRoot();
      if (appRoot) appRoot.setAttribute(rootAttribute, 'true');
      const dataAttributes = ['data-theme', 'data-color-mode', 'data-appearance'];
      const modeFromValue = (value) => {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'dark' || normalized.endsWith('-dark')) return 'Dark';
        if (normalized === 'light' || normalized.endsWith('-light')) return 'Light';
        return null;
      };
      const signalRoots = () => [...new Set([document.documentElement, document.body, appRoot].filter(Boolean))];
      const detectMode = () => {
        for (const root of signalRoots()) {
          if (root.classList?.contains('electron-dark')) return { mode: 'Dark', signal: 'class:electron-dark' };
          if (root.classList?.contains('electron-light')) return { mode: 'Light', signal: 'class:electron-light' };
        }
        for (const root of signalRoots()) {
          for (const attribute of dataAttributes) {
            const mode = modeFromValue(root.getAttribute?.(attribute));
            if (mode) return { mode, signal: 'attribute:' + attribute };
          }
        }
        for (const root of signalRoots()) {
          const colorScheme = getComputedStyle(root).colorScheme.toLowerCase().split(/\\s+/);
          if (colorScheme.includes('dark') && !colorScheme.includes('light')) return { mode: 'Dark', signal: 'color-scheme' };
          if (colorScheme.includes('light') && !colorScheme.includes('dark')) return { mode: 'Light', signal: 'color-scheme' };
        }
        const nativeSurface = document.querySelector('main[class*="MainContentSurface"]');
        if (nativeSurface) {
          const match = getComputedStyle(nativeSurface).backgroundColor.match(/^rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/i);
          if (match) {
            const luminance = (Number(match[1]) * 299 + Number(match[2]) * 587 + Number(match[3]) * 114) / 1000;
            return { mode: luminance < 145 ? 'Dark' : 'Light', signal: 'surface-background-fallback' };
          }
        }
        return null;
      };

      let currentMode = null;
      let currentSignal = null;
      let lastViewportWidth = null;
      let lastViewportHeight = null;
      let lastLayout = null;
      let layoutFrame = null;
      let resizeObserver = null;
      let resizeFallback = null;
      const applyLayout = (force = false) => {
        if (!currentMode || !payload.layouts[currentMode] || !payload.images[currentMode]) return false;
        const viewportWidth = document.documentElement?.clientWidth || window.innerWidth;
        const viewportHeight = document.documentElement?.clientHeight || window.innerHeight;
        if (!(viewportWidth > 0 && viewportHeight > 0)) return false;
        if (!force && viewportWidth === lastViewportWidth && viewportHeight === lastViewportHeight) return false;
        const image = payload.images[currentMode];
        const result = calculateBackgroundLayout(
          { width: image.width, height: image.height },
          { width: viewportWidth, height: viewportHeight },
          payload.layouts[currentMode]
        );
        layer.style.backgroundSize = result.renderedWidth.toFixed(3) + 'px ' + result.renderedHeight.toFixed(3) + 'px';
        layer.style.backgroundPosition = result.offsetX.toFixed(3) + 'px ' + result.offsetY.toFixed(3) + 'px';
        lastViewportWidth = viewportWidth;
        lastViewportHeight = viewportHeight;
        lastLayout = result;
        return true;
      };
      const applyMode = (targetMode, signal) => {
        if (!payload.images[targetMode]) return false;
        const targetClass = 'forest-scholar-' + targetMode.toLowerCase();
        const otherClass = targetMode === 'Dark' ? 'forest-scholar-light' : 'forest-scholar-dark';
        const targetImage = 'url("' + payload.images[targetMode].dataUrl + '")';
        const alreadyApplied = currentMode === targetMode &&
          document.documentElement.classList.contains('forest-scholar-skin') &&
          document.documentElement.classList.contains(targetClass) &&
          !document.documentElement.classList.contains(otherClass) &&
          layer.style.backgroundImage === targetImage;
        if (alreadyApplied) {
          currentSignal = signal || currentSignal;
          return false;
        }
        document.documentElement.classList.remove('forest-scholar-light', 'forest-scholar-dark');
        document.documentElement.classList.add('forest-scholar-skin', targetClass);
        layer.style.backgroundImage = targetImage;
        currentMode = targetMode;
        currentSignal = signal;
        applyLayout(true);
        return true;
      };

      const detectedAtInstall = detectMode();
      const initialMode = payload.mode === 'Auto' ? (detectedAtInstall?.mode || 'Dark') : payload.mode;
      applyMode(initialMode, payload.mode === 'Auto' ? (detectedAtInstall?.signal || 'auto-fallback') : 'manual-initial');

      let disposed = false;
      let repairTimer = null;
      let scheduledReason = null;
      let themeObserver = null;
      let integrityObserver = null;
      let layerObserver = null;
      const scheduleLayout = () => {
        if (disposed) return;
        const viewportWidth = document.documentElement?.clientWidth || window.innerWidth;
        const viewportHeight = document.documentElement?.clientHeight || window.innerHeight;
        if (viewportWidth === lastViewportWidth && viewportHeight === lastViewportHeight) return;
        if (layoutFrame != null) return;
        layoutFrame = requestAnimationFrame(() => {
          layoutFrame = null;
          applyLayout(false);
        });
      };
      const repairCounts = { cycles: 0, layer: 0, style: 0, rootClass: 0, backgroundImage: 0, appRoot: 0 };
      let lastRepairAt = null;
      let lastRepairReason = null;
      let selfHealSuppressed = false;

      const refreshThemeObservation = () => {
        if (!themeObserver || disposed) return;
        themeObserver.disconnect();
        for (const root of signalRoots()) {
          themeObserver.observe(root, {
            attributes: true,
            attributeFilter: ['class', 'data-theme', 'data-color-mode', 'data-appearance', 'style']
          });
        }
      };

      const reconcile = (reason) => {
        if (disposed || !document.documentElement || !document.head || !document.body) return false;
        const repaired = [];
        if (!style.isConnected) {
          document.head.appendChild(style);
          repairCounts.style += 1;
          repaired.push('style');
        }
        if (!layer.isConnected) {
          document.body.insertBefore(layer, document.body.firstChild);
          repairCounts.layer += 1;
          repaired.push('background-layer');
        }

        const nextAppRoot = findAppRoot();
        if (nextAppRoot !== appRoot || (nextAppRoot && !nextAppRoot.hasAttribute(rootAttribute))) {
          document.querySelectorAll('[' + rootAttribute + ']').forEach((node) => {
            if (node !== nextAppRoot) node.removeAttribute(rootAttribute);
          });
          appRoot = nextAppRoot;
          if (appRoot) appRoot.setAttribute(rootAttribute, 'true');
          repairCounts.appRoot += 1;
          repaired.push('app-root');
          refreshThemeObservation();
        }

        const detected = payload.mode === 'Auto' ? detectMode() : null;
        const targetMode = payload.mode === 'Auto' ? (detected?.mode || currentMode || initialMode) : payload.mode;
        const targetClass = 'forest-scholar-' + targetMode.toLowerCase();
        const otherClass = targetMode === 'Dark' ? 'forest-scholar-light' : 'forest-scholar-dark';
        const targetImage = 'url("' + payload.images[targetMode].dataUrl + '")';
        const rootClassMissing = currentMode === targetMode && (!document.documentElement.classList.contains('forest-scholar-skin') ||
          !document.documentElement.classList.contains(targetClass) || document.documentElement.classList.contains(otherClass));
        const backgroundImageMissing = currentMode === targetMode && layer.style.backgroundImage !== targetImage;
        applyMode(targetMode, detected?.signal || (payload.mode === 'Auto' ? currentSignal : 'manual-override') || 'self-heal-fallback');
        if (rootClassMissing) {
          repairCounts.rootClass += 1;
          repaired.push('root-class');
        }
        if (backgroundImageMissing) {
          repairCounts.backgroundImage += 1;
          repaired.push('background-image');
        }

        if (repaired.length > 0) {
          repairCounts.cycles += 1;
          lastRepairAt = new Date().toISOString();
          lastRepairReason = reason + ':' + repaired.join(',');
          return true;
        }
        return false;
      };

      const scheduleReconcile = (reason) => {
        if (disposed || selfHealSuppressed) return;
        if (repairCounts.cycles >= ${SELF_HEAL_MAX_REPAIRS}) {
          selfHealSuppressed = true;
          return;
        }
        scheduledReason = scheduledReason || reason;
        if (repairTimer) return;
        repairTimer = setTimeout(() => {
          repairTimer = null;
          const reasonToUse = scheduledReason || 'observer';
          scheduledReason = null;
          reconcile(reasonToUse);
        }, ${SELF_HEAL_DEBOUNCE_MS});
      };

      themeObserver = new MutationObserver(() => scheduleReconcile('theme-or-root-class'));
      refreshThemeObservation();
      integrityObserver = new MutationObserver((records) => {
        if (!layer.isConnected || !style.isConnected || (appRoot && !appRoot.isConnected)) {
          scheduleReconcile('dom-rebuild');
          return;
        }
        for (const record of records) {
          for (const removed of record.removedNodes) {
            if (removed === layer || removed === style || removed === appRoot || removed.contains?.(layer) || removed.contains?.(style) || removed.contains?.(appRoot)) {
              scheduleReconcile('dom-removal');
              return;
            }
          }
        }
      });
      integrityObserver.observe(document.documentElement, { childList: true, subtree: true });
      layerObserver = new MutationObserver(() => {
        if (currentMode && layer.style.backgroundImage !== 'url("' + payload.images[currentMode].dataUrl + '")') {
          scheduleReconcile('background-style');
        }
      });
      layerObserver.observe(layer, { attributes: true, attributeFilter: ['style'] });
      if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(scheduleLayout);
        resizeObserver.observe(document.documentElement);
      } else {
        resizeFallback = scheduleLayout;
        window.addEventListener('resize', resizeFallback, { passive: true });
      }

      const cleanup = () => {
        disposed = true;
        if (repairTimer) clearTimeout(repairTimer);
        repairTimer = null;
        themeObserver?.disconnect();
        integrityObserver?.disconnect();
        layerObserver?.disconnect();
        resizeObserver?.disconnect();
        if (resizeFallback) window.removeEventListener('resize', resizeFallback);
        if (layoutFrame != null) cancelAnimationFrame(layoutFrame);
        layoutFrame = null;
        document.getElementById(styleId)?.remove();
        document.getElementById(layerId)?.remove();
        document.querySelectorAll('[' + rootAttribute + ']').forEach((node) => node.removeAttribute(rootAttribute));
        document.documentElement?.classList.remove('forest-scholar-skin', 'forest-scholar-light', 'forest-scholar-dark');
        delete window[stateKey];
        return true;
      };
      const getStatus = () => ({
        activeMode: currentMode,
        detectionSignal: currentSignal,
        repairCounts: { ...repairCounts },
        lastRepairAt,
        lastRepairReason,
        selfHealSuppressed,
        layout: lastLayout ? {
          mode: lastLayout.mode,
          viewportWidth: lastViewportWidth,
          viewportHeight: lastViewportHeight,
          renderedWidth: lastLayout.renderedWidth,
          renderedHeight: lastLayout.renderedHeight,
          offsetX: lastLayout.offsetX,
          offsetY: lastLayout.offsetY,
          focalVisibleRatio: lastLayout.focal.visibleRatio,
          constraintSatisfied: lastLayout.constraintSatisfied
        } : null
      });
      window[stateKey] = {
        version: 4,
        launchMode: payload.mode,
        theme: { ...payload.theme },
        getMode: () => currentMode,
        getStatus,
        cleanup
      };
      const computedBackgroundImage = getComputedStyle(layer).backgroundImage;
      return {
        installed: true,
        activeMode: currentMode,
        detectionSignal: currentSignal,
        backgroundImageIsNone: computedBackgroundImage === 'none',
        backgroundImageIsDataImage: /^url\\(["']?data:image\\//i.test(computedBackgroundImage),
        backgroundImageLength: computedBackgroundImage.length,
        backgroundImageHasBase64Marker: computedBackgroundImage.includes('base64,'),
        backgroundSize: getComputedStyle(layer).backgroundSize,
        backgroundPosition: getComputedStyle(layer).backgroundPosition,
        backgroundRepeat: getComputedStyle(layer).backgroundRepeat,
        repairCounts: { ...repairCounts }
      };
    };
    const installed = install();
    if (installed) return installed;
    if (!${waitForShell ? "true" : "false"}) return false;
    if (typeof MutationObserver === 'function' && document.documentElement) {
      observer = new MutationObserver(install);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    timeout = setTimeout(stopWaiting, 15000);
    return true;
  })()`;
}

function buildVerifyInstallExpression() {
  return `(() => {
    const state = window[${JSON.stringify(STATE_KEY)}];
    const activeMode = state?.getMode?.() || null;
    const expectedClass = activeMode === 'Light' ? 'forest-scholar-light' : activeMode === 'Dark' ? 'forest-scholar-dark' : null;
    const otherClass = activeMode === 'Light' ? 'forest-scholar-dark' : activeMode === 'Dark' ? 'forest-scholar-light' : null;
    const html = document.documentElement;
    const style = document.getElementById(${JSON.stringify(STYLE_ID)});
    const layer = document.getElementById(${JSON.stringify(LAYER_ID)});
    const computed = layer ? getComputedStyle(layer) : null;
    const rect = layer ? layer.getBoundingClientRect() : null;
    const htmlHasSkin = Boolean(html?.classList.contains('forest-scholar-skin'));
    const modeClassCorrect = Boolean(expectedClass && html?.classList.contains(expectedClass) && !html?.classList.contains(otherClass));
    const backgroundImagePresent = Boolean(computed && computed.backgroundImage !== 'none');
    const backgroundImageIsDataImage = Boolean(computed && /^url\\(["']?data:image\\//i.test(computed.backgroundImage));
    const backgroundLayerSized = Boolean(rect && rect.width > 0 && rect.height > 0);
    const ready = Boolean(state && style?.isConnected && layer?.isConnected && htmlHasSkin && modeClassCorrect &&
      backgroundImagePresent && backgroundImageIsDataImage && backgroundLayerSized);
    return {
      ready,
      statePresent: Boolean(state),
      stylePresent: Boolean(style?.isConnected),
      layerPresent: Boolean(layer?.isConnected),
      htmlHasSkin,
      activeMode,
      modeClassCorrect,
      backgroundImagePresent,
      backgroundImageIsDataImage,
      backgroundLayerSized,
      widthPositive: Boolean(rect && rect.width > 0),
      heightPositive: Boolean(rect && rect.height > 0),
      status: state?.getStatus?.() || null
    };
  })()`;
}

function buildRemoveExpression() {
  return `(() => {
    const stateKey = ${JSON.stringify(STATE_KEY)};
    try { window[stateKey]?.cleanup?.(); } catch {}
    document.getElementById(${JSON.stringify(STYLE_ID)})?.remove();
    document.getElementById(${JSON.stringify(LAYER_ID)})?.remove();
    document.querySelectorAll('[${ROOT_ATTRIBUTE}]').forEach((node) => node.removeAttribute(${JSON.stringify(ROOT_ATTRIBUTE)}));
    document.documentElement?.classList.remove('forest-scholar-skin', 'forest-scholar-light', 'forest-scholar-dark');
    delete window[stateKey];
    return true;
  })()`;
}

function buildVerifyRemovedExpression() {
  return `(() => Boolean(
    !document.getElementById(${JSON.stringify(STYLE_ID)}) &&
    !document.getElementById(${JSON.stringify(LAYER_ID)}) &&
    !document.documentElement?.classList.contains('forest-scholar-skin') &&
    !window[${JSON.stringify(STATE_KEY)}]
  ))()`;
}

function buildVisibilityOnExpression() {
  return `(() => {
    const diagnosticStyleId = 'forest-scholar-visibility-test-style';
    const diagnosticMarkerId = 'forest-scholar-visibility-test-marker';
    document.getElementById(diagnosticStyleId)?.remove();
    document.getElementById(diagnosticMarkerId)?.remove();
    if (!document.documentElement || !document.head || !document.body) return { documentReady: false };
    const style = document.createElement('style');
    style.id = diagnosticStyleId;
    style.textContent = '#' + diagnosticMarkerId + '{position:fixed!important;inset:0!important;border:6px solid #ff00ff!important;box-sizing:border-box!important;z-index:2147483647!important;pointer-events:none!important;user-select:none!important;background:transparent!important;}';
    document.head.appendChild(style);
    const marker = document.createElement('div');
    marker.id = diagnosticMarkerId;
    marker.setAttribute('aria-hidden', 'true');
    marker.setAttribute('role', 'presentation');
    document.body.appendChild(marker);
    const formalStyle = document.getElementById(${JSON.stringify(STYLE_ID)});
    const formalBackground = document.getElementById(${JSON.stringify(LAYER_ID)});
    const computed = formalBackground ? getComputedStyle(formalBackground) : null;
    const rect = formalBackground ? formalBackground.getBoundingClientRect() : null;
    return {
      documentReady: true,
      protocolIsApp: location.protocol === 'app:',
      formalStyleExists: Boolean(formalStyle),
      formalBackgroundExists: Boolean(formalBackground),
      diagnosticStyleExists: Boolean(document.getElementById(diagnosticStyleId)),
      diagnosticMarkerExists: Boolean(document.getElementById(diagnosticMarkerId)),
      formalBackground: computed && rect ? {
        position: computed.position,
        top: computed.top,
        right: computed.right,
        bottom: computed.bottom,
        left: computed.left,
        zIndex: computed.zIndex,
        pointerEvents: computed.pointerEvents,
        opacity: computed.opacity,
        display: computed.display,
        visibility: computed.visibility,
        backgroundImagePresent: computed.backgroundImage !== 'none',
        backgroundImageIsLocalData: computed.backgroundImage.startsWith('url("data:image/png;base64,'),
        widthPositive: rect.width > 0,
        heightPositive: rect.height > 0
      } : null
    };
  })()`;
}

function buildVisibilityOffExpression() {
  return `(() => {
    document.getElementById('forest-scholar-visibility-test-marker')?.remove();
    document.getElementById('forest-scholar-visibility-test-style')?.remove();
    return Boolean(
      !document.getElementById('forest-scholar-visibility-test-marker') &&
      !document.getElementById('forest-scholar-visibility-test-style')
    );
  })()`;
}

async function loadPayload(root, themePackage, mode) {
  const realRoot = await fs.realpath(root);
  const theme = await loadThemePackage(themePackage);
  const encodeImage = (background) => {
    const base64 = background.bytes.toString("base64");
    const dataUrl = `data:${background.mimeType};base64,${base64}`;
    return {
      dataUrl,
      width: background.width,
      height: background.height,
      stats: {
        sourceBytes: background.bytes.length,
        width: background.width,
        height: background.height,
        base64Length: base64.length,
        dataUrlLength: dataUrl.length,
        mimeType: background.mimeType,
        base64HasNewline: /[\r\n]/.test(base64),
        dataUrlHasQuote: /["']/.test(dataUrl),
        dataUrlHasBackslash: /\\/.test(dataUrl),
        base64LengthModulo4: base64.length % 4,
        base64HasPadding: base64.endsWith("="),
      },
    };
  };
  const [baseCss, compatibilityCss] = await Promise.all([
    fs.readFile(path.join(realRoot, "styles", "base.css"), "utf8"),
    fs.readFile(path.join(realRoot, "styles", "codex-compat.css"), "utf8"),
  ]);
  const light = encodeImage(theme.variants.light.background);
  const dark = encodeImage(theme.variants.dark.background);
  return {
    theme: {
      id: theme.manifest.id,
      name: theme.manifest.name,
      version: theme.manifest.version,
    },
    css: [baseCss, compatibilityCss, ...theme.styles.map((style) => style.content)].join("\n\n"),
    images: {
      Light: { dataUrl: light.dataUrl, width: light.width, height: light.height },
      Dark: { dataUrl: dark.dataUrl, width: dark.width, height: dark.height },
    },
    layouts: {
      Light: theme.variants.light.layoutConfig,
      Dark: theme.variants.dark.layoutConfig,
    },
    imageStats: {
      Light: light.stats,
      Dark: dark.stats,
    },
    mode,
  };
}

async function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8");
    await fs.rm(filePath, { force: true });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function readJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

async function confirmRendererTarget(target) {
  const session = await new CdpSession(target.wsUrl).open();
  try {
    for (let attempt = 1; attempt <= RENDERER_PROBE_COUNT; attempt += 1) {
      const probe = await probeCodexRenderer(session);
      const accepted = rendererIsCodex(probe);
      diagnosticOnce("renderer-probe", {
        targetIndex: target.diagnosticIndex,
        confirmationAttempt: attempt,
        protocolIsApp: Boolean(probe?.protocolIsApp),
        shell: Boolean(probe?.shell),
        sidebar: Boolean(probe?.sidebar),
        composer: Boolean(probe?.composer),
        mainRole: Boolean(probe?.mainRole),
        accepted,
      });
      if (!accepted) { session.close(); return null; }
      if (attempt < RENDERER_PROBE_COUNT) await sleep(RENDERER_PROBE_INTERVAL_MS);
    }
    return { target, session };
  } catch (error) {
    session.close();
    throw error;
  }
}

async function installIntoConfirmedTarget(confirmed, payload) {
  const { session } = confirmed;
  let scriptIdentifier = null;
  const attachedAt = new Date().toISOString();
  let firstInstallAt = null;
  try {
    const early = await session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: buildInstallExpression(payload, true),
    });
    scriptIdentifier = early.identifier ?? null;
    diagnosticOnce("renderer-attached", {
      attachedAt,
      targetIndex: confirmed.target.diagnosticIndex,
      earlyDocumentScriptRegistered: Boolean(scriptIdentifier),
    });

    let installed = null;
    let verification = null;
    let verificationAttempts = 0;
    for (let attempt = 1; attempt <= INSTALL_MAX_ATTEMPTS; attempt += 1) {
      verificationAttempts = attempt;
      if (!firstInstallAt) {
        firstInstallAt = new Date().toISOString();
        diagnosticOnce("install-start", {
          firstInstallAt,
          targetIndex: confirmed.target.diagnosticIndex,
        });
      }
      installed = await session.evaluate(buildInstallExpression(payload, false));
      await sleep(INSTALL_VERIFY_DELAY_MS);
      verification = await session.evaluate(buildVerifyInstallExpression());
      diagnosticOnce("install-verification", {
        attempt,
        checkedAt: new Date().toISOString(),
        pass: Boolean(verification?.ready),
        statePresent: Boolean(verification?.statePresent),
        stylePresent: Boolean(verification?.stylePresent),
        layerPresent: Boolean(verification?.layerPresent),
        htmlHasSkin: Boolean(verification?.htmlHasSkin),
        activeMode: verification?.activeMode ?? null,
        modeClassCorrect: Boolean(verification?.modeClassCorrect),
        backgroundImagePresent: Boolean(verification?.backgroundImagePresent),
        backgroundImageIsDataImage: Boolean(verification?.backgroundImageIsDataImage),
        backgroundLayerSized: Boolean(verification?.backgroundLayerSized),
        repairCounts: verification?.status?.repairCounts ?? null,
      });
      if (verification?.ready) break;
      if (attempt < INSTALL_MAX_ATTEMPTS) {
        diagnosticOnce("install-retry", {
          retry: attempt,
          retryAfterMs: INSTALL_VERIFY_DELAY_MS,
          sameVerifiedRenderer: true,
        });
        await sleep(INSTALL_VERIFY_DELAY_MS);
      }
    }

    if (!verification?.ready) {
      throw new Error(`Forest Scholar DOM verification failed after ${INSTALL_MAX_ATTEMPTS} attempts on the confirmed renderer.`);
    }

    const activeStats = payload.imageStats[verification.activeMode] ?? null;
    diagnosticOnce("background-binding", {
      launchMode: payload.mode,
      activeMode: verification.activeMode,
      detectionSignal: verification?.status?.detectionSignal ?? installed?.detectionSignal ?? null,
      imageStats: activeStats,
      runtime: installed && typeof installed === "object" ? installed : { installed: false },
      runtimeLengthMatchesExpected: Boolean(activeStats) && installed?.backgroundImageLength === activeStats.dataUrlLength + 7,
      assignment: "element.style.backgroundImage",
      backgroundShorthandUsed: false,
      laterResetInInstallPath: false,
    });
    const readyAt = new Date().toISOString();
    diagnosticOnce("renderer-ready", {
      readyAt,
      verificationAttempts,
      selfHealOccurred: Number(verification?.status?.repairCounts?.cycles ?? 0) > 0,
      repairCounts: verification?.status?.repairCounts ?? null,
    });
    return {
      session,
      scriptIdentifier,
      activeMode: verification.activeMode,
      attachedAt,
      firstInstallAt,
      readyAt,
      verificationAttempts,
      repairCounts: verification?.status?.repairCounts ?? null,
    };
  } catch (error) {
    if (scriptIdentifier) {
      await session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptIdentifier }).catch(() => {});
    }
    session.close();
    throw error;
  }
}

async function removeFromTargets(options) {
  await validateBrowserIdentity(options.port, options.browserId);
  const savedState = options.stateFile ? await readJson(options.stateFile) : null;
  const savedIdentifiers = new Map((savedState?.targets ?? []).map((item) => [item.targetId, item.scriptIdentifier]));
  const targets = await listPageTargets(options.port);
  let qualified = 0;
  for (const target of targets) {
    const confirmed = await confirmRendererTarget(target);
    if (!confirmed) continue;
    const { session } = confirmed;
    try {
      qualified += 1;
      const identifier = savedIdentifiers.get(target.id);
      if (identifier) {
        await session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }).catch(() => {});
      }
      await session.evaluate(buildRemoveExpression());
      const removed = await session.evaluate(buildVerifyRemovedExpression());
      if (!removed) throw new Error(`Theme cleanup verification failed for target ${target.id}.`);
    } finally {
      session.close();
    }
  }
  if (targets.length > 0 && qualified === 0) throw new Error("No CDP page matched the expected Codex renderer structure.");
  return qualified;
}

async function getRecordedRendererTarget(options) {
  await validateBrowserIdentity(options.port, options.browserId);
  if (!options.stateFile) throw new Error("--state-file is required for visibility diagnostics.");
  const savedState = await readJson(options.stateFile);
  if (!savedState || savedState.port !== options.port || savedState.browserId !== options.browserId ||
      !Array.isArray(savedState.targets) || savedState.targets.length !== 1) {
    throw new Error("Visibility diagnostics require exactly one recorded renderer target from this CDP session.");
  }
  const targetId = savedState.targets[0]?.targetId;
  if (!IDENTIFIER.test(targetId ?? "")) throw new Error("The recorded renderer target ID is invalid.");
  const targets = await listPageTargets(options.port);
  const matches = targets.filter((target) => target.id === targetId);
  if (matches.length !== 1) throw new Error("The recorded renderer target is not uniquely available.");
  return matches[0];
}

async function setVisibilityDiagnostic(options, enabled) {
  const target = await getRecordedRendererTarget(options);
  const resultPath = path.join(options.root, "runtime", "visibility-test.json");
  if (enabled) {
    const confirmed = await confirmRendererTarget(target);
    if (!confirmed) throw new Error("The recorded target no longer passes the stable renderer probe.");
    try {
      const result = await confirmed.session.evaluate(buildVisibilityOnExpression());
      if (!result?.documentReady || !result?.diagnosticStyleExists || !result?.diagnosticMarkerExists) {
        throw new Error("The visibility marker DOM verification failed.");
      }
      await writeJsonAtomic(resultPath, {
        schemaVersion: 1,
        enabled: true,
        checkedAt: new Date().toISOString(),
        result,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } finally {
      confirmed.session.close();
    }
    return;
  }

  const session = await new CdpSession(target.wsUrl).open();
  try {
    const removed = await session.evaluate(buildVisibilityOffExpression());
    if (!removed) throw new Error("The visibility marker cleanup verification failed.");
    await fs.rm(resultPath, { force: true });
    process.stdout.write("Forest Scholar visibility marker removed.\n");
  } finally {
    session.close();
  }
}

async function watchAndInject(options) {
  const identity = await validateBrowserIdentity(options.port, options.browserId);
  const anchor = new WebSocket(identity.wsUrl);
  let anchorClosed = false;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Browser identity anchor timed out.")), 5000);
    anchor.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    anchor.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Browser identity anchor failed.")); }, { once: true });
  });
  anchor.addEventListener("close", () => { anchorClosed = true; });
  anchor.addEventListener("error", () => { anchorClosed = true; });

  const payload = await loadPayload(options.root, options.themePackage, options.mode);
  const runtimeDir = path.join(options.root, "runtime");
  const injectionStatePath = options.stateFile ?? path.join(runtimeDir, "injection-state.json");
  const readyPath = path.join(runtimeDir, "ready.json");
  const stopPath = path.join(runtimeDir, "stop.request");
  const attached = new Map();
  let readyWritten = false;

  try {
    while (!anchorClosed) {
      try {
        await fs.access(stopPath);
        await fs.rm(stopPath, { force: true });
        break;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }

      await validateBrowserIdentity(options.port, options.browserId);
      const targets = await listPageTargets(options.port);
      for (const [targetId, value] of attached) {
        if (value.session.closed) attached.delete(targetId);
      }

      if (attached.size === 0) {
        const confirmedTargets = [];
        for (const target of targets) {
          try {
            const confirmed = await confirmRendererTarget(target);
            if (confirmed) confirmedTargets.push(confirmed);
          } catch {
            diagnosticOnce("target-error", {
              targetIndex: target.diagnosticIndex,
              stage: "websocket-or-probe",
              failed: true,
            });
          }
        }

        if (confirmedTargets.length === 1) {
          const confirmed = confirmedTargets[0];
          try {
            const applied = await installIntoConfirmedTarget(confirmed, payload);
            attached.set(confirmed.target.id, applied);
          } catch (error) {
            diagnosticOnce("target-error", {
              targetIndex: confirmed.target.diagnosticIndex,
              stage: "install-after-confirmation",
              failed: true,
              reason: String(error?.message || "unknown-install-error"),
            });
            throw error;
          }
        } else {
          for (const confirmed of confirmedTargets) confirmed.session.close();
          if (confirmedTargets.length > 1) {
            diagnosticOnce("renderer-selection", {
              stableCandidateCount: confirmedTargets.length,
              accepted: false,
              reason: "multiple-stable-candidates",
            });
          }
        }
      }

      if (attached.size > 0) {
        const state = {
          schemaVersion: 2,
          port: options.port,
          browserId: options.browserId,
          mode: options.mode,
          theme: { ...payload.theme },
          injectorPid: process.pid,
          nodePath: process.execPath,
          targets: [...attached].map(([targetId, value]) => ({
            targetId,
            scriptIdentifier: value.scriptIdentifier,
            activeMode: value.activeMode,
            attachedAt: value.attachedAt,
            firstInstallAt: value.firstInstallAt,
            readyAt: value.readyAt,
            verificationAttempts: value.verificationAttempts,
            repairCountsAtReady: value.repairCounts,
          })),
          updatedAt: new Date().toISOString(),
        };
        await writeJsonAtomic(injectionStatePath, state);
        if (!readyWritten) {
          await writeJsonAtomic(readyPath, state);
          readyWritten = true;
          diagnosticOnce("ready-written", {
            readyAt: state.targets[0]?.readyAt ?? state.updatedAt,
            targetCount: attached.size,
            verificationAttempts: state.targets[0]?.verificationAttempts ?? null,
            selfHealOccurredBeforeReady: Number(state.targets[0]?.repairCountsAtReady?.cycles ?? 0) > 0,
            repairCountsAtReady: state.targets[0]?.repairCountsAtReady ?? null,
          });
          process.stdout.write(`Forest Scholar Skin ${options.mode} applied to ${attached.size} renderer target(s).\n`);
        }
      }
      await sleep(750);
    }
  } finally {
    for (const value of attached.values()) value.session.close();
    try { anchor.close(); } catch { }
  }
}

const options = parseArgs(process.argv.slice(2));
if (options.action === "remove") {
  const removed = await removeFromTargets(options);
  process.stdout.write(`Forest Scholar Skin removed from ${removed} renderer target(s).\n`);
} else if (options.action === "visibility-on") {
  await setVisibilityDiagnostic(options, true);
} else if (options.action === "visibility-off") {
  await setVisibilityDiagnostic(options, false);
} else {
  await watchAndInject(options);
}
