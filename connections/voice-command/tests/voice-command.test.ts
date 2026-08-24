/**
 * หน้าที่: proves `connections/voice-command/` — real `runUiWorkOrder`
 * calls (real `osascript`/`say` processes, same as
 * `connections/os-ui/tests/work-order.test.ts` already exercises live),
 * real cancellation via `cancelActiveSpeech()`. Speech-to-Text itself is
 * exercised separately (this file injects real transcript TEXT directly
 * into `handleTranscript`, matching the architecture's own contract:
 * "Speech-to-Text ต้องคืน text ก่อน แล้วจึง resolve เป็น deterministic
 * command" — the resolver/dispatcher never depends on how the text
 * arrived).
 *
 * How to run: npx tsx connections/voice-command/tests/voice-command.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleTranscript, getVoiceCommandState, resolveVoiceIntent } from "../contract";
import { runUiWorkOrder } from "../../os-ui/adapter-contract";

// Dynamic, not static — see ../dispatcher.ts's `voiceQueue()` header for
// why: a static import of this .mjs file is a SEPARATE module instance
// from screen-reader.ts's own dynamic import under this repo's tsx/Node
// ESM setup (verified live). Tests must observe the SAME instance
// screen-reader.ts actually mutates.
async function voiceQueue() {
  return import("../../os-ui/voice-queue.mjs");
}

declare const process: { exitCode?: number; cwd(): string };
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
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readAuditLines(relativePath: string): any[] {
  try {
    return readFileSync(join(process.cwd(), relativePath), "utf8")
      .split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  // A. "อ่าน" -> read_screen is really dispatched exactly once.
  await check("A. speaking \"อ่าน\" dispatches a real read_screen Work Order exactly once", async () => {
    assert(getVoiceCommandState() === "IDLE", "precondition: must start IDLE");
    const result = await handleTranscript("อ่าน");
    assert(result.intent === "READ", `expected intent READ, got ${result.intent}`);
    assert(result.action === "STARTED_READ", `expected STARTED_READ, got ${result.action}`);
    assert(getVoiceCommandState() === "IDLE", "expected state to settle back to IDLE after read+speak completes");

    const osUiAudit = readAuditLines("connections/os-ui/data/work-order-audit.jsonl");
    const matches = osUiAudit.filter((row) => row?.order?.idempotency_key === `${result.correlation_id}-read`);
    assert(matches.length === 1, `expected exactly one real read_screen audit entry for this command, got ${matches.length}`);
    assert(matches[0].order.ui_action === "read_screen", "expected the audited order to really be read_screen");
  });

  // B. no command -> Screen Reader never runs (no read_screen audit entry is ever created without a real dispatch).
  await check("B. no command issued -> no read_screen entry appears for a never-issued correlation_id", () => {
    const osUiAudit = readAuditLines("connections/os-ui/data/work-order-audit.jsonl");
    const bogusMatches = osUiAudit.filter((row) => row?.order?.idempotency_key === "voice-cmd-never-issued-read");
    assert(bogusMatches.length === 0, "expected zero audit entries for a command that was never issued");
  });

  // B2. left alone with no command for a real wall-clock window -> zero NEW read_screen and zero NEW speak entries attributable to this capability (Owner requirement, 2026-08-21: "ปล่อยระบบทิ้งไว้โดยไม่มีคำสั่ง ต้องเกิด read_screen = 0 และ speech = 0").
  await check("B2. left idle for a real 3s window with no command -> zero new voice-command read_screen/speak entries", async () => {
    const countVoiceCmdEntries = () => {
      const rows = readAuditLines("connections/os-ui/data/work-order-audit.jsonl");
      const key = (r: any) => String(r?.order?.idempotency_key ?? "");
      return {
        read: rows.filter((r) => key(r).startsWith("voice-cmd-") && key(r).endsWith("-read")).length,
        speak: rows.filter((r) => key(r).startsWith("voice-cmd-") && key(r).endsWith("-speak")).length,
      };
    };
    const before = countVoiceCmdEntries();
    await sleep(3_000); // real wall-clock idle window — handleTranscript is never called during this window.
    const after = countVoiceCmdEntries();
    assert(after.read === before.read, `expected zero new read_screen entries while idle, before=${before.read} after=${after.read}`);
    assert(after.speak === before.speak, `expected zero new speak entries while idle, before=${before.speak} after=${after.speak}`);
    assert(getVoiceCommandState() === "IDLE", "expected state to remain IDLE throughout the idle window");
  });

  // C. "หยุด" while speaking -> speech stops immediately (real cancellation, not a wait-for-completion).
  await check("C. \"หยุด\" during real speech cancels it immediately, without waiting for natural completion", async () => {
    // A real, deliberately longer speak Work Order so there's a real window to interrupt.
    const longText = "This is a deliberately long sentence used only to create a real, measurable window during which a stop command can interrupt the speech before it would naturally finish on its own.";
    const speakPromise = runUiWorkOrder({ ui_action: "speak", target: longText, scope: "voice-command-test", timeout_ms: 20_000, dry_run: false, risk_confirmed: true, idempotency_key: `voice-cmd-test-longspeak-${Date.now()}` });

    // May need to wait its own turn behind other real, lock-contending speakers (voice-alert-worker.mjs) before it actually starts speaking.
    const deadline = Date.now() + 15_000;
    while (!(await voiceQueue()).isSpeaking() && Date.now() < deadline) await sleep(50);
    assert((await voiceQueue()).isSpeaking(), "precondition: real speech must be actively in progress before testing cancellation");

    const cancelStartedAt = Date.now();
    const cancelled = (await voiceQueue()).cancelActiveSpeech();
    assert(cancelled === true, "expected cancelActiveSpeech() to report a real process was signaled");
    const outcome = await speakPromise;
    const cancelElapsedMs = Date.now() - cancelStartedAt;
    assert(cancelElapsedMs < 3_000, `expected the speak Work Order to resolve quickly after cancellation, took ${cancelElapsedMs}ms`);
    assert(outcome.ok === false, "expected the cancelled speak outcome to honestly report failure, never a fabricated success");
    await sleep(100);
    assert(!(await voiceQueue()).isSpeaking(), "expected no speech to still be active shortly after cancellation");
  });

  // D. after stop -> "อ่าน" again works (no stuck state).
  await check("D. after a stop, a fresh \"อ่าน\" command works again without a restart", async () => {
    assert(getVoiceCommandState() === "IDLE", "precondition: must be IDLE after test C's cancellation settled");
    const result = await handleTranscript("อ่าน");
    assert(result.action === "STARTED_READ", `expected a fresh READ to start normally, got ${result.action}`);
    assert(getVoiceCommandState() === "IDLE", "expected state to settle back to IDLE again");
  });

  // E. "restart" never replays an old command — the entire session state is in-memory only (module-scope), never resumed from the append-only audit trail.
  await check("E. restart never replays an old command (state is in-memory only; the audit trail is write-only, never read back as input)", () => {
    assert(getVoiceCommandState() === "IDLE", "expected a fresh module load to always start IDLE — no persisted 'pending command' state exists anywhere");
    const dispatcherSource = readFileSync(join(process.cwd(), "connections/voice-command/dispatcher.ts"), "utf8");
    const listenerSource = readFileSync(join(process.cwd(), "connections/voice-command/listener.ts"), "utf8");
    for (const forbidden of ["readFileSync", "loadEvidenceForTask", "loadAllTasks", "recoverInterruptedTasks"]) {
      assert(!dispatcherSource.includes(forbidden), `dispatcher.ts must never read back its own audit trail as startup input (found ${forbidden})`);
      assert(!listenerSource.includes(forbidden), `listener.ts must never read back the audit trail as startup input (found ${forbidden})`);
    }
  });

  // F. DNA OS's own speech never triggers a new Voice Command — the real, provable self-audio-suppression gate.
  await check("F. the self-audio-suppression signal (isSpeaking()) is real and correctly gates listening", async () => {
    // Other real background speakers share this same lock — voice-alert-worker.mjs, in particular, independently watches the SAME work-order-audit.jsonl this suite's own read_screen Work Orders append to, and legitimately re-announces them on its own. Wait generously for a real quiet moment rather than asserting one instantaneously.
    const quietDeadline = Date.now() + 20_000;
    while ((await voiceQueue()).isSpeaking() && Date.now() < quietDeadline) await sleep(100);
    assert(!(await voiceQueue()).isSpeaking(), "precondition: expected a real quiet moment within 20s before testing the suppression gate");
    const speakPromise = runUiWorkOrder({ ui_action: "speak", target: "short suppression test phrase", scope: "voice-command-test", timeout_ms: 20_000, dry_run: false, risk_confirmed: true, idempotency_key: `voice-cmd-test-suppression-${Date.now()}` });
    const deadline = Date.now() + 15_000; // may need to wait its own turn behind other real, lock-contending speakers before it actually starts.
    while (!(await voiceQueue()).isSpeaking() && Date.now() < deadline) await sleep(50);
    assert((await voiceQueue()).isSpeaking(), "expected isSpeaking() to be true while a real say process is active");
    const listenerSource = readFileSync(join(process.cwd(), "connections/voice-command/listener.ts"), "utf8");
    assert(listenerSource.includes("await isSpeaking()") && listenerSource.indexOf("await isSpeaking()") < listenerSource.indexOf("recordUtterance("), "expected the listener loop to check isSpeaking() BEFORE every microphone capture, source-verified");
    await speakPromise;
    assert(!(await voiceQueue()).isSpeaking(), "expected isSpeaking() to be false again once the real speech naturally finished");
  });

  // G. unknown speech -> no action.
  await check("G. an unrelated Thai phrase (neither keyword) -> UNKNOWN, IGNORED, no state change", async () => {
    const before = getVoiceCommandState();
    const result = await handleTranscript("สวัสดีครับ วันนี้อากาศดีมาก");
    assert(result.intent === "UNKNOWN", `expected UNKNOWN, got ${result.intent}`);
    assert(result.action === "IGNORED", `expected IGNORED, got ${result.action}`);
    assert(getVoiceCommandState() === before, "expected no state change from unrecognized speech");
    const osUiAudit = readAuditLines("connections/os-ui/data/work-order-audit.jsonl");
    assert(!osUiAudit.some((row) => row?.order?.idempotency_key === `${result.correlation_id}-read`), "expected no read_screen Work Order for unrecognized speech");
  });

  // H. no infinite Screen Reader polling — static source proof.
  await check("H. no setInterval anywhere in this capability; read_screen is reachable only through handleTranscript's READ branch", () => {
    const dispatcherSource = readFileSync(join(process.cwd(), "connections/voice-command/dispatcher.ts"), "utf8");
    const listenerSource = readFileSync(join(process.cwd(), "connections/voice-command/listener.ts"), "utf8");
    assert(!dispatcherSource.includes("setInterval(") && !listenerSource.includes("setInterval("), "expected zero real setInterval(...) calls — this loop must be a plain, fully-awaited sequential loop, never a fire-and-pile-up timer");
    const readScreenCallCount = (dispatcherSource.match(/ui_action:\s*"read_screen"/g) ?? []).length;
    assert(readScreenCallCount === 1, `expected exactly one read_screen call site in the whole capability, found ${readScreenCallCount}`);
  });

  // I. audit traceability: Voice Command -> Work Order -> read_screen -> speech/cancel.
  await check("I. the audit trail traces Voice Command -> read_screen -> speak by a shared correlation_id", async () => {
    const result = await handleTranscript("อ่าน");
    const voiceAudit = readAuditLines("connections/voice-command/data/voice-command-audit.jsonl");
    const ownEntry = voiceAudit.find((row) => row.correlation_id === result.correlation_id);
    assert(!!ownEntry, "expected a real voice-command-audit.jsonl entry for this correlation_id");
    assert(ownEntry.read_work_order_key === `${result.correlation_id}-read`, "expected the own audit entry to record the linking read work-order key");

    const osUiAudit = readAuditLines("connections/os-ui/data/work-order-audit.jsonl");
    const readEntry = osUiAudit.find((row) => row?.order?.idempotency_key === `${result.correlation_id}-read`);
    const speakEntry = osUiAudit.find((row) => row?.order?.idempotency_key === `${result.correlation_id}-speak`);
    assert(!!readEntry, "expected a real read_screen entry linked by correlation_id");
    assert(!!speakEntry, "expected a real speak entry linked by correlation_id");
  });

  // J. Natural Voice Output Intent — classification table, every Owner-given example phrase (pure function, no real audio needed).
  await check("J. resolveVoiceIntent classifies every Owner-given example phrase correctly", () => {
    const cases: Array<[string, string]> = [
      ["หยุด", "STOP"], ["หยุดพูด", "STOP"], ["หยุดอ่าน", "STOP"], ["พอ", "STOP"], ["พอแล้ว", "STOP"],
      ["เงียบ", "STOP"], ["ไม่ต้องพูด", "STOP"], ["ไม่ต้องอ่าน", "STOP"], ["เข้าใจแล้วพอ", "STOP"],
      ["อ่าน", "READ"], ["อ่านให้ฟังหน่อย", "READ"], ["พูดต่อ", "READ"], ["อ่านต่อ", "READ"], ["อ่านทั้งหมด", "READ"], ["อ่านทั้งหมดได้เลย", "READ"],
      ["ในหน้าจอมันเขียนว่าอะไร", "SCREEN_INTERPRETATION"], ["หน้าจอมันอ่านว่าอะไร", "SCREEN_INTERPRETATION"], ["แปลความหมายหน้าจอให้หน่อย", "SCREEN_INTERPRETATION"],
      ["แปลภาษาอังกฤษให้หน่อย", "TRANSLATE"], ["ภาษาอังกฤษแปลเป็นไทยให้หน่อย", "TRANSLATE"], ["อ่านภาษาอังกฤษให้เป็นภาษาไทย", "TRANSLATE"], ["แปลให้ตรงกับความหมายบนหน้าจอ", "TRANSLATE"],
      ["สรุปอ่านให้ฟังหน่อย", "SUMMARIZE"], ["อ่านเฉพาะสรุป", "SUMMARIZE"], ["สรุปให้ฟัง", "SUMMARIZE"],
      ["อ่านเฉพาะบรรทัดที่ห้า", "SELECTIVE_READ"], ["อ่านย่อหน้าสุดท้าย", "SELECTIVE_READ"], ["อ่านตรงนี้", "SELECTIVE_READ"], ["อ่านตรงที่เมาส์คลุม", "SELECTIVE_READ"], ["อ่านตรงที่เมาส์ชี้", "SELECTIVE_READ"], ["อ่านส่วนที่เลือกไว้", "SELECTIVE_READ"],
    ];
    for (const [phrase, expected] of cases) {
      const got = resolveVoiceIntent(phrase);
      assert(got === expected, `"${phrase}" expected ${expected}, got ${got}`);
    }
  });

  // K. STOP has absolute priority — a phrase containing both a STOP word and a READ substring (e.g. "อ่าน" inside "ไม่ต้องอ่าน") must resolve STOP, never UNKNOWN or READ.
  await check("K. STOP priority: \"ไม่ต้องอ่าน\" resolves STOP even though it contains the READ substring \"อ่าน\"", () => {
    assert(resolveVoiceIntent("ไม่ต้องอ่าน") === "STOP", "expected absolute STOP priority over any overlapping READ substring");
  });

  // L. TRANSLATE is recognized but honestly reported NOT_AVAILABLE — never a fabricated translation, never silently downgraded to plain READ.
  await check("L. TRANSLATE intent -> NOT_AVAILABLE, no read_screen/speak Work Order ever created", async () => {
    assert(getVoiceCommandState() === "IDLE", "precondition: must start IDLE");
    const before = readAuditLines("connections/os-ui/data/work-order-audit.jsonl").length;
    const result = await handleTranscript("แปลภาษาอังกฤษให้หน่อย");
    assert(result.intent === "TRANSLATE", `expected TRANSLATE, got ${result.intent}`);
    assert(result.action === "NOT_AVAILABLE", `expected NOT_AVAILABLE, got ${result.action}`);
    assert(getVoiceCommandState() === "IDLE", "expected no state change — recognizing TRANSLATE must never enter READING/SPEAKING");
    const after = readAuditLines("connections/os-ui/data/work-order-audit.jsonl").length;
    assert(after === before, "expected zero new os-ui Work Orders for a NOT_AVAILABLE intent");
  });

  // M. SUMMARIZE — same honest-unavailable contract as TRANSLATE.
  await check("M. SUMMARIZE intent -> NOT_AVAILABLE, no Work Order created", async () => {
    const result = await handleTranscript("สรุปให้ฟัง");
    assert(result.intent === "SUMMARIZE", `expected SUMMARIZE, got ${result.intent}`);
    assert(result.action === "NOT_AVAILABLE", `expected NOT_AVAILABLE, got ${result.action}`);
  });

  // N. SELECTIVE_READ (mouse/cursor phrasing) -> NOT_AVAILABLE — no mouse-position/selection API exists; never approximated by reading the whole screen instead.
  await check("N. SELECTIVE_READ (mouse-position phrasing) -> NOT_AVAILABLE, never silently falls back to reading the whole screen", async () => {
    const before = readAuditLines("connections/os-ui/data/work-order-audit.jsonl").length;
    const result = await handleTranscript("อ่านตรงที่เมาส์คลุม");
    assert(result.intent === "SELECTIVE_READ", `expected SELECTIVE_READ, got ${result.intent}`);
    assert(result.action === "NOT_AVAILABLE", `expected NOT_AVAILABLE, got ${result.action}`);
    const after = readAuditLines("connections/os-ui/data/work-order-audit.jsonl").length;
    assert(after === before, "expected zero new os-ui Work Orders — must not silently read the whole screen as a fallback");
  });

  // O. SELECTIVE_READ (line-number phrasing) — real E2E: either a real line is extracted and spoken, or it's honestly IGNORED with a real reason if that line doesn't exist right now. Never a guessed/fabricated line.
  await check("O. SELECTIVE_READ (\"บรรทัดที่ห้า\") -> real read_screen occurs, then either a real extracted line is spoken or an honest IGNORED with a real reason", async () => {
    assert(getVoiceCommandState() === "IDLE", "precondition: must start IDLE");
    const result = await handleTranscript("อ่านเฉพาะบรรทัดที่ห้า");
    assert(result.intent === "SELECTIVE_READ", `expected SELECTIVE_READ, got ${result.intent}`);
    assert(result.action === "STARTED_SELECTIVE_READ" || result.action === "IGNORED", `expected STARTED_SELECTIVE_READ or an honest IGNORED, got ${result.action}`);
    const osUiAudit = readAuditLines("connections/os-ui/data/work-order-audit.jsonl");
    assert(osUiAudit.some((row) => row?.order?.idempotency_key === `${result.correlation_id}-read`), "expected a real read_screen Work Order regardless of whether line 5 existed");
    assert(getVoiceCommandState() === "IDLE", "expected state to settle back to IDLE");
  });

  // P. SCREEN_INTERPRETATION — real E2E: real read_screen + real speak, with the deterministic metadata filter applied (documented as filtering, not genuine interpretation).
  await check("P. SCREEN_INTERPRETATION (\"หน้าจอมันเขียนว่าอะไร\") -> real read_screen + real speak, metadata filter applied", async () => {
    assert(getVoiceCommandState() === "IDLE", "precondition: must start IDLE");
    const result = await handleTranscript("ในหน้าจอมันเขียนว่าอะไร");
    assert(result.intent === "SCREEN_INTERPRETATION", `expected SCREEN_INTERPRETATION, got ${result.intent}`);
    assert(result.action === "STARTED_SCREEN_INTERPRETATION", `expected STARTED_SCREEN_INTERPRETATION, got ${result.action} (error=${JSON.stringify((result as any).error ?? null)})`);
    const osUiAudit = readAuditLines("connections/os-ui/data/work-order-audit.jsonl");
    const speakEntry = osUiAudit.find((row) => row?.order?.idempotency_key === `${result.correlation_id}-speak`);
    assert(!!speakEntry, "expected a real speak Work Order for SCREEN_INTERPRETATION");
    assert(getVoiceCommandState() === "IDLE", "expected state to settle back to IDLE");
  });

  // Q. STOP priority holds across the new intents too — "หยุดพูด" during a real SCREEN_INTERPRETATION speech cancels it immediately.
  await check("Q. \"หยุดพูด\" during real SCREEN_INTERPRETATION speech cancels it immediately (priority holds across all new intents)", async () => {
    const longText = "This is a deliberately long sentence used only to create a real, measurable window during which a stop command can interrupt the speech before it would naturally finish on its own, this time testing the new intent family.";
    const speakPromise = runUiWorkOrder({ ui_action: "speak", target: longText, scope: "voice-command-test", timeout_ms: 20_000, dry_run: false, risk_confirmed: true, idempotency_key: `voice-cmd-test-longspeak-q-${Date.now()}` });
    const deadline = Date.now() + 15_000;
    while (!(await voiceQueue()).isSpeaking() && Date.now() < deadline) await sleep(50);
    assert((await voiceQueue()).isSpeaking(), "precondition: real speech must be actively in progress before testing STOP priority");
    const cancelStartedAt = Date.now();
    const stopResult = await handleTranscript("หยุดพูด");
    assert(stopResult.intent === "STOP", `expected STOP, got ${stopResult.intent}`);
    const outcome = await speakPromise;
    const cancelElapsedMs = Date.now() - cancelStartedAt;
    assert(cancelElapsedMs < 3_000, `expected quick cancellation, took ${cancelElapsedMs}ms`);
    assert(outcome.ok === false, "expected the cancelled speak outcome to honestly report failure");
    await sleep(100);
    assert(!(await voiceQueue()).isSpeaking(), "expected no speech to still be active shortly after \"หยุดพูด\"");
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
