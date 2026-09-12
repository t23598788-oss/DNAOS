/**
 * หน้าที่: the one real, persistent write/read path for
 * `RepositoryRegistration` — REGISTER/LOOKUP/LIST/SUSPEND. Same real
 * durability convention as `connections/connection-registry/registry.ts`
 * and `credentials/registry/*.ts`: append-only JSONL, "latest record per
 * repository_id wins," a restart re-reads this file fresh — nothing
 * durable ever lives only in an in-process Map.
 *
 * `buildRepositoryId()` is deterministic (same discipline as
 * `connections/connection-registry/registry.ts`'s `buildConnectionId`) —
 * re-registering the identical `owner`/`repository` is idempotent, never
 * a duplicate row.
 *
 * Input: `RegisterRepositoryInput`, a `repository_id` (get/suspend).
 * Output: `buildRepositoryId`, `registerRepository`, `getRepository`,
 * `listRepositories`, `suspendRepository`.
 * Dependency ที่อนุญาต: node:fs, node:path, ./types.ts.
 * สิ่งที่ห้ามแตะ: never accept or persist a credential value — only
 * `connection_id` (a reference) ever appears here. Never write directly
 * to this file's data file from outside this module — ./contract.ts's
 * exported functions are the only boundary.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RegisterRepositoryInput, RepositoryRegistration } from "./types";

const DEFAULT_DATA_DIR_RELATIVE = "software/repository-registry/data";
const REPOSITORIES_FILENAME = "repositories.jsonl";

/** Deterministic — the same real owner/repository always produces the same repository_id, so re-registering the same real repo is idempotent, never a duplicate row. */
export function buildRepositoryId(owner: string, repository: string): string {
  return `repository://${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
}

export interface RepositoryRegistryStore {
  registerRepository(input: RegisterRepositoryInput): { registration: RepositoryRegistration; inserted: boolean };
  getRepository(repositoryId: string): RepositoryRegistration | null;
  listRepositories(): readonly RepositoryRegistration[];
  suspendRepository(repositoryId: string): RepositoryRegistration | null;
  /**
   * Replacement-environment rebind of checkout path / connection_id.
   * Append-only; never copies secrets. Used after canonical git clone so
   * cloned machine-local repository_root values are not treated as authority.
   */
  rebindRepositoryCheckout(repositoryId: string, input: { repository_root: string; connection_id?: string | null }): RepositoryRegistration | null;
}

function readAll(path: string): RepositoryRegistration[] {
  if (!existsSync(path)) return [];
  const latest = new Map<string, RepositoryRegistration>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as RepositoryRegistration;
      latest.set(row.repository_id, row);
    } catch {
      // ignore malformed history, same discipline as connection-registry
    }
  }
  return [...latest.values()];
}

export function createRepositoryRegistryStore(dataDir: string = join(process.cwd(), DEFAULT_DATA_DIR_RELATIVE)): RepositoryRegistryStore {
  const path = join(dataDir, REPOSITORIES_FILENAME);
  const append = (row: RepositoryRegistration) => {
    mkdirSync(dataDir, { recursive: true });
    appendFileSync(path, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  };

  return {
    registerRepository(input) {
      const repository_id = buildRepositoryId(input.owner, input.repository);
      const existing = readAll(path).find((r) => r.repository_id === repository_id);
      if (existing) return { registration: existing, inserted: false };
      const registration: RepositoryRegistration = {
        repository_id,
        owner: input.owner,
        repository: input.repository,
        world: input.world,
        source_authority: input.source_authority,
        default_branch: input.default_branch,
        repository_root: input.repository_root,
        connection_id: input.connection_id ?? null,
        status: "ACTIVE",
        registered_at: new Date().toISOString(),
      };
      append(registration);
      return { registration, inserted: true };
    },
    getRepository(repositoryId) {
      return readAll(path).find((r) => r.repository_id === repositoryId) ?? null;
    },
    listRepositories() {
      return readAll(path);
    },
    suspendRepository(repositoryId) {
      const existing = readAll(path).find((r) => r.repository_id === repositoryId);
      if (!existing) return null;
      const updated: RepositoryRegistration = { ...existing, status: "SUSPENDED" };
      append(updated);
      return updated;
    },
    rebindRepositoryCheckout(repositoryId, input) {
      const existing = readAll(path).find((r) => r.repository_id === repositoryId);
      if (!existing || existing.status !== "ACTIVE") return null;
      const updated: RepositoryRegistration = {
        ...existing,
        repository_root: input.repository_root,
        connection_id: input.connection_id === undefined ? existing.connection_id : input.connection_id,
        registered_at: new Date().toISOString(),
      };
      append(updated);
      return updated;
    },
  };
}

// A single, real, process-wide store — same convention as connections/connection-registry/registry.ts's own default instance.
const defaultStore = createRepositoryRegistryStore();

export function registerRepository(input: RegisterRepositoryInput): { registration: RepositoryRegistration; inserted: boolean } {
  return defaultStore.registerRepository(input);
}
export function getRepository(repositoryId: string): RepositoryRegistration | null {
  return defaultStore.getRepository(repositoryId);
}
export function listRepositories(): readonly RepositoryRegistration[] {
  return defaultStore.listRepositories();
}
export function suspendRepository(repositoryId: string): RepositoryRegistration | null {
  return defaultStore.suspendRepository(repositoryId);
}
export function rebindRepositoryCheckout(repositoryId: string, input: { repository_root: string; connection_id?: string | null }): RepositoryRegistration | null {
  return defaultStore.rebindRepositoryCheckout(repositoryId, input);
}

/* ─────────────────────────────────────────────────────────────────────────
 * CENSUS CLASSIFICATION (2026-09-01)
 *
 * `data/repositories.jsonl` เป็น append-only และ **ไฟล์เทสต์เขียนลงไฟล์เดียว
 * กับ production** — repository-registry.test.ts, agent-production-ingress,
 * canonical-flow-trace, repository-resolution และอื่น ๆ ลงทะเบียน fixture
 * ทุกครั้งที่รัน ผลคือทะเบียนมี 119 แถวแต่เป็นของจริงเพียง 2
 *
 * ตัวจำแนกนี้มีไว้ให้ census/รายงานนับได้ถูก โดย **ไม่ลบ fixture**
 * กฎเป็น deterministic และต้องให้ marker สองตัวที่อิสระต่อกันตรงกัน:
 *   1. owner ตรงกับรูปแบบที่ไฟล์เทสต์ในรีโปนี้เขียนเอง
 *   2. repository_root ชี้ไป sandbox/tmp (ไม่ใช่ checkout จริงบนเครื่อง)
 * ตรวจกับข้อมูลจริง 2026-09-01: marker ตรงกันครบ 119/119 ขัดแย้ง 0
 *
 * marker ขัดกัน = UNCLASSIFIED ไม่เดาไปข้างใดข้างหนึ่ง
 * ─────────────────────────────────────────────────────────────────────── */

export type RepositoryClassification = "OPERATIONAL" | "TEST_FIXTURE" | "UNCLASSIFIED";

/** owner ที่ไฟล์เทสต์ในรีโปนี้ใช้ — ค่าคงที่ ไม่ใช่การเดาจากชื่อ */
export const FIXTURE_OWNER_EXACT: readonly string[] = ["test-owner", "debug-owner"];
export const FIXTURE_OWNER_PREFIXES: readonly string[] = ["repo-res-owner-", "canonical-flow-owner-"];
const SANDBOX_ROOT = /__sandbox__|^\/tmp\/|\/T\//;

export function classifyRepository(entry: { owner: string; repository_root: string }): RepositoryClassification {
  const ownerIsFixture =
    FIXTURE_OWNER_EXACT.includes(entry.owner) ||
    FIXTURE_OWNER_PREFIXES.some((p) => entry.owner.startsWith(p));
  const rootIsSandbox = SANDBOX_ROOT.test(String(entry.repository_root ?? ""));
  if (ownerIsFixture && rootIsSandbox) return "TEST_FIXTURE";
  if (!ownerIsFixture && !rootIsSandbox) return "OPERATIONAL";
  return "UNCLASSIFIED";
}

/** repository ที่ระบบใช้งานจริง — ตัวเดียวที่ census ควรนับ */
export function listOperationalRepositories(): readonly RepositoryRegistration[] {
  return listRepositories().filter((r) => classifyRepository(r) === "OPERATIONAL");
}

export interface CheckoutResolutionDeps {
  readonly lookup: {
    getRepository(repositoryId: string): RepositoryRegistration | null;
    listOperationalRepositories(): readonly RepositoryRegistration[];
  };
  readonly host: {
    cwd(): string;
    exists(path: string): boolean;
  };
}

let checkoutResolutionForTests: CheckoutResolutionDeps | undefined;

export function setCheckoutResolutionForTests(
  deps: CheckoutResolutionDeps | undefined
): void {
  checkoutResolutionForTests = deps;
}

/**
 * Resolve exactly one ACTIVE CONTROL_PLANE checkout for this node.
 *
 * Registered repository_root is preferred when it exists locally.
 * A stale machine-local path never grants authority by itself.
 * If the registered path is stale, the current git checkout may represent
 * the same node-local checkout. Otherwise fail closed.
 */
export function resolveControlPlaneCheckout(): RepositoryRegistration | null {
  const deps: CheckoutResolutionDeps = checkoutResolutionForTests ?? {
    lookup: {
      getRepository,
      listOperationalRepositories,
    },
    host: {
      cwd: () => process.cwd(),
      exists: existsSync,
    },
  };

  const matches = deps.lookup.listOperationalRepositories().filter(
    (r) => r.status === "ACTIVE" && r.world === "CONTROL_PLANE"
  );

  if (matches.length !== 1) return null;

  const candidate =
    deps.lookup.getRepository(matches[0].repository_id) ?? matches[0];

  const registeredRoot = resolve(candidate.repository_root);
  if (deps.host.exists(registeredRoot)) {
    return { ...candidate, repository_root: registeredRoot };
  }

  const localRoot = resolve(deps.host.cwd());
  if (!deps.host.exists(join(localRoot, ".git"))) return null;

  return { ...candidate, repository_root: localRoot };
}

export function countRepositoriesByClassification(): {
  readonly OPERATIONAL: number; readonly TEST_FIXTURE: number;
  readonly UNCLASSIFIED: number; readonly total: number;
} {
  const all = listRepositories();
  const n = (k: RepositoryClassification) => all.filter((r) => classifyRepository(r) === k).length;
  return { OPERATIONAL: n("OPERATIONAL"), TEST_FIXTURE: n("TEST_FIXTURE"), UNCLASSIFIED: n("UNCLASSIFIED"), total: all.length };
}
