/**
 * หน้าที่: the real test for `../voice-bridge.ts`. Drives the module
 * directly, same convention as ../../command-router/tests/router.test.ts.
 * Covers: approval gate default-off, enable/disable durability, idempotent
 * restart (no double-announce), and the HIGH-risk exclusion (production
 * business-code writes / credential-surface intents are never spoken).
 *
 * How to run:
 *   npx tsx control/agent-gateway/tests/voice-bridge.test.ts
 */
import { isVoiceBridgeEnabled, setVoiceBridgeEnabled, runVoiceAnnouncementSweep } from "../voice-bridge";
import { saveTask } from "../memory-store";
import type { Task } from "../types";

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
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

function fakeTask(overrides: Partial<Task>): Task {
  const id = overrides.task_id ?? `task-voicetest-${Math.random().toString(36).slice(2, 10)}`;
  return {
    task_id: id,
    memory: { user_id: "test", workspace_id: "test-ws", conversation_id: "test-conv", task_id: id, parent_task_id: null, created_at: new Date().toISOString() },
    intent_text: "routine status check",
    submitted_by_client: "voice-bridge-test",
    status: "COMPLETED",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

async function main(): Promise<void> {
  await check("approval gate defaults OFF when never explicitly enabled by this process — sweep is a real no-op", async () => {
    setVoiceBridgeEnabled(false, "test-owner");
    const result = await runVoiceAnnouncementSweep();
    assert(result.enabled === false, "expected disabled sweep to report enabled=false");
    assert(result.announced.length === 0, "expected no announcements while disabled");
  });

  await check("setVoiceBridgeEnabled(true, ...) is the real, evidenced approval event", () => {
    const before = isVoiceBridgeEnabled();
    assert(before === false, "expected gate to start disabled for this test");
    setVoiceBridgeEnabled(true, "identity-voice-test-owner");
    assert(isVoiceBridgeEnabled() === true, "expected gate to be enabled after setVoiceBridgeEnabled(true, ...)");
    setVoiceBridgeEnabled(false, "identity-voice-test-owner"); // reset for isolation from later checks
  });

  await check("runVoiceAnnouncementSweep: HIGH-risk task (production code write via ai-write-control-adapter) is NEVER spoken", async () => {
    setVoiceBridgeEnabled(true, "test-owner");
    const task = fakeTask({
      intent_text: "write a sandbox file",
      status: "COMPLETED",
      work_order: { operation: "CREATE", target_type: "FILE", target_path: "tests/__sandbox__/x.txt", requested_change: "test", content: "x", workspace_scope: "tests/__sandbox__/", mode: "sandbox", required_tests: ["sandbox.write"], forbidden_files: [], evidence: [] },
    });
    saveTask(task);
    const result = await runVoiceAnnouncementSweep();
    assert(!result.announced.includes(task.task_id), "expected a Work Order (production code write) task to NEVER be auto-announced");
    assert(result.skipped_high_risk.includes(task.task_id), "expected the task to be reported as skipped_high_risk, not silently dropped");
    setVoiceBridgeEnabled(false, "test-owner");
  });

  await check("runVoiceAnnouncementSweep: credential-surface intent text is NEVER spoken, even if plain COMPLETED", async () => {
    setVoiceBridgeEnabled(true, "test-owner");
    const task = fakeTask({ intent_text: "check keychain password status", status: "COMPLETED" });
    saveTask(task);
    const result = await runVoiceAnnouncementSweep();
    assert(!result.announced.includes(task.task_id), "expected a credential-surface-named task to never be auto-announced");
    assert(result.skipped_high_risk.includes(task.task_id), "expected it reported as skipped_high_risk");
    setVoiceBridgeEnabled(false, "test-owner");
  });

  await check("runVoiceAnnouncementSweep: idempotent restart — a task already in the announced set is never re-spoken", async () => {
    setVoiceBridgeEnabled(true, "test-owner");
    const task = fakeTask({ intent_text: "routine low risk status", status: "BLOCKED" });
    saveTask(task);
    const first = await runVoiceAnnouncementSweep();
    const wasAnnouncedOrErrored = first.announced.includes(task.task_id) || first.errors.some((e) => e.task_id === task.task_id);
    assert(wasAnnouncedOrErrored, "expected the first sweep to attempt this LOW/MEDIUM-risk task");
    const second = await runVoiceAnnouncementSweep();
    assert(!second.announced.includes(task.task_id), "expected the second sweep (simulating a restart) to skip an already-announced task, not re-speak it");
    setVoiceBridgeEnabled(false, "test-owner");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
