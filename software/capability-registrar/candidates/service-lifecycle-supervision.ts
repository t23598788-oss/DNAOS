/**
 * หน้าที่: the `RegistrationCandidate` for dependency-ordered service
 * lifecycle supervision — the boot conveyor's first five stages
 * (BOOT SENSOR → SERVICE REGISTRY → SUPERVISOR → DEPENDENCY START →
 * HEALTH SENSOR) as they actually run on this machine.
 *
 * WHY IT IS NOT A DUPLICATE. `control/runtime-control/` already held the
 * service registry and the launchctl primitives; `control/owner-backbone/`
 * already held the continuous recovery sweep under
 * `com.dnaos.recovery-supervisor`. Neither knew about START ORDER, and
 * neither stopped after a bounded number of attempts. This capability is the
 * ordering and the bound — added to those two, not beside them. No second
 * registry, no second supervisor, no second process system.
 *
 * Input: none (one const value).
 * Output: `SERVICE_LIFECYCLE_SUPERVISION_CANDIDATE`.
 * Dependency ที่อนุญาต: `../../../control/event-pipeline/registration-contract.ts` (type only).
 * สิ่งที่ห้ามแตะ: never edit `evidence_refs` to name a run that did not happen.
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

export const SERVICE_LIFECYCLE_SUPERVISION_CANDIDATE: RegistrationCandidate = {
  candidate_id: "candidate-service-lifecycle-supervision-v1",
  name: "service-lifecycle-supervision",
  kind: "capability",
  source_location: "control/runtime-control/ (boot-orchestrator.ts, host-runtime.ts SERVICES, types.ts depends_on)",
  owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/service-lifecycle-supervision.ts",

  input: [
    "none — reads SERVICES from control/runtime-control and the real state of the machine (launchctl, listening ports, HTTP health)",
  ],
  output: [
    "BootReport: boot_id, dependency-resolved start order, and per-service ServiceBootResult",
    "ServiceState per service: READY | DEGRADED | DOWN | RECOVERING | FAILED_LOCKED | SKIPPED_DEPENDENCY",
    "OperationEvidence per action, through control/runtime-control's existing evidence contract",
  ],
  side_effects: [
    "launchctl bootstrap/kickstart on services that are not healthy — never on ones that are",
    "appends OperationEvidence rows through the existing runtime-control evidence writer",
  ],
  dependencies: [
    "control/runtime-control (service registry, launchctl primitives, health probe, evidence)",
    "control/owner-backbone (the continuous supervisor process that runs the cold-start boot)",
    "launchd (the only process supervisor; no second one is introduced)",
  ],

  behavior:
    "boot_services_in_declared_dependency_order_with_bounded_attempts: resolves a topological start order from each service's declared depends_on, starts only services that fail their own health criterion, skips any service whose dependencies are not yet READY (with the reason), waits for a real port answer rather than trusting launchd's pid, and stops after MAX_START_ATTEMPTS=3 with FAILED_LOCKED plus evidence rather than retrying forever. No AI is in the recovery path; every decision is a fixed rule readable in the source.",

  version: "1.0.0",

  evidence_refs: [
    "control/runtime-control/boot-orchestrator.ts",
    "control/runtime-control/host-runtime.ts (SERVICES, 8 services, every one with explicit depends_on)",
    "control/runtime-control/types.ts (ServiceId extended with control-workspace and joint-monitor)",
    "control/owner-backbone/start.ts (cold-start boot wired into the existing supervisor)",
    "~/Library/LaunchAgents/com.dnaos.control-workspace.plist",
    "~/Library/LaunchAgents/com.dnaos.joint-monitor.plist",
    "live proof: kill -9 on control-workspace, launchd restarted it in ~1s with a new pid and a new started_at",
    "live proof: joint-monitor fully booted out of launchd, then bootstrapped back to HTTP 200 in 1027ms on attempt 1",
    "live proof: start order resolved joint-monitor -> ... -> control-workspace with 0 cycles, READY 8 FAILED_LOCKED 0 SKIPPED 0",
    "live proof: recovery-supervisor now watches all 7 peer services including the two newly registered ones",
  ],

  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "runtime/service-lifecycle",
};
