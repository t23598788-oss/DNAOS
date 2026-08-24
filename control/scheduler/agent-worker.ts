/**
 * หน้าที่: the AGENT. One bounded Work Order in, evidence out. Runs as a
 * `worker_thread` so several agents execute concurrently and independently.
 *
 * AN AGENT NEVER DECIDES SYSTEM STATE. It receives a target and its test files,
 * executes them, and returns the literal observed result. It does not read the
 * census, does not consult the work graph, does not decide whether anything is
 * VERIFIED, and does not write to the registry. The coordinator does all of
 * that with the evidence this returns.
 *
 * WHY worker_threads AND NOT THE PROCESS GATE — stated plainly, because it is a
 * real boundary decision, not an oversight:
 *   - `execution/run/`'s Process Gate deliberately REFUSES a cwd inside
 *     MASTER_SOURCE (the repo root). That is correct and protects the
 *     repository. But a capability's own tests must run with the repo as cwd,
 *     so the Gate structurally cannot host them.
 *   - `control/agent-host/` confines an agent to a disposable workspace, which
 *     has the same problem for in-repo tests.
 *   - A worker thread is NOT process creation, so this does not circumvent
 *     `execution/run/tests/process-boundary-scan.test.ts`'s intent.
 *   - BUT a worker thread has NO SANDBOX. It is therefore valid ONLY for
 *     already-trusted, in-repo verification code, which is all this file ever
 *     runs. UNTRUSTED or agent-authored candidate code must still go through
 *     `control/agent-host/` or the Process Gate. Do not widen this file to
 *     execute anything that did not come from this repository.
 *
 * Input: `{ work_id, target, test_files }` via `workerData`.
 * Output: a `WorkResult` posted back to the parent.
 * Dependency ที่อนุญาต: ../work-graph/types.ts (types only), node builtins.
 */

import { parentPort, workerData } from "node:worker_threads";
import { join } from "node:path";
import type { WorkResult } from "../work-graph/types";

interface AgentInput {
  work_id: string;
  target: string;
  test_files: readonly string[];
  repo_root: string;
  timeout_ms: number;
}

const input = workerData as AgentInput;

/** Tests report "N passed, M failed" on their own line. Sum across every file this order covers. */
function tally(output: string): { passed: number; failed: number; sawResult: boolean } {
  let passed = 0;
  let failed = 0;
  let sawResult = false;
  for (const m of output.matchAll(/(\d+)\s+passed,\s*(\d+)\s+failed/g)) {
    passed += Number(m[1]);
    failed += Number(m[2]);
    sawResult = true;
  }
  // Some suites report only failures, e.g. the boundary scan's
  // "PROCESS_BOUNDARY_VIOLATION: 8 raw ... call site(s) found".
  if (!sawResult && /\bFAIL\b/.test(output)) {
    failed += (output.match(/\bFAIL\b/g) ?? []).length;
    sawResult = true;
  }
  return { passed, failed, sawResult };
}

async function run(): Promise<WorkResult> {
  const started = Date.now();
  let captured = "";

  // Tests communicate results through console output, so capture it rather than
  // letting it interleave with other concurrent agents on the shared stdout.
  const realLog = console.log;
  const realError = console.error;
  const capture = (...args: unknown[]): void => {
    captured += `${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`;
  };
  console.log = capture;
  console.error = capture;

  try {
    // Count RESULT LINES rather than slicing per file. Each suite self-invokes an
    // async main() that resolves after import returns, so two suites' output
    // interleaves on the shared capture buffer — a per-file slice then fails to
    // find the second file's line and reports a false TIMEOUT even though every
    // check passed. Observed exactly that on control/event-pipeline: "9 passed,
    // 0 failed (TIMEOUT)". Waiting for the Nth result line is interleave-proof.
    const resultLineCount = (): number => (captured.match(/(\d+)\s+passed,\s*(\d+)\s+failed/g) ?? []).length;
    let expectedResults = 0;

    for (const testFile of input.test_files) {
      expectedResults += 1;
      try {
        // A test module self-invokes `main()` at import, so importing IS running
        // it. Cache-busting query keeps repeated orders honest.
        await import(`${join(input.repo_root, testFile)}?agent=${input.work_id}-${started}`);
      } catch (error) {
        captured += `IMPORT_ERROR ${testFile}: ${error instanceof Error ? error.message : String(error)}\n`;
        continue;
      }
      // Wait until this suite's result line has landed — i.e. the total number of
      // result lines has caught up to the number of suites imported so far.
      const deadline = Date.now() + input.timeout_ms;
      while (Date.now() < deadline && resultLineCount() < expectedResults) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (resultLineCount() < expectedResults) {
        captured += `TIMEOUT ${testFile}: only ${resultLineCount()} of ${expectedResults} result line(s) within ${input.timeout_ms}ms\n`;
      }
    }
  } finally {
    console.log = realLog;
    console.error = realError;
  }

  const { passed, failed, sawResult } = tally(captured);
  const timedOut = captured.includes("TIMEOUT ");
  const importFailed = captured.includes("IMPORT_ERROR ");

  // The agent reports an OUTCOME for its own bounded order only. The coordinator
  // decides what that means for the system.
  const outcome: WorkResult["outcome"] = !sawResult || timedOut || importFailed
    ? "BLOCKED"
    : failed > 0
      ? "FAILED"
      : "VERIFIED";

  return {
    work_id: input.work_id,
    target: input.target,
    outcome,
    evidence_ref: `${input.test_files.join(" + ")} => ${passed} passed, ${failed} failed${timedOut ? " (TIMEOUT)" : ""}${importFailed ? " (IMPORT_ERROR)" : ""}`,
    passed,
    failed,
    duration_ms: Date.now() - started,
    output_tail: captured.split("\n").slice(-12).join("\n"),
  };
}

run()
  .then((result) => parentPort?.postMessage(result))
  .catch((error) => {
    const result: WorkResult = {
      work_id: input.work_id,
      target: input.target,
      outcome: "BLOCKED",
      evidence_ref: `agent crashed: ${error instanceof Error ? error.message : String(error)}`,
      passed: 0,
      failed: 0,
      duration_ms: 0,
      output_tail: "",
    };
    parentPort?.postMessage(result);
  });
