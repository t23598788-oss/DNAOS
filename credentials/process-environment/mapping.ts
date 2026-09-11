/**
 * Explicit CORE_NODE credential_ref → process environment mapping.
 * Fail-closed: a credential_ref that is not listed here never becomes an
 * env-var name, and listed names are constants — never derived from the ref.
 *
 * This is not a second credential registry. Metadata identity stays in
 * `credentials/registry/`. This table only names where CORE_NODE may read
 * secret material when macOS Keychain is not an allowed backend.
 *
 * Shared HTTP secrets (OWNER_COMMAND_HTTP_SHARED_SECRET, etc.) are not
 * listed: they remain direct runtime env variables, not credential_refs.
 */

export type CoreSecretAvailabilityClass =
  | "CORE_REQUIRED"
  | "OPTIONAL_PROVIDER"
  | "DATA_SERVICE"
  | "MAC_LOCAL_AGENT_ONLY";

export type CoreProcessEnvBinding =
  | {
      readonly match: "exact";
      readonly credential_ref: string;
      readonly env_var: string;
      readonly availability: "CORE_REQUIRED" | "OPTIONAL_PROVIDER" | "DATA_SERVICE";
      readonly consumer: string;
    }
  | {
      readonly match: "github_source_authority";
      readonly env_var: "GITHUB_PAT_INFRASTRUCTURE";
      readonly availability: "CORE_REQUIRED";
      readonly consumer: "connections/github";
    }
  | {
      readonly match: "github_webhook_secret";
      readonly env_var: "GITHUB_WEBHOOK_SECRET_INFRASTRUCTURE";
      readonly availability: "CORE_REQUIRED";
      readonly consumer: "connections/github/webhook-receiver";
    };

const GITHUB_SOURCE_AUTHORITY = /^credential:\/\/github\/[^/]+\/[^/]+\/source-authority$/;
const GITHUB_WEBHOOK_SECRET = /^credential:\/\/github\/[^/]+\/[^/]+\/webhook-secret$/;
const ENV_VAR_NAME = /^[A-Z][A-Z0-9_]*$/;

export const RAILWAY_CORE_CREDENTIAL_REF =
  "credential://railway/dna-os-infrastructure/production/project-token" as const;
export const RAILWAY_CORE_ENV_VAR = "RAILWAY_PROJECT_TOKEN" as const;

export const SUPABASE_SCHEMA_READ_CREDENTIAL_REF =
  "credential://supabase/xeytcavxejhyzxwevgto/schema-read" as const;
export const SUPABASE_SCHEMA_READ_ENV_VAR = "SUPABASE_SCHEMA_READ_TOKEN" as const;

export const CORE_PROCESS_ENV_BINDINGS: readonly CoreProcessEnvBinding[] = [
  {
    match: "github_source_authority",
    env_var: "GITHUB_PAT_INFRASTRUCTURE",
    availability: "CORE_REQUIRED",
    consumer: "connections/github",
  },
  {
    match: "github_webhook_secret",
    env_var: "GITHUB_WEBHOOK_SECRET_INFRASTRUCTURE",
    availability: "CORE_REQUIRED",
    consumer: "connections/github/webhook-receiver",
  },
  {
    match: "exact",
    credential_ref: RAILWAY_CORE_CREDENTIAL_REF,
    env_var: RAILWAY_CORE_ENV_VAR,
    availability: "OPTIONAL_PROVIDER",
    consumer: "connections/railway",
  },
  {
    match: "exact",
    credential_ref: SUPABASE_SCHEMA_READ_CREDENTIAL_REF,
    env_var: SUPABASE_SCHEMA_READ_ENV_VAR,
    availability: "DATA_SERVICE",
    consumer: "connections/supabase-schema-read",
  },
];

/** Mac-local OAuth / browser material — never mapped for CORE_NODE. */
export const MAC_LOCAL_AGENT_ONLY_CREDENTIAL_REFS: readonly string[] = [
  "credential://google/workspace/oauth",
  "credential://google/workspace/oauth-client/client-id",
  "credential://google/workspace/oauth-client/client-secret",
];

/**
 * Already portable as process.env reads in their servers/clients.
 * Not credential_refs and not entered into CORE_PROCESS_ENV_BINDINGS.
 */
export const DIRECT_RUNTIME_ENV_SECRETS: readonly string[] = [
  "OWNER_COMMAND_HTTP_SHARED_SECRET",
  "JOINT_MONITOR_SHARED_SECRET",
  "DNA_OS_CIRCUIT_SHARED_SECRET",
];

export function isAllowedEnvVarName(name: string): boolean {
  return ENV_VAR_NAME.test(name);
}

export function lookupCoreProcessEnvBinding(credential_ref: string): CoreProcessEnvBinding | null {
  if (MAC_LOCAL_AGENT_ONLY_CREDENTIAL_REFS.includes(credential_ref)) return null;
  for (const binding of CORE_PROCESS_ENV_BINDINGS) {
    if (binding.match === "exact" && binding.credential_ref === credential_ref) return binding;
    if (binding.match === "github_source_authority" && GITHUB_SOURCE_AUTHORITY.test(credential_ref)) return binding;
    if (binding.match === "github_webhook_secret" && GITHUB_WEBHOOK_SECRET.test(credential_ref)) return binding;
  }
  return null;
}

export function classifyCredentialRefAvailability(credential_ref: string): CoreSecretAvailabilityClass | "UNKNOWN" {
  if (MAC_LOCAL_AGENT_ONLY_CREDENTIAL_REFS.includes(credential_ref)) return "MAC_LOCAL_AGENT_ONLY";
  const binding = lookupCoreProcessEnvBinding(credential_ref);
  if (binding) return binding.availability;
  return "UNKNOWN";
}
