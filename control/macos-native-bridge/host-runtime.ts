import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nodeProcess from "node:process";

export function nowIso(): string {
  return new Date().toISOString();
}

export function repoRoot(): string {
  return resolve(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
}

export function dataPath(fileName: string, envName: string): string {
  return nodeProcess.env[envName] ?? join(repoRoot(), "control/macos-native-bridge/data", fileName);
}

export function isDarwin(): boolean {
  return nodeProcess.platform === "darwin";
}

export function openMode(): "execute" | "record" {
  return nodeProcess.env.MACOS_NATIVE_OPEN_MODE === "execute" ? "execute" : "record";
}

export { nodeProcess as process };
