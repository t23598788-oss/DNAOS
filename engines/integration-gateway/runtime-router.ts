import {
  DNA_OS_RUNTIME_STATE_BOUNDARY,
  type RuntimeProviderAdapter,
  type RuntimeProviderRejection,
  type RuntimeProviderStatus,
  type RuntimeTargetRequest,
  type RuntimeTargetSelection,
} from "./contracts/runtime-provider";

function hasCapabilities(provider: RuntimeProviderStatus, required: string[]): boolean {
  return required.every((capability) => provider.capabilities.includes(capability));
}

function reject(provider: RuntimeProviderStatus, reason: RuntimeProviderRejection["reason"]): RuntimeProviderRejection {
  return { provider_id: provider.provider_id, reason };
}

export async function selectRuntimeProvider(
  adapters: RuntimeProviderAdapter[],
  request: RuntimeTargetRequest,
): Promise<RuntimeTargetSelection> {
  const statuses = await Promise.all(adapters.map((adapter) => adapter.observeRuntimeStatus()));
  const rejections: RuntimeProviderRejection[] = [];

  for (const provider of statuses) {
    if (provider.health !== "healthy") {
      rejections.push(reject(provider, "unhealthy"));
      continue;
    }
    if (provider.availability !== "available") {
      rejections.push(reject(provider, "unavailable"));
      continue;
    }
    if (!hasCapabilities(provider, request.required_capabilities)) {
      rejections.push(reject(provider, "missing_capability"));
      continue;
    }
    if (provider.latency_ms === null || provider.latency_ms > request.max_latency_ms) {
      rejections.push(reject(provider, "latency_too_high"));
      continue;
    }
    if (!provider.runtime_url) {
      rejections.push(reject(provider, "missing_runtime_url"));
      continue;
    }
    if (provider.cost.requires_owner_approval || (provider.cost.paid && (!provider.cost.owner_approved || !request.allow_paid_providers))) {
      return {
        ok: false,
        selected_provider_id: provider.provider_id,
        runtime_url: provider.runtime_url,
        requires_owner_approval: true,
        rejections,
        state_boundary: DNA_OS_RUNTIME_STATE_BOUNDARY,
      };
    }

    return {
      ok: true,
      selected_provider_id: provider.provider_id,
      runtime_url: provider.runtime_url,
      requires_owner_approval: false,
      rejections,
      state_boundary: DNA_OS_RUNTIME_STATE_BOUNDARY,
    };
  }

  return {
    ok: false,
    selected_provider_id: null,
    runtime_url: null,
    requires_owner_approval: false,
    rejections,
    state_boundary: DNA_OS_RUNTIME_STATE_BOUNDARY,
  };
}
