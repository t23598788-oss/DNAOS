/**
 * Node-class dispatch for credential material.
 * CORE_NODE on a non-darwin host uses process-environment only and never
 * calls MacOsKeychainProvider.resolve. Darwin (Mac Local Agent colocated)
 * keeps the existing Keychain path.
 *
 * Secret availability is not permission. Callers must still pass
 * repository / connection / write-gate / execution-policy checks.
 */

import {
  canExecuteMacLocalAgentCapability,
  type RuntimeNodeKind,
} from "../../contracts/architecture/runtime-node-and-optional-provider";
import { MacOsKeychainProvider } from "../macos-keychain/provider";
import { findApiCredential } from "../registry/api-credential-registry";
import { resolveProcessEnvironmentSecret } from "../process-environment/provider";
import { RAILWAY_CORE_CREDENTIAL_REF } from "../process-environment/mapping";
import type { SecretResolution } from "./types";
import { publicSecretOutcome } from "./types";

export type SecretBackend = "macos_keychain" | "process_environment";

export function secretResolutionBackend(
  current_node: RuntimeNodeKind = "CORE_NODE",
): SecretBackend {
  if (canExecuteMacLocalAgentCapability({ current_node })) return "macos_keychain";
  return "process_environment";
}

export interface ResolveNodeCredentialOptions {
  readonly current_node?: RuntimeNodeKind;
  readonly keychain?: MacOsKeychainProvider;
}

/**
 * Railway (OPTIONAL_PROVIDER): missing material must not block Core boot.
 * Availability is adapter-local; Core startup never requires this secret.
 */
export function optionalProviderSecretStatus(credential_ref: string): {
  readonly credential_ref: string;
  readonly available: boolean;
  readonly core_startup_blocked: false;
  readonly code?: string;
} {
  if (secretResolutionBackend("CORE_NODE") === "process_environment") {
    const resolution = resolveProcessEnvironmentSecret(credential_ref);
    return {
      credential_ref,
      available: resolution.ok,
      core_startup_blocked: false,
      code: resolution.ok ? undefined : resolution.code,
    };
  }
  const entry = findApiCredential(credential_ref);
  return {
    credential_ref,
    available: entry !== null && entry.status === "ACTIVE",
    core_startup_blocked: false,
    code: entry ? undefined : "NOT_FOUND",
  };
}

export function railwayAdapterAvailability(): ReturnType<typeof optionalProviderSecretStatus> {
  return optionalProviderSecretStatus(RAILWAY_CORE_CREDENTIAL_REF);
}

export async function resolveNodeCredential(
  credential_ref: string,
  options: ResolveNodeCredentialOptions = {},
): Promise<SecretResolution> {
  const node = options.current_node ?? "CORE_NODE";
  const backend = secretResolutionBackend(node);

  if (backend === "process_environment") {
    return resolveProcessEnvironmentSecret(credential_ref);
  }

  const entry = findApiCredential(credential_ref);
  if (!entry) {
    return {
      ok: false,
      code: "NOT_FOUND",
      reason: "CREDENTIAL_NOT_REGISTERED",
      credential_source: credential_ref,
    };
  }
  if (entry.status !== "ACTIVE") {
    return {
      ok: false,
      code: "FAILED",
      reason: `CREDENTIAL_${entry.status}`,
      credential_source: credential_ref,
    };
  }
  const keychain = options.keychain ?? new MacOsKeychainProvider();
  const resolution = await keychain.resolve({
    service: entry.resolver_service,
    account: entry.resolver_account,
    kind: "api_key",
  });
  if (!resolution.ok) {
    return {
      ok: false,
      code: resolution.code === "NOT_FOUND" ? "NOT_FOUND" : "FAILED",
      reason: resolution.reason,
      credential_source: resolution.credential_source,
    };
  }
  return { ok: true, secret: resolution.secret, credential_source: resolution.credential_source };
}

export { publicSecretOutcome };
