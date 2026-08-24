/** Reference-only API credential registry — the generic sibling of
 * ./database-credential-registry.ts, for provider API tokens (GitHub PAT
 * today) instead of database connections. No token, secret, or key is
 * stored here — only the metadata needed to find the real Keychain entry
 * again after a restart. Same append-only JSONL, "latest record per
 * credential_ref wins" convention as ./database-credential-registry.ts —
 * reused, not reimplemented differently — and the same discipline: this
 * is the credential registration boundary itself, never something a
 * caller reaches around via direct file access.
 *
 * Input: `ApiCredentialEntry` (metadata only).
 * Output: `registerApiCredential`, `findApiCredential`,
 * `listApiCredentials`, `setApiCredentialStatus`.
 * Dependency ที่อนุญาต: none (pure file I/O + types).
 * สิ่งที่ห้ามแตะ: never add a field here that could hold a secret value —
 * `credential_ref` is a logical identity string
 * (`credential://<provider>/...`), `resolver_service`/`resolver_account`
 * name a Keychain entry, neither ever carries the secret itself.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ApiCredentialStatus = "ACTIVE" | "DISABLED" | "REVOKED";

export interface ApiCredentialEntry {
  credential_ref: string;
  provider: string;
  /** The real-world account/owner this credential authenticates as (e.g. a GitHub username/org) — identity only, never a secret. */
  account: string;
  scope: readonly string[];
  status: ApiCredentialStatus;
  created_at: string;
  updated_at: string;
  resolver_kind: "macos_keychain";
  resolver_service: string;
  resolver_account: string;
}

export interface ApiCredentialReferenceStore {
  registerApiCredential(entry: ApiCredentialEntry): void;
  findApiCredential(credential_ref: string): ApiCredentialEntry | null;
  listApiCredentials(): readonly ApiCredentialEntry[];
  setApiCredentialStatus(credential_ref: string, status: ApiCredentialStatus): ApiCredentialEntry;
}

const DEFAULT_DATA_DIR_RELATIVE = "credentials/registry/data";
const REFERENCES_FILENAME = "api-credential-references.jsonl";

/**
 * Builds an isolated store rooted at `baseDir` (default: the real
 * credentials/registry/data/ directory under the repo root) — same
 * pattern as ./database-credential-registry.ts's
 * createDatabaseCredentialReferenceStore. The `baseDir` parameter exists
 * solely so tests can point this at a temp directory; production code
 * never passes it.
 */
export function createApiCredentialReferenceStore(
  baseDir: string = join(process.cwd(), DEFAULT_DATA_DIR_RELATIVE),
): ApiCredentialReferenceStore {
  const file = join(baseDir, REFERENCES_FILENAME);

  function ensureFile(): void {
    mkdirSync(baseDir, { recursive: true });
    if (!existsSync(file)) writeFileSync(file, "", "utf-8");
  }

  function readAll(): ApiCredentialEntry[] {
    ensureFile();
    return readFileSync(file, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ApiCredentialEntry);
  }

  function readLatest(): Map<string, ApiCredentialEntry> {
    const latest = new Map<string, ApiCredentialEntry>();
    for (const record of readAll()) latest.set(record.credential_ref, record);
    return latest;
  }

  function appendEntry(entry: ApiCredentialEntry): void {
    ensureFile();
    appendFileSync(file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  return {
    registerApiCredential(entry) {
      if (!entry.credential_ref.startsWith("credential://")) throw new Error("INVALID_CREDENTIAL_REF");
      if (readLatest().has(entry.credential_ref)) throw new Error("DUPLICATE_CREDENTIAL_REF");
      appendEntry(Object.freeze({ ...entry, scope: [...entry.scope] }));
    },
    findApiCredential(credential_ref) {
      return readLatest().get(credential_ref) ?? null;
    },
    listApiCredentials() {
      return [...readLatest().values()];
    },
    setApiCredentialStatus(credential_ref, status) {
      const current = readLatest().get(credential_ref);
      if (!current) throw new Error("CREDENTIAL_NOT_REGISTERED");
      const updated: ApiCredentialEntry = { ...current, status, updated_at: new Date().toISOString() };
      appendEntry(Object.freeze({ ...updated, scope: [...updated.scope] }));
      return updated;
    },
  };
}

const defaultStore = createApiCredentialReferenceStore();

export function registerApiCredential(entry: ApiCredentialEntry): void {
  defaultStore.registerApiCredential(entry);
}

export function findApiCredential(credential_ref: string): ApiCredentialEntry | null {
  return defaultStore.findApiCredential(credential_ref);
}

export function listApiCredentials(): readonly ApiCredentialEntry[] {
  return defaultStore.listApiCredentials();
}

export function setApiCredentialStatus(credential_ref: string, status: ApiCredentialStatus): ApiCredentialEntry {
  return defaultStore.setApiCredentialStatus(credential_ref, status);
}
