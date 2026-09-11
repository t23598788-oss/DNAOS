/**
 * CORE_NODE secret backend: one mapped credential_ref → one process env var.
 * Never enumerates the environment. Never guesses names. Never returns a
 * default/fake credential. Secret values are never logged here.
 */

import {
  classifyCredentialRefAvailability,
  isAllowedEnvVarName,
  lookupCoreProcessEnvBinding,
} from "./mapping";
import { publicSecretOutcome, type SecretResolution } from "../secret-resolver/types";

export type ProcessEnvironmentReader = (name: string) => string | undefined;

const defaultReader: ProcessEnvironmentReader = (name) => {
  if (typeof process === "undefined" || process.env === undefined) return undefined;
  return process.env[name];
};

export class ProcessEnvironmentSecretProvider {
  constructor(private readonly readEnv: ProcessEnvironmentReader = defaultReader) {}

  resolve(credential_ref: string): SecretResolution {
    const trimmed = credential_ref.trim();
    if (trimmed.length === 0) {
      return {
        ok: false,
        code: "NOT_FOUND",
        reason: "empty credential_ref",
        credential_source: credential_ref,
      };
    }

    if (classifyCredentialRefAvailability(trimmed) === "MAC_LOCAL_AGENT_ONLY") {
      return {
        ok: false,
        code: "DENIED",
        reason: "MAC_LOCAL_AGENT_ONLY credential_ref is not resolvable on CORE_NODE process-environment",
        credential_source: trimmed,
      };
    }

    const binding = lookupCoreProcessEnvBinding(trimmed);
    if (!binding) {
      return {
        ok: false,
        code: "NOT_FOUND",
        reason: "unknown credential_ref — no explicit CORE_NODE env mapping",
        credential_source: trimmed,
      };
    }

    if (!isAllowedEnvVarName(binding.env_var)) {
      return {
        ok: false,
        code: "FAILED",
        reason: "mapped env var name is not an allowed identifier",
        credential_source: trimmed,
      };
    }

    const raw = this.readEnv(binding.env_var);
    if (raw === undefined) {
      return {
        ok: false,
        code: "NOT_CONFIGURED",
        reason: `environment variable "${binding.env_var}" is not set`,
        credential_source: `env:${binding.env_var}`,
      };
    }
    const secret = raw.trim();
    if (secret.length === 0) {
      return {
        ok: false,
        code: "NOT_CONFIGURED",
        reason: `environment variable "${binding.env_var}" is set but empty`,
        credential_source: `env:${binding.env_var}`,
      };
    }

    return { ok: true, secret, credential_source: `env:${binding.env_var}` };
  }

  /** Status/evidence shape — never includes the secret. */
  publicOutcome(credential_ref: string): ReturnType<typeof publicSecretOutcome> {
    return publicSecretOutcome(this.resolve(credential_ref));
  }
}

const defaultProvider = new ProcessEnvironmentSecretProvider();

export function resolveProcessEnvironmentSecret(credential_ref: string): SecretResolution {
  return defaultProvider.resolve(credential_ref);
}
