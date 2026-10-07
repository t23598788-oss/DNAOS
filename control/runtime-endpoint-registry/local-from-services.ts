/**
 * หน้าที่: project four existing Core ServiceDefinition rows into NODE_LOCAL
 * endpoints. Does not copy the service catalog; ports/health stay owned by
 * control/runtime-control.
 *
 * Input: SERVICES from runtime-control.
 * Output: RuntimeEndpointRegistration[] for owner-command-http, dna-os-circuit,
 * joint-monitor, dna-os-mcp.
 * Dependency ที่อนุญาต: runtime-control contract, runtime-node kinds, ./types.ts
 */

import { lookupRuntimeNodeKind } from "../../contracts/architecture/runtime-node-and-optional-provider";
import { SERVICES } from "../runtime-control/contract";
import type { ServiceId } from "../runtime-control/contract";
import type { RuntimeEndpointRegistration, RuntimeEndpointScope } from "./types";

const LOCAL_CORE_SERVICES: readonly ServiceId[] = [
  "owner-command-http",
  "dna-os-circuit",
  "joint-monitor",
  "dna-os-mcp",
];

function scopeFor(capabilityFolder: string): RuntimeEndpointScope {
  const kind = lookupRuntimeNodeKind(capabilityFolder);
  return kind.known && kind.node === "MAC_LOCAL_AGENT" ? "MAC_LOCAL" : "CORE_LOCAL";
}

export function localEndpointsFromServices(): readonly RuntimeEndpointRegistration[] {
  return LOCAL_CORE_SERVICES.map((service_id) => {
    const def = SERVICES[service_id];
    return {
      endpoint_id: `endpoint://${service_id}/local`,
      service_id,
      scope: scopeFor(def.capability_folder),
      transport: "HTTP",
      address: `http://127.0.0.1:${def.port}`,
      health_path: def.health_path,
      source: "NODE_LOCAL",
      status: "ACTIVE",
    } as const;
  });
}

export { LOCAL_CORE_SERVICES };
