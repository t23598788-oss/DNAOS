/**
 * หน้าที่: the DNA OS half of the n8n event router. n8n CLASSIFIES; this file
 * RESOLVES, CHECKS and DISPATCHES — and it is the only side that may, because
 * the registries and the authority live here.
 *
 *   DNA OS event -> outbound POST -> n8n classifies -> route_group returned
 *   -> [this file] resolve capability -> resolve agent -> read policy
 *   -> create work item -> dispatch through the EXISTING boundary
 *
 * NO INBOUND PORT IS OPENED. Every hop is originated by DNA OS; n8n never
 * calls back. That is what keeps the loopback-only rule intact while still
 * putting a real orchestrator in the middle.
 *
 * NO POLICY ENGINE IS REIMPLEMENTED HERE. This file READS a capability's
 * declared `permission_requirement` and hands the work to
 * `control/agent-gateway/#submitTask`, which runs the real policy gate,
 * Admission, and the write/permission gates on the way to execution.
 * Duplicating any of that here would create a second, divergent authority —
 * and a router that decides permissions is a bypass by another name.
 *
 * RESOLUTION IS REGISTRY-DRIVEN, NOT NAME-DRIVEN. `GROUP_CANDIDATES` below is
 * a SEARCH ORDER, not an answer: every candidate is looked up in
 * `control/command-router/`'s real `CAPABILITY_REGISTRY` and then in the
 * persistent software registry, and only a capability that actually exists
 * can be taken. Nothing resolves by string similarity, and an unresolvable
 * event returns UNRESOLVED_OWNER rather than the closest-looking owner.
 *
 * Input: `DnaOsCentralEvent`.
 * Output: `routeDnaOsEvent` -> `RoutedEventOutcome`.
 * Dependency ที่อนุญาต: ./types.ts, ./outbound-webhook.ts,
 * ../../control/command-router/contract.ts,
 * ../../control/agent-gateway/contract.ts,
 * ../../software/registry-database/contract.ts (+ its persistent adapter).
 * สิ่งที่ห้ามแตะ: never execute anything directly from this file — no spawn,
 * no file write, no credential read. Never invent an agent when resolution
 * fails. Never let a routing failure become a silent success: every terminal
 * state here is a named status with evidence.
 */

import { randomUUID } from "node:crypto";
import { getCapability, listCapabilities } from "../../control/command-router/contract";
import { saveEvidence, submitTask, DEFAULT_AGENT_WORKERS } from "../../control/agent-gateway/contract";
import { findCapability } from "../../software/registry-database/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import { GROUP_CAPABILITY_SEARCH_ORDER } from "../../contracts/command/route-group-capabilities";
import { sendCentralEventToN8n } from "./outbound-webhook";
import type {
  AgentDispatchOrder, AgentDispatchResult, DnaOsCentralEvent, HopRecord,
  OwnerResolution, RouteGroup, RouteStatus, RoutedEventOutcome, RouterDecision,
} from "./types";

const SOURCE = "connections/n8n/event-router.ts";
export const MAX_HOPS = 10;
const DISPATCH_TIMEOUT_MS = 120_000;

/**
 * SEARCH ORDER per group — candidates to look UP, never answers to use.
 *
 * This used to be a local table. It now comes from
 * `contracts/command/route-group-capabilities.ts` because
 * `control/agent-gateway/capability-resolver.ts` needs the identical mapping:
 * two copies would let the router resolve one owner and the gateway another
 * for the same group, which is the worst possible kind of disagreement —
 * silent, and only visible after work has already been dispatched.
 */
const GROUP_CANDIDATES = GROUP_CAPABILITY_SEARCH_ORDER;

/**
 * What an agent handling this group may and may not do. FORBIDDEN_ACTIONS is
 * not decoration: it travels with the order so a worker that receives it
 * cannot claim it did not know. Direct source writing is forbidden for every
 * group without exception — code changes go through the write gate, never
 * through an event router.
 */
