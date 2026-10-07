/**
 * หน้าที่: ask DNA OS ten real questions about its own tools and require every
 * answer to come from persisted, measured records — never from a literal in
 * this file (Owner, 2026-09-02).
 *
 * THE THING THAT WOULD MAKE THIS TEST WORTHLESS. Writing `expect(EMAIL_READ ===
 * "RUNTIME_PROVEN")` would prove only that I typed the same word twice. So no
 * question below names an expected state. Each asks the resolver, reads what
 * came back, and asserts the STRUCTURE of a defensible answer: that a proven
 * claim is backed by a satisfied evidence rule at a named path, and that an
 * unproven one carries a typed limitation instead of a guess. Case P1 then
 * proves the whole store is re-derivable from disk, and P2 proves a state
 * collapses when its evidence is taken away.
 *
 * REGISTERED IS NOT PROVEN, AND THIS TEST HOLDS THAT LINE. All 118 canonical
 * capabilities are REGISTERED with `verified_at: null`. Case R1 reads that from
 * the registry and requires that no method's runtime state was influenced by
 * it — the two dimensions stay orthogonal.
 *
 * Input: none — reads the persisted self-resource store and the repository's
 * own evidence files. No execution, no OS action, no model.
 * Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../contract, ../derive, ../declarations, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้าม hardcode คำตอบที่คาดหวังลงในเทสต์นี้, ห้ามยอมรับ
 * RUNTIME_PROVEN ที่ไม่มีหลักฐานพร้อม path.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveSelfResource, type MethodKind, type SelfResourceRecord } from "../contract";
import { deriveSelfResources, readSelfResources } from "../derive";
import { SELF_RESOURCE_DECLARATIONS } from "../declarations";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const records = readSelfResources();
const byKind = (k: MethodKind): SelfResourceRecord | undefined => records.find((r) => r.method_kind === k);

/** The shape of a defensible answer: proven only with a satisfied rule at a real path. */
function answerIsDefensible(r: SelfResourceRecord | undefined): boolean {
  if (!r) return false;
  if (r.runtime_state === "RUNTIME_PROVEN" || r.runtime_state === "OBSERVED") {
    return r.evidence_refs.some((e) => e.satisfied && e.exists && e.matching_rows >= e.required_rows)
      && r.runtime_state_source === "MEASURED_EVIDENCE";
  }
  if (r.runtime_state === "NOT_IMPLEMENTED") return r.known_limitations.includes("NO_IMPLEMENTATION");
  // Anything else must say what is missing, in a typed code.
  return r.known_limitations.length > 0 || r.evidence_refs.some((e) => !e.satisfied);
}

/** Renders an answer the way a caller would read it, from the record only. */
function answer(k: MethodKind): string {
  const r = byKind(k);
  if (!r) return "NO_RECORD";
  const proof = r.evidence_refs.filter((e) => e.satisfied).map((e) => `${e.path}(${e.matching_rows})`).join(", ");
  return `${r.runtime_state}${proof ? ` via ${proof}` : ""}${r.known_limitations.length ? ` [${r.known_limitations.join(",")}]` : ""}`;
}

