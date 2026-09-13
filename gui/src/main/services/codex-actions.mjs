import { spawn } from "node:child_process";
import path from "node:path";

const MAX_CAPTURED_CHARS = 64 * 1024;

export function resolveWindowsPowerShell(environment = process.env) {
  const windowsRoot = environment.SystemRoot || environment.WINDIR;
  if (!windowsRoot || !path.win32.isAbsolute(windowsRoot)) {
    throw new Error("The Windows system directory could not be resolved.");
  }
  return path.win32.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function appendBounded(current, chunk) {
  const combined = current + String(chunk);
  return combined.length <= MAX_CAPTURED_CHARS ? combined : combined.slice(-MAX_CAPTURED_CHARS);
}

export function executeProcess(executable, args, options, spawnImplementation = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImplementation(executable, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); });
    child.stderr?.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); });
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal, stdout, stderr }));
  });
}

function safeFailureMessage(action, result) {
  if (result.signal) return `${action} was interrupted (${result.signal}).`;
  return `${action} failed with exit code ${result.exitCode ?? "unknown"}.`;
}

export class CodexActions {
  #projectRoot;
  #startScript;
  #restoreScript;
  #powerShell;
  #executor;
  #dataRoot;
  #environment;

  constructor({
    projectRoot,
    startScript,
    restoreScript,
    environment = process.env,
    executor = executeProcess,
    isPackaged=false,
    dataRoot,
  }) {
    for (const [name, value] of Object.entries({ projectRoot, startScript, restoreScript })) {
      if (!path.isAbsolute(value)) throw new TypeError(`${name} must be absolute.`);
    }
    this.#projectRoot = projectRoot;
    this.#startScript = startScript;
    this.#restoreScript = restoreScript;
    this.#powerShell = resolveWindowsPowerShell(environment);
    this.#executor = executor;
    if(isPackaged&&(!dataRoot||!path.isAbsolute(dataRoot)))throw Error('Packaged launch requires absolute dataRoot.');
    this.#dataRoot=isPackaged?dataRoot:null;
    this.#environment={...environment};
    if(isPackaged){
      delete this.#environment.NODE_OPTIONS;delete this.#environment.NODE_PATH;
      this.#environment.TEMP=this.#environment.TMP=path.join(dataRoot,'runtime','temp');
    }
  }

  launch() {
    return this.#run("Launch Codex", this.#startScript, ["-Mode", "Auto"]);
  }

  restore() {
    return this.#run("Restore Codex", this.#restoreScript, []);
  }

  async #run(action, scriptPath, scriptArguments) {
    const args = [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      ...(this.#dataRoot?['-DataRoot',this.#dataRoot]:[]),
      ...scriptArguments,
    ];
    const result = await this.#executor(this.#powerShell, args, {
      cwd: this.#dataRoot??this.#projectRoot,
      env:this.#environment,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.exitCode !== 0 || result.signal) {
      throw new Error(safeFailureMessage(action, result));
    }
    return Object.freeze({ ok: true, message: `${action} completed successfully.` });
  }
}