const GROUP_ACTIONS: Readonly<Record<RouteGroup, { allowed: readonly string[]; evidence: readonly string[]; success: string }>> = {
  OWNER_COMMAND: { allowed: ["classify_intent", "create_work_item", "report_status"], evidence: ["command_id", "work_id"], success: "an Owner-visible work item exists with a resolved next action" },
  RUNTIME_ERROR: { allowed: ["read_process_state", "read_logs", "request_controlled_restart"], evidence: ["failed_boundary", "last_evidence_ref"], success: "the failed boundary is named and a recovery path is chosen or escalated" },
  SECURITY_POLICY: { allowed: ["read_policy_decision", "read_grant_state", "report_denial"], evidence: ["policy_decision_id", "rule_id"], success: "the denial is explained by a real rule id" },
  SOFTWARE_CODE: { allowed: ["read_source", "run_tests", "report_diff_intent"], evidence: ["test_result", "commit_or_diff_ref"], success: "a reproducible build/test result exists" },
  INFRASTRUCTURE: { allowed: ["read_service_health", "read_dns_tls_state", "report_incident"], evidence: ["health_probe_result"], success: "the unhealthy component is identified with a probe result" },
  DATABASE_DATA: { allowed: ["read_schema", "read_row_counts", "report_integrity_finding"], evidence: ["query_result_ref"], success: "the data problem is located with a real query result" },
  RESOURCE_COMPUTE: { allowed: ["measure_process", "read_resource_evidence", "read_rate_card"], evidence: ["work_id", "process_id", "evidence_ref"], success: "a measured work item exists with per-process evidence" },
  COST_BILLING: { allowed: ["read_rate_card", "read_cost_evidence", "reconcile_against_invoice"], evidence: ["rate_card_ref", "cost_evidence_ref"], success: "the cost is reconciled or explicitly NOT_MEASURED with a reason" },
  EXTERNAL_INTEGRATION: { allowed: ["read_integration_status", "retry_outbound_call", "report_provider_error"], evidence: ["provider_response_ref"], success: "the external boundary state is known from a real response" },
  EVIDENCE_VERIFICATION: { allowed: ["read_evidence", "recompute_from_evidence", "report_conflict"], evidence: ["evidence_ref", "recomputation_result"], success: "the evidence is confirmed, or the conflict is named" },
};

const FORBIDDEN_FOR_EVERY_GROUP: readonly string[] = [
  "write_source_code",
  "bypass_write_gate",
  "bypass_permission_gate",
  "bypass_execution_policy",
  "open_public_port",
  "read_or_forward_credentials",
  "self_certify_verification",
  "re_emit_the_same_event_id",
];

function nowIso(): string { return new Date().toISOString(); }

/**
 * DNA OS-side loop guard. n8n has its own, and BOTH are required: n8n's
 * protects the router, this one protects DNA OS even when the router is
 * unreachable or has been reset. A guard that lives only on the far side of a
 * network hop is not a guard.
 */
const seenEventIds = new Map<string, string>();
const traceCapabilityVisits = new Map<string, number>();
const MAX_SAME_CAPABILITY_VISITS = 3;

export function localLoopCheck(event: DnaOsCentralEvent): { loop: boolean; reason: string | null } {
  if (!Number.isFinite(event.hop_count) || event.hop_count < 0) {
    return { loop: true, reason: `hop_count is not a non-negative number: ${event.hop_count}` };
  }
  if (event.hop_count >= MAX_HOPS) {
    return { loop: true, reason: `hop_count ${event.hop_count} reached MAX_HOPS ${MAX_HOPS}` };
  }
  const seenAt = seenEventIds.get(event.event_id);
  if (seenAt) {
    return { loop: true, reason: `event_id already routed at ${seenAt}; a retry carries a NEW event_id and the SAME trace_id` };
  }
  if (event.capability_id) {
    const key = `${event.trace_id}::${event.capability_id}`;
    const visits = (traceCapabilityVisits.get(key) ?? 0) + 1;
    if (visits > MAX_SAME_CAPABILITY_VISITS) {
      return { loop: true, reason: `trace ${event.trace_id} returned to capability ${event.capability_id} ${visits} times (limit ${MAX_SAME_CAPABILITY_VISITS})` };
    }
  }
  return { loop: false, reason: null };
}

