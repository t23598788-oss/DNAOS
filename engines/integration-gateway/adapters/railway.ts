import {
  DNA_OS_RUNTIME_STATE_BOUNDARY,
  type RuntimeProviderStatus,
} from "../contracts/runtime-provider";

export interface RailwayRuntimeProviderConfig {
  runtimeUrl?: string | null;
  available?: boolean;
  healthy?: boolean;
  latencyMs?: number | null;
  paid?: boolean;
  ownerApproved?: boolean;
  capabilities?: string[];
}

export function railwayRuntimeProviderStatus(config: RailwayRuntimeProviderConfig = {}): RuntimeProviderStatus {
  const runtimeUrl = config.runtimeUrl ?? process.env.RAILWAY_RUNTIME_URL ?? null;
  const paid = config.paid ?? process.env.RAILWAY_RUNTIME_PAID === "true";
  const ownerApproved = config.ownerApproved ?? process.env.RAILWAY_RUNTIME_OWNER_APPROVED === "true";
  const available = config.available ?? Boolean(runtimeUrl);
  const healthy = config.healthy ?? Boolean(runtimeUrl);

  return {
    provider_id: "railway",
    availability: available ? "available" : "unavailable",
    health: healthy ? "healthy" : "unhealthy",
    latency_ms: config.latencyMs ?? null,
    cost: {
      paid,
      owner_approved: ownerApproved,
      requires_owner_approval: paid && !ownerApproved,
    },
    runtime_url: runtimeUrl,
    capabilities: config.capabilities ?? ["runtime.render", "runtime.display"],
    state_boundary: DNA_OS_RUNTIME_STATE_BOUNDARY,
  };
}

export const railwayRuntimeProvider = {
  provider_id: "railway" as const,
  observeRuntimeStatus: railwayRuntimeProviderStatus,
};
