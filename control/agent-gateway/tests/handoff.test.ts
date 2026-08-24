import { recordHandoff, validateHandoff } from "../handoff";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(value: boolean, message: string): void { if (!value) throw new Error(message); }
async function check(name: string, body: () => void): Promise<void> { try { body(); passed++; console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); } }

const base = {
  task_id: "task_handoff_1", agent_id: "codex", role: "credential-scope-config-test", input_reference: "work-order://credential-keychain/1",
  files_read: ["credentials/macos-keychain/provider.ts"], files_changed: ["credentials/macos-keychain/provider.ts"], tests_run: ["npx tsc --noEmit"],
  status: "VERIFIED" as const, evidence_refs: ["evidence://test/keychain-provider"], blockers: [], next_action: "Claude Code reviews the Keychain adapter boundary",
};

async function main(): Promise<void> {
  await check("accepts a complete Codex handoff", () => { const result = validateHandoff(base); assert(result.ok, result.reason_codes.join(",")); });
  await check("rejects secret-bearing input references", () => { const result = validateHandoff({ ...base, input_reference: "password=hunter2" }); assert(!result.ok && result.reason_codes.includes("INPUT_REFERENCE_INVALID_OR_SECRET_BEARING"), "secret reference was admitted"); });
  await check("rejects forbidden files and production business changes", () => { const result = validateHandoff({ ...base, files_read: [".env.local"], files_changed: ["app/business/orders.ts"] }); assert(!result.ok && result.reason_codes.includes("FORBIDDEN_FILE_OR_PATH") && result.reason_codes.includes("PRODUCTION_BUSINESS_FILE_FORBIDDEN"), "forbidden file was admitted"); });
  await check("requires structured recovery information for BLOCKED", () => { const result = validateHandoff({ ...base, status: "BLOCKED", tests_run: [], evidence_refs: [], blockers: [], next_action: null }); assert(!result.ok && result.reason_codes.includes("BLOCKED_REQUIRES_BLOCKER_AND_NEXT_ACTION"), "incomplete blocked handoff was admitted"); });
  await check("persists an admitted handoff through the existing task store", () => { const result = recordHandoff(base); assert(result.ok && result.handoff.task_id === base.task_id && result.handoff.handoff_id.startsWith("handoff_"), "handoff was not persisted"); });
  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}
void main();
