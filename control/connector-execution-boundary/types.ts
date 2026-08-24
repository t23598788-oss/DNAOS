/**
 * หน้าที่: the generic type contracts for the Connector Execution
 * Boundary — the ONE reusable seam between `../command-router/router.ts`
 * and ANY provider connector (`connections/digitalocean/`,
 * `connections/hostinger/` once it exists, a future `connections/runpod/`,
 * etc). Built to fix the exact gap `capability-registry.ts` documented for
 * `digitalocean` ("router has no mechanism to supply deps") — generically,
 * so a second provider never needs a second router change or a second
 * boundary.
 *
 * A `ConnectorInvoker` takes ONLY a `CommandEnvelope` — every
 * provider-specific dependency (its own `AccountBindingProvider`,
 * `CredentialProvider`, fetch override, etc.) is already closed over
 * inside that provider's own `*-router-invoker.ts` file (see
 * `../../connections/digitalocean/router-invoker.ts`) at REGISTRATION
 * TIME, not call time. This is what lets this boundary stay generic: it
 * never needs to know DigitalOcean's `AuthMethod` or Hostinger's
 * `HOSTINGER_API_TOKEN` shape, only a uniform outcome.
 *
 * Input: none (pure type definitions).
 * Output: `ConnectorInvoker`, `ConnectorBoundaryOutcome`.
 * Dependency ที่อนุญาต: ../../contracts/command/command-envelope.ts,
 * ../../contracts/command/capability-result.ts (evidence type only).
 * สิ่งที่ห้ามแตะ: never add a field here that could carry a raw secret.
 * Never widen `ConnectorInvoker`'s signature to accept a second,
 * caller-supplied `deps` argument — the whole point is that the router
 * never constructs or holds a provider's credential/binding providers.
 */

import type { CommandEnvelope } from "../../contracts/command/command-envelope";
import type { CapabilityResultEvidence } from "../../contracts/command/capability-result";

/**
 * Uniform outcome every provider's invoker must translate its own
 * adapter-specific outcome type into. `auth_required: true` is the
 * generic signal for "this call is genuinely wired and reached the real
 * fail-closed authorization/credential stage, and correctly found nothing
 * to use" — never a fabricated success. `ok: false, auth_required: false`
 * covers every other real failure (unknown intent, invalid payload,
 * transport error, non-2xx API response).
 */
export interface ConnectorBoundaryOutcome {
  ok: boolean;
  auth_required: boolean;
  summary: string;
  evidence: readonly CapabilityResultEvidence[];
  artifacts: readonly { kind: string; ref: string }[];
}

/** One provider's real, dependency-closed entry point — see this file's own header for why it takes only a CommandEnvelope. */
export type ConnectorInvoker = (command: CommandEnvelope) => Promise<ConnectorBoundaryOutcome>;
