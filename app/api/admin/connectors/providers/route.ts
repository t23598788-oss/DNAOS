/**
 * GET /api/admin/connectors/providers — the pre-Connect discovery surface.
 *
 * Answers "which providers exist, what can they do, and which ones can this
 * system actually connect today" BEFORE any connectors row exists. Today the
 * only other provider-shaped endpoints are post-Connect (`catalog` joins
 * connector rows; `infrastructure` serves the billing center), so a provider
 * that has never been connected could not be seen at all.
 *
 * Composition only — no new registry, no new scanner, no new lifecycle:
 *   - identity / capability / evidence / connection_status come from the real,
 *     already-built app/api/admin/ide/_lib/providerRegistryRuntime.ts
 *     (listNormalizedProviders: 6 evidence sources incl. the existing
 *     dependency-discovery artifact). That function does not write anything,
 *     which is what makes it safe for a GET.
 *   - provider-specific detail (auth modes, approval requirement, capability
 *     metadata, pre-connect artifacts) comes from the Connect contract in
 *     engines/connectors/registry.ts — looked up by id, never by branching on a
 *     provider name here. A provider without a contract honestly reports
 *     contract_implemented: false instead of a guessed field set.
 *   - `reconcileProviders()` is deliberately NOT called: it persists a snapshot,
 *     and this route must stay read-only.
 *
 * Secret rule: nothing here can return a secret value — the normalized entries
 * carry status/evidence only, and a contract's detect() sees file existence and
 * environment variable NAMES (never values).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listNormalizedProviders } from "@/app/api/admin/ide/_lib/providerRegistryRuntime";
import { findContract, listConnectContractIds } from "@/engines/connectors/registry";
import type { CapabilityMetadata, EvidenceRef } from "@/engines/connectors/contract";
import { buildConnectRuntimeDeps, buildDetectDeps } from "../_lib/connectRuntime";

/** Keep the payload bounded; truncation is reported, never silent. */
const MAX_EVIDENCE_PER_ENTRY = 8;

interface ProviderEntry {
  provider_id: string;
  canonical_name: string;
  service_owner: string;
  provider_type: string;
  connection_status: string;
  credential_status: string;
  runtime_status: string;
  capabilities: string[];
  reconciliation_status: string;
  last_verified_at: string | null;
  evidence: EvidenceRef[];
  evidence_truncated: boolean;
  connect: {
    contract_implemented: boolean;
    auth_modes?: string[];
    approval_requirement?: string;
    capability_metadata?: CapabilityMetadata[];
    evidence?: EvidenceRef[];
  };
}

function capEvidence(items: EvidenceRef[]): { items: EvidenceRef[]; truncated: boolean } {
  return {
    items: items.slice(0, MAX_EVIDENCE_PER_ENTRY),
    truncated: items.length > MAX_EVIDENCE_PER_ENTRY,
  };
}

/** Honest mapping from a contract's credential status into the vocabulary
 *  providerRegistryRuntime already uses — never claiming more than is known. */
function connectionStatusFromCredential(credentialStatus: string): string {
  if (credentialStatus === "CONFIGURED") return "NOT_YET_VERIFIED";
  if (credentialStatus === "NOT_APPLICABLE") return "DISCOVERED_NOT_CONNECTED";
  return "WAITING_FOR_CREDENTIAL";
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const normalized = await listNormalizedProviders();
  const deps = buildDetectDeps();
  const runtimeDeps = buildConnectRuntimeDeps();

  const providers: ProviderEntry[] = normalized.map((p) => {
    const contract = findContract(p.provider_id);
    const identity = capEvidence(p.evidence as EvidenceRef[]);
    return {
      provider_id: p.provider_id,
      canonical_name: p.canonical_name,
      service_owner: p.service_owner,
      provider_type: p.provider_type,
      connection_status: p.connection_status,
      credential_status: p.credential_status,
      runtime_status: p.runtime_status,
      capabilities: p.capabilities,
      reconciliation_status: p.reconciliation_status,
      last_verified_at: p.last_verified_at,
      evidence: identity.items,
      evidence_truncated: identity.truncated,
      connect: contract
        ? {
            contract_implemented: true,
            auth_modes: [...contract.authModes],
            approval_requirement: contract.approvalRequirement,
            capability_metadata: contract.capabilityMetadata(),
            evidence: capEvidence(contract.detect(deps)).items,
          }
        : { contract_implemented: false },
    };
  });

  // A provider that exists ONLY as a Connect contract must still be visible here
  // — the whole point of the pre-Connect layer is seeing providers before any
  // connectors row exists. Real finding (STEP 9 acceptance harness): none of the
  // evidence sources behind listNormalizedProviders know about "railway" (25
  // providers, no railway), so the first proof provider was invisible. The
  // contract itself is evidence (detect() reads real workspace artifacts), so
  // contract-only providers are unioned in with an explicitly UNKNOWN ownership
  // and PENDING_RECONCILIATION (they are genuinely absent from the owner's
  // registry/PROVIDER_DIRECTORY.json).
  const known = new Set(providers.map((p) => p.provider_id));
  for (const providerId of listConnectContractIds()) {
    if (known.has(providerId)) continue;
    const contract = findContract(providerId);
    if (!contract) continue;

    let credentialStatus = "MISSING";
    try {
      credentialStatus = (await contract.inspect(runtimeDeps)).credential_status;
    } catch {
      // A connector read can legitimately fail outside a configured environment —
      // report UNKNOWN rather than a fabricated status.
      credentialStatus = "UNKNOWN";
    }

    providers.push({
      provider_id: contract.providerId,
      canonical_name: contract.providerId,
      service_owner: "UNKNOWN",
      provider_type: "UNKNOWN",
      connection_status: connectionStatusFromCredential(credentialStatus),
      credential_status: credentialStatus,
      runtime_status: "UNKNOWN",
      capabilities: contract.capabilityMetadata().map((c) => c.id),
      reconciliation_status: "PENDING_RECONCILIATION",
      last_verified_at: null,
      evidence: capEvidence(contract.detect(deps)).items,
      evidence_truncated: contract.detect(deps).length > MAX_EVIDENCE_PER_ENTRY,
      connect: {
        contract_implemented: true,
        auth_modes: [...contract.authModes],
        approval_requirement: contract.approvalRequirement,
        capability_metadata: contract.capabilityMetadata(),
        evidence: capEvidence(contract.detect(deps)).items,
      },
    });
  }

  return NextResponse.json({
    providers,
    summary: {
      total: providers.length,
      with_contract: providers.filter((p) => p.connect.contract_implemented).length,
      contract_ids: listConnectContractIds(),
    },
  });
}
