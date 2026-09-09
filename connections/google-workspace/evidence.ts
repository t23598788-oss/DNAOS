/**
 * Evidence builders for Google Workspace runtime reads.
 * Never put token/secret values into notes.
 */

import type { CapabilityResultEvidence } from "../../contracts/command/capability-result";
import type { GoogleWorkspaceOutcomeCode } from "./adapter-contract";

export function outcomeEvidence(outcome: GoogleWorkspaceOutcomeCode, detail: string): CapabilityResultEvidence {
  return { source: "google-workspace.outcome", note: `outcome=${outcome} ${detail}` };
}

export function ownerPolicyEvidence(binding_id: string, decision: string, reason_code: string): CapabilityResultEvidence {
  return {
    source: "google-workspace.owner_policy",
    note: `binding_id=${binding_id} decision=${decision} reason_code=${reason_code}`,
  };
}

export function scopeCheckEvidence(service: string, required: readonly string[], ok: boolean): CapabilityResultEvidence {
  return {
    source: "google-workspace.scope",
    note: `service=${service} required_scopes=${required.join(",")} ${ok ? "satisfied" : "missing (fail-closed)"}`,
  };
}

export function credentialMetaEvidence(credential_ref: string, status: string | null, present: boolean): CapabilityResultEvidence {
  return {
    source: "google-workspace.credential_meta",
    note: present
      ? `credential_ref=${credential_ref} status=${status ?? "unknown"} (metadata only — secret not resolved yet)`
      : `credential_ref=${credential_ref} not registered`,
  };
}

export function credentialResolvedEvidence(credential_source: string, ok: boolean, refreshed: boolean): CapabilityResultEvidence {
  return {
    source: "google-workspace.credential_resolve",
    note: ok
      ? `resolved via ${credential_source} refreshed=${refreshed}`
      : `failed to resolve via ${credential_source}`,
  };
}

export function apiCallEvidence(service: string, endpoint: string, http_status: number | null, ok: boolean): CapabilityResultEvidence {
  return {
    source: "google-workspace.read_api",
    note: `${service} -> GET ${endpoint} -> ${http_status === null ? "transport_error" : `HTTP ${http_status}`} (${ok ? "ok" : "failed"})`,
  };
}

export function normalizedResultEvidence(service: string, action: string, itemCount: number | null): CapabilityResultEvidence {
  return {
    source: "google-workspace.normalize",
    note: itemCount === null
      ? `provider=google_workspace service=${service} action=${action} normalized`
      : `provider=google_workspace service=${service} action=${action} count=${itemCount}`,
  };
}
