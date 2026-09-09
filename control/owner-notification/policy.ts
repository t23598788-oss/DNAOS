import type { CanonicalEventV1 } from "../canonical-information/types";
import type { PolicyDecision } from "./types";

const IGNORE_TYPES = new Set([
  "FILE_READ", "SYMBOL_LOOKUP", "REPOSITORY_SEARCH", "TEST_CASE", "EVIDENCE_WRITE",
  "RESOLVER_STEP", "PROCESS_SPAWN", "FILE_WRITE", "DISCOVERED", "STATE_CHANGED",
]);

const ACTIVITY_ONLY_TYPES = new Set([
  "CODING_STARTED", "CODING_PROGRESS", "WORK_PROGRESS",
  "CONTEXT_LOADING", "IMPLEMENTING", "BUILDING", "TESTING", "REVIEWING",
  "WAITING", "BLOCKED", "COMPLETED_CANDIDATE", "HANDOFF_COMPLETE",
  "DEPLOYMENT_STARTED",
]);

const ACTION_TYPES = new Set([
  "OWNER_APPROVAL_REQUIRED", "SECURITY_SENSITIVE_REAUTH", "DEVELOPMENT_PROPOSAL_READY", "REVIEW_READY",
]);

const CRITICAL_TYPES = new Set([
  "ROLLBACK_FAILED", "SYSTEM_ERROR", "DEPLOYMENT_FAILED", "RUNTIME_VERIFICATION_FAILED",
]);

export function evaluateNotificationPolicy(event: CanonicalEventV1): PolicyDecision {
  const type = event.event_type;
  if (IGNORE_TYPES.has(type)) return "IGNORE";
  if (type === "WORK_COMPLETED" && isCodingSelfReport(event)) return "ACTIVITY_ONLY";
  if (type === "RUNTIME_VERIFIED" && isCodingSelfReport(event)) return "IGNORE";
  if (type.startsWith("INBOUND_") && event.source_system === "UNREGISTERED") return "IGNORE";
  if (ACTIVITY_ONLY_TYPES.has(type)) return "ACTIVITY_ONLY";
  if (ACTION_TYPES.has(type) || event.action_required) return "NOTIFY_ACTION_REQUIRED";
  if (CRITICAL_TYPES.has(type) || event.severity === "ERROR") return "NOTIFY_CRITICAL";
  if (type === "TEST_FAILED" || type === "BUILD_FAILED" || type === "SYSTEM_WARNING") return "NOTIFY";
  if (type === "TEST_COMPLETED" || type === "BUILD_COMPLETED") return "NOTIFY";
  if (type === "WORK_STARTED" || type === "WORK_COMPLETED" || type === "WORK_ACCEPTED") return "NOTIFY";
  if (type === "REPORT_CREATED") return "NOTIFY";
  if (type === "CLIENT_DISCONNECTED" || type === "STALE") return "NOTIFY";
  if (type === "FILE_RECEIVED") return "NOTIFY";
  if (type === "FILE_ARRIVAL_INTERNAL") return "IGNORE";
  if (type === "WORK_CHECKPOINT_COMPLETED" || type === "WORK_COMPLETION_REPORT_READY" || type === "WORK_FULLY_COMPLETED") return "NOTIFY";
  if (type === "WORK_CHECKPOINT_FAILED") return "NOTIFY_CRITICAL";
  if (type === "WORK_WAITING_FOR_OWNER") return "NOTIFY_ACTION_REQUIRED";
  if (type === "UNREGISTERED_AGENT_ACTIVITY") return "NOTIFY";
  if (type === "PUBLISH_STARTED" || type === "PUBLISHED") return "NOTIFY";
  if (type === "DEPLOYMENT_STARTED" || type === "DEPLOYED") return "NOTIFY";
  if (type === "RUNTIME_VERIFIED") return "NOTIFY";
  if (type === "CAPABILITY_REGISTERED" || type === "CAPABILITY_AVAILABLE" || type === "CAPABILITY_DISABLED") return "NOTIFY";
  if (type === "ROLLBACK_STARTED" || type === "ROLLBACK_COMPLETED") return "NOTIFY";
  if (type === "CONNECTION_CHANGED" || type === "RESOURCE_CHANGED") return "NOTIFY";
  if (type === "INBOUND_MESSAGE" || type === "INBOUND_EMAIL" || type === "INBOUND_SYSTEM_EVENT") return "NOTIFY";
  return "IGNORE";
}

export function isCodingSelfReport(event: CanonicalEventV1): boolean {
  const source = event.source_system.toLowerCase();
  return source.includes("cursor") || source.includes("coding") || source.includes("chatgpt") || source.includes("gemini") || source.startsWith("ai://");
}

export function deduplicationKey(event: CanonicalEventV1, extra = ""): string {
  const work = event.work_id ?? event.entity_id;
  const state = event.current_state ?? "";
  return `${event.event_type}|${work}|${state}|${extra}|v${event.version}`;
}