function markSeen(event: DnaOsCentralEvent): void {
  seenEventIds.set(event.event_id, nowIso());
  if (event.capability_id) {
    const key = `${event.trace_id}::${event.capability_id}`;
    traceCapabilityVisits.set(key, (traceCapabilityVisits.get(key) ?? 0) + 1);
  }
}

/** Test-only reset. Never called in a real routing path. */
export function __resetLoopState(): void { seenEventIds.clear(); traceCapabilityVisits.clear(); }

/**
 * Resolve the owning capability from the REAL registries. Two sources are
 * consulted in order and both are recorded, so a resolution can always be
 * traced to the registry row that produced it.
 */
export function resolveOwner(group: RouteGroup | null): OwnerResolution {
  const considered: { capability_id: string; found: boolean; health: string | null; taken: boolean; note: string }[] = [];
  if (!group) {
    return { route_group: null, capability_id: null, capability_source: null, capability_health: null,
      permission_requirement: null, agent_adapter_id: null, agent_capabilities: [], resolved: false,
      reason: "n8n returned no route_group, so there is nothing to resolve an owner for", considered: [] };
  }

  const registry = listCapabilities();
  let store: ReturnType<typeof createPersistentFileStore> | null = null;
  try { store = createPersistentFileStore(); } catch { store = null; }

  for (const candidate of GROUP_CANDIDATES[group]) {
    const registered = registry.find((c) => c.capability_id === candidate) ?? getCapability(candidate) ?? null;
    if (registered) {
      // A capability that exists but is NOT_CONNECTED is recorded and skipped:
      // routing work to a destination the router itself knows is unreachable
      // would produce a work item that can never complete.
      const connected = registered.health_status === "CONNECTED";
      considered.push({ capability_id: candidate, found: true, health: registered.health_status, taken: connected,
        note: connected ? "taken from control/command-router CAPABILITY_REGISTRY" : "found but health_status is not CONNECTED" });
      if (connected) {
        const worker = DEFAULT_AGENT_WORKERS.find((w) => w.describe().capabilities.length > 0) ?? null;
        return {
          route_group: group, capability_id: registered.capability_id, capability_source: "command-router-registry",
          capability_health: registered.health_status, permission_requirement: registered.permission_requirement,
          agent_adapter_id: worker ? worker.describe().adapter_id : null,
          agent_capabilities: worker ? worker.describe().capabilities : [],
          resolved: true,
          reason: `capability ${registered.capability_id} resolved from the command-router registry (health ${registered.health_status})`,
          considered,
        };
      }
      continue;
    }

    if (store) {
      const hit = findCapability({ canonical_name: candidate }, store);
      if (hit) {
        considered.push({ capability_id: candidate, found: true, health: hit.status, taken: true,
          note: "taken from the persistent software registry" });
        return {
          route_group: group, capability_id: candidate, capability_source: "persistent-software-registry",
          capability_health: hit.status,
          // A persistent-registry capability carries no router permission
          // requirement field; saying "unknown" is the truth, and the real
          // gate still runs downstream regardless of what is recorded here.
          permission_requirement: "declared-by-execution-boundary",
          agent_adapter_id: null, agent_capabilities: [], resolved: true,
          reason: `capability ${candidate} resolved from the persistent software registry (status ${hit.status})`,
          considered,
        };
      }
      considered.push({ capability_id: candidate, found: false, health: null, taken: false,
        note: "not in the command-router registry and not in the persistent software registry" });
      continue;
    }
    considered.push({ capability_id: candidate, found: false, health: null, taken: false,
      note: "not in the command-router registry; persistent registry unreadable from here" });
  }

  return {
    route_group: group, capability_id: null, capability_source: null, capability_health: null,
    permission_requirement: null, agent_adapter_id: null, agent_capabilities: [], resolved: false,
    reason: `no candidate for ${group} resolved to a real, connected capability — reported as UNRESOLVED_OWNER rather than assigned to the nearest match`,
    considered,
  };
}

