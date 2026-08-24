/** Reference-only database credential registry.
 * No password, URI, token, or connection material is stored here — only
 * the metadata needed to find a Keychain entry again after a restart.
 *
 * Persistence: append-only JSONL, "latest record per credential_ref wins"
 * — the same convention connections/agent-registry/store.ts and
 * connections/telemetry/store.ts already use elsewhere in this repo. No
 * new database engine, no shared cross-folder utility (this repo's
 * capability folders stay self-contained). A restart re-reads this file
 * fresh; nothing durable ever lives only in an in-process Map.
 *
 * `registerDatabaseCredential`/`findDatabaseCredential`/
 * `listDatabaseCredentials`/`setDatabaseCredentialStatus` are the only
 * write/read surface — this is the credential registration boundary
 * itself, not something callers should reach around via direct file
 * access.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type DatabaseCredentialStatus = "ACTIVE" | "DISABLED" | "REVOKED";

export interface DatabaseCredentialEntry {
  credential_ref: string;
  credential_type: "postgres_database";
  owner: string;
  target: { host: string; port: number; database: string; role: string; schema: string };
  scope: readonly string[];
  status: DatabaseCredentialStatus;
  created_at: string;
  updated_at: string;
  resolver_kind: "macos_keychain";
  resolver_service: string;
  resolver_account: string;
}

/**
 * Canonical credential_ref identity: owner + host + port + database + role.
 * Deterministic (same input always yields the same ref) and collision-safe
 * across hosts/providers — a local Postgres and a Supabase Postgres both
 * named "postgres" no longer produce the same identity, because host and
 * port are now part of it. No password/secret is ever a component.
 */
export function buildDatabaseCredentialRef(input: { owner: string; host: string; port: number; database: string; role: string }): string {
  const parts = [input.owner, input.host, String(input.port), input.database, input.role].map(encodeURIComponent);
  return `credential://postgres/${parts.join("/")}`;
}

export interface DatabaseCredentialReferenceStore {
  registerDatabaseCredential(entry: DatabaseCredentialEntry): void;
  findDatabaseCredential(credential_ref: string): DatabaseCredentialEntry | null;
  listDatabaseCredentials(): readonly DatabaseCredentialEntry[];
  setDatabaseCredentialStatus(credential_ref: string, status: DatabaseCredentialStatus): DatabaseCredentialEntry;
}

const DEFAULT_DATA_DIR_RELATIVE = "credentials/registry/data";
const REFERENCES_FILENAME = "database-credential-references.jsonl";

/**
 * Builds an isolated store rooted at `baseDir` (default: the real
 * credentials/registry/data/ directory under the repo root). The `baseDir`
 * parameter exists solely so tests can point this at a temp directory
 * instead of the real store — production code never passes it.
 */
export function createDatabaseCredentialReferenceStore(
  baseDir: string = join(process.cwd(), DEFAULT_DATA_DIR_RELATIVE),
): DatabaseCredentialReferenceStore {
  const file = join(baseDir, REFERENCES_FILENAME);

  function ensureFile(): void {
    mkdirSync(baseDir, { recursive: true });
    if (!existsSync(file)) writeFileSync(file, "", "utf-8");
  }

  function readAll(): DatabaseCredentialEntry[] {
    ensureFile();
    return readFileSync(file, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as DatabaseCredentialEntry);
  }

  // A restart replays this file fresh, so this is the only read every
  // export below relies on — nothing here depends on process memory.
  function readLatest(): Map<string, DatabaseCredentialEntry> {
    const latest = new Map<string, DatabaseCredentialEntry>();
    for (const record of readAll()) latest.set(record.credential_ref, record);
    return latest;
  }

  // A single appendFileSync call is one write() syscall opened with
  // O_APPEND — atomic with respect to other appends on this file, same
  // guarantee every other JSONL store in this repo already relies on.
  function appendEntry(entry: DatabaseCredentialEntry): void {
    ensureFile();
    appendFileSync(file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  return {
    registerDatabaseCredential(entry) {
      if (!entry.credential_ref.startsWith("credential://")) throw new Error("INVALID_CREDENTIAL_REF");
      if (readLatest().has(entry.credential_ref)) throw new Error("DUPLICATE_CREDENTIAL_REF");
      appendEntry(Object.freeze({ ...entry, scope: [...entry.scope] }));
    },
    findDatabaseCredential(credential_ref) {
      return readLatest().get(credential_ref) ?? null;
    },
    listDatabaseCredentials() {
      return [...readLatest().values()];
    },
    // Revoke/deactivate boundary: appends an updated metadata record so
    // the resolver's next lookup rejects it. Never touches Keychain,
    // never deletes the secret — the only way to remove a Keychain
    // secret is a separate, explicit deletion path, which does not exist
    // in this repo.
    setDatabaseCredentialStatus(credential_ref, status) {
      const current = readLatest().get(credential_ref);
      if (!current) throw new Error("CREDENTIAL_NOT_REGISTERED");
      const updated: DatabaseCredentialEntry = { ...current, status, updated_at: new Date().toISOString() };
      appendEntry(Object.freeze({ ...updated, scope: [...updated.scope] }));
      return updated;
    },
  };
}

const defaultStore = createDatabaseCredentialReferenceStore();

export function registerDatabaseCredential(entry: DatabaseCredentialEntry): void {
  defaultStore.registerDatabaseCredential(entry);
}

export function findDatabaseCredential(credential_ref: string): DatabaseCredentialEntry | null {
  return defaultStore.findDatabaseCredential(credential_ref);
}

export function listDatabaseCredentials(): readonly DatabaseCredentialEntry[] {
  return defaultStore.listDatabaseCredentials();
}

export function setDatabaseCredentialStatus(credential_ref: string, status: DatabaseCredentialStatus): DatabaseCredentialEntry {
  return defaultStore.setDatabaseCredentialStatus(credential_ref, status);
}
