/**
 * หน้าที่: THE WORK PACKET — the ONLY thing a Processing Resource (an AI
 * dispatch, `./reasoning-worker.ts`) ever sees. Owner's own boundary
 * statement, restated as a contract: a Processing Resource must not scan
 * the repo, must not walk folders, must not read system history, must not
 * know what DNA OS is, and must not summarize anything back to the Owner —
 * it sees a task, an input location, a permission, an output shape, and a
 * pass criterion, and returns a result. Everything about WHERE things are,
 * WHAT depends on WHAT, and WHETHER a capability already exists is Live
 * Census + Registry + Work Graph + Evidence's job — software, computed from
 * source, never re-derived by asking an agent to go look.
 *
 * This file is the SOLE place a `WorkItem` + its `CapabilityRecord` become
 * the bounded, self-sufficient packet a Processing Resource is handed.
 * `./reasoning-worker.ts` renders this into an instruction and NOTHING
 * else — no free-standing "investigate the folder" prose, no invitation to
 * read beyond `input_refs`.
 *
 * Input: `WorkItem`, `CapabilityRecord | null` (already resolved by the
 * caller from the Live Census — this file never queries it itself).
 * Output: `WorkPacket`, `buildWorkPacket`, `renderPacketInstruction`.
 * Dependency ที่อนุญาต: ../work-graph/types.ts, ../../software/live-census/contract.ts
 * (types only).
 * สิ่งที่ห้ามแตะ: never add a field naming a filesystem path outside
 * `input_refs`/`permitted_write_scope` — a Processing Resource has no
 * legitimate reason to look anywhere the packet did not name. Never add a
 * field asking the resource to report whether its own work is
 * VERIFIED/complete — `pass_criteria` describes what the VERIFIER checks
 * afterward, never what the resource itself claims.
 */

import type { WorkItem, WorkKind } from "../work-graph/types";
import type { CapabilityRecord } from "../../software/live-census/contract";

export interface WorkPacket {
  packet_id: string;
  work_id: string;
  kind: WorkKind;
  /** One precise sentence. No ambiguity a resource would need to "investigate" to resolve. */
  objective: string;
  /** The COMPLETE, closed set of paths the resource may read. Nothing outside this list is relevant to the task — never "for context", never "the rest of the repo". */
  input_refs: readonly string[];
  /** The COMPLETE, closed set of paths the resource may write. Identical to the work item's own write_scope — the same boundary the coordinator already locks before dispatch. */
  permitted_write_scope: readonly string[];
  output_contract: {
    /** What a correct result looks like, in the resource's own terms — never "tests pass" (that is the Verifier's job, not a claim the resource makes). */
    description: string;
    /** Relative-to-permitted-write-scope path patterns the resource is expected to produce, if any. Empty is legitimate (e.g. RESOLVE_DEPENDENCY only writes one status file). */
    expected_artifact_patterns: readonly string[];
  };
  /** What the VERIFIER (a DETERMINISTIC_TEST re-run, never the resource itself) will check next cycle. Stated here so the resource can aim at something concrete, never asked to confirm it itself. */
  pass_criteria: readonly string[];
  timeout_ms: number;
}

const OBJECTIVE_BY_KIND: Record<WorkKind, (item: WorkItem, cap: CapabilityRecord | null) => string> = {
  WIRE_OR_RETIRE: (item, cap) =>
    `Decide WIRE or RETIRE for this capability (reason it is unwired: ${cap?.status_reason ?? "unknown"}). WIRE: add a real, minimal test file exercising its actual exported behavior. RETIRE: add RETIREMENT.md stating why and what replaced it (if anything).`,
  REPAIR: (item, cap) =>
    `Fix the real, already-run test failure at source digest ${cap?.source_digest ?? "unknown"} (${cap?.status_reason ?? "unknown"}). Fix the implementation the test exercises — never edit the test to make it pass artificially.`,
  IMPLEMENT: (item, cap) =>
    `This capability is declared but has no implementation (${cap?.status_reason ?? "no .ts/.mjs present"}). Implement it plus a real test file, OR if it is genuinely meant to stay documentation/data-only, add DECLARED_ONLY.md stating why.`,
  RESOLVE_DEPENDENCY: (item, cap) =>
    `Investigate the blocking condition (${cap?.status_reason ?? (item.blocked_by.join(", ") || "unknown")}). Write DEPENDENCY_STATUS.md: is it still real, what exactly clears it, does it require Owner authority (credential/resource/business decision) rather than more engineering work.`,
  VERIFY_CAPABILITY: () => { throw new Error("VERIFY_CAPABILITY is DETERMINISTIC_TEST class — it never gets a WorkPacket, it runs real tests directly."); },
  EXTERNAL: () => { throw new Error("EXTERNAL is not independently packetizable — see RESOLVE_DEPENDENCY."); },
};

