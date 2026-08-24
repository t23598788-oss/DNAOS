/**
 * หน้าที่: the repo-wide Process Boundary Static Verification Gate
 * (Owner, "Single Process Creation Gate — Consolidation", item 7).
 * Greps every production `.ts`/`.mjs`/`.js` source file (excluding
 * node_modules, tests, and this file itself) for any of the raw process-
 * creation primitives named in the Owner's spec. A match outside the
 * explicit `CANONICAL_BOUNDARY_FILES` allowlist below is a real
 * PROCESS_BOUNDARY_VIOLATION and fails this check (exit code 1).
 *
 * This is a STATIC text scan, not a type-aware AST analysis — it can
 * over-match a string that merely contains one of these substrings in a
 * comment or unrelated context; every match this file reports below was
 * manually read and confirmed to be a REAL call site, not a false
 * positive, at the time this gate was built. A future false positive
 * should be fixed by narrowing the regex, never by silently widening the
 * allowlist.
 *
 * How to run: npx tsx execution/run/tests/process-boundary-scan.test.ts
 */
export {}; // forces this file to be a module, not a global script — keeps its ambient `declare`s local, never leaking into other files' own `process`/`require` typings.
declare const require: (id: string) => unknown;
interface NodeFsModule {
  readdirSync(path: string, opts: { withFileTypes: true }): Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  readFileSync(path: string, encoding: string): string;
}
interface NodePathModule {
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
}
const fs = require("node:fs") as NodeFsModule;
const nodePath = require("node:path") as NodePathModule;
declare const process: { cwd(): string; exitCode?: number };
declare const console: { log(...a: unknown[]): void; error(...a: unknown[]): void };

const REPO_ROOT = process.cwd();

const EXCLUDED_DIRS = new Set(["node_modules", ".git", "tests", "test-workspace", "test-fixtures", "data", ".agent-host-profiles"]);

/**
 * Every file in this repo that is real, deliberate, canonical process-
 * boundary implementation — the ONLY places a raw process-creation
 * primitive may appear. Everything else must route through
 * `control/agent-host/` (AI runtimes) or
 * `execution/run/contract.ts#requestProcessExecution` (the Process
 * Gate).
 */
const CANONICAL_BOUNDARY_FILES = new Set([
  "control/agent-host/host-runtime.ts",
  // The confined worker script itself — runs INSIDE the Seatbelt sandbox;
  // its own spawn attempts are exactly what control/agent-host/'s tests
  // prove get BLOCKED. Not a bypass — the thing being tested.
  "control/agent-host/agent-script.mjs",
  "execution/run/host-runtime.ts",
  "execution/run/process-gate.ts",
  // CANONICAL_BOUNDARY (Owner, "Phase 4 — Canonical Reconciliation"):
  // the ONE spawn call site for control/runtime-adapter/ — reached by
  // BOTH ./adapter.ts (regular launches) and ./pty.ts (PTY sessions),
  // itself only reachable from execution/run/process-gate.ts's "policy"
  // confinement branch. Not a second/duplicate executor: this capability
  // previously had its own additional raw spawn in adapter.ts (a real,
  // disclosed DUPLICATE_PATH at reconciliation time) — retired this round
  // in favor of routing adapter.ts through this one file, same
  // "exactly one spawn site per capability" discipline as
  // control/agent-host/host-runtime.ts and execution/run/host-runtime.ts
  // above.
  "control/runtime-adapter/host-runtime.ts",
  // control/runtime-control/ is a separate, pre-existing capability with
  // its own real, self-contained host-runtime.ts (launchctl/lsof service
  // management) — same "only place spawn is called in this capability"
  // discipline as execution/run's own host-runtime.ts, predates this
  // consolidation pass, and was not named in this task's explicit scope.
  "control/runtime-control/host-runtime.ts",
  // Documented platform-bootstrap scripts — real, standalone, pre-existing
  // capability-discovery utilities that run OUTSIDE the live server process
  // (manually invoked, never imported by production request-handling code).
  "control/agent-gateway/bootstrap.mjs",
  "connections/agent-registry/detect.ts",
  "connections/os-ui/screen-reader.ts",
  "connections/os-ui/window-state-watcher.mjs",
  "connections/os-ui/voice-queue.mjs",
  "connections/voice-command/microphone.mjs",
  "connections/voice-command/listen-observe.mjs",
  "connections/voice-command/whisper-listener.mjs",
  "connections/voice-command/speech-to-text.mjs",
  "connections/language-listening/segmenter.mjs",
  "connections/audio-classifier/audio-classifier.mjs",
  "connections/stt-per-segment/stt-segment.mjs",
  "connections/human-verified-text/verify-tool.mjs",
  "connections/connection-registry/git-discovery.ts",
  "connections/agent-registry/worker-state-collector.ts",
  "connections/agent-registry/session-registry.ts",
  "connections/telemetry/collector.ts",
  "control/source-workspace/host-runtime.ts",
  "control/system-reference-resolution/resolver.ts",
  "reports/phase16-world-evidence/action_loop.mjs",
  "reports/phase16-world-evidence/problem_resolver.mjs",
  "reports/phase16-world-evidence/control_case_pipeline.mjs",
  "reports/phase16-world-evidence/entry_point.mjs",
  "dna-os-circuit/definition/semantic-model.ts",
]);

