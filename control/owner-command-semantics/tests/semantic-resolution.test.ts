/**
 * หน้าที่: the six Owner-stated cases for `control/owner-command-semantics/`
 * (Owner, 2026-08-26), run against the real local model and the real
 * registries — no mock model, no stub registry.
 *
 * Cases A–C prove the layer resolves what it can. Cases D–F prove the more
 * important half: that it refuses. A layer that always answers would be worse
 * than none, because every answer would have to be re-checked by hand.
 *
 * How to run (Node >=18, ../../../.nvmrc pins 24; needs the local
 * mlx-community/Qwen3-4B-Instruct-2507-4bit weights already in
 * ~/.cache/huggingface — the model runs with no network):
 * npx tsx control/owner-command-semantics/tests/semantic-resolution.test.ts
 */

declare const require: any;
declare const process: { argv: string[]; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const __dirname: string;

import { resolveOwnerCommandSemantics, resolveCapabilityMention, resolveFromInterpretation, validateAiInterpretation } from "../contract";
import type { AiSemanticInterpretation } from "../types";

const fs = require("node:fs");
const path = require("node:path");

const OWNER = { identity_id: "identity-semantic-test", kind: "human" };
const HISTORY = path.join(__dirname, "..", "data", "semantic-history.jsonl");

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

/** Each case starts from a clean history for this test identity, so a pass can never be inherited from an earlier run. */
function clearTestHistory(): void {
  if (!fs.existsSync(HISTORY)) return;
  const kept = String(fs.readFileSync(HISTORY, "utf8")).split("\n").filter((line: string) => line.trim().length > 0 && !line.includes(OWNER.identity_id));
  fs.writeFileSync(HISTORY, kept.length > 0 ? `${kept.join("\n")}\n` : "");
}

function run(text: string, commandId: string) {
  const outcome = resolveOwnerCommandSemantics(commandId, text, OWNER);
  assert(outcome.ok, `semantic layer produced a contract-valid result for "${text}" — ${outcome.ok ? "" : `${outcome.stage}: ${outcome.reasons.join("; ")}`}`);
  return outcome.ok ? outcome.context : undefined!;
}

function main(): void {
  console.log("=== control/owner-command-semantics/tests/semantic-resolution.test.ts ===");
  clearTestHistory();

  // A. A command with a real target the registry knows.
  const a = run("เช็ก GitHub repo นี้", "cmd_test_a");
  assert(a.raw_text === "เช็ก GitHub repo นี้", "raw_text survives the layer unchanged");
  assert(a.action.length > 0, "an action is extracted");
  assert(a.resolved_capabilities.length > 0, `a real capability resolved, got unresolved=${a.unresolved_refs.length}`);
  assert(a.resolved_capabilities.every((r) => r.evidence_refs.length > 0), "every resolved capability carries evidence");
  console.log(`PASS A: action=${a.action} capability=${a.resolved_capabilities.map((r) => r.resolved_id).join(",")}`);

  // B. Continuation with a history to inherit from.
  const b = run("เอาตัวเดิมต่อ", "cmd_test_b");
  assert(b.resolved_history !== null, "a backward reference is recognised and looked up in real history");
  assert(b.resolved_history!.provenance === "HISTORY", "continuation is resolved from history, not from the model");
  assert(b.resolved_history!.evidence_refs.some((e: string) => e.includes("semantic-history.jsonl")), "continuation cites the real history record");
  console.log(`PASS B: continuation=${b.resolved_history!.status} -> ${b.resolved_history!.resolved_id ?? "none"}`);

  // C. Continuation with no history at all — must not invent one.
  clearTestHistory();
  const c = run("เชื่อมอันเมื่อกี้กับระบบเรา", "cmd_test_c");
  if (c.resolved_history) {
    assert(c.resolved_history.resolved_id === null, "with an empty history, a backward reference cannot resolve to anything");
    assert(c.resolved_history.status === "RESOLVER_UNRESOLVED", `empty history yields UNRESOLVED, got ${c.resolved_history.status}`);
  }
  console.log(`PASS C: no history -> ${c.resolved_history ? c.resolved_history.status : "no continuation claimed"}`);

  // D. Ambiguity is reported, never resolved by preference. Driven through the
  // resolver directly so the case is deterministic: the phrase below matches
  // more than one registered capability's keyword sets.
  // "ตรวจ repo permission" satisfies file-intelligence's ["ตรวจ","repo"] AND
  // permission-reasoner's ["ตรวจ","permission"] — the same collision the
  // router itself would answer with OWNER_REVIEW, so the two layers cannot
  // disagree about what is ambiguous.
  const ambiguous = resolveCapabilityMention("ตรวจ repo permission");
  assert(ambiguous.status === "RESOLVER_AMBIGUOUS", `a phrase matching two registered capabilities is AMBIGUOUS, got ${ambiguous.status}`);
  assert(ambiguous.resolved_id === null, "an ambiguous reference never carries an id");
  assert(ambiguous.candidates.length > 1, "an ambiguous reference lists every candidate");
  console.log(`PASS D: "ตรวจ repo permission" -> ${ambiguous.status}${ambiguous.candidates.length > 0 ? ` candidates=${ambiguous.candidates.join(",")}` : ""}`);

  // E. A resource that is not in any registry.
  const e = resolveCapabilityMention("เครื่องปั่นน้ำผลไม้ของเฮีย");
  assert(e.status === "RESOLVER_UNRESOLVED", `an unregistered thing is UNRESOLVED, got ${e.status}`);
  assert(e.resolved_id === null, "an unresolved reference never carries an id");
  console.log("PASS E: unregistered mention -> RESOLVER_UNRESOLVED, no id");

  // F. The model points at something real-sounding but wrong; the resolver
  // finds no evidence, so the interpretation is not promoted to a target.
  const forged: AiSemanticInterpretation = {
    raw_text: "ทำอันนั้น", intent: "do it", action: "RUN",
    target_text: "ตัวจัดการฐานข้อมูลของบริษัท", entity_mentions: ["ตัวจัดการฐานข้อมูลของบริษัท"],
    resource_reference: "ตัวจัดการฐานข้อมูลของบริษัท", capability_reference: "ตัวจัดการฐานข้อมูลของบริษัท",
    parameters: {}, constraints: [], continuation_reference: null, previous_context_reference: null,
    requested_result: null, ambiguities: [],
  };
  const f = resolveFromInterpretation("cmd_test_f", OWNER, forged);
  assert(f.resolved_resources.length === 0 && f.resolved_capabilities.length === 0, "an unprovable interpretation produces no targets");
  assert(f.unresolved_refs.length > 0, "the rejected interpretation is recorded as unresolved, not dropped silently");
  assert(f.semantic_interpretation.target_text === "ตัวจัดการฐานข้อมูลของบริษัท", "the model's own reading is preserved for inspection");
  assert(f.policy_command_id !== "unknown", "policy_command_id is never the literal \"unknown\"");
  console.log(`PASS F: AI pointed at something unprovable -> ${f.unresolved_refs.length} unresolved, 0 targets`);

  // The id boundary the contract exists to hold.
  const withId = validateAiInterpretation(JSON.stringify({ ...forged, raw_text: "x", resource_reference: "capability-3a7a4db0-f4eb-46d1-85db-3212e3a665ab" }), "x");
  assert(!withId.ok, "a model naming a real id shape is refused");
  console.log("PASS: the model cannot smuggle an id through the contract");

  clearTestHistory();
  console.log("=== ALL semantic-resolution.test.ts CASES PASSED ===");
  process.exit(0);
}

try { main(); } catch (error) { console.error(error); process.exit(1); }
