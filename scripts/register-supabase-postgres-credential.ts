/**
 * scripts/register-supabase-postgres-credential.ts
 *
 * Human-only interactive CLI to register the DNA OS Supabase PostgreSQL
 * credential (the software_registry PRODUCTION target) into the macOS
 * Keychain, reusing this repo's existing credential path end to end:
 *
 *   registerOwnerDatabaseCredential()      (credentials/macos-keychain/registration.ts)
 *   -> Database Credential Registry        (credentials/registry/database-credential-registry.ts)
 *   -> Credential Resolver                 (credentials/registry/database-credential-resolver.ts)
 *   -> Connection Provider                 (software/registry-database/connection-provider.ts)
 *
 * Nothing here is new plumbing — this file only collects real target
 * details interactively and wires them into what already exists.
 *
 * Boundaries (all enforced, not just documented):
 * - Local Postgres (127.0.0.1 / localhost / ::1) is refused outright.
 *   Local stays test/dev-only via scripts/register-local-postgres-credential.ts.
 * - The secret is read via masked terminal input only (stty -echo), the
 *   same pattern register-local-postgres-credential.ts already uses. It is
 *   never printed, logged, or written to any file.
 * - This script must be run directly by a human in their own terminal.
 *   registerOwnerDatabaseCredential()'s own docstring is explicit:
 *   "Owner-only registration boundary... Callers must not forward this
 *   input from an Agent API." No agent, automation, or CI job in this
 *   repo may invoke this file with a real secret — see
 *   software/registry-database/README.md's "No AI login to Supabase".
 * - No migration statement is executed anywhere in this file. Verification
 *   is read-only (current_database/current_user/schema check), delegated
 *   entirely to the existing Connection Provider.
 *
 * On success, registration prints only: credential_ref, target, role,
 * status — never the secret, never a raw connection string.
 */

import * as readline from "node:readline";
import { registerOwnerDatabaseCredential } from "../credentials/macos-keychain/registration";
import { DatabaseCredentialResolver as RegistryCredentialResolver } from "../credentials/registry/database-credential-resolver";
import {
  PostgresRegistryConnectionProvider,
  type DatabaseCredentialResolver as ConnectionCredentialResolver,
} from "../software/registry-database/connection-provider";
import type { KeychainReference, KeychainResolution } from "../credentials/macos-keychain/types";

const SUPABASE_KEYCHAIN_SERVICE = "dna-os-supabase-postgres";
const SUPABASE_KEYCHAIN_ACCOUNT = "owner";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

interface SupabaseTarget {
  host: string;
  port: number;
  database: string;
  role: string;
  schema: string;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (prompt: string): Promise<string> => new Promise((resolve) => rl.question(prompt, resolve));

function assertSafeLine(label: string, value: string): void {
  if (!value || value.includes("\n") || value.includes("\r")) throw new Error(`INVALID_${label}_INPUT`);
}

/**
 * 2026-08-24 (Owner, "Single Process Creation Gate — Consolidation"):
 * this used to shell out to `/bin/sh -c "stty -echo/echo"` to hide
 * terminal input — a real, forbidden `sh -c` invocation. Node's own
 * `readline` interface mutes its own output stream during the question
 * instead — no subprocess.
 */
async function askSecret(prompt: string): Promise<string> {
  const output = process.stdout as unknown as { write(chunk: string): boolean };
  const realWrite = output.write.bind(output);
  process.stdout.write(prompt);
  let muted = true;
  output.write = ((chunk: string) => (muted ? true : realWrite(chunk))) as typeof output.write;
  try {
    return await ask("");
  } finally {
    muted = false;
    output.write = realWrite;
    console.log("");
  }
}

async function collectTarget(): Promise<SupabaseTarget | null> {
  const host = (await ask("Supabase host (e.g. db.<project-ref>.supabase.co, or pooler host): ")).trim();
  if (LOCAL_HOSTS.has(host.toLowerCase())) {
    console.error("REGISTRATION_REFUSED=LOCAL_HOST_NOT_ALLOWED");
    console.error("Local Postgres is test/dev-only — use scripts/register-local-postgres-credential.ts for that. It may never be registered as the software_registry production target.");
    return null;
  }
  assertSafeLine("HOST", host);

  const portRaw = (await ask("Port (5432 direct / 6543 pooler): ")).trim();
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error("REGISTRATION_REFUSED=INVALID_PORT");
    return null;
  }

