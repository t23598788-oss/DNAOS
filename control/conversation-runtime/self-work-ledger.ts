/**
 * หน้าที่: BUILD_SELF_WORK_LEDGER_V1 (Owner UNLOCK 2026-09-06). Answers ONE
 * question — "ตอนนี้งานล่าสุดถึงไหน และติดอะไรอยู่" — from real registries
 * only. No field here is ever authored by the language model; the model's
 * only job (see `../owner-command-semantics/`) is producing the
 * `StructuredOwnerContext` this ledger reads back, deterministically.
 *
 * DATA SOURCES, and nothing else:
 * - `../owner-command-semantics/read-paths.ts#readHistoryForIdentity` — the
 *   latest RESOLUTION record for this identity (this layer's own durable
 *   history; already an approved conversation-owned write path).
 * - `../conversation-read-model/contract.ts` — task-status/task-evidence
 *   projections, IF the latest resolution ever produced a linked task_id.
 * - `readCapabilitySummaries()` (same contract) — to tell "a capability
 *   name matched by keyword" apart from "a command exists for the
 *   requested action".
 *
 * BLOCKER_KIND is derived by a fixed decision order, never guessed: every
 * branch below cites the exact field that justified it, and any field this
 * file cannot support with a real record is `"UNKNOWN"` — never invented.
 *
 * Input: an `identity_id`.
 * Output: `getLatestWorkContinuity()` → `WorkLedgerRecord | null` (`null`
 * only when there is no history at all for this identity — not a guess at
 * "no work has ever happened").
 * Dependency ที่อนุญาต: `../owner-command-semantics/contract.ts` (read-paths
 * re-exports only), `../conversation-read-model/contract.ts`.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเรียกโมเดลภาษา หรือแต่งค่า field ใดๆ ที่ไม่มีหลักฐานจริงรองรับ.
 * - ห้ามเขียนทะเบียนใดๆ จากไฟล์นี้ — read-only ทุกการเรียก.
 * - ห้ามเพิ่ม BLOCKER_KIND ค่าใหม่นอกเหนือจากชุดที่ประกาศไว้ใน `BlockerKind`.
 */

import { readHistoryForIdentity, type HistoryRecord } from "../owner-command-semantics/contract";
import {
  isPublished,
  readCapabilitySummaries,
  readTaskEvidenceProjection,
  readTaskStatusProjection,
} from "../conversation-read-model/contract";

export type BlockerKind =
  | "NONE"
  | "CAPABILITY_MISSING"
  | "RESOURCE_NOT_REGISTERED"
  | "RELATIONSHIP_UNRESOLVED"
  | "CONNECTOR_MISSING"
  | "AUTHORITY_MISSING"
  | "DEPENDENCY_MISSING"
  | "VERIFICATION_MISSING"
  | "RUNTIME_UNAVAILABLE"
  | "UNKNOWN";

const UNKNOWN = "UNKNOWN";

export interface WorkLedgerRecord {
  readonly WORK_ID: string;
  readonly OBJECTIVE: string;
  readonly CURRENT_STAGE: string;
  readonly LAST_COMPLETED_STAGE: string;
  readonly LAST_RESULT: string;
  readonly REQUIRED_NEXT_CAPABILITY: string;
  readonly REQUIRED_NEXT_TARGET: string;
  readonly AVAILABLE_CAPABILITY: string;
  readonly CONNECTED_RESOURCE: string;
  readonly BLOCKER_KIND: BlockerKind;
  readonly BLOCKER_DETAIL: string;
  readonly NEXT_STEP: string;
  readonly EVIDENCE_REFS: readonly string[];
  readonly UPDATED_AT: string;
}

function findMatchedCapability(capabilityId: string): { capability_id: string; supported_commands: readonly string[] } | null {
  const summaries = readCapabilitySummaries();
  return summaries.find((s) => s.capability_id === capabilityId) ?? null;
}

/**
 * True only when the actual verb the Owner used (`record.intent`, e.g.
 * "Open GitHub") plausibly matches one of the capability's own registered
 * `supported_commands` strings (e.g. "connector.github.read_status") by
 * token overlap. This is a real, checkable comparison against registry
 * data — not a guess — but it is intentionally conservative: it can say
 * "no supported command names this action" with evidence; it never claims
 * a command DOES match without a real token appearing in both.
 */
function hasSupportedCommandForIntent(supportedCommands: readonly string[] | undefined, intent: string): boolean {
  // A projection published before `supported_commands` existed on this
  // type (or otherwise malformed) is treated as "no evidence either way" —
  // NOT as proof a command exists. Callers that reach here already know a
  // capability id matched; this only decides whether the SPECIFIC action
  // is supported, so an absent field must not silently pass as "supported".
  if (!supportedCommands) return false;
  const intentTokens = intent.toLocaleLowerCase().split(/[^a-z0-9ก-๙]+/i).filter((t) => t.length > 2);
  return supportedCommands.some((cmd) => {
    const cmdTokens = cmd.toLocaleLowerCase().split(/[._-]+/);
    return intentTokens.some((t) => cmdTokens.includes(t));
  });
}

