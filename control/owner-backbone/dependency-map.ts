/**
 * หน้าที่: answer "what is this thing, and what breaks if it is gone?" for
 * any provider or service an event names — from EXISTING sources only.
 *
 * SOURCES, in order of authority:
 *   - `../runtime-control/#SERVICES`       internal services launchd declares
 *   - `credentials/registry/`              which providers DNA OS holds an
 *                                          authorized credential reference for
 *   - `../../software/registry-database/`  capability_id / resource_id
 *   - `../work-continuation/`              which work_ids depend on it RIGHT NOW
 *   - `../alert-correlation/#resolveTarget` a provider's own service name -> a
 *                                          probe-able URL, when one is known
 *
 * NOTHING IS INVENTED. Every field this repo has no source for comes back
 * `UNRESOLVED`, and `unresolved_fields` names them. Billing state, plan,
 * quota, renewal and cost have NO source in this system today — so they are
 * reported UNRESOLVED rather than guessed, and a decision that would need
 * them says so instead of proceeding on a number nobody measured.
 *
 * Input: a provider slug and/or a service id.
 * Output: `resolveDependency`, `dependencyMap`, `UNRESOLVED`.
 * Dependency ที่อนุญาต: ../runtime-control/contract.ts,
 * ../work-continuation/contract.ts, ../../software/registry-database/contract.ts,
 * node built-ins.
 * สิ่งที่ห้ามแตะ: never fill a field from an email's claim — an email is an
 * input, not a source of truth about the system. Never default a money
 * field to zero: an unmeasured cost is UNRESOLVED, and zero is a number.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { SERVICES } from "../runtime-control/contract";
import { currentWaiting } from "../work-continuation/contract";
import { searchCapabilities } from "../../software/registry-database/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";

export const UNRESOLVED = "UNRESOLVED" as const;

const REPO_ROOT = resolvePath(new URL("../..", import.meta.url).pathname);
const CREDENTIAL_REFERENCES = join(REPO_ROOT, "credentials/registry/data/api-credential-references.jsonl");

export interface DependencyFacts {
  readonly provider: string;
  readonly account_identity: string;
  readonly project_identity: string;
  readonly service_id: string;
  readonly resource_id: string;
  readonly capability_id: string;
  readonly purpose: string;
  readonly used_for: string;

  readonly runtime_state: string;
  readonly health_read_path: string;
  readonly write_action_path: string;

  readonly credential_boundary: string;
  readonly credential_status: string;

  /** No source exists in this system for any of these. Reported, never guessed. */
  readonly subscription_plan: string;
  readonly billing_state: string;
  readonly renewal_state: string;
  readonly quota_state: string;
  readonly current_cost: string;
  readonly billing_currency: string;
  readonly billing_cycle: string;

  readonly failure_modes: readonly string[];
  readonly remediation_actions: readonly string[];
  readonly verification_method: string;

  /** work_ids waiting on this dependency right now — read from the live journal. */
  readonly dependents_work_ids: readonly string[];
  readonly depends_on: readonly string[];

  readonly unresolved_fields: readonly string[];
  readonly sources: readonly string[];
}

interface CredentialReference {
  readonly credential_ref?: string;
  readonly provider?: string;
  readonly account?: string;
  readonly scope?: readonly string[];
  readonly status?: string;
}

function credentialReferences(): readonly CredentialReference[] {
  if (!existsSync(CREDENTIAL_REFERENCES)) return [];
  const out: CredentialReference[] = [];
  for (const line of readFileSync(CREDENTIAL_REFERENCES, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as CredentialReference); } catch { /* a half-written line is not a row */ }
  }
  return out;
}

/** The credential boundary for a provider: WHICH reference, never the secret. */
function credentialFor(provider: string): { boundary: string; status: string; account: string } {
  const matches = credentialReferences().filter((r) => (r.provider ?? "").toLowerCase() === provider.toLowerCase());
  if (matches.length === 0) return { boundary: UNRESOLVED, status: UNRESOLVED, account: UNRESOLVED };
  const active = matches.find((r) => r.status === "ACTIVE") ?? matches[matches.length - 1];
  return {
    boundary: active.credential_ref ?? UNRESOLVED,
    status: active.status ?? UNRESOLVED,
    account: active.account ?? UNRESOLVED,
  };
}

function capabilityFor(tokens: readonly string[]): { capability_id: string; canonical_name: string; source_location: string } {
  try {
    const hits = searchCapabilities([...tokens], createPersistentFileStore(), 1) as unknown as { capability_id?: string; canonical_name?: string; source_location?: string; score: number }[];
    const top = hits?.[0];
    if (!top || top.score < 3) return { capability_id: UNRESOLVED, canonical_name: UNRESOLVED, source_location: UNRESOLVED };
    return { capability_id: top.capability_id ?? UNRESOLVED, canonical_name: top.canonical_name ?? UNRESOLVED, source_location: top.source_location ?? UNRESOLVED };
  } catch {
    return { capability_id: UNRESOLVED, canonical_name: UNRESOLVED, source_location: UNRESOLVED };
  }
}

