/**
 * หน้าที่: build the `CapabilityResultEvidence[]` trail for one request —
 * the final step of Owner's required flow ("→ normalized result →
 * evidence"). Reuses `../../contracts/command/capability-result.ts`'s
 * already-real `CapabilityResultEvidence` shape rather than inventing a
 * new one — the same contract every other registered capability
 * (file-intelligence, permission-reasoner, github, ...) already speaks.
 *
 * Input: plain facts about what happened at each stage.
 * Output: `CapabilityResultEvidence[]`.
 * Dependency ที่อนุญาต: `../../contracts/command/capability-result.ts`
 * (type only).
 * สิ่งที่ห้ามแตะ: never put a token/secret value into any evidence
 * `note` — only safe facts (resource, endpoint, scope, credential_source,
 * http_status, outcome) belong here.
 */

import type { CapabilityResultEvidence } from "../../contracts/command/capability-result";

export function bindingResolvedEvidence(account_id: string, digitalocean_team_id: string, found: boolean): CapabilityResultEvidence {
  return {
    source: "digitalocean.binding_provider",
    note: found
      ? `resolved a binding for account "${account_id}" / DigitalOcean team "${digitalocean_team_id}"`
      : `no binding found for account "${account_id}" / DigitalOcean team "${digitalocean_team_id}"`,
  };
}

export function statusCheckEvidence(status: string, allowed: boolean): CapabilityResultEvidence {
  return { source: "digitalocean.authorization.status", note: `binding status "${status}" — ${allowed ? "allowed" : "denied (fail-closed)"}` };
}

export function scopeCheckEvidence(required_scope: string, allowed: boolean): CapabilityResultEvidence {
  return { source: "digitalocean.authorization.scope", note: `required scope "${required_scope}" — ${allowed ? "satisfied" : "not satisfied (fail-closed)"}` };
}

export function credentialResolvedEvidence(credential_source: string, ok: boolean): CapabilityResultEvidence {
  return { source: "digitalocean.credential_provider", note: ok ? `resolved credential via "${credential_source}"` : `failed to resolve credential "${credential_source}"` };
}

export function apiCallEvidence(resource: string, endpoint: string, http_status: number | null, ok: boolean): CapabilityResultEvidence {
  return {
    source: "digitalocean.read_api",
    note: `${resource} -> GET ${endpoint} -> ${http_status === null ? "no HTTP response (transport error)" : `HTTP ${http_status}`} (${ok ? "ok" : "failed"})`,
  };
}

export function normalizedResultEvidence(resource: string, count: number | null): CapabilityResultEvidence {
  return { source: "digitalocean.normalize", note: count === null ? `${resource} normalized (single object)` : `${resource} normalized (${count} item(s))` };
}
