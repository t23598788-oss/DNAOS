/**
 * หน้าที่: internal glue this orchestrator alone uses to pick which real
 * downstream branch (execution/deploy/'s plan-only resolver, or a
 * skip-straight-through path) a capability needs — NOT a separate
 * capability folder. Duplicate/Overlap Discovery against
 * `../target-resolution/` (STEP, 2026-08-21) found that folder answers a
 * different real question — "where does this REGISTERED artifact's OWN
 * registry/source data live" (resource_type-driven, e.g.
 * CAPABILITY -> CAPABILITY_GRAPH, always trivially RESOLVED) — never
 * "where does this capability run at runtime." This file answers only
 * the second question, purely as routing input for
 * `execution/deploy/contract.ts`'s `resolveDeployPlan`; it has no
 * standing of its own and is never re-exported through ./contract.ts.
 *
 * Input: caller-cited evidence, independently re-checked here.
 * Output: `DeliveryTargetClass`, `DeliveryTargetEvidence`,
 * `classifyDeliveryTarget`.
 * Dependency ที่อนุญาต: ../../software/registry-database/contract.ts
 * (findCapability), ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never resolve HOSTED_SERVICE from a caller-supplied
 * capability_id string alone — the target capability must be a real,
 * REGISTERED row in the store. Never re-export this file through
 * ./contract.ts — it is orchestration-internal only.
 */

import { findCapability } from "../../software/registry-database/contract";
import type { RegistryStore } from "../../software/registry-database/contract";
import { fileExistsOnDisk, nowIso } from "./host-runtime";

export type DeliveryTargetClass = "IN_PROCESS_LOCAL" | "LOCAL_MACOS_OWNER_HOST_PROCESS" | "HOSTED_SERVICE" | "UNRESOLVED";

export interface DeliveryTargetEvidence {
  in_process_consumer_file?: string;
  host_process_entrypoint?: string;
  hosted_provider_adapter_capability_id?: string;
}

export interface DeliveryTargetClassification {
  delivery_target_class: DeliveryTargetClass;
  reason: string;
  evidence_ref: string | null;
  created_at: string;
}

export function classifyDeliveryTarget(evidence: DeliveryTargetEvidence, store: RegistryStore): DeliveryTargetClassification {
  const created_at = nowIso();

  if (evidence.hosted_provider_adapter_capability_id) {
    const adapter = findCapability({ capability_id: evidence.hosted_provider_adapter_capability_id }, store);
    if (adapter && adapter.status === "REGISTERED") {
      return { delivery_target_class: "HOSTED_SERVICE", reason: `resolved through real, REGISTERED hosted provider adapter capability ${evidence.hosted_provider_adapter_capability_id}`, evidence_ref: evidence.hosted_provider_adapter_capability_id, created_at };
    }
  }

  if (evidence.host_process_entrypoint && fileExistsOnDisk(evidence.host_process_entrypoint)) {
    return { delivery_target_class: "LOCAL_MACOS_OWNER_HOST_PROCESS", reason: `real host-process entrypoint file found at ${evidence.host_process_entrypoint}`, evidence_ref: evidence.host_process_entrypoint, created_at };
  }

  if (evidence.in_process_consumer_file && fileExistsOnDisk(evidence.in_process_consumer_file)) {
    return { delivery_target_class: "IN_PROCESS_LOCAL", reason: `real in-process consumer file found at ${evidence.in_process_consumer_file}`, evidence_ref: evidence.in_process_consumer_file, created_at };
  }

  return { delivery_target_class: "UNRESOLVED", reason: "no cited evidence independently verified — nothing guessed", evidence_ref: null, created_at };
}