const OUTPUT_CONTRACT_BY_KIND: Record<WorkKind, { description: string; expected_artifact_patterns: readonly string[] }> = {
  WIRE_OR_RETIRE: { description: "a real test file, OR a RETIREMENT.md", expected_artifact_patterns: ["*.test.ts", "RETIREMENT.md"] },
  REPAIR: { description: "modified implementation source; the existing test file(s) unchanged", expected_artifact_patterns: [] },
  IMPLEMENT: { description: "real implementation source plus a real test file, OR a DECLARED_ONLY.md", expected_artifact_patterns: ["*.ts", "*.test.ts", "DECLARED_ONLY.md"] },
  RESOLVE_DEPENDENCY: { description: "a DEPENDENCY_STATUS.md", expected_artifact_patterns: ["DEPENDENCY_STATUS.md"] },
  VERIFY_CAPABILITY: { description: "", expected_artifact_patterns: [] },
  EXTERNAL: { description: "", expected_artifact_patterns: [] },
};

const PASS_CRITERIA_BY_KIND: Record<WorkKind, (item: WorkItem) => readonly string[]> = {
  WIRE_OR_RETIRE: () => ["a subsequent VERIFY_CAPABILITY re-run against this exact target finds real test files and they report 0 failed", "OR the capability's census status becomes RETIRED (no implementation left to verify)"],
  REPAIR: (item) => [`a subsequent VERIFY_CAPABILITY re-run of ${item.test_files.join(", ") || "this capability's test files"} reports 0 failed at the new source digest`],
  IMPLEMENT: () => ["a subsequent VERIFY_CAPABILITY re-run finds real implementation + real test files and they report 0 failed", "OR the capability's census status stays DECLARED_ONLY with a documented reason"],
  RESOLVE_DEPENDENCY: () => ["DEPENDENCY_STATUS.md exists and states a real, checkable next step — no pass/fail re-run applies to an investigation"],
  VERIFY_CAPABILITY: () => [],
  EXTERNAL: () => [],
};

let packetCounter = 0;

export function buildWorkPacket(item: WorkItem, cap: CapabilityRecord | null, timeoutMs: number): WorkPacket {
  packetCounter += 1;
  return {
    packet_id: `pkt-${Date.now()}-${packetCounter}`,
    work_id: item.work_id,
    kind: item.kind,
    objective: OBJECTIVE_BY_KIND[item.kind](item, cap),
    input_refs: item.write_scope, // the resource's own folder — the ONLY thing it needs to read; it is also what it may write.
    permitted_write_scope: item.write_scope,
    output_contract: OUTPUT_CONTRACT_BY_KIND[item.kind],
    pass_criteria: PASS_CRITERIA_BY_KIND[item.kind](item),
    timeout_ms: timeoutMs,
  };
}

/**
 * The ONLY prose a Processing Resource receives — rendered strictly from
 * packet fields, nothing added. No "you may read the rest of the
 * repository for context", no narrative framing, no explanation of what
 * DNA OS is.
 */
export function renderPacketInstruction(packet: WorkPacket): string {
  return [
    `TASK: ${packet.objective}`,
    `YOU MAY READ AND WRITE ONLY: ${packet.input_refs.join(", ")}`,
    `EXPECTED OUTPUT: ${packet.output_contract.description}`,
    packet.pass_criteria.length > 0 ? `THIS WILL BE CHECKED BY: ${packet.pass_criteria.join("; ")}` : "",
    `Do not read, write, or reference any path outside the list above. Do not report your own work as verified or complete — verification happens independently, after you finish.`,
  ].filter((l) => l.length > 0).join("\n");
}
