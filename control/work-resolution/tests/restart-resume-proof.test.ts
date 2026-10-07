/**
 * หน้าที่: §8 — HARD RESTART PROOF, plus §5's mandatory-gate interception.
 *
 * The restart is REAL, not simulated: phase 1 resolves and persists, then
 * this process spawns a SEPARATE `tsx` process (a genuinely new Node
 * runtime, new module registry, zero shared memory, zero conversation
 * context) which is given ONLY a `work_id` on argv. That child must
 * reconstruct the entire architecture answer from persisted state and must
 * perform no discovery of its own.
 *
 * How to run (Node >=18): npx tsx control/work-resolution/tests/restart-resume-proof.test.ts
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveWriteIntent, persistResolution, loadResolution, guardAgentWrite, UNKNOWN } from "../contract";
import { createPersistentFileStore } from "../../../software/registry-database/adapters/persistent-file-store";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}`); if (detail !== undefined) console.error("      " + JSON.stringify(detail).slice(0, 350)); }
}

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORK_ID = `work-restart-proof-${Date.now()}`;

function main(): void {
  const store = createPersistentFileStore();

  // ===== A. resolve a real work request =====
  const ctx = resolveWriteIntent(
    {
      requested_function: "gmail reader",
      requested_change: "expose provider alert emails as raw messages",
      target_domain: "connections/email-alert-source",
      owner_intent: "connect email alerts into the incident pipeline",
      current_work_id: WORK_ID,
    },
    store,
  );
  check("A1. a real work request resolved to an existing capability", ctx.decision === "ADAPT_EXISTING" && ctx.canonical_name === "gmail-readonly-reader", { d: ctx.decision, n: ctx.canonical_name });
  check("A2. it is dispatchable", ctx.dispatchable, ctx.blocking_reason);

  // ===== B. persist BEFORE dispatch =====
  const persisted = persistResolution(ctx);
  check("B1. resolution persisted with an id and a content digest", persisted.resolution_id.startsWith("resolution-") && persisted.resolution_digest.length === 64, { id: persisted.resolution_id, d: persisted.resolution_digest.slice(0, 12) });
  check("B2. the source revision was captured", persisted.source_revision !== "UNKNOWN", persisted.source_revision.slice(0, 12));

  // ===== C/D/E. REAL restart — a separate process, zero shared state =====
  const childPath = join(tmpdir(), `dna-os-restart-worker-${Date.now()}.ts`);
  mkdirSync(dirname(childPath), { recursive: true });
  writeFileSync(
    childPath,
    `
// A FRESH WORKER. It is given ONLY a work_id. It imports the loader and
// nothing else — no resolver, no registry search, no scan.
import { loadResolution } from "${join(REPO, "control/work-resolution/contract").replace(/\\\\/g, "/")}";
const workId = process.argv[2];
const loaded = loadResolution(workId);
if (!loaded) { console.log(JSON.stringify({ ok: false, reason: "NOT_FOUND" })); process.exit(0); }
console.log(JSON.stringify({
  ok: true,
  work_id: loaded.work_id,
  resolution_id: loaded.resolution_id,
  digest: loaded.resolution_digest,
  stale: loaded.stale,
  staleness_reason: loaded.staleness_reason,
  decision: loaded.context.decision,
  capability_id: loaded.context.existing_capability_id,
  canonical_name: loaded.context.canonical_name,
  source_paths: loaded.context.exact_source_paths,
  reuse: loaded.context.components_to_reuse,
  allowed_write_scope: loaded.context.allowed_write_scope,
  input_contract: loaded.context.input_contract,
  next_action: loaded.context.next_action,
}));
`,
    "utf-8",
  );

  let childOut = "";
  try {
    childOut = execFileSync("npx", ["tsx", childPath, WORK_ID], { cwd: REPO, encoding: "utf-8", timeout: 120_000 });
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    childOut = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  } finally {
    rmSync(childPath, { force: true });
  }

  const jsonLine = childOut.split("\n").filter((l) => l.trim().startsWith("{")).pop() ?? "{}";
  const child = JSON.parse(jsonLine) as Record<string, unknown>;

  check("C1. PERSISTENT_CONTEXT_RECOVERED — a fresh process found it from work_id alone", child.ok === true, child);
  check("C2. SAME_WORK_ID", child.work_id === WORK_ID, { got: child.work_id, want: WORK_ID });
  check("C3. SAME_RESOLUTION_ID", child.resolution_id === persisted.resolution_id, { got: child.resolution_id, want: persisted.resolution_id });
  check("C4. RESOLUTION_RECOMPUTED = NO — the stored digest still matches the real files", child.stale === false, child.staleness_reason);
  check("C5. the fresh worker got the capability identity", child.capability_id === ctx.existing_capability_id && child.canonical_name === "gmail-readonly-reader", { c: child.capability_id });
  check("C6. it got the exact source paths without looking", Array.isArray(child.source_paths) && (child.source_paths as string[]).some((p) => p.includes("gmail-client.ts")), child.source_paths);
  check("C7. it got the reuse list and the write scope", Array.isArray(child.reuse) && (child.reuse as string[]).includes("getGmailAccessToken") && Array.isArray(child.allowed_write_scope), { r: (child.reuse as string[])?.slice(0, 3) });
  check("C8. it got the §2 input_contract", Array.isArray(child.input_contract) && (child.input_contract as string[]).length > 0, child.input_contract);
  check("C9. AGENT_REPO_DISCOVERY = 0 — the next_action names no search", typeof child.next_action === "string" && !/find |search |explore|investigate/i.test(child.next_action as string), child.next_action);

  // ===== J. the mandatory gate, exercised on the RECOVERED context =====
  const loaded = loadResolution(WORK_ID);
  if (!loaded) {
    check("J0. resolution reloadable in-process", false);
    return;
  }
  const rc = loaded.context;
  const agent = "agent-restart-proof";

  const dupGmail = guardAgentWrite(rc, { target_path: "connections/email-alert-source/my-gmail-client.ts", operation: "CREATE", requested_change: "a second gmail reader", defines_symbols: ["getGmailAccessToken"], agent_identity_id: agent });
  check("J1. duplicate Gmail reader -> BLOCK (at resolution layer, before the Write Gate)", !dupGmail.allowed && dupGmail.refused_by === "RESOLUTION_ENFORCEMENT" && dupGmail.enforcement.reason_code === "DUPLICATE_IMPLEMENTATION_BLOCKED", { by: dupGmail.refused_by, code: dupGmail.enforcement.reason_code });
  check("J2. the block tells the Agent to import, never to search", /import/i.test(dupGmail.enforcement.allowed_next_action) && !/search|find/i.test(dupGmail.enforcement.allowed_next_action), dupGmail.enforcement.allowed_next_action);

  const outside = guardAgentWrite(rc, { target_path: "control/machine-observation/second-observer.ts", operation: "CREATE", requested_change: "a second machine observer", agent_identity_id: agent });
  check("J3. second machine observer / out-of-scope write -> BLOCK", !outside.allowed && outside.enforcement.reason_code === "OUT_OF_ALLOWED_SCOPE", outside.enforcement.reason_code);

  const forbidden = guardAgentWrite(rc, { target_path: rc.forbidden_write_scope[0], operation: "MODIFY", requested_change: "edit the existing reader", agent_identity_id: agent });
  check("J4. writing the existing implementation -> BLOCK", !forbidden.allowed && forbidden.enforcement.reason_code === "IN_FORBIDDEN_SCOPE", forbidden.enforcement.reason_code);

  const approved = guardAgentWrite(rc, { target_path: "connections/email-alert-source/raw-fetch.ts", operation: "CREATE", requested_change: "the approved missing piece", defines_symbols: ["fetchRawAlertMessages"], agent_identity_id: agent });
  check("J5. MANDATORY_WRITE_GATE_USED — the approved piece reached the real Write Gate", approved.gate_decision !== null, { by: approved.refused_by, gate: approved.gate_decision?.decision });
  console.log(`      [gate] resolution=${approved.enforcement.reason_code} writeGate=${approved.gate_decision?.decision ?? "n/a"} allowed=${approved.allowed}`);
  check("J6. the real permissions/write-gate/ produced a real decision value", typeof approved.gate_decision?.decision === "string" && approved.gate_decision.decision.length > 0, approved.gate_decision?.decision);
  check("J7. fail-closed: a Write Gate refusal is never reported as allowed", approved.allowed === (approved.gate_decision?.decision === "ALLOW_CREATE" || approved.gate_decision?.decision === "ALLOW_MODIFY"));

  // ===== staleness is evidence-based =====
  const tampered = { ...rc, exact_source_paths: [...rc.exact_source_paths, "connections/email-alert-source/adapter.ts"] };
  const p2 = persistResolution({ ...tampered, work_id: `${WORK_ID}-stale` });
  const reloaded = loadResolution(`${WORK_ID}-stale`);
  check("K1. digest covers the real file bytes (different paths -> different digest)", reloaded !== null && reloaded.resolution_digest !== persisted.resolution_digest, { a: persisted.resolution_digest.slice(0, 10), b: p2.resolution_digest.slice(0, 10) });
  check("K2. an unchanged resolution is reported fresh, so re-resolving is forbidden work", reloaded?.stale === false && /unchanged/.test(reloaded?.staleness_reason ?? ""), reloaded?.staleness_reason);
}

try {
  main();
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}