  const database = (await ask("Database (usually 'postgres'): ")).trim();
  assertSafeLine("DATABASE", database);

  const role = (await ask("Database role to connect as (e.g. registry_writer): ")).trim();
  assertSafeLine("ROLE", role);

  const schemaInput = (await ask("Schema [software_registry]: ")).trim();
  const schema = schemaInput.length > 0 ? schemaInput : "software_registry";
  assertSafeLine("SCHEMA", schema);

  return { host, port, database, role, schema };
}

async function verifyConnection(credential_ref: string, target: SupabaseTarget): Promise<void> {
  const registryResolver = new RegistryCredentialResolver();

  const resolution: KeychainResolution = await registryResolver.resolve(credential_ref);
  if (!resolution.ok) {
    console.error(`VERIFY_CREDENTIAL_RESOLUTION=FAILED code=${resolution.code} reason=${resolution.reason}`);
    return;
  }
  console.log("VERIFY_CREDENTIAL_RESOLUTION=OK");

  // Connection Provider's context field is named `credential_ref` but is
  // typed as a raw KeychainReference, not this script's credential_ref
  // string. This adapter bridges the two so the Connection Provider still
  // performs its own resolve() call, unmodified, through the same
  // registry-backed Credential Resolver used above — no secret is read or
  // held by this script directly.
  const connectionResolver: ConnectionCredentialResolver = {
    resolve: (_reference: KeychainReference) => registryResolver.resolve(credential_ref),
  };
  const provider = new PostgresRegistryConnectionProvider(connectionResolver);

  try {
    const connection = await provider.connect({
      credential_ref: { service: SUPABASE_KEYCHAIN_SERVICE, account: SUPABASE_KEYCHAIN_ACCOUNT, kind: "password" },
      workspace_scope: "software-registry",
      expected_database: target.database,
      expected_role: target.role,
      expected_schema: target.schema,
    });
    console.log(`VERIFY_STATE=${connection.health.state}`);
    console.log(`VERIFY_DATABASE=${connection.health.database}`);
    console.log(`VERIFY_ROLE=${connection.health.role}`);
    console.log(`VERIFY_SCHEMA_EXISTS=${connection.health.schema_exists}`);
    console.log(`VERIFY_CAN_READ_REGISTRY=${connection.health.can_read_registry}`);
    await connection.close();
  } catch (error) {
    console.error(`VERIFY_FAILED=${error instanceof Error ? error.message : "UNKNOWN"}`);
  }
}

async function main(): Promise<void> {
  let credential_ref: string | undefined;
  let target: SupabaseTarget | undefined;
  let verifyNow = false;

  try {
    console.log("DNA OS Supabase PostgreSQL credential registration — software_registry PRODUCTION target");
    console.log("Human-only step. No migration is executed by this script.");
    console.log("");

    const collected = await collectTarget();
    if (!collected) {
      process.exitCode = 1;
      return;
    }
    target = collected;

    const secret = await askSecret("Password (hidden): ");
    if (!secret) {
      console.error("REGISTRATION_REFUSED=EMPTY_SECRET");
      process.exitCode = 1;
      return;
    }

    const result = await registerOwnerDatabaseCredential({
      requester_identity: "scripts/register-supabase-postgres-credential.ts",
      owner: "owner",
      target,
      scope: ["database:connect", "software_registry:read", "software_registry:write"],
      service: SUPABASE_KEYCHAIN_SERVICE,
      account: SUPABASE_KEYCHAIN_ACCOUNT,
      secret,
    });
    credential_ref = result.credential_ref;

    console.log("");
    console.log(`credential_ref: ${credential_ref}`);
    console.log(`target: ${target.host}:${target.port}/${target.database}`);
    console.log(`role: ${target.role}`);
    console.log(`status: ${result.status}`);

    const verifyAnswer = (await ask("\nVerify this connection now via the existing Connection Provider? [y/N]: ")).trim().toLowerCase();
    verifyNow = verifyAnswer === "y" || verifyAnswer === "yes";
  } catch (error) {
    console.error(`REGISTRATION_FAILED=${error instanceof Error ? error.message : "UNKNOWN"}`);
    process.exitCode = 1;
    return;
  } finally {
    rl.close();
  }

  if (!credential_ref || !target) return;

  if (!verifyNow) {
    console.log("Skipped verification. The credential registry is in-memory per process, not persisted — verifying later requires re-running this script.");
    return;
  }

  await verifyConnection(credential_ref, target);
}

void main();