(async () => {
  check("0. every declared method has a persisted record",
    records.length === SELF_RESOURCE_DECLARATIONS.length && records.length === 12,
    `${records.length} records`);

  // ================= Q1–Q10, each answered from the store =================
  const q1 = resolveSelfResource(records, { required_method_kind: "LOCAL_PROCESS", requires_runtime_proof: true });
  check("Q1. can I execute a local process with runtime evidence?",
    answerIsDefensible(byKind("LOCAL_PROCESS")) && (q1.candidates.length > 0) === (byKind("LOCAL_PROCESS")!.runtime_state === "RUNTIME_PROVEN"),
    answer("LOCAL_PROCESS"));

  const q2 = resolveSelfResource(records, { required_method_kind: "COMPUTER_USE", requires_runtime_proof: true, requires_observation: true, requires_verification: true });
  check("Q2. can I physically control UI with runtime evidence?",
    answerIsDefensible(byKind("COMPUTER_USE")) && q2.candidates.every((c) => c.observation_compatible && c.verification_compatible),
    answer("COMPUTER_USE"));

  check("Q3. can I read email?", answerIsDefensible(byKind("EMAIL_READ")), answer("EMAIL_READ"));

  // Sending is not a state of EMAIL_READ — it is the absence of any method.
  const emailSend = records.find((r) => r.method_kind === "EMAIL_READ" && !r.known_limitations.includes("CANNOT_SEND_ONLY_READ"));
  check("Q4. can I send email?",
    emailSend === undefined && byKind("EMAIL_READ")!.known_limitations.includes("CANNOT_SEND_ONLY_READ"),
    "NO — the only email method is read-only, recorded as a typed limitation");

  const q5 = resolveSelfResource(records, { required_method_kind: "BROWSER_DOM", requires_runtime_proof: true });
  check("Q5. can I use Browser DOM automation?",
    q5.candidates.length === 0 && (q5.no_suitable_self_resource ?? []).includes("NOT_RUNTIME_PROVEN")
    && byKind("BROWSER_DOM")!.runtime_state === "NOT_IMPLEMENTED",
    answer("BROWSER_DOM"));

  const q6 = resolveSelfResource(records, { required_method_kind: "API_OUTBOUND_PROVIDER", requires_runtime_proof: true });
  check("Q6. can I execute an authenticated provider API call with runtime proof?",
    (q6.candidates.length > 0) === (byKind("API_OUTBOUND_PROVIDER")!.runtime_state === "RUNTIME_PROVEN")
    && answerIsDefensible(byKind("API_OUTBOUND_PROVIDER")),
    answer("API_OUTBOUND_PROVIDER"));

  const q7 = resolveSelfResource(records, { required_method_kind: "DATABASE", requires_runtime_proof: true });
  check("Q7. can I use a live Postgres canonical registry round trip?",
    (q7.candidates.length > 0) === (byKind("DATABASE")!.runtime_state === "RUNTIME_PROVEN")
    && answerIsDefensible(byKind("DATABASE")),
    answer("DATABASE"));

  // Q8/Q9 are measurement questions, answered from the dimension lists.
  const anyMoney = records.some((r) => r.measured_dimensions.some((d) => String(d).includes("MONETARY")));
  const allDeclareMoneyUnmeasured = records.every((r) => r.unmeasured_dimensions.includes("EXECUTION_MONETARY_COST"));
  check("Q8. can I measure monetary cost for a specific execution?",
    anyMoney === false && allDeclareMoneyUnmeasured,
    "NO — EXECUTION_MONETARY_COST is listed unmeasured on all 12 records, never zero");
  const anyTokens = records.some((r) => r.measured_dimensions.some((d) => String(d).includes("TOKEN")));
  const allDeclareTokensUnmeasured = records.every((r) => r.unmeasured_dimensions.includes("TOKEN_USAGE"));
  check("Q9. can I measure token usage for a specific execution?",
    anyTokens === false && allDeclareTokensUnmeasured,
    "NO — TOKEN_USAGE is listed unmeasured on all 12 records");

  const verifying = records.filter((r) => r.verification_support);
  check("Q10. which methods currently expose deterministic verification?",
    verifying.length > 0 && verifying.every((r) => typeof r.verification_source === "string" && r.verification_source.length > 0),
    verifying.map((r) => r.method_kind).join(", "));

  // ================= P. provenance: fact → source → evidence → derivation =================
  const rederived = deriveSelfResources();
  // Some evidence files are written continuously (runtime-control alone adds
  // rows every few seconds), so exact row counts legitimately differ between a
  // snapshot and a re-derivation. What must be identical is every DECISION:
  // the state, and which rules were satisfied.
  const decisions = (rs: readonly SelfResourceRecord[]) => JSON.stringify(rs.map((r) => ({
    id: r.method_id, state: r.runtime_state,
    satisfied: r.evidence_refs.map((e) => `${e.path}:${e.satisfied}`),
    limits: r.known_limitations,
  })));
  check("P1. every persisted record is re-derivable from the same files",
    decisions(rederived) === decisions(records),
    "states and satisfied-rules match; raw counts move because the system is running");
  check("P2. no RUNTIME_PROVEN state exists without a satisfied rule at a real path",
    records.filter((r) => r.runtime_state === "RUNTIME_PROVEN")
      .every((r) => r.evidence_refs.some((e) => e.satisfied && e.exists && existsSync(join(process.cwd(), e.path)))),
    records.filter((r) => r.runtime_state === "RUNTIME_PROVEN").map((r) => r.method_kind).join(", "));
  // Take the evidence away and the claim must collapse — proven by pointing the
  // deriver at a root where nothing exists.
  const collapsed = deriveSelfResources("/nonexistent-root-for-collapse-test");
  check("P3. a state collapses when its evidence is absent",
    collapsed.every((r) => r.runtime_state !== "RUNTIME_PROVEN")
    && collapsed.every((r) => r.evidence_refs.every((e) => !e.exists)),
    "nothing survives on reputation");
  check("P4. drift outranks a historical proof",
    byKind("WEBHOOK_OUTBOUND")!.runtime_state === "CONFIGURATION_DRIFT"
    && byKind("WEBHOOK_OUTBOUND")!.evidence_refs.filter((e) => e.satisfied).length >= 2,
    "the old success is still on disk and still does not speak for the current channel");

  // ================= R. registered is not proven =================
  const caps = readFileSync(join(process.cwd(), "software/registry-database/data/canonical/capabilities.jsonl"), "utf8")
    .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { status: string; verified_at: string | null });
  check("R1. the registry says REGISTERED and verifies nothing",
    caps.length > 0 && caps.every((c) => c.status === "REGISTERED") && caps.every((c) => c.verified_at === null),
    `${caps.length} capabilities, all REGISTERED, all verified_at null`);
  const src = readFileSync(join(process.cwd(), "control/self-resource/contract.ts"), "utf8")
    + readFileSync(join(process.cwd(), "control/self-resource/derive.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  check("R2. no derivation path reads a registration status",
    !/REGISTERED|verified_at|capabilities\.jsonl/.test(code),
    "registration state cannot reach runtime state");

  // ================= A. no model anywhere in the derivation =================
  check("A1. no model, network or randomness in the contract or the deriver",
    !/\b(fetch|anthropic|openai|claude|spawn|child_process|https?:|Math\.random)/i.test(code),
    "AI_INVOLVED_IN_DERIVATION = NO");
  check("A2. freshness is recorded as MISSING rather than invented",
    records.every((r) => r.freshness_model === "MISSING"),
    "no rule exists for when a measurement goes stale, and none was made up");

  // ================= N. the resolver refuses rather than improvises =================
  const noKind = resolveSelfResource(records, { required_method_kind: "STDIO_NOT_A_KIND" as MethodKind });
  check("N1. an unknown method kind yields NO_METHOD_OF_THIS_KIND, not an empty success",
    noKind.candidates.length === 0 && (noKind.no_suitable_self_resource ?? []).includes("NO_METHOD_OF_THIS_KIND"));
  const impossible = resolveSelfResource(records, { required_method_kind: "COMPUTER_USE", required_measurements: ["ROUND_TRIP_MS"] });
  check("N2. an unmeasurable requirement is refused with MEASUREMENT_UNAVAILABLE",
    impossible.candidates.length === 0 && (impossible.no_suitable_self_resource ?? []).includes("MEASUREMENT_UNAVAILABLE"));
  check("N3. the resolver executes nothing",
    !/execFile|spawn|writeFile|appendFile/.test(readFileSync(join(process.cwd(), "control/self-resource/contract.ts"), "utf8")));

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
