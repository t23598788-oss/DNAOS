/**
 * หน้าที่: the `RegistrationCandidate` for the Control Workspace's client-side
 * survival layer — the boot conveyor's remaining stages (UI SHELL →
 * LOCAL SNAPSHOT → STATE RECONCILIATION → NETWORK OFFLINE AND RETRY) as they
 * actually run on this machine.
 *
 * WHY IT IS NOT A DUPLICATE of `service-lifecycle-supervision`. That
 * capability keeps the BACKEND PROCESSES alive: dependency-ordered launchctl
 * starts, bounded attempts, FAILED_LOCKED. It says nothing about what the
 * screen does while those processes are down, and nothing can — it runs on the
 * machine, not in the page. This capability is the other half: the screen
 * opens with no backend at all, shows what it last saw with its age attached,
 * repairs itself by diff instead of reload when the backend returns, and holds
 * undeliverable outbound work in a bounded, idempotent queue. Different
 * subject (the view, not the process), different failure it prevents (a blank
 * or lying screen, not a dead service).
 *
 * WHY IT IS NOT A DUPLICATE of `circuit-breaker`. That one kills subprocesses
 * that violate import boundaries. Unrelated subject.
 *
 * Input: none (one const value).
 * Output: `CONTROL_WORKSPACE_RESILIENCE_CANDIDATE`.
 * Dependency ที่อนุญาต: `../../../control/event-pipeline/registration-contract.ts` (type only).
 * สิ่งที่ห้ามแตะ: never edit `evidence_refs` to name a run that did not happen.
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

export const CONTROL_WORKSPACE_RESILIENCE_CANDIDATE: RegistrationCandidate = {
  candidate_id: "candidate-control-workspace-resilience-v1",
  name: "control-workspace-resilience",
  kind: "capability",
  source_location:
    "~/Desktop/dna-os-control-workspace/ (features/resilience/, server/snapshot-store.mjs, server/retry-queue.mjs, server/outbound.mjs)",
  owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/control-workspace-resilience.ts",

  input: [
    "none — reads its own last-known UI state from disk and the real state of the machine (loopback probes, an internet reachability probe, the joint-monitor SSE stream)",
  ],
  output: [
    "ShellState: BOOTING | CONNECTING | LIVE | DEGRADED | OFFLINE | RECOVERING — derived only from measured probe results, never declared",
    "a local snapshot carrying graph, node_states, edge_states, selected_node, current_view, camera, layout, last_event_id, snapshot_created_at, source_timestamps — every read labelled ORIGIN=SNAPSHOT with AS_OF and STALE_AGE_MS",
    "a reconciliation report: per-id add/remove/update patches plus conflicts resolved to BACKEND, with full_reload_required always false",
    "FailureClass: LOCAL_SERVICE_DOWN | INTERNET_OFFLINE | EXTERNAL_PROVIDER_DOWN | AUTH_FAILURE | RATE_LIMIT | TIMEOUT | INVALID_CONTRACT | PERMISSION_DENIED",
    "an append-only outbound retry queue row: operation_id, destination, payload_hash, idempotency_key, attempt, max_attempts, last_error, next_retry_at, created_at, status",
  ],
  side_effects: [
    "atomic write (temp -> fsync -> rename, same directory) of data/workspace-snapshot.json",
    "appends rows to data/outbound-retry-queue.jsonl — append-only, never rewritten, latest row per operation_id is the current state",
    "outbound HTTP to destinations the caller names, each carrying its idempotency-key header",
    "one HEAD request to an internet reachability probe, only when an external destination has already failed",
  ],
  dependencies: [
    "dna-os-control-workspace product server (the only process that owns these files)",
    "observability/joint-monitor (SSE resume via Last-Event-ID / ?since=, already contracted)",
    "transport/owner-command-http (the Core whose absence this layer is built to survive)",
    "service-lifecycle-supervision (keeps the process alive; this keeps the view honest while it is not)",
  ],

  behavior:
    "render_shell_before_backend_then_label_every_value_with_its_age: the screen opens with no backend call above it, fills from a disk snapshot labelled ORIGIN=SNAPSHOT/AS_OF/STALE_AGE_MS, then reconciles against backend truth by stable id and patches only what differs — never a full page reload. Unmeasured probes (write paths deliberately not fired) leave the denominator rather than counting as healthy, so a fully dead Core reads OFFLINE and not DEGRADED. A corrupt snapshot is an expected state (SNAPSHOT_INVALID) that opens an empty shell instead of crashing. Loopback failures are classified as LOCAL_SERVICE_DOWN without consulting the internet, and an external failure is separated from an internet failure by a real reachability probe, so losing the internet never marks a local DNA OS service DOWN. Undeliverable outbound work enters a disk-backed queue keyed by destination+payload_hash; retries back off exponentially to a 5-minute ceiling and stop at MAX_ATTEMPTS=5 (EXHAUSTED) or immediately on AUTH_FAILURE/INVALID_CONTRACT/PERMISSION_DENIED (FAILED_PERMANENT), both demanding incident evidence. A terminal record can only be revived by an explicit reset, so re-submitting the same work cannot reset the attempt counter.",

  version: "1.0.0",

  evidence_refs: [
    "~/Desktop/dna-os-control-workspace/features/resilience/shell-state.mjs (six shell states, eight failure classes)",
    "~/Desktop/dna-os-control-workspace/features/resilience/reconcile.mjs (diff by stable id)",
    "~/Desktop/dna-os-control-workspace/features/resilience/controller.mjs (SHELL -> SNAPSHOT -> HANDSHAKE -> RECONCILE -> LIVE)",
    "~/Desktop/dna-os-control-workspace/server/snapshot-store.mjs (temp -> fsync -> rename)",
    "~/Desktop/dna-os-control-workspace/server/retry-queue.mjs (bounded backoff, idempotency, explicit reset)",
    "~/Desktop/dna-os-control-workspace/server/outbound.mjs (reachability probe separates INTERNET_OFFLINE from EXTERNAL_PROVIDER_DOWN)",
    "~/Desktop/dna-os-control-workspace/test/resilience-acceptance.mjs — 39 passed, 0 failed against the live launchd-managed service",
    "live proof TEST A: com.dnaos.owner-command-http booted out; UI shell/main.mjs still HTTP 200, snapshot readable, 4 required Core endpoints NOT_CONNECTED while joint-monitor stayed CONNECTED",
    "live proof TEST B: Core bootstrapped back to HTTP 200 in ~2s; /api/core/status returned to CONNECTED with no page reload",
    "live proof TEST B2: reconcile over the real 170-node/477-edge graph with the arrays reversed produced 5 patches out of 647 items, 0 when identical",
    "live proof TEST C: kill -9 on the workspace; launchd restarted it with a new pid and ppid=1, and the 409586-byte snapshot survived and read back with camera/view/selection intact",
    "live proof TEST D: snapshot truncated to 137 bytes -> SNAPSHOT_INVALID, UI still HTTP 200, same pid, no crash",
    "live proof TEST E: unreachable external host classified EXTERNAL_PROVIDER_DOWN (reachability probe HTTP 200) while LOCAL_SERVICE_DOWN stayed NO",
    "live proof TEST F: 3 sends + 2 drains against a counting receiver delivered exactly 1 request; a 401 destination was hit exactly once across 5 sends and a drain",
    "live proof: SSE ?since=<known event_id> replayed 525 missed events; ?since=<unknown> returned resume_failed plus a full snapshot",
  ],

  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "product/control-workspace-resilience",
};
