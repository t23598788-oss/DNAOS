/**
 * หน้าที่: generate and install a Supabase Edge Function secret into BOTH
 * ends — the Supabase project and DNA OS's own Keychain credential
 * boundary — without the Owner ever typing or seeing it, and without the
 * plaintext ever reaching an Agent, a log, Git, the Registry, or evidence.
 *
 * NO NEW CREDENTIAL SYSTEM. Both writes go through mechanisms that already
 * existed:
 *   - Supabase side: `../../execution/run/contract.ts#requestProcessExecution`
 *     -> the registered `supabase.secrets-set` operation (closed argv,
 *     pinned project ref, name allowlist). The Process Gate is extended,
 *     never bypassed.
 *   - DNA OS side: `../macos-keychain/api-registration.ts#registerOwnerApiCredential`
 *     -> the already-registered `keychain.add-generic-password` operation.
 *
 * HOW THE PLAINTEXT IS CONTAINED — each of these is load-bearing:
 *  1. Generated with `randomBytes(32)`, never derived from anything
 *     guessable and never chosen by a model.
 *  2. NEVER placed in argv. `supabase secrets set NAME=VALUE` would put it
 *     in the process command line, where any `ps` on this machine reads it.
 *     It is written to a 0600 env-file instead and passed by `--env-file`.
 *  3. The env-file is created with mode 0600 and `wx` (exclusive), so it
 *     cannot silently reuse or overwrite an attacker-planted path.
 *  4. It is unlinked in a `finally`, so it disappears even on failure.
 *  5. No function here returns, logs, or throws the value. The only
 *     outputs are booleans and names.
 *
 * Input: a secret name from the registry's allowlist.
 * Output: `installEdgeFunctionSecret`, `verifySupabaseSecretPresent`,
 * `verifyDnaOsCallerSecretPresent`, `readCallerSecret`.
 * Dependency ที่อนุญาต: ../../execution/run/contract.ts,
 * ../macos-keychain/contract.ts, node:crypto, node:fs, node:path.
 * สิ่งที่ห้ามแตะ: never add a parameter that accepts a caller-supplied
 * secret value (that would let a plaintext travel through an Agent), never
 * return the plaintext from any exported function, and never widen the
 * argv contract in `../../execution/run/process-registry.ts`.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { requestProcessExecution } from "../../execution/run/contract";
import {
  SUPABASE_INSTALLABLE_SECRET_NAMES,
  SUPABASE_PRODUCTION_PROJECT_REF,
  SUPABASE_SECRET_ENVFILE_DIR,
} from "../../execution/run/process-registry";
import { registerOwnerApiCredential } from "../macos-keychain/index";

const CALLER = "credentials/supabase-edge-secret/installer.ts";
/** Where the DNA OS caller half lives, so the adapter can fetch it later. */
export const CALLER_KEYCHAIN_SERVICE = "dna-os-supabase-edge";

export type InstallableSecretName = (typeof SUPABASE_INSTALLABLE_SECRET_NAMES)[number];

export interface InstallResult {
  readonly secret_name: string;
  readonly project_ref: string;
  readonly supabase_installed: boolean;
  readonly caller_installed: boolean;
  /** Never the value — only where the caller half can be looked up. */
  readonly credential_ref: string;
  readonly detail: string;
}

function assertAllowed(name: string): asserts name is InstallableSecretName {
  if (!(SUPABASE_INSTALLABLE_SECRET_NAMES as readonly string[]).includes(name)) {
    throw new Error(`SECRET_NAME_NOT_ALLOWED: "${name}" is not in the Process Gate's installable allowlist`);
  }
}

/**
 * Generates and installs. The plaintext lives in one local binding and one
 * 0600 file, both gone before this returns.
 */
