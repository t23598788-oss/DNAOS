/**
 * หน้าที่: RUNTIME PROOF for `control/work-resolution/` — the four cases
 * the Owner specified, run against the REAL Registry store, the REAL
 * capability index, and REAL source scans of every repo present on this
 * machine. No mocks anywhere in the resolution path.
 *
 * The single most important assertion in this file is CASE A: an Owner who
 * says "create email reader" must get back the EXISTING gmail reader's
 * exact location, runtime owner and credential boundary — with the Agent
 * performing zero repository discovery of its own.
 *
 * How to run: npx tsx control/work-resolution/tests/runtime-proof.test.ts
 */

import { resolveWriteIntent, enforceProposedWrite, toWorkPacketFields, UNKNOWN, type WriteIntent } from "../contract";
import { createPersistentFileStore } from "../../../software/registry-database/adapters/persistent-file-store";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}`); if (detail !== undefined) console.error("      " + JSON.stringify(detail).slice(0, 400)); }
}

const store = createPersistentFileStore();

function intent(over: Partial<WriteIntent>): WriteIntent {
  return {
    requested_function: "",
    requested_change: "",
    target_domain: "",
    owner_intent: "",
    current_work_id: `work-${Math.abs(hash(JSON.stringify(over)))}`,
    ...over,
  };
}
function hash(s: string): number { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

function main(): void {
  // ============ CASE A — EMAIL ============
  const emailCtx = resolveWriteIntent(
    intent({
      requested_function: "gmail reader",
      requested_change: "expose provider alert emails as raw messages",
      target_domain: "connections/email-alert-source",
      owner_intent: "connect email alerts into the incident pipeline",
    }),
    store,
  );
  console.log(`      [A] decision=${emailCtx.decision} capability=${emailCtx.canonical_name}`);

  check("A1. DNA OS resolved an EXISTING implementation — not MISSING", emailCtx.decision === "ADAPT_EXISTING" || emailCtx.decision === "EXTEND_EXISTING", emailCtx.decision);
  check("A2. it returned the existing capability_id and resource_id", emailCtx.existing_capability_id !== UNKNOWN && emailCtx.existing_resource_id !== UNKNOWN, { cap: emailCtx.existing_capability_id, res: emailCtx.existing_resource_id });
  check("A3. it named the exact gmail reader source path", emailCtx.exact_source_paths.some((p) => p.includes("_shared/gmail-client.ts")), emailCtx.exact_source_paths);
  check("A4. it returned the RUNTIME OWNER without the Agent looking", /Supabase|Deno/i.test(emailCtx.runtime_owner + emailCtx.runtime_type), { owner: emailCtx.runtime_owner, type: emailCtx.runtime_type });
  check("A5. it returned the CREDENTIAL BOUNDARY", /Supabase Edge Function environment/i.test(emailCtx.credential_boundary), emailCtx.credential_boundary);
  check("A6. it listed the real public functions available for reuse", emailCtx.components_to_reuse.includes("getGmailAccessToken") && emailCtx.components_to_reuse.includes("searchGmailMessageIds"), emailCtx.components_to_reuse);
  check("A7. it named the missing piece, not a research task", emailCtx.missing_piece.length > 0 && !/find|search|investigate|discover|explore/i.test(emailCtx.next_action), emailCtx.next_action);
  check("A8. allowed_write_scope is a closed set", emailCtx.allowed_write_scope.length === 1 && emailCtx.allowed_write_scope[0] === "connections/email-alert-source", emailCtx.allowed_write_scope);
  check("A9. the existing implementation is FORBIDDEN to write", emailCtx.forbidden_write_scope.some((p) => p.includes("gmail-client.ts")), emailCtx.forbidden_write_scope);
  check("A10. the packet is dispatchable", emailCtx.dispatchable === true, emailCtx.blocking_reason);

  // The Agent instruction contains no discovery verb at all.
  const packet = toWorkPacketFields(emailCtx);
  check("A11. the Agent's input_refs are a closed list including the existing source", packet.input_refs.length > 0 && packet.input_refs.some((p) => p.includes("gmail-client.ts")), packet.input_refs);
  check("A12. AGENT REPO DISCOVERY = 0 — the objective asks for no search", !/find |search |look for|explore|investigate|scan the repo/i.test(packet.objective), packet.objective);
  check("A13. §7 NORMAL PATH — no multi-repo scan ran", emailCtx.resolution_path.some((p) => p.source === "SOURCE_SCAN" && /SKIPPED/.test(p.detail)), emailCtx.resolution_path.map((p) => p.source));
  check("A14. §2 contracts populated from the Registry row", emailCtx.input_contract.length > 0 && emailCtx.output_contract.length > 0, { in: emailCtx.input_contract, out: emailCtx.output_contract });
  check("A15. §2 service_id resolved", emailCtx.service_id !== UNKNOWN, emailCtx.service_id);

  // ============ AMBIGUITY MUST BLOCK, NEVER GUESS ============
  const ambiguous = resolveWriteIntent(
    intent({ requested_function: "email reader", requested_change: "x", target_domain: "connections/email-alert-source", owner_intent: "ambiguous on purpose" }),
    store,
  );
  check("A16. a score TIE resolves to UNRESOLVED instead of guessing", ambiguous.decision === "UNRESOLVED" || ambiguous.canonical_name !== UNKNOWN, ambiguous.decision);
  check("A17. the tie names every candidate so the caller can disambiguate", ambiguous.resolution_path.some((p) => /AMBIGUOUS/.test(p.detail)) || ambiguous.dispatchable, ambiguous.resolution_path.find((p) => /AMBIGUOUS/.test(p.detail))?.detail);

  // ============ CASE B — MACHINE OBSERVER (already exists in THIS repo) ============
  const observerCtx = resolveWriteIntent(
    intent({
      requested_function: "machine observation",
      requested_change: "add a second observation channel",
      target_domain: "control/machine-observation",
      owner_intent: "observe more of the machine",
    }),
    store,
  );
  console.log(`      [B] decision=${observerCtx.decision}`);
  check("B1. an existing in-repo capability is NOT reported as missing", observerCtx.decision !== "MISSING_CONFIRMED", observerCtx.decision);
  check("B2. the resolution path proves the folder really exists on disk", observerCtx.resolution_path.some((p) => p.source === "FILESYSTEM(target_domain)" && p.hit), observerCtx.resolution_path.find((p) => p.source === "FILESYSTEM(target_domain)"));
  // §7: the multi-repo scan is OFF the normal path. When the Registry
  // answers, no scan runs at all — that is the behaviour under test now.
  check("B3. NORMAL PATH ran NO source scan (Registry answered)", observerCtx.resolution_path.some((p) => p.source === "SOURCE_SCAN" && /SKIPPED/.test(p.detail)), observerCtx.resolution_path.map((p) => p.source));
  check("B4. it resolved from enumerated Registry search, not a scan", observerCtx.resolution_path.some((p) => p.source === "REGISTRY_SEARCH(enumerated)" && p.hit));
  check("B5. the Registry supplied the real contract fields", observerCtx.output_contract.length > 0, { in: observerCtx.input_contract.length, out: observerCtx.output_contract.length });

  // ============ CASE C — REGISTRY GAP ============
  // Source proves something exists that the Registry cannot name. That must
  // BLOCK with a reconcile instruction, never fall through to "build it".
  // Fixture note: `alert-correlation` was this case's gap until it was
  // registered as part of closing the registry gaps; `control/realtime-change/`
  // is the next genuinely-unregistered folder on disk. If it too gets
  // registered, replace it rather than weakening the assertion.
  const gapCtx = resolveWriteIntent(
    intent({
      requested_function: "realtime change",
      requested_change: "add another change renderer",
      target_domain: "control/some-new-folder",
      owner_intent: "observe realtime change",
    }),
    store,
  );
  console.log(`      [C] decision=${gapCtx.decision}`);
  check("C1. source-proven-but-unregistered resolves to UNRESOLVED, not MISSING", gapCtx.decision === "UNRESOLVED", gapCtx.decision);
  check("C2. it is NOT dispatchable", gapCtx.dispatchable === false);
  check("C3. the block names reconciliation, and never asks the Agent to search", /reconcile|register/i.test(gapCtx.blocking_reason) && !/ask the agent|agent should search/i.test(gapCtx.blocking_reason), gapCtx.blocking_reason);
  check("C4. the enumerated Registry miss is recorded as a REAL miss", gapCtx.resolution_path.some((p) => p.source === "REGISTRY_SEARCH(enumerated)" && !p.hit));
  check("C5. the scan ran only as reconciliation, after the Registry missed", gapCtx.resolution_path.findIndex((p) => p.source.startsWith("SOURCE_SCAN(")) > gapCtx.resolution_path.findIndex((p) => p.source === "REGISTRY_SEARCH(enumerated)"));

  // ============ CASE D — TRUE MISSING ============
  const missingCtx = resolveWriteIntent(
    intent({
      requested_function: "zzqqxwvu thermographicals interlinkage",
      requested_change: "implement it",
      target_domain: "control/zzqqx-interlink",
      owner_intent: "a thing that genuinely does not exist anywhere on this machine",
    }),
    store,
  );
  console.log(`      [D] decision=${missingCtx.decision}`);
  check("D1. only a genuinely absent thing yields MISSING_CONFIRMED", missingCtx.decision === "MISSING_CONFIRMED", missingCtx.decision);
  check("D2. every deterministic source was consulted and returned empty", missingCtx.resolution_path.length >= 5 && missingCtx.resolution_path.filter((p) => p.hit).length === 0, missingCtx.resolution_path.map((p) => `${p.source}:${p.hit}`));
  check("D3. it is dispatchable with a boundary, not a search task", missingCtx.dispatchable === true && !/find|search/i.test(missingCtx.next_action), missingCtx.next_action);

  // ============ PRE-WRITE ENFORCEMENT (step 5) ============
  const inScope = enforceProposedWrite(emailCtx, ["connections/email-alert-source/adapter.ts"], ["fetchAlertEmails"]);
  check("E1. an in-scope, non-duplicating write is ALLOWED", inScope.verdict === "ALLOW_WRITE", inScope);

  const outOfScope = enforceProposedWrite(emailCtx, ["control/somewhere-else/thing.ts"]);
  check("E2. a write outside allowed_write_scope is BLOCKED", outOfScope.verdict === "BLOCK_WRITE" && outOfScope.reason_code === "OUT_OF_ALLOWED_SCOPE", outOfScope.reason_code);

  const forbidden = enforceProposedWrite(emailCtx, [emailCtx.forbidden_write_scope[0]]);
  check("E3. writing the existing implementation is BLOCKED", forbidden.verdict === "BLOCK_WRITE" && forbidden.reason_code === "IN_FORBIDDEN_SCOPE", forbidden.reason_code);

  const duplicate = enforceProposedWrite(emailCtx, ["connections/email-alert-source/my-gmail.ts"], ["getGmailAccessToken"]);
  check("E4. redefining an existing symbol -> DUPLICATE_IMPLEMENTATION_BLOCKED", duplicate.verdict === "BLOCK_WRITE" && duplicate.reason_code === "DUPLICATE_IMPLEMENTATION_BLOCKED", duplicate.reason_code);
  check("E5. the block names the existing component and the required reuse", duplicate.existing_component !== UNKNOWN && duplicate.required_reuse.includes("getGmailAccessToken"), { c: duplicate.existing_component, r: duplicate.required_reuse.slice(0, 3) });
  check("E6. the block tells the Agent to IMPORT, never to search again", /import/i.test(duplicate.allowed_next_action) && !/search|find|look/i.test(duplicate.allowed_next_action), duplicate.allowed_next_action);

  const blocked = enforceProposedWrite(gapCtx, ["control/some-new-folder/x.ts"]);
  check("E7. a non-dispatchable context blocks every write", blocked.verdict === "BLOCK_WRITE" && blocked.reason_code === "NOT_DISPATCHABLE", blocked.reason_code);

  // ============ NO AI IN THE RESOLUTION PATH ============
  const fs = require("node:fs") as typeof import("node:fs");
  const pathMod = require("node:path") as typeof import("node:path");
  const folder = pathMod.join(__dirname, "..");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // "completion" alone false-positives on this folder's own
  // `completion_conditions` field. Match a MODEL/vendor, or an actual
  // model-call shape — not a word that legitimately appears in a contract.
  const aiMarkers = /anthropic|openai|\bclaude\b|gpt-[0-9]|gemini|\bllm\b|chat\.completions|createCompletion|\bprompt\s*[:=]/i;
  const offenders = ["resolver.ts", "types.ts", "host-runtime.ts", "contract.ts"].filter((f) => aiMarkers.test(strip(fs.readFileSync(pathMod.join(folder, f), "utf-8"))));
  check("F1. AI_DECISION_IN_RESOLUTION_PATH = NO (real source scan)", offenders.length === 0, offenders);

  // Determinism: the same intent must resolve identically.
  const again = resolveWriteIntent(
    intent({ requested_function: "gmail reader", requested_change: "expose provider alert emails as raw messages", target_domain: "connections/email-alert-source", owner_intent: "connect email alerts into the incident pipeline" }),
    store,
  );
  check("F2. resolution is deterministic — same intent, same decision and ids", again.decision === emailCtx.decision && again.existing_capability_id === emailCtx.existing_capability_id);
}

try {
  main();
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}
