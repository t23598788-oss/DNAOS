/**
 * หน้าที่: turn a root-caused gap into the Owner's REPAIR_WORK_ITEM — a
 * package precise enough that the agent has no reason to look anywhere else.
 *
 * `allowed_paths` is the whole point. An agent given a repair item may touch
 * those paths and nothing else; the verifier rejects any proposal that steps
 * outside them, so the list is a real boundary rather than a request. It is
 * derived from the root-cause finding's own call_site/emitting_site — the
 * files the evidence actually implicates — never widened "just in case".
 *
 * `error_signature` is what loop protection compares. It is deliberately
 * built from the STABLE parts of the finding (boundary + reason + class) and
 * not from timestamps or counts, so the same defect produces the same
 * signature on every attempt and a repeat is detectable.
 *
 * Input: a `GapRecord` + its `RootCauseFinding`.
 * Output: `buildRepairWorkItem`.
 * Dependency ที่อนุญาต: ./types.ts, ./root-cause.ts, node:crypto.
 * สิ่งที่ห้ามแตะ: never emit a repair item for a finding whose
 * `repair_required` is false — that is the check that keeps the loop from
 * "fixing" an intended behaviour.
 */

import { createHash, randomUUID } from "node:crypto";
import type { GapRecord, RepairWorkItem } from "./types";
import type { RootCauseFinding } from "./root-cause";

/** Paths no repair may ever touch, whatever the finding says. */
const ALWAYS_FORBIDDEN: readonly string[] = [
  "permissions/",            // the gates themselves
  "credentials/",            // secrets and their resolvers
  "governance/",             // the rules a repair is judged by
  "software/registry-database/data/",  // the canonical registry's stored rows
  "control/agent-gateway/data/",       // the evidence store's stored rows
  ".git/",
  "node_modules/",
];

export function errorSignature(finding: RootCauseFinding, gap: GapRecord): string {
  const stable = [finding.failed_boundary, finding.root_cause_class, gap.gap_id].join("|");
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

export function buildRepairWorkItem(
  gap: GapRecord,
  finding: RootCauseFinding,
  context: { trace_id: string; attempt: number; existing_tests: readonly string[] },
): RepairWorkItem | null {
  if (!finding.repair_required || !finding.repair_type) return null;

  // Allowed paths come from what the evidence implicates, not from the whole
  // capability folder: the call site that caused the state, and the source
  // path the registry names for it.
  const implicated = [finding.call_site, finding.emitting_site, gap.source_path]
    .filter((p): p is string => Boolean(p))
    .map((p) => p.split(":")[0]);
  const allowed = [...new Set(implicated)];

  return {
    repair_id: `repair-${randomUUID().slice(0, 12)}`,
    event_id: `evt-${randomUUID().slice(0, 12)}`,
    trace_id: context.trace_id,
    work_id: `work-${randomUUID().slice(0, 12)}`,

    failed_capability_id: gap.capability_id,
    failed_boundary: finding.failed_boundary,
    source_path: finding.call_site?.split(":")[0] ?? gap.source_path,
    upstream_capability: gap.upstream[0] ?? null,
    downstream_capability: gap.downstream[0] ?? null,

    error_code: gap.gap_id.replace(/^gap-evidence-/, "").replace(/^gap-/, ""),
    error_message: gap.reason,
    observed_state: finding.observed_state,
    expected_contract: finding.expected_contract,

    evidence_refs: gap.evidence_refs,
    registry_refs: gap.registry_refs,
    existing_tests: context.existing_tests,
    dependencies: finding.source_evidence,

    allowed_paths: allowed,
    forbidden_paths: ALWAYS_FORBIDDEN,

    verification_required: [
      "SOURCE_VALIDATION", "CONTRACT_VALIDATION", "DEPENDENCY_VALIDATION",
      "SECURITY_PERMISSION_VALIDATION", "ISOLATED_TEST", "REGRESSION_TEST",
      "DETERMINISTIC_VERIFIER", "WRITE_GATE", "CONTROLLED_PROMOTION", "RUNTIME_VERIFICATION",
    ],
    success_condition:
      `${finding.expected_contract}; proven by a real re-run, not by the agent's own claim`,

    repair_type: finding.repair_type,
    root_cause_class: finding.root_cause_class,
    attempt: context.attempt,
    error_signature: errorSignature(finding, gap),
  };
}
