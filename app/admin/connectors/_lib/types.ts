// Client-side mirror of app/api/admin/connectors/_lib/catalog.ts's
// CatalogEntry shape (kept in sync manually — this route boundary is a
// plain JSON response, not a shared TS import, since one side is a
// Next.js API route and the other a "use client" page).
export type Direction = "INBOUND" | "OUTBOUND" | "BIDIRECTIONAL";
export type ConnectorFamily = "AI_CODE_WORKER" | "GITHUB" | "VERCEL" | "GENERIC_API" | "OTHER";
export type WorkerHealthStatus = "HEALTHY" | "DEGRADED" | "NOT_CONFIGURED" | "UNAVAILABLE" | "UNKNOWN";

export interface CatalogEntry {
  id: string;
  kind: "db_connector" | "ai_worker" | "gateway_adapter";
  provider: string;
  product: string;
  model: string | null;
  logo: string | null;
  connectionType: string;
  capabilities: string[];
  role: string;
  direction: Direction;
  runtimeStatus: string;
  healthStatus: WorkerHealthStatus;
  enabled: boolean;
  endpoints: string[];
  permissions: string[];
  lastVerifiedAt: string | null;
  lastError: string | null;
  family: ConnectorFamily;
  functionGroup: string;
  connectorId?: string;
  adapterId?: string;
  slug?: string;
}

export const FAMILY_LABELS: Record<ConnectorFamily, string> = {
  AI_CODE_WORKER: "AI / Code Worker",
  GITHUB: "GitHub",
  VERCEL: "Vercel",
  GENERIC_API: "Generic API / Webhook",
  OTHER: "Other External Services",
};

export function healthColor(h: WorkerHealthStatus): string {
  switch (h) {
    case "HEALTHY": return "bg-emerald-500";
    case "DEGRADED": return "bg-amber-400";
    case "UNAVAILABLE": return "bg-red-500";
    case "NOT_CONFIGURED": return "bg-stone-300";
    default: return "bg-stone-300";
  }
}

// ── Connect Core (pre-Connect discovery + prepare) ──────────────────────────
// Client-side mirrors of the JSON returned by
// GET  /api/admin/connectors/providers  and
// POST /api/admin/connectors/providers/[providerId]/prepare
// (engines/connectors/contract.ts is the server-side source of truth; this page
// is a "use client" boundary, so the shapes are mirrored here, same as
// CatalogEntry above).

export interface ProviderEvidenceRef {
  source: string;
  detail: string;
  captured_at: string;
}

export interface ProviderDiscoveryEntry {
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
  evidence: ProviderEvidenceRef[];
  evidence_truncated: boolean;
  connect: {
    contract_implemented: boolean;
    auth_modes?: string[];
    approval_requirement?: "NONE" | "OWNER_REQUIRED";
    capability_metadata?: { id: string; label_key: string; direction: string }[];
    evidence?: ProviderEvidenceRef[];
  };
}

export interface ProvidersListResponse {
  providers: ProviderDiscoveryEntry[];
  summary: { total: number; with_contract: number; contract_ids: string[] };
}

export interface ProviderFieldSpec {
  key: string;
  label_key: string;
  target: "config" | "secret";
  secret: boolean;
  required: boolean;
  placeholder?: string;
}

export interface ProviderDerivedValue {
  key: string;
  value: string;
}

export interface ConnectPrepareResponse {
  ok: true;
  contract_implemented: true;
  provider_id: string;
  auth_modes: string[];
  approval_requirement: "NONE" | "OWNER_REQUIRED";
  /** Real approval state from the one proposal store (never a local guess). */
  approval_state: {
    required: boolean;
    approved: boolean;
    pending: boolean;
    proposal_id: string | null;
    status: string | null;
    decided_by: string | null;
    decided_at: string | null;
  };
  capability_metadata: { id: string; label_key: string; direction: string }[];
  inspection: {
    credential_status: string;
    missing_field_keys: string[];
    evidence: ProviderEvidenceRef[];
  };
  preparation: {
    fields: ProviderFieldSpec[];
    defaults: ProviderDerivedValue[];
    derived: ProviderDerivedValue[];
    required_secret_field_keys: string[];
    approval: "NONE" | "OWNER_REQUIRED";
    evidence: ProviderEvidenceRef[];
  };
}