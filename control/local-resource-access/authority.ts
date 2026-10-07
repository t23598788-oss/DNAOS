/**
 * Owner-controlled local access grants. AI vendor identity never grants authority.
 * Default = DENY.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { dataPath, nowIso } from "./host-runtime";
import { getLocalCapability } from "./capability-catalog";
import { evaluateOwnerMachinePolicy } from "./machine-policy";
import { getRegisteredLocalResource, listRegisteredLocalResources } from "./resource-registry";
import type { AccessClass, AuthorityRequest, AuthorityResult, LocalAccessGrant } from "./types";

const HIGH_IMPACT: readonly AccessClass[] = ["DELETE", "SHARE_EXTERNAL", "PUBLISH_EXTERNAL"];

function accessMatches(granted: readonly AccessClass[], requested: AccessClass): boolean {
  if (granted.includes(requested)) return true;
  if ((requested === "CREATE" || requested === "MODIFY") && granted.includes("WRITE")) return true;
  if (requested === "MOVE" && granted.includes("WRITE")) return true;
  return false;
}

function grantFile(): string {
  return dataPath("local-access-grants.jsonl", "LOCAL_RESOURCE_GRANTS_LOG");
}

export function issueLocalAccessGrant(input: Omit<LocalAccessGrant, "grant_id" | "issued_at" | "issuer">): LocalAccessGrant {
  const grant: LocalAccessGrant = {
    ...input,
    grant_id: `lrg-${randomUUID()}`,
    issued_at: nowIso(),
    issuer: "DNA_OS_OWNER_POLICY",
  };
  const p = grantFile();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(grant)}\n`, "utf8");
  return grant;
}

export function listLocalAccessGrants(): readonly LocalAccessGrant[] {
  const p = grantFile();
  if (!existsSync(p)) return [];
  const rows: LocalAccessGrant[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as LocalAccessGrant); } catch { /* skip */ }
  }
  return rows;
}

function expired(grant: LocalAccessGrant, now: string): boolean {
  return grant.expires_at !== null && grant.expires_at <= now;
}

function scopeAllows(grant: LocalAccessGrant, requested: readonly string[]): boolean {
  if (grant.data_scope.includes("*")) return true;
  if (requested.length === 0) return grant.data_scope.length > 0 || grant.resource_id !== "*";
  return requested.every((item) => grant.data_scope.some((allowed) => item === allowed || item.startsWith(`${allowed}/`) || allowed === "*"));
}

export function evaluateLocalAuthority(request: AuthorityRequest): AuthorityResult {
  const deny = (reason_code: string): AuthorityResult => ({
    decision: "DENY",
    reason_code,
    grant_id: null,
    matched_resource_ids: [],
  });
  if (!request.session_id || !request.ai_identity) return deny("MISSING_SESSION_OR_IDENTITY");
  if (!getLocalCapability(request.capability)) return deny("UNKNOWN_CAPABILITY");
  const resource = getRegisteredLocalResource(request.resource_id);
  if (!resource) return deny("UNKNOWN_RESOURCE");
  const now = nowIso();
  const sessionGrants = listLocalAccessGrants().filter((grant) =>
    grant.ai_identity === request.ai_identity
    && grant.session_id === request.session_id
    && (grant.work_id === null || grant.work_id === request.work_id)
    && (grant.capability === "*" || grant.capability === request.capability)
    && (grant.resource_id === "*" || grant.resource_id === request.resource_id)
    && !expired(grant, now)
    && scopeAllows(grant, request.data_scope),
  );
  if (HIGH_IMPACT.includes(request.access) && sessionGrants.length > 0 && !sessionGrants.some((grant) => grant.access.includes(request.access))) {
    return { decision: "OWNER_APPROVAL_REQUIRED", reason_code: "OWNER_APPROVAL_REQUIRED", grant_id: sessionGrants[0]!.grant_id, matched_resource_ids: [request.resource_id] };
  }
  const matches = sessionGrants.filter((grant) => accessMatches(grant.access, request.access));
  if (matches.length === 0) return deny("NO_OWNER_GRANT");
  const approval = matches.find((grant) => grant.effect === "OWNER_APPROVAL_REQUIRED");
  if (approval && !matches.some((grant) => grant.effect === "ALLOW")) {
    return { decision: "OWNER_APPROVAL_REQUIRED", reason_code: "OWNER_APPROVAL_REQUIRED", grant_id: approval.grant_id, matched_resource_ids: [request.resource_id] };
  }
  const allow = matches.find((grant) => grant.effect === "ALLOW");
  if (!allow) return deny("NO_OWNER_GRANT");
  if (allow.network_egress === "DENIED" && request.network_egress !== "LOCAL_ONLY") {
    return deny("NETWORK_EGRESS_DENIED");
  }
  const policy = evaluateOwnerMachinePolicy({
    ai_identity: request.ai_identity,
    session_id: request.session_id,
    resource_id: request.resource_id,
    capability: request.capability,
    access: request.access,
    network_egress: request.network_egress,
  });
  if (policy.decision === "DENY") return deny(policy.reason_code);
  if (policy.decision === "OWNER_APPROVAL_REQUIRED") {
    return { decision: "OWNER_APPROVAL_REQUIRED", reason_code: policy.reason_code, grant_id: allow.grant_id, matched_resource_ids: [request.resource_id] };
  }
  return { decision: "ALLOW", reason_code: "GRANTED", grant_id: allow.grant_id, matched_resource_ids: [request.resource_id] };
}

export function resourcesVisibleToSession(ai_identity: string, session_id: string): readonly string[] {
  const now = nowIso();
  const ids = new Set<string>();
  for (const grant of listLocalAccessGrants()) {
    if (grant.ai_identity !== ai_identity || grant.session_id !== session_id) continue;
    if (grant.effect === "DENY" || expired(grant, now)) continue;
    if (grant.resource_id === "*") {
      for (const resource of listRegisteredLocalResources()) ids.add(resource.resource_id);
    } else {
      ids.add(grant.resource_id);
    }
  }
  return [...ids];
}
