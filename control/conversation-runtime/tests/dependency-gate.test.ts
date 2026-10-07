/**
 * หน้าที่: PHASE 5 hard dependency gate (Owner UNLOCK 2026-09-06,
 * ISOLATE_OWNER_CONVERSATION_RUNTIME). Walks `../main.ts`'s REAL static
 * import/re-export closure (not a hand-maintained list) and fails the
 * build if it reaches execution/agent-dispatch/credential/computer-use/
 * deploy code, or any `node:child_process` use outside the one approved
 * fixed boundary.
 *
 * This is deliberately a source-text walk, not a runtime import — it must
 * catch a bad dependency even in a code path that never executes in this
 * test run (e.g. an unreachable branch that would still make the file
 * physically reachable from the conversation entrypoint).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const ENTRY = join(ROOT, "control/conversation-runtime/main.ts");

const APPROVED_CHILD_PROCESS_FILE = "control/owner-command-semantics/language-processor/fixed-runner.ts";

const DENY_PATH_PATTERNS: readonly RegExp[] = [
  /^execution\/run\b/,
  /^control\/command-router\/(router|capability-registry)\b/,
  /^control\/agent-gateway\/(gateway|agent-execution-loop|agent-host-dispatch|memory-store)\b/,
  /^control\/computer-use-/,
  /^credentials\//,
  /^control\/registration-pipeline\b/,
  /^control\/registration-update\b/,
];

/** Actual imports of node:child_process — not comment mentions of it (this file's own header, and others', discuss the boundary in prose). */
const CHILD_PROCESS_IMPORT_PATTERN = /(?:require\(\s*["']node:child_process["']\s*\)|from\s*["']node:child_process["'])/;

const DENY_TEXT_PATTERNS: readonly RegExp[] = [
  /\bspawn\s*\(/,
  /\bexecFile(Sync)?\s*\(/,
  /\bexec\s*\(/,
  /\bfetch\s*\(/,
  /https?\.request\s*\(/,
  /\bnet\.connect\s*\(/,
  /new\s+WebSocket\s*\(/,
  /osascript/i,
  /submitTask\s*\(/,
  /dispatchAgent/i,
];

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = dirname(fromFile);
  const resolved = resolve(base, spec);
  for (const candidate of [resolved, `${resolved}.ts`, join(resolved, "contract.ts"), join(resolved, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function importSpecsOf(src: string): string[] {
  const specs: string[] = [];
  for (const re of [
    /(?:^|\n)\s*import\s+[^"'\n]*from\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*export\s+(?:\*|type\s*\{[^}]*\}|\{[^}]*\})\s*from\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) specs.push(m[1]);
  }
  return specs;
}

interface ClosureResult {
  files: readonly string[];
  denyHits: readonly { file: string; pattern: string }[];
  unapprovedChildProcessUsers: readonly string[];
}

function walkClosure(entry: string): ClosureResult {
  const visited = new Set<string>();
  const denyHits: { file: string; pattern: string }[] = [];
  const childProcessUsers: string[] = [];

  function walk(file: string): void {
    if (visited.has(file)) return;
    visited.add(file);
    const rel = relative(ROOT, file);
    const src = readFileSync(file, "utf8");

    for (const pattern of DENY_PATH_PATTERNS) {
      if (pattern.test(rel)) denyHits.push({ file: rel, pattern: pattern.toString() });
    }
    if (CHILD_PROCESS_IMPORT_PATTERN.test(src)) childProcessUsers.push(rel);
    if (rel !== APPROVED_CHILD_PROCESS_FILE) {
      for (const pattern of DENY_TEXT_PATTERNS) {
        if (pattern.test(src)) denyHits.push({ file: rel, pattern: pattern.toString() });
      }
    }
    for (const spec of importSpecsOf(src)) {
      const resolved = resolveImport(file, spec);
      if (resolved) walk(resolved);
    }
  }

  walk(entry);
  return {
    files: [...visited].map((f) => relative(ROOT, f)).sort(),
    denyHits,
    unapprovedChildProcessUsers: childProcessUsers.filter((f) => f !== APPROVED_CHILD_PROCESS_FILE),
  };
}

test("conversation-runtime/main.ts's dependency closure never reaches execution/agent-dispatch/credential/computer-use code", () => {
  const result = walkClosure(ENTRY);
  assert.equal(result.denyHits.length, 0, `forbidden dependency reached: ${JSON.stringify(result.denyHits, null, 2)}`);
});

test("conversation-runtime/main.ts's dependency closure has no unapproved node:child_process user", () => {
  const result = walkClosure(ENTRY);
  assert.equal(result.unapprovedChildProcessUsers.length, 0, `unapproved child_process user: ${JSON.stringify(result.unapprovedChildProcessUsers)}`);
});

test("the one approved child_process user is exactly the fixed language-processor boundary", () => {
  const src = readFileSync(join(ROOT, APPROVED_CHILD_PROCESS_FILE), "utf8");
  assert.match(src, /node:child_process/, "expected fixed-runner.ts to be the file that imports node:child_process");
});
