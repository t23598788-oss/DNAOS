/**
 * หน้าที่: `resolveSystemReference()` — queries the real, already-loaded
 * registries this repo already has (never a new one) and returns exactly
 * one of RESOLVED / AMBIGUOUS / UNRESOLVED. No fuzzy/embedding/LLM
 * matching anywhere in this file — every comparison is a plain, exact,
 * normalized string equality check, so the same input always produces the
 * same output from the same registry state.
 *
 * Input: `SystemReferenceRequest`, `SystemReferenceContext`.
 * Output: `SystemReferenceResolution`.
 * Dependency ที่อนุญาต: ../command-router/contract.ts,
 * ../../software/registry-database/contract.ts,
 * ../../software/repository-registry/contract.ts,
 * ../../connections/os-ui/adapter-contract.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never call fs/grep/child_process here — only the four
 * dependencies above, all of which are already-loaded in-memory reads by
 * the time this function runs (see their own modules' `defaultStore`/
 * `CAPABILITY_REGISTRY` module-load-time hydration). Never widen the
 * match logic to substring/fuzzy comparison — exact, normalized equality
 * only, so "DNA_LAB" never silently matches "DNA-LAB-FILE-INTELLIGENCE".
 */

import { listCapabilities } from "../command-router/contract";
import { findCapability } from "../../software/registry-database/contract";
import { listRepositories } from "../../software/repository-registry/contract";
import { resolveOsUiTargetLocator, type OsUiTarget } from "../../connections/os-ui/adapter-contract";
import type { SystemReferenceContext, SystemReferenceMatch, SystemReferenceRequest, SystemReferenceResolution } from "./types";

const OPEN_LIKE_REQUESTS = new Set(["OPEN", "OPEN_UI", "LAUNCH", "SHOW"]);

/** Exhaustive by construction — `Record<OsUiTarget, true>` fails to compile if `connections/os-ui/adapter-contract.ts`'s `OsUiTarget` union ever gains or loses a member without this file being updated. */
const OS_UI_TARGET_MEMBERSHIP: Record<OsUiTarget, true> = {
  vscode: true,
  chrome: true,
  "dna-os": true,
  "system-settings-firewall": true,
  "finder-infra": true,
  "finder-deadboard": true,
  terminal: true,
  "display-wake": true,
};

function isOsUiTarget(value: string): value is OsUiTarget {
  return Object.prototype.hasOwnProperty.call(OS_UI_TARGET_MEMBERSHIP, value);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function matchCommandRouterCapability(normalizedTarget: string): SystemReferenceMatch | null {
  const found = listCapabilities().find((entry) => normalize(entry.capability_id) === normalizedTarget);
  if (!found) return null;
  return {
    source: "COMMAND_ROUTER_CAPABILITY",
    entity_id: found.capability_id,
    capability_id: found.capability_id,
    resource_id: null,
    repository_id: found.repo_id,
    ui_ref: null,
    api_ref: null,
    runtime_ref: null,
    host_ref: null,
    port_ref: null,
    action_ref: null,
    evidence_refs: [found.contract],
  };
}

function matchRegistryDatabaseCapability(rawTarget: string, context: SystemReferenceContext): SystemReferenceMatch | null {
  const found = findCapability({ canonical_name: rawTarget }, context.registryStore);
  if (!found) return null;
  return {
    source: "REGISTRY_DATABASE_CAPABILITY",
    entity_id: found.capability_id,
    capability_id: found.capability_id,
    resource_id: found.resource_ids[0] ?? null,
    repository_id: null,
    ui_ref: null,
    api_ref: null,
    runtime_ref: null,
    host_ref: null,
    port_ref: null,
    action_ref: null,
    evidence_refs: found.evidence_refs,
  };
}

function matchRepositoryRegistry(normalizedTarget: string): SystemReferenceMatch | null {
  // Phase 6 (stale-reference protection): only ACTIVE repositories resolve.
  // A SUSPENDED/RETIRED repository (see suspendRepository()) must never be
  // silently returned as if it were still live — see
  // ../../reports/SYSTEM_ADDRESSABILITY_REPORT.md §PHASE_6.
  const found = listRepositories().find((entry) => entry.status === "ACTIVE" && normalize(entry.repository) === normalizedTarget);
  if (!found) return null;
  return {
    source: "REPOSITORY_REGISTRY",
    entity_id: found.repository_id,
    capability_id: null,
    resource_id: null,
    repository_id: found.repository_id,
    ui_ref: null,
    api_ref: null,
    runtime_ref: null,
    host_ref: null,
    port_ref: null,
    action_ref: null,
    evidence_refs: [],
  };
}

function matchOsUiTarget(normalizedTarget: string, request: string): SystemReferenceMatch | null {
  if (!isOsUiTarget(normalizedTarget)) return null;
  const locator = resolveOsUiTargetLocator(normalizedTarget);
  const openLike = OPEN_LIKE_REQUESTS.has(request.trim().toUpperCase());
  return {
    source: "OS_UI_TARGET",
    entity_id: normalizedTarget,
    capability_id: null,
    resource_id: null,
    repository_id: null,
    ui_ref: normalizedTarget,
    api_ref: null,
    runtime_ref: null,
    host_ref: null,
    port_ref: null,
    action_ref: openLike ? "connections/os-ui#openOsUi" : null,
    evidence_refs: locator ? [`connections/os-ui/adapter-contract.ts#TARGETS.${normalizedTarget}`] : [],
  };
}

export function resolveSystemReference(input: SystemReferenceRequest, context: SystemReferenceContext): SystemReferenceResolution {
  const normalizedTarget = normalize(input.target);

  const candidates: SystemReferenceMatch[] = [];
  const commandRouterMatch = matchCommandRouterCapability(normalizedTarget);
  if (commandRouterMatch) candidates.push(commandRouterMatch);
  const registryDatabaseMatch = matchRegistryDatabaseCapability(input.target, context);
  if (registryDatabaseMatch) candidates.push(registryDatabaseMatch);
  const repositoryMatch = matchRepositoryRegistry(normalizedTarget);
  if (repositoryMatch) candidates.push(repositoryMatch);
  const osUiMatch = matchOsUiTarget(normalizedTarget, input.request);
  if (osUiMatch) candidates.push(osUiMatch);

  if (candidates.length === 0) {
    return { status: "UNRESOLVED", request: input.request, target: input.target, match: null, candidates: [], reason_code: "NO_REGISTERED_MATCH" };
  }
  if (candidates.length > 1) {
    return { status: "AMBIGUOUS", request: input.request, target: input.target, match: null, candidates, reason_code: "MULTIPLE_REGISTERED_MATCHES" };
  }
  return { status: "RESOLVED", request: input.request, target: input.target, match: candidates[0], candidates: [], reason_code: "SINGLE_REGISTERED_MATCH" };
}
