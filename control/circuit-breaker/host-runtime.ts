/**
 * หน้าที่: declare the small real host surface `control/circuit-breaker/`
 * needs (`fs` for mtime-based change detection, `path`, plus a real
 * interval timer) — same isolation pattern as every other host-runtime.ts
 * in this repo.
 *
 * Input: none.
 * Output: `listFilesModifiedSince`, `joinPath`, `relativePath`,
 * `repoRootDirname`, `readEnvVar`, `startInterval`, `stopInterval`,
 * `nowIso`.
 * Dependency ที่อนุญาต: none — ambient require() only.
 * สิ่งที่ห้ามแตะ: never add a kill-capable primitive here — killing a
 * process is `../agent-host/contract.ts`'s `killLaunch`'s job alone;
 * this file only ever reads.
 */

declare const require: (id: string) => unknown;
declare const process: { cwd(): string; env: Record<string, string | undefined> };
declare const setInterval: (fn: () => void, ms: number) => unknown;
declare const clearInterval: (handle: unknown) => void;

interface NodeFsModule {
  existsSync(path: string): boolean;
  statSync(path: string): { isDirectory(): boolean; isFile(): boolean; mtimeMs: number };
  readdirSync(path: string): string[];
}
interface NodePathModule {
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
}

const fs = require("fs") as NodeFsModule;
const nodePath = require("path") as NodePathModule;

export function joinPath(...parts: string[]): string {
  return nodePath.join(...parts);
}

export function relativePath(from: string, to: string): string {
  return nodePath.relative(from, to);
}

export function repoRootDirname(): string {
  return process.cwd();
}

export function readEnvVar(name: string): string | undefined {
  return process.env[name];
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Every `.ts` file under `absDir` whose modification time is at or after
 * `sinceMs` (epoch ms) — the real, on-disk signal that a sandboxed
 * launch actually wrote something since it started, used by
 * `./daemon.ts` to scope `governance/source-validation/contract.ts`'s
 * `checkImportBoundaries()` to only the files a given launch could
 * plausibly have touched. Never throws on a directory that does not
 * exist (a launch's workspace may not exist yet at the very first poll
 * tick) — returns empty instead.
 */
export function listFilesModifiedSince(absDir: string, sinceMs: number): readonly string[] {
  if (!fs.existsSync(absDir)) return [];
  const results: string[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir)) {
      const absPath = nodePath.join(dir, entry);
      let stat: { isDirectory(): boolean; isFile(): boolean; mtimeMs: number };
      try {
        stat = fs.statSync(absPath);
      } catch {
        continue; // a file that vanished between readdir and stat — real race, skip it, never crash the poll loop.
      }
      if (stat.isDirectory()) {
        walk(absPath);
      } else if (stat.isFile() && entry.endsWith(".ts") && stat.mtimeMs >= sinceMs) {
        results.push(absPath);
      }
    }
  }
  walk(absDir);
  return results;
}

export function startInterval(fn: () => void, ms: number): unknown {
  return setInterval(fn, ms);
}

export function stopInterval(handle: unknown): void {
  clearInterval(handle);
}