function buildOrder(event: DnaOsCentralEvent, resolution: OwnerResolution): AgentDispatchOrder | null {
  if (!resolution.resolved || !resolution.route_group || !resolution.capability_id) return null;
  const spec = GROUP_ACTIONS[resolution.route_group];
  return {
    WORK_ID: event.work_id ?? `work-${randomUUID()}`,
    TASK_TYPE: resolution.route_group,
    TARGET_CAPABILITY: resolution.capability_id,
    INPUT_CONTRACT: {
      event_id: event.event_id, trace_id: event.trace_id, origin: event.origin,
      hop_count: event.hop_count + 1, source: event.source, event_type: event.event_type,
      severity: event.severity, status: event.status, error_code: event.error_code,
      capability_id: event.capability_id, resource_id: event.resource_id,
      evidence_ref: event.evidence_ref, occurred_at: event.occurred_at, payload: event.payload,
    },
    ALLOWED_ACTIONS: spec.allowed,
    FORBIDDEN_ACTIONS: FORBIDDEN_FOR_EVERY_GROUP,
    EVIDENCE_REQUIRED: spec.evidence,
    SUCCESS_CONDITION: spec.success,
    TIMEOUT_MS: DISPATCH_TIMEOUT_MS,
  };
}

function hop(from: string, to: string, event: DnaOsCentralEvent, start: string, status: string,
             errorCode: string | null, evidenceRef: string | null): HopRecord {
  const end = nowIso();
  return {
    FROM: from, TO: to, EVENT_ID: event.event_id, WORK_ID: event.work_id, TRACE_ID: event.trace_id,
    START: start, END: end, DURATION_MS: new Date(end).getTime() - new Date(start).getTime(),
    STATUS: status, ERROR_CODE: errorCode, EVIDENCE_REF: evidenceRef, HOP_COUNT: event.hop_count,
  };
}

/**
 * Persist the whole outcome through the EXISTING evidence store. No new
 * store, no new table: `saveEvidence` is the same append-only sink
 * `control/owner-backbone/` and `work-resolution` already write into.
 */
function persist(outcome: Omit<RoutedEventOutcome, "evidence_ref">): string {
  const evidenceId = `n8n-route-${outcome.event.event_id}`;
  saveEvidence({
    evidence_id: evidenceId,
    task_id: outcome.event.work_id ?? outcome.event.trace_id,
    kind: "execution_output",
    source: SOURCE,
    recorded_at: nowIso(),
    payload: outcome,
  } as never);
  return evidenceId;
}

export interface RouteOptions {
  /** When false the work item is NOT created — used only to inspect a resolution. Dispatch is the default because a router that never dispatches is not a router. */
  readonly dispatch?: boolean;
}

