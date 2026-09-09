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
  /**
   * Replace metadata for an existing credential_ref (append-only; latest wins).
   * Used for same-identity OAuth rebind — never creates a second credential:// identity.
   */
  replaceApiCredential(entry: Omit<ApiCredentialEntry, "created_at"> & { created_at?: string }): ApiCredentialEntry;
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
    replaceApiCredential(entry) {
      if (!entry.credential_ref.startsWith("credential://")) throw new Error("INVALID_CREDENTIAL_REF");
      const current = readLatest().get(entry.credential_ref);
      if (!current) throw new Error("CREDENTIAL_NOT_REGISTERED");
      const updated: ApiCredentialEntry = {
        ...current,
        ...entry,
        created_at: current.created_at,
        updated_at: entry.updated_at || new Date().toISOString(),
        scope: [...entry.scope],
      };
      appendEntry(Object.freeze({ ...updated, scope: [...updated.scope] }));
      return updated;
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

export function replaceApiCredential(
  entry: Omit<ApiCredentialEntry, "created_at"> & { created_at?: string },
): ApiCredentialEntry {
  return defaultStore.replaceApiCredential(entry);
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

/* ─────────────────────────────────────────────────────────────────────────
 * FIXTURE SEPARATION (Phase 2, 2026-09-01)
 *
 * `data/api-credential-references.jsonl` เป็น append-only และ **ไฟล์เทสต์
 * เขียนลงไฟล์เดียวกับ production** — `connections/github/
 * keychain-credential-resolution.test.ts` ลงทะเบียน fixture ทุกครั้งที่รัน
 * ผลคือทะเบียนมี 134 แถว แต่เป็นของจริงเพียง 4
 *
 * การนับ "จำนวน credential" ตรง ๆ จากไฟล์นี้จึงให้ตัวเลขที่ผิด 33 เท่า
 * ตัวจำแนกข้างล่างมีไว้ให้ census/รายงานนับได้ถูก โดย **ไม่ลบ fixture**
 *
 * กฎการจำแนกเป็น deterministic และต้องให้ marker ทั้งสามตรงกัน:
 *   1. account            === TEST_FIXTURE_ACCOUNT
 *   2. resolver_service   ขึ้นต้นด้วย TEST_FIXTURE_RESOLVER_PREFIX
 *   3. credential_ref     มี TEST_FIXTURE_REF_MARKER
 *
 * ทั้งสามค่าเป็นค่าคงที่ที่ไฟล์เทสต์ในรีโปนี้เขียนเอง ไม่ใช่การเดาจากชื่อ
 * ตรวจกับข้อมูลจริง 2026-09-01: marker ตรงกันครบ 134/134 แถว ขัดแย้ง 0
 *
 * ถ้าวันใด marker ไม่ตรงกัน แถวนั้นได้ UNCLASSIFIED — ไม่ถูกเดาไปข้างใดข้างหนึ่ง
 * เพราะการเดาผิดด้านหนึ่งคือนับ fixture เป็นของ production
 * และผิดอีกด้านคือซ่อน credential จริงออกจากรายงาน
 * ─────────────────────────────────────────────────────────────────────── */

export type CredentialClassification = "PRODUCTION" | "TEST_FIXTURE" | "UNCLASSIFIED";

/** เขียนโดย connections/github/keychain-credential-resolution.test.ts */
export const TEST_FIXTURE_ACCOUNT = "test-fixture-owner";
export const TEST_FIXTURE_RESOLVER_PREFIX = "dna-os-github-test-";
export const TEST_FIXTURE_REF_MARKER = "/test-fixture-repo";

export function classifyApiCredential(entry: ApiCredentialEntry): CredentialClassification {
  const markers = [
    entry.account === TEST_FIXTURE_ACCOUNT,
    String(entry.resolver_service ?? "").startsWith(TEST_FIXTURE_RESOLVER_PREFIX),
    String(entry.credential_ref ?? "").includes(TEST_FIXTURE_REF_MARKER),
  ];
  if (markers.every((m) => m)) return "TEST_FIXTURE";
  if (markers.every((m) => !m)) return "PRODUCTION";
  return "UNCLASSIFIED";
}

/** credential ที่ระบบใช้งานจริง — ตัวเดียวที่ census/รายงานควรนับ */
export function listProductionApiCredentials(): readonly ApiCredentialEntry[] {
  return defaultStore.listApiCredentials().filter((e) => classifyApiCredential(e) === "PRODUCTION");
}

export function countApiCredentialsByClassification(): {
  readonly PRODUCTION: number; readonly TEST_FIXTURE: number;
  readonly UNCLASSIFIED: number; readonly total: number;
} {
  const all = defaultStore.listApiCredentials();
  const n = (k: CredentialClassification) => all.filter((e) => classifyApiCredential(e) === k).length;
  return { PRODUCTION: n("PRODUCTION"), TEST_FIXTURE: n("TEST_FIXTURE"), UNCLASSIFIED: n("UNCLASSIFIED"), total: all.length };
}
