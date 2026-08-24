/**
 * หน้าที่: a focused test for `../result.ts`'s pure functions —
 * ANSI-stripping, secret-redaction, and terminal-status mapping. These
 * are deterministic, no-I/O functions; testing them directly (rather than
 * only indirectly through a real spawned process, which would make
 * ANSI/redaction assertions depend on shell-quoting and platform-specific
 * `echo`/`printf` behaviour) is the more reliable way to prove the exact
 * behaviour ported from the old repo's real
 * `app/api/admin/ide/_lib/executionRuntime.ts`. `../tests/executor.test.ts`
 * covers the end-to-end, real-process path through `../contract.ts`; this
 * file covers the sanitization logic those real processes' output flows
 * through.
 *
 * How to run: npx tsx execution/run/tests/result.test.ts
 *
 * Input: none.
 * Output: PASS/FAIL lines and a non-zero exit code on any failure.
 * Dependency ที่อนุญาต: ../result.ts (private implementation — a
 * deliberate, narrow exception to the "tests import ../contract.ts only"
 * convention, since `sanitizeChunk` has no equivalent in the public
 * contract to test through).
 * สิ่งที่ห้ามแตะ: never assert a `[REDACTED]` test fixture value that
 * looks like a REAL credential — use obviously-fake values only.
 */

import { mapTerminalStatus, sanitizeChunk } from "../result";

declare const process: { readonly env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function check(name: string, body: () => void): void {
  try {
    body();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

check("ANSI colour/style codes are stripped", () => {
  const raw = "\x1B[31mHELLO\x1B[0m \x1B[1mWORLD\x1B[0m";
  const clean = sanitizeChunk(raw);
  assert(clean === "HELLO WORLD", `expected ANSI codes stripped to "HELLO WORLD", got ${JSON.stringify(clean)}`);
});

check("ANSI OSC (title-setting) sequences are stripped", () => {
  const raw = "\x1B]0;window title\x07visible text";
  const clean = sanitizeChunk(raw);
  assert(clean === "visible text", `expected OSC sequence stripped, got ${JSON.stringify(clean)}`);
});

check("a static Authorization Bearer token pattern is redacted", () => {
  const raw = "curl output: Authorization: Bearer sk-fake-not-a-real-token-abc123";
  const clean = sanitizeChunk(raw);
  assert(!clean.includes("sk-fake-not-a-real-token-abc123"), "expected the bearer token to be redacted");
  assert(clean.includes("[REDACTED]"), "expected a [REDACTED] marker in place of the token");
});

check("a static sk-... style API key pattern is redacted", () => {
  const raw = "using key sk-FAKEKEYFORTESTONLY1234567890";
  const clean = sanitizeChunk(raw);
  assert(!clean.includes("sk-FAKEKEYFORTESTONLY1234567890"), "expected the sk- style key to be redacted");
});

check("a known-secret-shaped environment variable's VALUE is redacted wherever it appears in output", () => {
  // Simulated via a static pattern match (password=...) rather than mutating
  // process.env, since ../host-runtime.ts's allEnvEntries() reads the REAL host
  // environment and this test must not depend on what secrets happen to be set
  // on the machine running it.
  const raw = "config: password=hunter2-fake-test-value";
  const clean = sanitizeChunk(raw);
  assert(!clean.includes("hunter2-fake-test-value"), "expected the password value to be redacted");
});

check("plain text with no ANSI codes and no secrets passes through unchanged", () => {
  const raw = "/Users/example/workspace\n";
  const clean = sanitizeChunk(raw);
  assert(clean === raw, `expected plain text to pass through unchanged, got ${JSON.stringify(clean)}`);
});

check("mapTerminalStatus: a clean zero exit maps to passed", () => {
  const result = mapTerminalStatus({ exitCode: 0, signal: null, timedOut: false, cancelled: false, truncated: false, workspacePolicyViolation: false, processStartFailed: false });
  assert(result.status === "passed" && result.errorCode === null, `expected passed/null, got ${JSON.stringify(result)}`);
});

check("mapTerminalStatus: a nonzero exit maps to failed/EXECUTION_FAILED", () => {
  const result = mapTerminalStatus({ exitCode: 1, signal: null, timedOut: false, cancelled: false, truncated: false, workspacePolicyViolation: false, processStartFailed: false });
  assert(result.status === "failed" && result.errorCode === "EXECUTION_FAILED", `expected failed/EXECUTION_FAILED, got ${JSON.stringify(result)}`);
});

check("mapTerminalStatus: timeout takes priority over a nonzero exit code", () => {
  const result = mapTerminalStatus({ exitCode: 1, signal: "SIGTERM", timedOut: true, cancelled: false, truncated: false, workspacePolicyViolation: false, processStartFailed: false });
  assert(result.status === "timed_out" && result.errorCode === "COMMAND_TIMEOUT", `expected timed_out/COMMAND_TIMEOUT, got ${JSON.stringify(result)}`);
});

check("mapTerminalStatus: a workspace-policy violation downgrades a would-be pass to failed", () => {
  const result = mapTerminalStatus({ exitCode: 0, signal: null, timedOut: false, cancelled: false, truncated: false, workspacePolicyViolation: true, processStartFailed: false });
  assert(result.status === "failed" && result.errorCode === "WORKSPACE_POLICY_VIOLATION", `expected failed/WORKSPACE_POLICY_VIOLATION, got ${JSON.stringify(result)}`);
});

check("mapTerminalStatus: a failed process start takes priority over every other signal", () => {
  const result = mapTerminalStatus({ exitCode: 0, signal: null, timedOut: true, cancelled: true, truncated: true, workspacePolicyViolation: true, processStartFailed: true });
  assert(result.status === "failed" && result.errorCode === "PROCESS_START_FAILED", `expected failed/PROCESS_START_FAILED to win over every other signal, got ${JSON.stringify(result)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
