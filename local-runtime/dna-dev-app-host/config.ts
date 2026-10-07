/**
 * หน้าที่: the ONE place the DNA DEV launch target is declared. `./build.sh`
 * stamps the launcher from the same resolved REGISTERED_REMOTE address.
 *
 * Input: runtime-endpoint-registry.
 * Output: `CANONICAL_TARGET`, `resolveLaunchTarget`.
 * Dependency ที่อนุญาต: ./types.ts, control/runtime-endpoint-registry/contract.ts
 * สิ่งที่ห้ามแตะ: never make NODE_LOCAL the default and never fall back to it
 * silently. Missing REGISTERED_REMOTE is fail-closed, not localhost.
 */

import {
  ensureRuntimeEndpointsLoaded,
  resolveRuntimeEndpoint,
} from "../../control/runtime-endpoint-registry/contract";
import type { LaunchTarget } from "./types";

function requireEndpoint(endpointId: string, kind: LaunchTarget["runtime_kind"]): LaunchTarget {
  ensureRuntimeEndpointsLoaded();
  const resolved = resolveRuntimeEndpoint({ query: endpointId, purpose: "execute" });
  if (!resolved.ok) {
    return {
      url: "",
      runtime_kind: kind,
      service_id: "dna-os-circuit",
      evidence: [`UNRESOLVED ${endpointId} reason=${resolved.reason}`],
    };
  }
  return {
    url: resolved.endpoint.address,
    runtime_kind: resolved.endpoint.source === "NODE_LOCAL" ? "NODE_LOCAL" : "REGISTERED_REMOTE",
    service_id: resolved.endpoint.service_id,
    evidence: [
      `resolved ${endpointId} via control/runtime-endpoint-registry`,
      "REGISTERED_REMOTE backing (if any) is adapter JSONL, not a Core hostname constant",
      ".railway/railway.ts classifies dna-os-circuit as UI_APP and owner-command-http as API_SERVICE without a public domain",
      "dna-os-circuit/ui/circuit-board/index.html is the Owner-facing circuit board",
      "dna-os-circuit/runtime/server.ts serves GET / and /circuit.json",
    ],
  };
}

export const CANONICAL_TARGET: LaunchTarget = requireEndpoint("endpoint://dna-os-circuit/public", "REGISTERED_REMOTE");

export const LOCAL_TARGET: LaunchTarget = requireEndpoint("endpoint://dna-os-circuit/local", "NODE_LOCAL");

export function resolveLaunchTarget(prefer: "REGISTERED_REMOTE" | "NODE_LOCAL"): LaunchTarget {
  return prefer === "NODE_LOCAL" ? LOCAL_TARGET : CANONICAL_TARGET;
}
