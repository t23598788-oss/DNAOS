/**
 * หน้าที่: the `RegistrationCandidate` for the DNA OS ↔ n8n owner event
 * router — classification, owner resolution, anti-loop and controlled
 * dispatch — submitted through `control/registration-pipeline/`'s existing
 * stages into `software/registry-database/`'s canonical persistent store.
 *
 * WHY THIS IS A SEPARATE CAPABILITY FROM
 * `real-work-resource-cost-measurement`: that one MEASURES one process and
 * prices it. This one decides WHO should act on an event. They share no code
 * path, no contract and no storage, and Duplicate Resolution will fingerprint
 * them as distinct on content, not on my say-so.
 *
 * WHAT IT IS NOT: not an executor. It creates a work item through
 * `control/agent-gateway/#submitTask` and stops there. Every policy, write
 * and permission gate stays where it already is; a router that decided
 * permissions would be a bypass wearing a different name.
 *
 * Input: none (one const value).
 * Output: `OWNER_EVENT_AGENT_ROUTER_CANDIDATE`.
 * Dependency ที่อนุญาต: `../../../control/event-pipeline/registration-contract.ts` (type only).
 * สิ่งที่ห้ามแตะ: never edit `evidence_refs` to name a proof that was not
 * run — Duplicate Resolution fingerprints normalized content, so an edit to
 * an already-registered record creates a SECOND resource instead of updating
 * the first. Never add requested_owner/requested_repository unless BOTH are
 * real ids in `software/repository-registry/`.
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

export const OWNER_EVENT_AGENT_ROUTER_CANDIDATE: RegistrationCandidate = {
  candidate_id: "candidate-owner-event-agent-router-v1",
  name: "owner-event-agent-router",
  kind: "capability",
  source_location: "connections/n8n/ (event-router.ts, outbound-webhook.ts, types.ts, workflow/classify-and-route.js)",
  owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/owner-event-agent-router.ts",

  input: [
    "DnaOsCentralEvent: event_id, work_id, trace_id, owner_id, source, event_type, severity, status, message, capability_id, resource_id, error_code, evidence_ref, occurred_at, payload, hop_count, origin",
  ],
  output: [
    "RouterDecision from the live n8n workflow: route_group (one of ten), classification_signal, hop accounting, route_status",
    "OwnerResolution: capability_id resolved from the command-router registry or the persistent software registry, with every candidate considered and why",
    "AgentDispatchOrder: WORK_ID, TASK_TYPE, TARGET_CAPABILITY, INPUT_CONTRACT, ALLOWED_ACTIONS, FORBIDDEN_ACTIONS, EVIDENCE_REQUIRED, SUCCESS_CONDITION, TIMEOUT_MS",
    "AgentDispatchResult and one HopRecord per hop (FROM/TO/EVENT_ID/WORK_ID/TRACE_ID/START/END/DURATION_MS/STATUS/ERROR_CODE/EVIDENCE_REF)",
  ],
  side_effects: [
    "one outbound HTTPS POST to the existing n8n workflow jiNltcrOhck2wYtM (no inbound listener, no new port)",
    "creates a work item through control/agent-gateway/#submitTask — the existing controlled boundary",
    "appends routing evidence through the existing agent-gateway evidence store",
  ],
  dependencies: [
    "control/command-router (CAPABILITY_REGISTRY — owner resolution)",
    "software/registry-database (persistent software registry — owner resolution)",
    "control/agent-gateway (submitTask, DEFAULT_AGENT_WORKERS, saveEvidence)",
    "connections/n8n workflow DNA-OS-OUTBOUND-ORCHESTRATION-PROOF (jiNltcrOhck2wYtM)",
  ],

  behavior:
    "classify_event_resolve_owner_and_dispatch_through_existing_boundary: sends a central DNA OS event outbound to the n8n workflow, which classifies it into one of ten route groups from structured signals (error_code, then source, then longest event_type prefix — never message text) and enforces MAX_HOPS=10 plus duplicate-event_id and repeat-capability loop guards; DNA OS then resolves the owning capability against its own registries, refuses to invent one (UNRESOLVED_OWNER), attaches allowed/forbidden actions and evidence requirements to the order, and creates the work item through control/agent-gateway/#submitTask so every policy, write and permission gate runs unchanged. It never executes, never writes source, never opens an inbound port, and enforces its own loop guard independently of the router's.",

  version: "1.0.0",

  evidence_refs: [
    "connections/n8n/event-router.ts",
    "connections/n8n/outbound-webhook.ts",
    "connections/n8n/types.ts",
    "connections/n8n/workflow/classify-and-route.js",
    "connections/n8n/tests/ten-group-routing-proof.ts",
    "connections/n8n/evidence/workflow-before-extend.json",
    "connections/n8n/evidence/workflow-after-extend.json",
    "n8n workflow jiNltcrOhck2wYtM DNA-OS-OUTBOUND-ORCHESTRATION-PROOF (extended in place, same id, same webhook path, still active)",
    "live proof: 10/10 events classified into their expected route group, 10/10 owners resolved from real registries",
    "live proof: duplicate event_id and hop_count 11 both returned LOOP_DETECTED",
    "live proof: 30 hop records, 10 unique task_ids, 0 duplicate work items",
  ],

  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "orchestration/event-routing",
};
