import { evaluateCanonicalEvent, makeCanonicalEvent } from "../owner-notification/contract";
import { getStore, nowIso } from "../canonical-information/store";
import { ingestSafeCanonicalSources } from "../canonical-information/ingest-safe";
import type { CanonicalEntityV1, CanonicalFactV1 } from "../canonical-information/types";
import type { GithubGovernanceDiscoveryV1 } from "./types";
import { activationGate } from "./activation";
import { canonicalMainPolicy, githubBypassPolicy } from "./policy";

function fact(entity_id: string, key: string, value: string | number | boolean | null, source_ref: string): CanonicalFactV1 {
  const t = nowIso();
  return {
    schema: "CANONICAL_FACT_V1",
    fact_id: `fact:${entity_id}:${key}`,
    entity_id,
    fact_type: "GITHUB_GOVERNANCE",
    key,
    value,
    value_type: value === null ? "null" : typeof value as "string" | "number" | "boolean",
    verification: "VERIFIED",
    source_ref,
    evidence_refs: [source_ref],
    observed_at: t,
    valid_from: t,
    valid_until: null,
    version: 1,
    freshness_state: "FRESH",
    ttl_ms: 300_000,
    stale_after: new Date(Date.now() + 300_000).toISOString(),
    source_precedence: "LIVE_VERIFIED_RUNTIME_FACT",
  };
}

export function ingestGithubGovernanceCanonical(discovery: GithubGovernanceDiscoveryV1): void {
  ingestSafeCanonicalSources();
  const store = getStore();
  const entity_id = "entity:repository:github-canonical-main";
  const t = nowIso();
  const entity: CanonicalEntityV1 = {
    schema: "CANONICAL_INFORMATION_ENTITY_V1",
    entity_id,
    entity_type: "REPOSITORY",
    canonical_name: "github-canonical-main",
    display_name: `${discovery.owner}/${discovery.repository}#main`,
    domain: "github",
    status: discovery.MAIN_PROTECTED ? "VERIFIED" : "NOT_READY",
    verification: "VERIFIED",
    availability: "AVAILABLE",
    authority_state: "OWNER_DISABLED",
    owner_enabled: false,
    source_system: "github-branch-governance",
    source_ref: `github:${discovery.owner}/${discovery.repository}:main`,
    relationships: [],
    evidence_refs: [`governance:${discovery.discovered_at}`],
    created_at: t,
    updated_at: t,
    version: 1,
  };
  const idx = store.entities.findIndex((row) => row.entity_id === entity_id);
  if (idx >= 0) store.entities[idx] = entity;
  else store.entities.push(entity);
  const policy = canonicalMainPolicy();
  const bypass = githubBypassPolicy();
  const gate = activationGate(discovery);
  const rows: CanonicalFactV1[] = [
    fact(entity_id, "main_protected", discovery.MAIN_PROTECTED, "github-branch"),
    fact(entity_id, "governance_mechanism", discovery.GOVERNANCE_MECHANISM, "github-api"),
    fact(entity_id, "enforcement_mode", gate.RULESET_ENFORCEMENT_MODE, "activation-gate"),
    fact(entity_id, "required_checks", discovery.EXISTING_REQUIRED_CHECKS.join(",") || "NONE", "github-status"),
    fact(entity_id, "bypass_actors", bypass.bypass_actors.join(",") || "NONE", "bypass-policy"),
    fact(entity_id, "publication_actor", discovery.PUBLICATION_ACTOR_IDENTITY.github_login, "publication-probe"),
    fact(entity_id, "force_push_policy", policy.MAIN_FORCE_PUSH_ALLOWED, "canonical-main-policy"),
    fact(entity_id, "delete_policy", policy.MAIN_DELETE_ALLOWED, "canonical-main-policy"),
    fact(entity_id, "plan_blocker", discovery.github_plan_blocker, "github-api"),
  ];
  for (const row of rows) {
    const existing = store.facts.findIndex((item) => item.fact_id === row.fact_id);
    if (existing >= 0) store.facts[existing] = row;
    else store.facts.push(row);
  }
}

export function notifyGithubGovernance(discovery: GithubGovernanceDiscoveryV1): void {
  const gate = activationGate(discovery);
  evaluateCanonicalEvent(makeCanonicalEvent({
    event_id: `event:github-governance-prepared:${discovery.discovered_at}`,
    event_type: "CONNECTION_CHANGED",
    entity_id: "entity:repository:github-canonical-main",
    work_id: null,
    command_id: null,
    source_system: "github-branch-governance",
    previous_state: "UNPROTECTED",
    current_state: "GOVERNANCE_PREPARED",
    severity: "INFO",
    owner_attention: false,
    action_required: false,
    evidence_refs: ["github-branch-governance"],
  }), { subject: "GitHub main governance prepared", revision: discovery.remote_head_sha });

  evaluateCanonicalEvent(makeCanonicalEvent({
    event_id: `event:github-governance-not-activated:${gate.blocker ?? "none"}`,
    event_type: "OWNER_APPROVAL_REQUIRED",
    entity_id: "entity:repository:github-canonical-main",
    work_id: null,
    command_id: null,
    source_system: "github-branch-governance",
    previous_state: "PREPARED",
    current_state: "NOT_ACTIVATED",
    severity: "WARN",
    owner_attention: true,
    action_required: true,
    evidence_refs: ["github-branch-governance"],
  }), { subject: `Protection not activated: ${gate.blocker ?? "unknown"}`, revision: discovery.remote_head_sha });
}
