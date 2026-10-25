export type RuntimeProviderId = "vercel" | "railway" | (string & {});

export type RuntimeProviderAvailability = "available" | "unavailable" | "unknown";

export type RuntimeProviderHealth = "healthy" | "unhealthy" | "unknown";

export interface RuntimeProviderCostStatus {
  paid: boolean;
  owner_approved: boolean;
  requires_owner_approval: boolean;
  note?: string;
}

export interface RuntimeProviderStateBoundary {
  authority: "dna-os";
  provider_role: "connect_service";
  owns_business_logic: false;
  owns_business_data: false;
  owns_authorization: false;
}

export interface RuntimeProviderStatus {
  provider_id: RuntimeProviderId;
  availability: RuntimeProviderAvailability;
  health: RuntimeProviderHealth;
  latency_ms: number | null;
  cost: RuntimeProviderCostStatus;
  runtime_url: string | null;
  capabilities: string[];
  state_boundary: RuntimeProviderStateBoundary;
}

export interface RuntimeProviderAdapter {
  provider_id: RuntimeProviderId;
  observeRuntimeStatus(): Promise<RuntimeProviderStatus> | RuntimeProviderStatus;
}

export interface RuntimeTargetRequest {
  required_capabilities: string[];
  max_latency_ms: number;
  allow_paid_providers: boolean;
}

export type RuntimeProviderRejectionReason =
  | "unhealthy"
  | "unavailable"
  | "missing_capability"
  | "latency_too_high"
  | "requires_owner_approval"
  | "missing_runtime_url";

export interface RuntimeProviderRejection {
  provider_id: RuntimeProviderId;
  reason: RuntimeProviderRejectionReason;
}

export interface RuntimeTargetSelection {
  ok: boolean;
  selected_provider_id: RuntimeProviderId | null;
  runtime_url: string | null;
  requires_owner_approval: boolean;
  rejections: RuntimeProviderRejection[];
  state_boundary: RuntimeProviderStateBoundary;
}

export const DNA_OS_RUNTIME_STATE_BOUNDARY: RuntimeProviderStateBoundary = {
  authority: "dna-os",
  provider_role: "connect_service",
  owns_business_logic: false,
  owns_business_data: false,
  owns_authorization: false,
};
