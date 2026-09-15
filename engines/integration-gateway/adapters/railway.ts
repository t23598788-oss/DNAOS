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

type RuntimeHealthFetch = (input: string, init: RequestInit) => Promise<{ ok: boolean }>;

async function probeRuntimeUrl(runtimeUrl: string, fetchImpl: RuntimeHealthFetch): Promise<{ available: boolean; healthy: boolean; latencyMs: number }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetchImpl(runtimeUrl, { method: "GET", cache: "no-store", signal: controller.signal });
    return { available: true, healthy: response.ok, latencyMs: Date.now() - startedAt };
  } catch {
    return { available: false, healthy: false, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
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

export async function observeRailwayRuntimeProviderStatus(
  config: RailwayRuntimeProviderConfig = {},
  fetchImpl: RuntimeHealthFetch = fetch,
): Promise<RuntimeProviderStatus> {
  const base = railwayRuntimeProviderStatus(config);
  if (!base.runtime_url || config.available !== undefined || config.healthy !== undefined || config.latencyMs !== undefined) {
    return base;
  }

  const probe = await probeRuntimeUrl(base.runtime_url, fetchImpl);
  return {
    ...base,
    availability: probe.available ? "available" : "unavailable",
    health: probe.healthy ? "healthy" : "unhealthy",
    latency_ms: probe.latencyMs,
  };
}

export const railwayRuntimeProvider = {
  provider_id: "railway" as const,
  observeRuntimeStatus: observeRailwayRuntimeProviderStatus,
};
