/**
 * หน้าที่: decide WHICH capability a task is for, from registry evidence
 * rather than from words in a sentence.
 *
 * MATCHING ORDER, most authoritative first:
 *   1. EXACT_CAPABILITY_ID       — the caller named an id, and a registry has it
 *   2. EXACT_CANONICAL_NAME      — the caller named a canonical name, and a registry has it
 *   3. REGISTRY_ROUTE_GROUP      — a route group, resolved through the shared
 *                                  search order against real registries
 *   4. LEGACY_SUBSTRING          — the original three-substring matcher, kept
 *                                  ONLY so existing callers keep working
 *
 * WHY THE ORDER MATTERS MORE THAN THE TIERS. `../../` gateway's original
 * matcher decided from three substrings ("ตรวจ", "modify", "external system
 * lifecycle") in the intent sentence. Every canonical route group missed it
 * and landed on NO_EXISTING_CAPABILITY — 213 recorded blocks. The fix is not
 * a bigger substring list: it is to stop letting prose decide, and to ask the
 * registries that already know. The substring matcher survives at tier 4
 * because real callers still depend on it, and removing it would break them
 * to make a point.
 *
 * THIS FILE GRANTS NOTHING. Resolving a capability answers "who is this for",
 * never "may it run". Policy, Admission, the write gate and the execution
 * gate all run afterwards, unchanged — a match that reaches a gate and is
 * refused there is a correct outcome, not a failure of this file.
 *
 * NO CAPABILITY IS INVENTED. Every tier returns only something a registry
 * actually contains, and reports which registry answered. When nothing
 * resolves the answer is NO_EXISTING_CAPABILITY, exactly as before.
 *
 * Input: `CapabilityMatchRequest`.
 * Output: `resolveCapability` -> `CapabilityMatchResult`.
 * Dependency ที่อนุญาต: ./types.ts, ../../contracts/command/route-group-capabilities.ts,
 * ../command-router/contract.ts, ../../software/registry-database/contract.ts
 * (+ its persistent adapter).
 * สิ่งที่ห้ามแตะ: never let tier 4 run before tiers 1-3. Never return a match
 * whose `registry_ref` is empty — a match with no citable row is a guess.
 */

import { GROUP_CAPABILITY_SEARCH_ORDER } from "../../contracts/command/route-group-capabilities";
import type { RouteGroup } from "../../contracts/command/route-group-capabilities";
import { getCapability, listCapabilities } from "../command-router/contract";
import { findCapability } from "../../software/registry-database/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";

/** The gateway's own capability index row shape (reports/phase16-world-evidence/capability_index.json). */
export interface GatewayCapabilityEntry {
  problem_type: string;
  available_capability: string;
  execution_method: string;
  required_permission: string;
  current_status: string;
}

export type MatchMethod =
  | "EXACT_CAPABILITY_ID"
  | "EXACT_CANONICAL_NAME"
  | "REGISTRY_ROUTE_GROUP"
  | "LEGACY_SUBSTRING"
  | "NO_EXISTING_CAPABILITY";

/** Everything a caller may tell the gateway about what this task is for. All optional but `intent_text`. */
export interface CapabilityMatchRequest {
  readonly intent_text: string;
  readonly route_group?: RouteGroup | null;
  readonly target_capability_id?: string | null;
  readonly target_capability_name?: string | null;
  readonly event_type?: string | null;
  readonly error_code?: string | null;
  readonly work_id?: string | null;
  readonly trace_id?: string | null;
  readonly evidence_ref?: string | null;
}

export interface CapabilityMatchResult {
  readonly MATCH_METHOD: MatchMethod;
  readonly MATCHED_CAPABILITY_ID: string | null;
  /** The exact registry (and row) that answered. Never empty for a real match. */
  readonly REGISTRY_REF: string | null;
  readonly REASON: string;
  readonly EVIDENCE_REF: string | null;
  /** The gateway index row, when the match corresponds to one. Downstream execution still needs it. */
  readonly entry: GatewayCapabilityEntry | null;
  /** Every candidate tried and what happened — a resolution with no audit trail is a guess. */
  readonly considered: readonly { candidate: string; registry: string; found: boolean; note: string }[];
}

type Considered = { candidate: string; registry: string; found: boolean; note: string };

/**
 * Look one identifier up in every registry this file can read, in order of
 * authority. Returns the first real hit, and records every miss.
 */
function lookupEverywhere(
  candidate: string,
  gatewayIndex: readonly GatewayCapabilityEntry[],
  considered: Considered[],
): { entry: GatewayCapabilityEntry | null; capability_id: string; registry_ref: string } | null {
  // a. the gateway's own index, keyed by problem_type — the only registry
  //    whose rows carry an execution_method, so a hit here is directly usable.
  const indexHit = gatewayIndex.find((row) => row.problem_type === candidate);
  if (indexHit) {
    considered.push({ candidate, registry: "gateway capability_index.json", found: true, note: `problem_type=${indexHit.problem_type}` });
    return { entry: indexHit, capability_id: indexHit.problem_type, registry_ref: `reports/phase16-world-evidence/capability_index.json#${indexHit.problem_type}` };
  }
  considered.push({ candidate, registry: "gateway capability_index.json", found: false, note: "no problem_type with this id" });

  // b. control/command-router's routable registry.
  const routable = listCapabilities().find((c) => c.capability_id === candidate) ?? getCapability(candidate) ?? null;
  if (routable) {
    const connected = routable.health_status === "CONNECTED";
    considered.push({ candidate, registry: "command-router CAPABILITY_REGISTRY", found: true,
      note: `health_status=${routable.health_status}${connected ? "" : " (not CONNECTED — not taken)"}` });
    if (connected) {
      return { entry: null, capability_id: routable.capability_id, registry_ref: `control/command-router/capability-registry.ts#${routable.capability_id}` };
    }
  } else {
    considered.push({ candidate, registry: "command-router CAPABILITY_REGISTRY", found: false, note: "no entry with this capability_id" });
  }

  // c. the persistent software registry, keyed by canonical name.
  try {
    const store = createPersistentFileStore();
    const hit = findCapability({ canonical_name: candidate }, store);
    if (hit) {
      considered.push({ candidate, registry: "persistent software registry", found: true, note: `status=${hit.status}` });
      return { entry: null, capability_id: hit.capability_id, registry_ref: `software/registry-database/data/canonical/capabilities.jsonl#${hit.capability_id}` };
    }
    considered.push({ candidate, registry: "persistent software registry", found: false, note: "no capability with this canonical_name" });
  } catch (error) {
    // A registry that cannot be read is recorded as unreadable, never as
    // empty — "no row" and "could not look" are different facts.
    considered.push({ candidate, registry: "persistent software registry", found: false,
      note: `unreadable: ${error instanceof Error ? error.message : String(error)}` });
  }
  return null;
}