export async function installEdgeFunctionSecret(secretName: string, requesterIdentity: string): Promise<InstallResult> {
  assertAllowed(secretName);

  // 32 random bytes, hex. Never printed, never returned.
  const secret = randomBytes(32).toString("hex");

  mkdirSync(SUPABASE_SECRET_ENVFILE_DIR, { recursive: true, mode: 0o700 });
  const envFile = join(SUPABASE_SECRET_ENVFILE_DIR, `${secretName}-${randomBytes(8).toString("hex")}.env`);

  let supabaseInstalled = false;
  let supabaseDetail = "";
  try {
    // `wx` = create-exclusive: refuses to write through a pre-existing file
    // or a planted symlink. Mode 0600 before any content is written.
    writeFileSync(envFile, `${secretName}=${secret}\n`, { mode: 0o600, flag: "wx" });

    const result = (await requestProcessExecution({
      request_id: `supabase-secret-install-${Date.now()}`,
      parent_work_order_id: null,
      requester_identity: CALLER,
      executable_id: "supabase.secrets-set",
      argv: ["secrets", "set", "--project-ref", SUPABASE_PRODUCTION_PROJECT_REF, "--env-file", envFile],
      cwd: SUPABASE_SECRET_ENVFILE_DIR,
    })) as unknown as { status: string; exit_code: number | null; stderr?: string };

    supabaseInstalled = result.status === "EXECUTED" && result.exit_code === 0;
    // Only the STATUS is retained. The CLI does not echo the value, but the
    // stderr is still truncated hard so nothing unexpected can ride along.
    supabaseDetail = `${result.status}/exit=${String(result.exit_code)}${supabaseInstalled ? "" : ` :: ${(result.stderr ?? "").slice(0, 160)}`}`;
  } finally {
    // Always, including on throw — the file must not outlive the call.
    if (existsSync(envFile)) unlinkSync(envFile);
  }

  // DNA OS caller half, through the EXISTING Keychain capability.
  let callerInstalled = false;
  let credentialRef = "";
  try {
    const registration = await registerOwnerApiCredential({
      requester_identity: requesterIdentity,
      service: CALLER_KEYCHAIN_SERVICE,
      keychainAccount: secretName,
      provider: "supabase",
      account: SUPABASE_PRODUCTION_PROJECT_REF,
      credential_ref: `credential://supabase/${SUPABASE_PRODUCTION_PROJECT_REF}/${secretName}`,
      scope: ["INVOKE_EDGE_FUNCTION"],
      secret,
    });
    credentialRef = registration.credential_ref;
    callerInstalled = true;
  } catch (error) {
    callerInstalled = false;
    credentialRef = "";
    supabaseDetail += ` | keychain: ${error instanceof Error ? error.message : String(error)}`;
  }

  return {
    secret_name: secretName,
    project_ref: SUPABASE_PRODUCTION_PROJECT_REF,
    supabase_installed: supabaseInstalled,
    caller_installed: callerInstalled,
    credential_ref: credentialRef,
    detail: supabaseDetail,
  };
}

/**
 * Behavioural check: does the project have a secret of this NAME? The CLI
 * returns names plus digests, never plaintext, and only the name is read.
 */
export async function verifySupabaseSecretPresent(secretName: string): Promise<boolean> {
  assertAllowed(secretName);
  mkdirSync(SUPABASE_SECRET_ENVFILE_DIR, { recursive: true, mode: 0o700 });
  const result = (await requestProcessExecution({
    request_id: `supabase-secret-verify-${Date.now()}`,
    parent_work_order_id: null,
    requester_identity: CALLER,
    executable_id: "supabase.secrets-list",
    argv: ["secrets", "list", "--project-ref", SUPABASE_PRODUCTION_PROJECT_REF, "--output=json"],
    cwd: SUPABASE_SECRET_ENVFILE_DIR,
  })) as unknown as { status: string; stdout?: string };
  if (result.status !== "EXECUTED") return false;
  try {
    const parsed = JSON.parse(result.stdout ?? "[]") as unknown;
    const rows = Array.isArray(parsed) ? parsed : ((parsed as { secrets?: unknown[] }).secrets ?? []);
    // NAME only. The digest field is never read, compared, or reported.
    return (rows as { name?: string }[]).some((row) => row.name === secretName);
  } catch {
    return false;
  }
}