export async function routeDnaOsEvent(event: DnaOsCentralEvent, options: RouteOptions = {}): Promise<RoutedEventOutcome> {
  const dispatchEnabled = options.dispatch !== false;
  const hops: HopRecord[] = [];

  // --- hop 0: DNA OS's own loop guard, BEFORE any network call ----------
  const localStart = nowIso();
  const local = localLoopCheck(event);
  if (local.loop) {
    hops.push(hop("DNA_OS", "DNA_OS_LOOP_GUARD", event, localStart, "LOOP_DETECTED", "LOOP_DETECTED", event.evidence_ref));
    const partial = {
      event, decision: null, resolution: resolveOwner(null), order: null, dispatch: null,
      hops, route_status: "LOOP_DETECTED" as RouteStatus,
    };
    return { ...partial, evidence_ref: persist(partial) };
  }
  markSeen(event);

  // --- hop 1: DNA OS -> n8n (classification) ----------------------------
  const sendStart = nowIso();
  const sent = await sendCentralEventToN8n(event);
  const decision: RouterDecision | null = sent.decision;
  const routerStatus: RouteStatus = decision?.route_status ?? "ROUTER_UNREACHABLE";
  hops.push(hop("DNA_OS", "N8N_ROUTER", event, sendStart, routerStatus,
                sent.error ? "ROUTER_ERROR" : null, event.evidence_ref));

  if (!decision || routerStatus === "ROUTER_UNREACHABLE" || routerStatus === "REJECTED_MISSING_FIELDS"
      || routerStatus === "LOOP_DETECTED") {
    const partial = {
      event, decision, resolution: resolveOwner(null), order: null, dispatch: null,
      hops, route_status: routerStatus,
    };
    return { ...partial, evidence_ref: persist(partial) };
  }

  // --- hop 2: n8n decision -> DNA OS resolution -------------------------
  const resolveStart = nowIso();
  const resolution = resolveOwner(decision.route_group);
  hops.push(hop("N8N_ROUTER", "DNA_OS_RESOLVER", event, resolveStart,
                resolution.resolved ? "RESOLVED" : "UNRESOLVED_OWNER",
                resolution.resolved ? null : "UNRESOLVED_OWNER", event.evidence_ref));

  const order = buildOrder(event, resolution);
  if (!resolution.resolved || !order) {
    const partial = {
      event, decision, resolution, order: null, dispatch: null, hops,
      route_status: "UNRESOLVED_OWNER" as RouteStatus,
    };
    return { ...partial, evidence_ref: persist(partial) };
  }

  // --- hop 3: DNA OS -> the existing controlled execution boundary ------
  let dispatchResult: AgentDispatchResult | null = null;
  if (dispatchEnabled) {
    const dispatchStart = nowIso();
    try {
      // submitTask IS the controlled boundary: it runs capability lookup, the
      // policy gate, Admission and the write/permission gates. This file does
      // not and must not reproduce any of them.
      // The route context is what lets the gateway resolve from a REGISTRY
      // rather than from this sentence. Before it existed, the gateway had
      // only the intent string and fell through to a three-substring matcher
      // that no canonical route group could ever satisfy.
      const task = await submitTask(
        `${order.TASK_TYPE} ${order.TARGET_CAPABILITY} ${event.event_type}`,
        { origin_capability: SOURCE, summary: event.message } as never,
        SOURCE,
        DEFAULT_AGENT_WORKERS,
        undefined,
        {
          route_group: resolution.route_group,
          target_capability_id: resolution.capability_id,
          target_capability_name: resolution.capability_id,
          event_type: event.event_type,
          error_code: event.error_code,
          work_id: order.WORK_ID,
          trace_id: event.trace_id,
          evidence_ref: event.evidence_ref,
        },
      );
      dispatchResult = {
        WORK_ID: order.WORK_ID,
        STATUS: task.status,
        OUTPUT: { task_id: task.task_id, next_action: task.next_action ?? null, output_lane: task.output_lane },
        EVIDENCE_REFS: [`agent-gateway:task:${task.task_id}`],
        ERROR_CODE: task.status === "BLOCKED" ? "GATEWAY_BLOCKED" : null,
        NEXT_ACTION: task.next_action ?? "AWAIT_GATEWAY",
        OWNER_DECISION_REQUIRED: task.status === "BLOCKED",
      };
      hops.push(hop("DNA_OS_RESOLVER", `AGENT_GATEWAY:${order.TARGET_CAPABILITY}`, event, dispatchStart,
                    task.status, dispatchResult.ERROR_CODE, `agent-gateway:task:${task.task_id}`));
    } catch (error) {
      // A dispatch failure is recorded as a failure. It never becomes a
      // success and it never silently retries — a retry is a new event with a
      // new event_id, which the loop guard depends on.
      dispatchResult = {
        WORK_ID: order.WORK_ID, STATUS: "DISPATCH_FAILED", OUTPUT: null, EVIDENCE_REFS: [],
        ERROR_CODE: "DISPATCH_FAILED", NEXT_ACTION: "OWNER_TRIAGE", OWNER_DECISION_REQUIRED: true,
      };
      hops.push(hop("DNA_OS_RESOLVER", `AGENT_GATEWAY:${order.TARGET_CAPABILITY}`, event, dispatchStart,
                    "DISPATCH_FAILED", error instanceof Error ? error.message.slice(0, 80) : "DISPATCH_FAILED", null));
    }
  }

  const partial = { event, decision, resolution, order, dispatch: dispatchResult, hops, route_status: "ROUTED" as RouteStatus };
  return { ...partial, evidence_ref: persist(partial) };
}
