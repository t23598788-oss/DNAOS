/**
 * หน้าที่: the public boundary of `control/connector-execution-boundary/`
 * — the only file `../command-router/router.ts` may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * `executeConnectorCommand()` is the ONE function that turns "route this
 * command to capability X" into a real call, generically, for any
 * capability whose `EndpointReference.kind === "connector"`:
 *
 *   ROUTER -> executeConnectorCommand(capability_id, command)
 *          -> CONNECTOR_INVOKER_REGISTRY[capability_id](command)
 *          -> (provider's own ConnectorInvoker, already closed over its
 *             real AccountBindingProvider/CredentialProvider)
 *          -> provider adapter -> external API
 *
 * Input: `capability_id`, a `CommandEnvelope`.
 * Output: `executeConnectorCommand` -> `ConnectorBoundaryOutcome |
 * { ok: false; auth_required: false; summary: "NOT_REGISTERED" }`.
 * Dependency ที่อนุญาต: ./types.ts, ./registry.ts.
 */

import type { CommandEnvelope } from "../../contracts/command/command-envelope";
import type { ConnectorBoundaryOutcome } from "./types";
import { getConnectorInvoker } from "./registry";

export async function executeConnectorCommand(capability_id: string, command: CommandEnvelope): Promise<ConnectorBoundaryOutcome> {
  const invoker = getConnectorInvoker(capability_id);
  if (!invoker) {
    return {
      ok: false,
      auth_required: false,
      summary: `no ConnectorInvoker registered for capability_id "${capability_id}"`,
      evidence: [{ source: "connector-execution-boundary", note: `capability_id "${capability_id}" has no entry in CONNECTOR_INVOKER_REGISTRY` }],
      artifacts: [],
    };
  }
  return invoker(command);
}

export type { ConnectorBoundaryOutcome, ConnectorInvoker } from "./types";
