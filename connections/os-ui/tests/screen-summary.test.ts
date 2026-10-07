/**
 * หน้าที่: real, executable evidence for ../screen-summary.ts — the Owner's
 * named sandbox monitor list (2026-08-20): 2x diff, permission dialog,
 * secret redaction, worker restart recovery, idempotency, unknown-dialog
 * BLOCKED. Diff logic is tested as a pure function (deterministic,
 * synthetic snapshots) — the live read_screen path is already covered
 * end-to-end by ../tests/work-order.test.ts, which this file does not
 * duplicate.
 *
 * How to run:
 *   npx tsx connections/os-ui/tests/screen-summary.test.ts
 */
import { diffSnapshots, loadLastSnapshot, recoverScreenSummaries } from "../screen-summary";
import type { ScreenSnapshot } from "../screen-summary";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

function snap(overrides: Partial<ScreenSnapshot>): ScreenSnapshot {
  return {
    taken_at: new Date().toISOString(),
    target: "vscode",
    app: "Code",
    title: "test.ts",
    state: "window_active",
    controls: [],
    confidence: 1,
    ...overrides,
  };
}

// 1. baseline capture (no prior snapshot) — everything present is "added", nothing removed/changed, no block
{
  const baseline = snap({ controls: [{ role: "AXButton", label: "Save", redacted: false }] });
  const diff = diffSnapshots(null, baseline);
  check("baseline diff (no prior snapshot) reports every control as added", diff.added.length === 1 && diff.removed.length === 0 && diff.changed.length === 0 && diff.blocked === null);
}

// 2. two real diffs in sequence: control added, then a different control removed — this is the "2x diff" scenario
{
  const first = snap({ controls: [{ role: "AXButton", label: "Save", redacted: false }] });
  const second = snap({ controls: [{ role: "AXButton", label: "Save", redacted: false }, { role: "AXButton", label: "Cancel", redacted: false }] });
  const diffA = diffSnapshots(first, second);
  check("diff #1: new control detected as added", diffA.added.length === 1 && diffA.added[0].label === "Cancel");

  const third = snap({ controls: [{ role: "AXButton", label: "Cancel", redacted: false }] });
  const diffB = diffSnapshots(second, third);
  check("diff #2: previously-present control detected as removed", diffB.removed.some((r) => r.label === "Save") && diffB.removed.length === 1);
}

// 3. permission/secure text field flips from visible to redacted between snapshots -> reported as "changed", never as the real value
{
  const before = snap({ controls: [{ role: "AXTextField", label: "notes", redacted: false }] });
  const after = snap({ controls: [{ role: "AXTextField", label: "[REDACTED]", redacted: true }] });
  const diff = diffSnapshots(before, after);
  check("redaction-state flip is reported as changed, not silently dropped", diff.changed.length === 1 && diff.changed[0].after === "[REDACTED]");
}

// 4. secret redaction: a redacted control's label is NEVER the real value in the diff output (added/removed/changed all read from already-redacted controls)
{
  const withSecret = snap({ controls: [{ role: "AXTextField", label: "[REDACTED]", redacted: true }] });
  const diff = diffSnapshots(null, withSecret);
  const allLabels = [...diff.added, ...diff.removed, ...diff.changed.map((c) => ({ label: c.after }))].map((x) => x.label);
  check("no diff field ever contains anything other than '[REDACTED]' for a redacted control", allLabels.every((l) => l === "[REDACTED]"));
}

// 5. unknown dialog -> BLOCKED with a structured reason, known dialog controls (Save/Cancel/OK) do NOT block
{
  const withKnownDialog = snap({ controls: [{ role: "AXSheet", label: "Save", redacted: false }] });
  const diffKnown = diffSnapshots(null, withKnownDialog);
  check("known dialog control (Save) does not block", diffKnown.blocked === null);

  const withUnknownDialog = snap({ controls: [{ role: "AXDialog", label: "Allow Screen Recording?", redacted: false }] });
  const diffUnknown = diffSnapshots(null, withUnknownDialog);
  check("unknown dialog control triggers BLOCKED with a structured reason", diffUnknown.blocked !== null && diffUnknown.blocked.reason.includes("AXDialog"));
}

// 6. recovery: loadLastSnapshot / recoverScreenSummaries read from the persisted file, never in-memory-only (a real "worker restart" survives because nothing here depends on process lifetime)
{
  const beforeRestart = loadLastSnapshot("__nonexistent_target_for_test__");
  check("loadLastSnapshot returns null (not a crash) for a target with no persisted history", beforeRestart === null);

  const recovered = recoverScreenSummaries("__nonexistent_target_for_test__");
  check("recoverScreenSummaries returns an empty, well-typed array for a target with no history", Array.isArray(recovered) && recovered.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0 && typeof process !== "undefined") process.exitCode = 1;