/** Which work items are parked on this dependency at this moment. */
function dependentsOf(serviceId: string, provider: string): readonly string[] {
  const needles = [serviceId, provider].filter((n) => n !== "" && n !== UNRESOLVED).map((n) => n.toLowerCase());
  if (needles.length === 0) return [];
  return currentWaiting()
    .filter((row) => row.status === "WAITING" || row.status === "WAITING_FOR_RESOURCE")
    .filter((row) => row.blocked_on.some((key) => needles.some((n) => key.toLowerCase().includes(n))))
    .map((row) => row.work_id);
}

/**
 * The money fields, in one place, so it is obvious that DNA OS measures none
 * of them yet. A financial decision built on these must say UNRESOLVED out
 * loud rather than present an unmeasured number to the Owner.
 */
const FINANCIAL_FIELDS = ["subscription_plan", "billing_state", "renewal_state", "quota_state", "current_cost", "billing_currency", "billing_cycle"] as const;

export function resolveDependency(input: { provider?: string; service_id?: string; project_identity?: string }): DependencyFacts {
  const provider = (input.provider ?? UNRESOLVED).trim() || UNRESOLVED;
  const serviceId = (input.service_id ?? UNRESOLVED).trim() || UNRESOLVED;
  const sources: string[] = [];
  const unresolved: string[] = [];

  // ---- internal service, declared by the launchd authority ---------------
  const declared = Object.prototype.hasOwnProperty.call(SERVICES, serviceId);
  const definition = declared ? (SERVICES as Record<string, { launchd_label: string; port: number; health_path: string }>)[serviceId] : null;
  if (definition !== null) sources.push("control/runtime-control#SERVICES");

  // ---- credential boundary ----------------------------------------------
  const credential = provider === UNRESOLVED ? { boundary: UNRESOLVED, status: UNRESOLVED, account: UNRESOLVED } : credentialFor(provider);
  if (credential.boundary !== UNRESOLVED) sources.push("credentials/registry/data/api-credential-references.jsonl");

  // ---- registry identity -------------------------------------------------
  const capability = capabilityFor([provider, serviceId].filter((t) => t !== UNRESOLVED));
  if (capability.capability_id !== UNRESOLVED) sources.push("software/registry-database#searchCapabilities");

  const dependents = dependentsOf(serviceId, provider);
  if (dependents.length > 0) sources.push("control/work-continuation#currentWaiting");

  for (const field of FINANCIAL_FIELDS) unresolved.push(field);
  if (provider === UNRESOLVED) unresolved.push("provider");
  if (serviceId === UNRESOLVED) unresolved.push("service_id");
  if (capability.capability_id === UNRESOLVED) unresolved.push("capability_id", "resource_id");
  if (credential.boundary === UNRESOLVED) unresolved.push("credential_boundary", "credential_status");
  if (definition === null) unresolved.push("runtime_state", "health_read_path", "write_action_path");

  return {
    provider,
    account_identity: credential.account,
    project_identity: input.project_identity ?? UNRESOLVED,
    service_id: serviceId,
    // The registry keys code capabilities, not external accounts — so a
    // resource_id exists only when the thing is something this repo builds.
    resource_id: capability.capability_id !== UNRESOLVED ? capability.source_location : UNRESOLVED,
    capability_id: capability.capability_id,
    purpose: capability.canonical_name,
    used_for: definition !== null ? `a service launchd supervises on port ${definition.port}` : capability.canonical_name,

    runtime_state: definition !== null ? "declared under the launchd authority" : UNRESOLVED,
    health_read_path: definition !== null ? `http://127.0.0.1:${definition.port}${definition.health_path}` : UNRESOLVED,
    write_action_path: definition !== null ? "control/runtime-control#runOperation" : UNRESOLVED,

    credential_boundary: credential.boundary,
    credential_status: credential.status,

    subscription_plan: UNRESOLVED,
    billing_state: UNRESOLVED,
    renewal_state: UNRESOLVED,
    quota_state: UNRESOLVED,
    current_cost: UNRESOLVED,
    billing_currency: UNRESOLVED,
    billing_cycle: UNRESOLVED,

    failure_modes: definition !== null
      ? ["SERVICE_DOWN (process alive but not serving)", "SERVICE_DOWN (process absent)"]
      : credential.boundary !== UNRESOLVED
        ? ["CREDENTIAL_FAILURE", "API_FAILURE", "QUOTA_EXHAUSTED", "SUBSCRIPTION_EXPIRED"]
        : [UNRESOLVED],
    remediation_actions: definition !== null
      ? ["RESTART_EXISTING_SERVICE"]
      : [UNRESOLVED],
    verification_method: definition !== null
      ? `re-probe ${`http://127.0.0.1:${definition.port}${definition.health_path}`} through control/runtime-control`
      : UNRESOLVED,

    dependents_work_ids: dependents,
    depends_on: definition !== null ? ["launchd", "the machine"] : [UNRESOLVED],

    unresolved_fields: [...new Set(unresolved)],
    sources,
  };
}

/** Every dependency this system can currently resolve anything at all about. */
export function dependencyMap(): readonly DependencyFacts[] {
  const services = Object.keys(SERVICES as Record<string, unknown>).map((id) => resolveDependency({ service_id: id }));
  const providers = [...new Set(credentialReferences().map((r) => (r.provider ?? "").toLowerCase()).filter((p) => p !== ""))]
    .map((provider) => resolveDependency({ provider }));
  return [...services, ...providers];
}
