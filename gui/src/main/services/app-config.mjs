import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isAppearance, isThemeId } from "../../shared/contracts.mjs";

const CONFIG_KEYS = Object.freeze(["schemaVersion", "activeTheme", "appearance"]);

export function validateAppConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Application configuration must be an object.");
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== CONFIG_KEYS.length || !CONFIG_KEYS.every((key) => keys.includes(key))) {
    throw new RangeError("Application configuration contains unsupported or missing properties.");
  }
  if (value.schemaVersion !== 1) throw new RangeError("Unsupported application configuration schemaVersion.");
  if (!isThemeId(value.activeTheme)) throw new RangeError("activeTheme is invalid.");
  if (!isAppearance(value.appearance)) throw new RangeError("appearance is invalid.");
  return Object.freeze({
    schemaVersion: 1,
    activeTheme: value.activeTheme,
    appearance: value.appearance,
  });
}

function parseConfig(text) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new SyntaxError("Application configuration is not valid JSON."); }
  return validateAppConfig(parsed);
}

export class AppConfigStore {
  #configPath;
  #fileSystem;
  #queue = Promise.resolve();

  constructor({ configPath, fileSystem = fs }) {
    if (!path.isAbsolute(configPath)) throw new TypeError("configPath must be absolute.");
    this.#configPath = configPath;
    this.#fileSystem = fileSystem;
  }

  async read() {
    return parseConfig(await this.#fileSystem.readFile(this.#configPath, "utf8"));
  }

  async readApplied() {
    try {
      const value = JSON.parse(await this.#fileSystem.readFile(path.join(path.dirname(this.#configPath), '.gui-applied.json'), 'utf8'));
      return value.schemaVersion === 1 && isThemeId(value.themeId) && isAppearance(value.appearance) &&
        /^[a-f0-9]{64}$/.test(value.contentRevision) ? value : null;
    } catch { return null; } // Unknown receipt never implies applied.
  }

  apply(selection, { themeExists, contentRevision }) {
    const operation = this.#queue.then(() => this.#applyInternal(selection, themeExists, contentRevision));
    this.#queue = operation.catch(() => undefined);
    return operation;
  }

  async #applyInternal(selection, themeExists, contentRevision) {
    if (contentRevision !== undefined && !/^[a-f0-9]{64}$/.test(contentRevision))
      throw new TypeError('Invalid content revision.');
    if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
      throw new TypeError("Apply request must be an object.");
    }
    const keys = Object.keys(selection).sort();
    if (keys.length !== 2 || !keys.includes("activeTheme") || !keys.includes("appearance")) {
      throw new RangeError("Apply may change only activeTheme and appearance.");
    }
    const next = validateAppConfig({
      schemaVersion: 1,
      activeTheme: selection.activeTheme,
      appearance: selection.appearance,
    });
    if (typeof themeExists !== "function" || !themeExists(next.activeTheme)) {
      throw new RangeError("The selected theme is not a valid loaded Theme Package.");
    }

    const oldText = await this.#fileSystem.readFile(this.#configPath, "utf8");
    parseConfig(oldText);
    const nextText = `${JSON.stringify(next, null, 2)}\n`;
    const directory = path.dirname(this.#configPath);
    const baseName = path.basename(this.#configPath);
    const temporaryPath = path.join(directory, `.${baseName}.${process.pid}.${crypto.randomUUID()}.tmp`);
    let handle;
    let renamed = false;

    try {
      handle = await this.#fileSystem.open(temporaryPath, "wx", 0o600);
      await handle.writeFile(nextText, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await this.#fileSystem.rename(temporaryPath, this.#configPath);
      renamed = true;
      const verified = parseConfig(await this.#fileSystem.readFile(this.#configPath, "utf8"));
      if (verified.activeTheme !== next.activeTheme || verified.appearance !== next.appearance) {
        throw new Error("The saved application configuration did not verify.");
      }
      if (contentRevision) {
        const receiptPath = path.join(directory, '.gui-applied.json');
        const receiptTemp = receiptPath + '.' + crypto.randomUUID() + '.tmp';
        try {
          await this.#fileSystem.writeFile(receiptTemp, JSON.stringify({
            schemaVersion:1, themeId:next.activeTheme, appearance:next.appearance, contentRevision,
          }) + '\n', {flag:'wx',mode:0o600});
          await this.#fileSystem.rename(receiptTemp, receiptPath);
        } finally {
          await this.#fileSystem.rm(receiptTemp, {force:true}).catch(()=>undefined);
        }
      }
      return verified;
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      if (renamed) {
        await this.#restoreOldConfig(oldText).catch((rollbackError) => {
          throw new AggregateError([error, rollbackError], "Configuration update failed and rollback could not be verified.");
        });
      }
      throw error;
    } finally {
      await this.#fileSystem.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async #restoreOldConfig(oldText) {
    const directory = path.dirname(this.#configPath);
    const rollbackPath = path.join(directory, `.app.json.rollback.${process.pid}.${crypto.randomUUID()}.tmp`);
    let handle;
    try {
      handle = await this.#fileSystem.open(rollbackPath, "wx", 0o600);
      await handle.writeFile(oldText, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await this.#fileSystem.rename(rollbackPath, this.#configPath);
      parseConfig(await this.#fileSystem.readFile(this.#configPath, "utf8"));
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      await this.#fileSystem.rm(rollbackPath, { force: true }).catch(() => undefined);
    }
  }
}