const PATTERNS = [/child_process/, /\bspawn\(/, /\bspawnSync\(/, /(?<!\.)\bexec\(/, /\bexecSync\(/, /\bexecFile\(/, /\bexecFileSync\(/, /\bfork\(/, /\bposix_spawn\b/, /\bsystem\(/, /\bpopen\(/];

/** Real code only — strips comment-only lines (JSDoc `*` continuation, `//`, `/**`) so this gate reports real call sites, not documentation describing them. */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/**");
}

function* walk(dir: string): Generator<string> {
  let entries: ReturnType<NodeFsModule["readdirSync"]>;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && /\.(ts|mjs|js)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      yield full;
    }
  }
}

interface Violation {
  file: string;
  line: number;
  pattern: string;
  text: string;
}

function scan(): readonly Violation[] {
  const violations: Violation[] = [];
  for (const absPath of walk(REPO_ROOT)) {
    const relPath = nodePath.relative(REPO_ROOT, absPath);
    if (CANONICAL_BOUNDARY_FILES.has(relPath)) continue;
    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i])) continue;
      // Strip a trailing `// ...` inline comment before pattern-matching —
      // real code, if any, is only ever to the left of it.
      const commentIdx = lines[i].indexOf("//");
      const codePart = commentIdx >= 0 ? lines[i].slice(0, commentIdx) : lines[i];
      for (const pattern of PATTERNS) {
        if (pattern.test(codePart)) {
          violations.push({ file: relPath, line: i + 1, pattern: pattern.source, text: lines[i].trim().slice(0, 160) });
        }
      }
    }
  }
  return violations;
}

function main(): void {
  const violations = scan();
  if (violations.length === 0) {
    console.log("PASS  PROCESS_BOUNDARY_SCAN: no production raw process-creation call site found outside CANONICAL_BOUNDARY_FILES");
    console.log(`      CANONICAL_BOUNDARY_FILES (${CANONICAL_BOUNDARY_FILES.size}): ${[...CANONICAL_BOUNDARY_FILES].join(", ")}`);
    return;
  }
  console.error(`FAIL  PROCESS_BOUNDARY_VIOLATION: ${violations.length} raw process-creation call site(s) found outside the canonical boundary`);
  for (const v of violations) {
    console.error(`      ${v.file}:${v.line} (matched /${v.pattern}/) -- ${v.text}`);
  }
  process.exitCode = 1;
}

main();
