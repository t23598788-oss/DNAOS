/**
 * หน้าที่: the Connector Contract — the shape of one registered
 * connection: which Account is using which Software, via which
 * destination adapter (see ../../connections/), holding only a REFERENCE
 * to where the real credential lives — never the credential itself.
 * Directly reuses the pattern proven and verified in dna-os-deadboard's
 * TASK-172 (connectors.config.secret_env_var, now frozen/legacy there):
 * the registry never holds a token, only the name of where to find one.
 *
 * Input: an Account, a Software, an adapter name.
 * Output: `ConnectionRegistration`.
 * Dependency ที่อนุญาต: none (account_id/software_id are plain string
 * references, resolved by the caller).
 * สิ่งที่ห้ามแตะ: `credential_ref` may only ever be a reference (env var
 * name) or `not_yet_built` — never widen this to allow an inline secret
 * value, in this file or any consumer of it.
 *
 * NOT_YET_BUILT: no real connection has been registered. See
 * ../../connections/ for the (also NOT_YET_BUILT) per-provider adapters
 * this would eventually reference.
 */

export interface ConnectionRegistration {
  connection_id: string;
  account_id: string;
  software_id: string;
  adapter: string; // e.g. "github", "vercel", "supabase" — matches a folder name under ../../connections/
  credential_ref: { kind: "env_var"; name: string } | { kind: "not_yet_built" };
  status: "disconnected" | "connecting" | "connected" | "error";
}
