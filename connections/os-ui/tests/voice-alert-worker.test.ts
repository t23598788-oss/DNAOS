/**
 * หน้าที่: proves ../voice-alert-worker.mjs's LIVE EVENT ONLY behavior —
 * real temp `work-order-audit.jsonl`/`voice-alert.cursor.json` files,
 * the real `initializeLiveCursor`/`consume` functions, an injected
 * `speak` function so no real `/usr/bin/say` process is ever spawned by
 * this suite. Never touches the real production
 * `connections/os-ui/data/` files.
 *
 * How to run: npx tsx connections/os-ui/tests/voice-alert-worker.test.ts
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consume, initializeLiveCursor, readCursor, writeCursor, safeText } from "../voice-alert-worker.mjs";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function tempPaths() {
  const dir = mkdtempSync(join(tmpdir(), "voice-alert-worker-test-"));
  return { dir, auditPath: join(dir, "work-order-audit.jsonl"), cursorPath: join(dir, "voice-alert.cursor.json") };
}

function auditLine(overrides: { ui_action?: string; status?: string; summary?: string; dry_run?: boolean } = {}): string {
  const record = {
    recorded_at: new Date().toISOString(),
    order: { ui_action: overrides.ui_action ?? "open_app", dry_run: overrides.dry_run ?? false },
    outcome: { status: overrides.status ?? "BLOCKED", summary: overrides.summary ?? "test summary" },
  };
  return JSON.stringify(record);
}

function fakeSpeaker() {
  const calls: string[] = [];
  const speak = async (text: string) => { calls.push(text); return true; };
  return { speak, calls };
}

async function main(): Promise<void> {
  // A. first start (no audit file, no cursor at all) -> cursor lands on real EOF (0), nothing to speak.
  await check("A. first start with nothing on disk -> cursor set to EOF(0), no backlog to speak", async () => {
    const { dir, auditPath, cursorPath } = tempPaths();
    try {
      const eof = initializeLiveCursor({ auditPath, cursorPath });
      assert(eof === 0, `expected EOF 0 on a brand-new audit file, got ${eof}`);
      assert(existsSync(auditPath), "expected initializeLiveCursor to create the audit file");
      assert(readCursor({ auditPath, cursorPath }) === 0, "expected the persisted cursor to be 0");

      const { speak, calls } = fakeSpeaker();
      const result = await consume({ auditPath, cursorPath }, speak);
      assert(calls.length === 0, `expected nothing spoken on a fresh empty audit file, got ${calls.length}`);
      assert(result.spoken.length === 0, "expected consume()'s own spoken list to be empty");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // B. restart with a real, pre-existing backlog (the exact reported bug shape) -> initializeLiveCursor must jump straight past it; consume() must never speak the old backlog.
  await check("B. restart with a stale cursor + real backlog -> old backlog is never spoken (the reported bug, fixed)", async () => {
    const { dir, auditPath, cursorPath } = tempPaths();
    try {
      const oldLines = Array.from({ length: 23 }, () => auditLine({ ui_action: "open_app", status: "BLOCKED", summary: "Refused: this target touches a credential/MFA/Keychain surface — never automated" }));
      writeFileSync(auditPath, oldLines.join("\n") + "\n", "utf8");
      // Simulate the exact stuck-cursor shape found live: a small, stale offset far behind the real end of file.
      writeCursor(10, { cursorPath });
      const auditSizeBefore = Buffer.byteLength(readFileSync(auditPath, "utf8"));
      assert(auditSizeBefore > 10, "precondition: the stale cursor must be far behind the real file size");

      const eof = initializeLiveCursor({ auditPath, cursorPath });
      assert(eof === auditSizeBefore, `expected the restart to reset the cursor to the real current EOF (${auditSizeBefore}), got ${eof}`);

      const { speak, calls } = fakeSpeaker();
      const result = await consume({ auditPath, cursorPath }, speak);
      assert(calls.length === 0, `expected NONE of the 23 pre-existing backlog records to be spoken after restart, got ${calls.length}: ${JSON.stringify(calls)}`);
      assert(result.spoken.length === 0, "expected consume()'s own spoken list to be empty after a live-only restart");

      // Audit history itself must never be touched/truncated/deleted.
      assert(readFileSync(auditPath, "utf8") === oldLines.join("\n") + "\n", "expected the audit history file to be byte-for-byte unchanged");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // C. a genuinely NEW record appended after the worker is ready -> spoken exactly once.
  await check("C. a new record appended after readiness -> spoken exactly once", async () => {
    const { dir, auditPath, cursorPath } = tempPaths();
    try {
      writeFileSync(auditPath, auditLine({ status: "BLOCKED", summary: "old, pre-start record" }) + "\n", "utf8");
      initializeLiveCursor({ auditPath, cursorPath }); // worker becomes "ready" here — cursor now pinned past the old record.

      const newText = "brand new live record, occurred after startup";
      const before = readFileSync(auditPath, "utf8");
      writeFileSync(auditPath, before + auditLine({ status: "COMPLETED", summary: newText }) + "\n", "utf8");

      const { speak, calls } = fakeSpeaker();
      const result = await consume({ auditPath, cursorPath }, speak);
      assert(calls.length === 1, `expected exactly one new record spoken, got ${calls.length}: ${JSON.stringify(calls)}`);
      assert(calls[0]!.includes(newText), `expected the spoken text to include the new record's summary, got "${calls[0]}"`);
      assert(result.spoken.length === 1, "expected consume()'s own spoken list to report exactly one item");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // D. invalid/corrupt cursor file -> initializeLiveCursor still resets cleanly to real EOF, never throws.
  await check("D. invalid/corrupt cursor JSON -> initializeLiveCursor still resets to real EOF", async () => {
    const { dir, auditPath, cursorPath } = tempPaths();
    try {
      writeFileSync(auditPath, auditLine() + "\n", "utf8");
      writeFileSync(cursorPath, "{ not valid json !!", "utf8");
      const auditSize = readFileSync(auditPath, "utf8").length;

      const eof = initializeLiveCursor({ auditPath, cursorPath });
      assert(eof === auditSize, `expected EOF to equal the real audit file size (${auditSize}) despite a corrupt cursor, got ${eof}`);
      const persisted = JSON.parse(readFileSync(cursorPath, "utf8"));
      assert(persisted.offset === auditSize, "expected the corrupt cursor file to be overwritten with a real, valid offset");

      const { speak, calls } = fakeSpeaker();
      await consume({ auditPath, cursorPath }, speak);
      assert(calls.length === 0, "expected nothing spoken — the one existing record predates this 'restart'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // E. no new record between polls -> speak is never called, and the cursor does not spuriously advance past the real end of file.
  await check("E. no new record -> speak never called across repeated polls", async () => {
    const { dir, auditPath, cursorPath } = tempPaths();
    try {
      writeFileSync(auditPath, auditLine() + "\n", "utf8");
      initializeLiveCursor({ auditPath, cursorPath });

      const { speak, calls } = fakeSpeaker();
      await consume({ auditPath, cursorPath }, speak);
      await consume({ auditPath, cursorPath }, speak);
      await consume({ auditPath, cursorPath }, speak);
      assert(calls.length === 0, `expected zero speak calls across three consecutive no-op polls, got ${calls.length}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // F. dry_run and non-speakable statuses are still correctly filtered even under the new live-only cursor.
  await check("F. dry_run / non-speakable status records are still filtered out after a live restart", async () => {
    const { dir, auditPath, cursorPath } = tempPaths();
    try {
      writeFileSync(auditPath, "", "utf8");
      initializeLiveCursor({ auditPath, cursorPath });
      const lines = [
        auditLine({ status: "COMPLETED", dry_run: true, summary: "dry run — must not speak" }),
        auditLine({ ui_action: "speak", status: "COMPLETED", summary: "speak action itself — must not re-speak" }),
        auditLine({ status: "RECEIVED", summary: "not a speakable status" }),
      ];
      writeFileSync(auditPath, lines.join("\n") + "\n", "utf8");

      const { speak, calls } = fakeSpeaker();
      await consume({ auditPath, cursorPath }, speak);
      assert(calls.length === 0, `expected all three filtered records to produce zero speak calls, got ${calls.length}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // G. multi-byte characters before the cursor must never break new-record detection (real bug caught during live verification: string-index slicing on a byte offset silently drops to an empty chunk once enough multi-byte drift accumulates).
  await check("G. multi-byte (em dash) content before the cursor does not prevent a genuinely new record from being spoken", async () => {
    const { dir, auditPath, cursorPath } = tempPaths();
    try {
      // Many em-dash-bearing lines, matching the real historical shape that exposed this bug live.
      const emDashLines = Array.from({ length: 400 }, () => auditLine({ ui_action: "open_app", status: "BLOCKED", summary: "Refused: this target touches a credential/MFA/Keychain surface — never automated" }));
      writeFileSync(auditPath, emDashLines.join("\n") + "\n", "utf8");
      initializeLiveCursor({ auditPath, cursorPath }); // ready — cursor now at the real byte EOF, past all the em-dash content.

      const newText = "genuinely new record after multi-byte backlog";
      const before = readFileSync(auditPath);
      writeFileSync(auditPath, Buffer.concat([before, Buffer.from(auditLine({ status: "COMPLETED", summary: newText }) + "\n", "utf8")]));

      const { speak, calls } = fakeSpeaker();
      const result = await consume({ auditPath, cursorPath }, speak);
      assert(calls.length === 1, `expected the new record to be spoken despite heavy multi-byte content before the cursor, got ${calls.length} calls: ${JSON.stringify(calls)}`);
      assert(calls[0]!.includes(newText), `expected the spoken text to include the new record, got "${calls[0]}"`);
      assert(result.consumed === Buffer.byteLength(readFileSync(auditPath, "utf8")), "expected the cursor to advance to the real byte end of file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // safeText — unchanged shape/behavior sanity check.
  await check("safeText formats action/status/summary as before", () => {
    const text = safeText({ order: { ui_action: "open_app" }, outcome: { status: "BLOCKED", summary: "x" } });
    assert(text === "DNA OS: open_app BLOCKED. x", `unexpected format: ${text}`);
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
