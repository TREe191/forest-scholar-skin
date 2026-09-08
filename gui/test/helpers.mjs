import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const temporaryBase = path.join(testDirectory, ".tmp");

export async function makeTemporaryDirectory(prefix) {
  await fs.mkdir(temporaryBase, { recursive: true });
  return fs.mkdtemp(path.join(temporaryBase, `${prefix}-`));
}

export async function removeTemporaryDirectory(directory) {
  const relative = path.relative(temporaryBase, directory);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Refused to remove a directory outside the GUI test temporary root.");
  }
  await fs.rm(directory, { recursive: true, force: true });
}

export const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
