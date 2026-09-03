/**
 * หน้าที่: the provider-neutral Worker Registry for `control/agent-host/`
 * (Owner, Phase 1 — "Activate DNA OS Agent Host"). Maps a named worker
 * kind (CLAUDE/CODEX/GEMINI/LOCAL) to the one real, literal executable
 * path `./host.ts`'s `launchAgent()` is allowed to exec under the
 * existing sandbox profile — never a second sandbox, never
 * provider-specific authority. Every kind goes through the exact same
 * `launchAgent()` call; this file only answers "which literal binary,
 * if any, is this kind" — resolution is real (`existsSync`, no
 * fabricated path) and reports `EXECUTABLE_NOT_FOUND` honestly instead
 * of ever falling back to a wildcard or a guessed path.
 *
 * Input: a `WorkerKind`.
 * Output: `resolveWorker`, `WORKER_DEFINITIONS`.
 * Dependency ที่อนุญาต: node:fs (existsSync only — read, never write).
 * สิ่งที่ห้ามแตะ: never widen a resolved `executable` to a directory or a
 * glob; never add a fallback path chain that would let a caller launch
 * something other than the one path this file names outright.
 */

import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// `__dirname` is a CommonJS-only global: under a true ESM evaluation it is
// undefined and this module threw at load. `import.meta.url` is the form
// that resolves under both loaders — same construct the tests here use.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export type WorkerKind = "CLAUDE" | "CODEX" | "GEMINI" | "LOCAL";

export interface WorkerDefinition {
  kind: WorkerKind;
  /** Real, absolute, literal path — the one `(allow process-exec (literal ...))` will name. */
  executable: string;
  /** Argv appended after any caller-supplied instruction args — kept minimal and non-interactive by convention (see ./tests/real-agent-launch.test.ts). */
  defaultArgv: readonly string[];
}

export type WorkerResolution =
  | { ok: true; worker: WorkerDefinition }
  | { ok: false; kind: WorkerKind; reason: "EXECUTABLE_NOT_FOUND"; detail: string };

/**
 * Real, literal candidate paths for this machine — each checked with
 * `existsSync` at resolve time, never assumed. LOCAL reuses the existing,
 * already-proven `./agent-script.mjs` (run under this process's own
 * `node`), so the "LOCAL" worker kind adds no new executable at all.
 */
const CANDIDATES: Record<WorkerKind, { executable: string; defaultArgv: readonly string[] } | null> = {
  CLAUDE: { executable: "/usr/local/bin/claude", defaultArgv: ["--version"] },
  CODEX: { executable: "/Users/tam/.codex/plugins/.plugin-appserver/codex", defaultArgv: ["--version"] },
  GEMINI: null, // no gemini CLI binary found on this machine — reported honestly, never guessed
  LOCAL: { executable: process.execPath, defaultArgv: [join(MODULE_DIR, "agent-script.mjs")] },
};

declare const process: { execPath: string };
declare const __dirname: string;

export function resolveWorker(kind: WorkerKind): WorkerResolution {
  const candidate = CANDIDATES[kind];
  if (!candidate) {
    return { ok: false, kind, reason: "EXECUTABLE_NOT_FOUND", detail: `no real executable is registered for worker kind "${kind}" on this machine — no CLI binary was found, and this file never fabricates or wildcards a path` };
  }
  if (!existsSync(candidate.executable)) {
    return { ok: false, kind, reason: "EXECUTABLE_NOT_FOUND", detail: `registered path "${candidate.executable}" for worker kind "${kind}" does not exist on this machine right now` };
  }
  // Seatbelt's `(allow process-exec (literal ...))` matches the kernel-
  // resolved executable path, not an invocation-time symlink — confirmed
  // empirically (Phase 1: /usr/local/bin/claude, a symlink, failed exec
  // under the sandbox with "Operation not permitted" until the profile
  // named the resolved target directly). realpathSync here resolves the
  // registered candidate ONCE, at resolution time, to that one real
  // literal path — still exactly one binary, never a wildcard, never a
  // directory or glob.
  const resolvedExecutable = realpathSync(candidate.executable);
  return { ok: true, worker: { kind, executable: resolvedExecutable, defaultArgv: candidate.defaultArgv } };
}

export function listWorkerKinds(): readonly WorkerKind[] {
  return ["CLAUDE", "CODEX", "GEMINI", "LOCAL"];
}
