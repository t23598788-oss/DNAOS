/** Deterministic Owner-facing projection. It is intentionally a whitelist,
 * never a serializer: canonical results, logs and evidence remain outside
 * the payload and are referenced only by approved identifiers. */

import { operationForIntent } from "../owner-command/intent-contract";
export type DisplayPayload =
  | { schema: "OWNER_DISPLAY_PAYLOAD_V1"; projection: "SUPPORTED"; subject: string; state: string; summary_facts: Readonly<Record<string, string | number | boolean>>; owner_attention: boolean; blocker: string | null; progress: number | null; evidence_available: boolean; details_reference: string | null }
  | { schema: "OWNER_DISPLAY_PAYLOAD_V1"; projection: "UNSUPPORTED_PROJECTION"; subject: "UNKNOWN"; state: "UNSUPPORTED"; owner_attention: true; evidence_available: boolean; details_reference: string | null };

type CanonicalResult = Readonly<Record<string, unknown>>;
const SUPPORTED = new Set(["runtime", "capability", "agent", "resource", "git", "test", "error"]);

function text(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function scalar(value: unknown): string | number | boolean | null { return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null; }

export function projectOwnerDisplayPayload(result: CanonicalResult): DisplayPayload {
  const operation = text(result.operation)?.toUpperCase();
  const intent = text(result.intent_type)?.toUpperCase();
  // PRESENTATION ONLY. This maps a contract-valid intent to a display
  // category; it never decides whether anything is executable. The intent's
  // operation is read from ../owner-command/intent-contract.ts rather than
  // re-listing intent names here — this file used to carry its own copy of the
  // vocabulary, including LIST_CAPABILITIES, which the Owner has since removed
  // from the executable contract for having no consumer. A value outside the
  // contract simply yields no inferred category.
  const effectiveOperation = operation ?? (intent ? operationForIntent(intent) : null);
  const inferredType = effectiveOperation === "CHECK_RUNTIME" || effectiveOperation === "INSPECT_PROCESS" ? "runtime"
    : effectiveOperation === "READ_GIT" ? "git"
    : effectiveOperation === "RUN_TEST" ? "test"
    : intent === "LIST_AVAILABLE_CAPABILITIES" || intent === "CAPABILITY_STATUS" ? "capability"
    : null;
  const type = text(result.result_type) ?? text(result.subject_type) ?? text(result.type) ?? inferredType;
  const evidence = Boolean(result.evidence_available) || (Array.isArray(result.evidence_refs) && result.evidence_refs.length > 0);
  const details = text(result.details_reference) ?? text(result.evidence_id);
  if (!type || !SUPPORTED.has(type.toLowerCase())) {
    return { schema: "OWNER_DISPLAY_PAYLOAD_V1", projection: "UNSUPPORTED_PROJECTION", subject: "UNKNOWN", state: "UNSUPPORTED", owner_attention: true, evidence_available: evidence, details_reference: details };
  }
  const subject = text(result.subject) ?? type.toUpperCase();
  const state = text(result.state) ?? text(result.status) ?? "UNKNOWN";
  const summary_facts: Record<string, string | number | boolean> = {};
  for (const key of ["health", "branch", "revision", "assignable", "count", "exit_code", "test_count"]) {
    const value = scalar(result[key]);
    if (value !== null) summary_facts[key] = value;
  }
  const blocker = text(result.blocker) ?? text(result.reason);
  const progress = typeof result.progress === "number" && Number.isFinite(result.progress) ? result.progress : null;
  return { schema: "OWNER_DISPLAY_PAYLOAD_V1", projection: "SUPPORTED", subject, state, summary_facts, owner_attention: Boolean(blocker), blocker, progress, evidence_available: evidence, details_reference: details };
}
