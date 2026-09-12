/**
 * หน้าที่: resolve a provider's OWN service name onto something DNA OS
 * can actually observe — a probe-able URL and/or a real repo path.
 * Resolution failure is a first-class outcome (`UNRESOLVED_ALERT`), never
 * a guess.
 *
 * Listen URLs come from control/runtime-endpoint-registry. This file only
 * maps alert keys (how the provider spells the service in email) onto an
 * existing ServiceId endpoint_id. It does not invent public hosts.
 *
 * Input: an `AlertEvent`.
 * Output: `resolveTarget`, `KNOWN_SERVICES`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts, runtime-endpoint-registry
 * สิ่งที่ห้ามแตะ: never synthesise a health URL from a naming convention.
 */

import {
  ensureRuntimeEndpointsLoaded,
  resolveRuntimeEndpoint,
} from "../runtime-endpoint-registry/contract";
import { UNKNOWN, PROVIDER_UNRESOLVED, type AlertEvent, type ResolvedTarget } from "./types";
import { repoPathExists } from "./host-runtime";

interface KnownService {
  readonly endpoint_id: string | null;
  readonly repo_path: string | null;
}

/**
 * Keyed by `<provider>/<project>/<service>` exactly as the provider
 * spells it in its own alert — so the key is what the email actually
 * says, not a normalised guess.
 */
export const KNOWN_SERVICES: Readonly<Record<string, KnownService>> = {
  "railway/DNA-OS-INFRASTRUCTURE/dna-os-circuit": {
    endpoint_id: "endpoint://dna-os-circuit/public",
    repo_path: "dna-os-circuit",
  },
  "railway/DNA-OS-INFRASTRUCTURE/owner-command-http": {
    endpoint_id: null,
    repo_path: "transport/owner-command-http",
  },
  "railway/DNA-OS-INFRASTRUCTURE/joint-monitor": {
    endpoint_id: "endpoint://joint-monitor/public",
    repo_path: "observability/joint-monitor",
  },
};

function observedAddress(endpointId: string | null): string | null {
  if (!endpointId) return null;
  ensureRuntimeEndpointsLoaded();
  const resolved = resolveRuntimeEndpoint({ query: endpointId, purpose: "observe" });
  return resolved.ok ? resolved.endpoint.address : null;
}

export function serviceKey(alert: AlertEvent): string {
  return `${alert.provider}/${alert.project}/${alert.service}`;
}

export function resolveTarget(alert: AlertEvent): ResolvedTarget {
  if (alert.provider === PROVIDER_UNRESOLVED) {
    return { resolved: false, health_url: UNKNOWN, repo_path: UNKNOWN, reason: `sender "${alert.sender}" matched no registered provider domain` };
  }
  if (alert.service === UNKNOWN) {
    return { resolved: false, health_url: UNKNOWN, repo_path: UNKNOWN, reason: `provider "${alert.provider}" recognised, but no service name could be proven from the message body` };
  }

  const key = serviceKey(alert);
  const known = KNOWN_SERVICES[key];
  if (!known) {
    return { resolved: false, health_url: UNKNOWN, repo_path: UNKNOWN, reason: `no registered service matches "${key}" — alert is real but its target is unknown to DNA OS` };
  }

  const repoOk = known.repo_path !== null && repoPathExists(known.repo_path);
  const health_url = observedAddress(known.endpoint_id);

  return {
    resolved: true,
    health_url: health_url ?? UNKNOWN,
    repo_path: repoOk ? (known.repo_path as string) : UNKNOWN,
    reason: health_url
      ? `matched "${key}"; probe target from runtime-endpoint-registry${repoOk ? "; repo path verified" : "; repo path MISSING on disk"}`
      : `matched "${key}", but no health URL is registered — correlation will report UNVERIFIABLE rather than guess`,
  };
}