function deriveBlocker(record: HistoryRecord): { kind: BlockerKind; detail: string; requiredCapability: string; availableCapability: string } {
  if (!isPublished()) {
    return { kind: "RUNTIME_UNAVAILABLE", detail: "conversation-read-model has never been published — cannot check capability/task registries", requiredCapability: UNKNOWN, availableCapability: UNKNOWN };
  }

  const relationshipStatus = record.relationship_query_status ?? null;
  if (relationshipStatus === "RELATIONSHIP_UNRESOLVED" || relationshipStatus === "RELATIONSHIP_AMBIGUOUS") {
    return { kind: "RELATIONSHIP_UNRESOLVED", detail: `relationship_query_status=${relationshipStatus}`, requiredCapability: UNKNOWN, availableCapability: UNKNOWN };
  }

  const capabilityIds = record.resolved_capability_ids ?? [];
  if (capabilityIds.length === 0) {
    const capabilityUnresolved = (record.unresolved_refs ?? []).find((r) => r.kind === "capability");
    return {
      kind: "CAPABILITY_MISSING",
      detail: capabilityUnresolved ? capabilityUnresolved.evidence_refs.join("; ") : "no capability was resolved for this request (resolved_capability_ids is empty)",
      requiredCapability: capabilityUnresolved?.mention ?? UNKNOWN,
      availableCapability: "NONE",
    };
  }

  // A capability id matched, but that alone does not prove the SPECIFIC
  // action the Owner asked for is one this capability can do — check its
  // real, registered supported_commands.
  const matched = findMatchedCapability(capabilityIds[0]);
  if (!matched) {
    return { kind: "CAPABILITY_MISSING", detail: `capability_id "${capabilityIds[0]}" was resolved earlier but is no longer in the published capability-summaries projection`, requiredCapability: capabilityIds[0], availableCapability: "NONE" };
  }
  const intent = record.intent ?? "";
  if (intent && !hasSupportedCommandForIntent(matched.supported_commands, intent)) {
    return {
      kind: "CAPABILITY_MISSING",
      detail: `capability "${matched.capability_id}" is registered, but its supported_commands (${(matched.supported_commands ?? []).join(", ") || "none"}) do not include a command matching the requested action "${intent}"`,
      requiredCapability: `${matched.capability_id}:<command matching "${intent}">`,
      availableCapability: matched.capability_id,
    };
  }

  const resourceUnresolved = (record.unresolved_refs ?? []).find((r) => r.kind === "resource");
  if (resourceUnresolved) {
    return { kind: "RESOURCE_NOT_REGISTERED", detail: resourceUnresolved.evidence_refs.join("; "), requiredCapability: matched.capability_id, availableCapability: matched.capability_id };
  }

  if (record.task_id) {
    const status = readTaskStatusProjection(record.task_id);
    if (status?.status === "COMPLETED") {
      const evidence = readTaskEvidenceProjection(record.task_id);
      if (!evidence || evidence.rows.length === 0) {
        return { kind: "VERIFICATION_MISSING", detail: `task ${record.task_id} status=COMPLETED but no evidence rows are published for it`, requiredCapability: matched.capability_id, availableCapability: matched.capability_id };
      }
    }
  }

  if (record.resolved_state === "RESOLVED") {
    return { kind: "NONE", detail: "", requiredCapability: "NONE", availableCapability: matched.capability_id };
  }

  return { kind: UNKNOWN, detail: "no rule matched real evidence for this record — reporting UNKNOWN rather than guessing", requiredCapability: UNKNOWN, availableCapability: matched.capability_id };
}

export function getLatestWorkContinuity(identityId: string): WorkLedgerRecord | null {
  const history = readHistoryForIdentity(identityId);
  if (!history.found) return null;
  const resolutions = history.value.filter((r) => (r.kind ?? "RESOLUTION") === "RESOLUTION");
  if (resolutions.length === 0) return null;
  const latest = resolutions[resolutions.length - 1];

  const blocker = deriveBlocker(latest);
  const taskStatus = latest.task_id ? readTaskStatusProjection(latest.task_id) : null;
  const taskEvidence = latest.task_id ? readTaskEvidenceProjection(latest.task_id) : null;

  const evidenceRefs: string[] = [`control/owner-command-semantics/data/semantic-history.jsonl#${latest.command_id}`];
  if (taskEvidence) evidenceRefs.push(...taskEvidence.rows.map((r) => `${r.kind}@${r.source}#${r.recorded_at}`));

  return {
    WORK_ID: latest.command_id,
    OBJECTIVE: latest.intent ?? latest.raw_text,
    CURRENT_STAGE: taskStatus ? taskStatus.status : blocker.kind === "NONE" ? "RESOLVED" : "BLOCKED_BEFORE_EXECUTION",
    LAST_COMPLETED_STAGE: latest.resolved_state === "RESOLVED" ? "SEMANTIC_RESOLUTION" : latest.resolved_capability_ids.length > 0 ? "CAPABILITY_MATCHED" : "OWNER_TEXT_RECEIVED",
    LAST_RESULT: taskStatus ? `task ${taskStatus.task_id} status=${taskStatus.status}` : blocker.kind === "NONE" ? "resolved, no execution requested" : UNKNOWN,
    REQUIRED_NEXT_CAPABILITY: blocker.requiredCapability,
    REQUIRED_NEXT_TARGET: latest.resolved_target_ids[0] ?? UNKNOWN,
    AVAILABLE_CAPABILITY: blocker.availableCapability,
    CONNECTED_RESOURCE: latest.resolved_target_ids.join(", ") || "NONE",
    BLOCKER_KIND: blocker.kind,
    BLOCKER_DETAIL: blocker.detail,
    NEXT_STEP: blocker.kind === "NONE"
      ? "no further action needed for this request"
      : blocker.kind === "CAPABILITY_MISSING"
        ? `register a capability/command that supports "${latest.intent ?? latest.raw_text}"`
        : blocker.kind === "UNKNOWN"
          ? "insufficient evidence to state a next step"
          : `resolve ${blocker.kind} before this request can proceed`,
    EVIDENCE_REFS: evidenceRefs,
    UPDATED_AT: latest.recorded_at,
  };
}