/**
 * The legacy matcher, moved here verbatim in behaviour and demoted to tier 4.
 * Preserved because `control/external-system-lifecycle/` and the existing
 * task-controller callers depend on it; changing what it matches would be a
 * silent behaviour change for them.
 */
export function legacySubstringMatch(
  intentText: string,
  gatewayIndex: readonly GatewayCapabilityEntry[],
): GatewayCapabilityEntry | null {
  const lower = intentText.toLowerCase();
  if (intentText.includes("ตรวจ") || lower.includes("status") || lower.includes("duplicate")) {
    return gatewayIndex.find((c) => c.problem_type === "file_duplicate_or_orphan_detection") ?? null;
  }
  if (intentText.includes("แก้ไข") || lower.includes("modify")) {
    return gatewayIndex.find((c) => c.problem_type === "server_hang_or_timeout") ?? null;
  }
  if (lower.includes("external system lifecycle")) {
    return gatewayIndex.find((c) => c.problem_type === "external_system_lifecycle_registration") ?? null;
  }
  return null;
}

export function resolveCapability(
  request: CapabilityMatchRequest,
  gatewayIndex: readonly GatewayCapabilityEntry[],
): CapabilityMatchResult {
  const considered: Considered[] = [];
  const evidenceRef = request.evidence_ref ?? null;

  // --- 1. EXACT CAPABILITY ID -------------------------------------------
  if (request.target_capability_id) {
    const hit = lookupEverywhere(request.target_capability_id, gatewayIndex, considered);
    if (hit) {
      return {
        MATCH_METHOD: "EXACT_CAPABILITY_ID", MATCHED_CAPABILITY_ID: hit.capability_id,
        REGISTRY_REF: hit.registry_ref,
        REASON: `caller named capability_id "${request.target_capability_id}" and a registry contains it`,
        EVIDENCE_REF: evidenceRef, entry: hit.entry, considered,
      };
    }
  }

  // --- 2. EXACT CANONICAL NAME ------------------------------------------
  if (request.target_capability_name && request.target_capability_name !== request.target_capability_id) {
    const hit = lookupEverywhere(request.target_capability_name, gatewayIndex, considered);
    if (hit) {
      return {
        MATCH_METHOD: "EXACT_CANONICAL_NAME", MATCHED_CAPABILITY_ID: hit.capability_id,
        REGISTRY_REF: hit.registry_ref,
        REASON: `caller named canonical name "${request.target_capability_name}" and a registry contains it`,
        EVIDENCE_REF: evidenceRef, entry: hit.entry, considered,
      };
    }
  }

  // --- 3. REGISTRY-SUPPORTED ROUTE GROUP ---------------------------------
  if (request.route_group) {
    const searchOrder = GROUP_CAPABILITY_SEARCH_ORDER[request.route_group] ?? [];
    for (const candidate of searchOrder) {
      const hit = lookupEverywhere(candidate, gatewayIndex, considered);
      if (hit) {
        return {
          MATCH_METHOD: "REGISTRY_ROUTE_GROUP", MATCHED_CAPABILITY_ID: hit.capability_id,
          REGISTRY_REF: hit.registry_ref,
          REASON: `route_group ${request.route_group} resolved to "${candidate}" via the shared search order in contracts/command/route-group-capabilities.ts`,
          EVIDENCE_REF: evidenceRef, entry: hit.entry, considered,
        };
      }
    }
  }

  // --- 4. LEGACY SUBSTRING (backward compatibility only) -----------------
  const legacy = legacySubstringMatch(request.intent_text, gatewayIndex);
  if (legacy) {
    considered.push({ candidate: request.intent_text.slice(0, 60), registry: "legacy substring matcher", found: true, note: legacy.problem_type });
    return {
      MATCH_METHOD: "LEGACY_SUBSTRING", MATCHED_CAPABILITY_ID: legacy.problem_type,
      REGISTRY_REF: `reports/phase16-world-evidence/capability_index.json#${legacy.problem_type}`,
      REASON: "no id, canonical name or route group resolved; the pre-existing substring matcher matched the intent text",
      EVIDENCE_REF: evidenceRef, entry: legacy, considered,
    };
  }
  considered.push({ candidate: request.intent_text.slice(0, 60), registry: "legacy substring matcher", found: false, note: "no substring rule matched" });

  return {
    MATCH_METHOD: "NO_EXISTING_CAPABILITY", MATCHED_CAPABILITY_ID: null, REGISTRY_REF: null,
    REASON: "no registry contains the named id, the named canonical name, any candidate for the route group, or a legacy substring match",
    EVIDENCE_REF: evidenceRef, entry: null, considered,
  };
}
