/**
 * หน้าที่: the Connector Contract — the shape of one registered
 * connection: which Account is using which Software, via which
 * destination adapter (see ../../connections/), holding only a REFERENCE
 * to where the real credential lives — never the credential itself.
 * Directly reuses the pattern proven and verified in dna-os-deadboard's
 * TASK-172 (connectors.config.secret_env_var, now frozen/legacy there):
 * the registry never holds a token, only the name of where to find one.
 *
 * STEP "Build Real GitHub Connection Registration + Keychain Resolution"
 * lifts the prior NOT_YET_BUILT status for GitHub specifically —
 * `connections/connection-registry/` is the real, persistent write path
 * this file's own header used to say did not exist. This file gained,
 * additively, exactly what that round needed: a `keychain_ref` credential
 * channel (still a reference only — never a secret value, same
 * discipline as `env_var`) and optional provider-target fields, matching
 * the exact extension shape `credentials/provider-accounts/digitalocean/
 * credential-reference.ts`'s own header already anticipated
 * ("a future round wiring ../../../connections/digitalocean/ into that
 * generic contract would add `{ kind: "vault_ref" } & VaultReference`").
 * All new fields are optional — every pre-existing fixture/consumer that
 * never set them keeps compiling unchanged.
 *
 * Input: an Account, a Software, an adapter name.
 * Output: `ConnectionRegistration`, `ConnectionType`,
 * `GithubRepositoryTarget`.
 * Dependency ที่อนุญาต: none (account_id/software_id are plain string
 * references, resolved by the caller).
 * สิ่งที่ห้ามแตะ: `credential_ref` may only ever be a reference (env var
 * name, or now a `keychain_ref` string identity) or `not_yet_built` —
 * never widen this to allow an inline secret value, in this file or any
 * consumer of it. `keychain_ref`'s `ref` is a logical identity string
 * (e.g. `credential://github/<owner>/<repository>/source-authority`),
 * never a Keychain service/account pair and never a secret.
 */

/** Extensible — only "SOURCE_AUTHORITY" is used by any real connection today (GitHub). */
export type ConnectionType = "SOURCE_AUTHORITY";

/** Provider-specific target for a SOURCE_AUTHORITY connection to a real Git host. Never a default anywhere — always real, discovered data (see connections/connection-registry/git-discovery.ts). */
export interface GithubRepositoryTarget {
  owner: string;
  repository: string;
  branch: string;
}

export interface ConnectionRegistration {
  connection_id: string;
  account_id: string;
  software_id: string;
  adapter: string; // e.g. "github", "vercel", "supabase" — matches a folder name under ../../connections/
  credential_ref: { kind: "env_var"; name: string } | { kind: "keychain_ref"; ref: string } | { kind: "not_yet_built" };
  status: "disconnected" | "connecting" | "connected" | "error";
  /** What kind of connection this is — optional so every pre-existing consumer that never set it keeps compiling. */
  connection_type?: ConnectionType;
  /** Provider-specific real target (e.g. GitHub owner/repository/branch) — never a default, always caller-supplied real data. */
  target?: GithubRepositoryTarget;
  /** The real, already-registered capability this connection is meant to be used through (e.g. github-source-executor's capability_id) — null when not yet bound. */
  executor_capability_id?: string | null;
  /** What this connection is authorized for, e.g. ["WRITE_SOURCE"] — never enforced here, just declared identity; the real enforcement stays Permission/Policy Resolution's job. */
  scope?: readonly string[];
}
