/**
 * หน้าที่: this capability's real `ConnectorInvoker` — the one function
 * `../../control/connector-execution-boundary/registry.ts` is allowed to
 * import from this folder (Capability Folder Law ข้อ 9: one public entry
 * point). Closes `handleDigitalOceanReadCommand` over the real
 * `productionAccountBindingProvider`/`productionCredentialProvider` at
 * MODULE LOAD TIME — the boundary and router never construct or see
 * either provider, exactly as `../../control/connector-execution-
 * boundary/types.ts`'s header requires.
 *
 * Translates `DigitalOceanAdapterOutcome` -> `ConnectorBoundaryOutcome`:
 * `denied_at_stage === "authenticate"` (no binding found, or binding
 * present but credential resolution failed) becomes `auth_required:
 * true` — the generic, provider-agnostic signal the router uses to
 * report a real (never fake) AUTH_REQUIRED-shaped result.
 *
 * Input: a `CommandEnvelope`.
 * Output: `invokeDigitalOceanConnector` -> `ConnectorBoundaryOutcome`.
 * Dependency ที่อนุญาต: ./digitalocean-adapter.ts,
 * ./production-binding-provider.ts, ./production-credential-provider.ts,
 * ../../control/connector-execution-boundary/types.ts (type only).
 * สิ่งที่ห้ามแตะ: never import this file's providers separately anywhere
 * else — the composition happens exactly once, here.
 */

import type { CommandEnvelope } from "../../contracts/command/command-envelope";
import type { ConnectorBoundaryOutcome, ConnectorInvoker } from "../../control/connector-execution-boundary/types";
import { handleDigitalOceanReadCommand } from "./digitalocean-adapter";
import { productionAccountBindingProvider } from "./production-binding-provider";
import { productionCredentialProvider } from "./production-credential-provider";

export const invokeDigitalOceanConnector: ConnectorInvoker = async (command: CommandEnvelope): Promise<ConnectorBoundaryOutcome> => {
  const outcome = await handleDigitalOceanReadCommand(command, {
    bindingProvider: productionAccountBindingProvider,
    credentialProvider: productionCredentialProvider,
  });

  if (outcome.ok) {
    return {
      ok: true,
      auth_required: false,
      summary: `digitalocean adapter completed "${outcome.event.event_type}"`,
      evidence: outcome.evidence,
      artifacts: [{ kind: "event_id", ref: outcome.event.event_id }],
    };
  }

  const authRequired = outcome.rejection.denied_at_stage === "authenticate";
  return {
    ok: false,
    auth_required: authRequired,
    summary: authRequired ? `AUTH_REQUIRED: ${outcome.rejection.reason}` : outcome.rejection.reason,
    evidence: outcome.evidence,
    artifacts: [],
  };
};
