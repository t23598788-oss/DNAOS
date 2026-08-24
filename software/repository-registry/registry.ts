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
import { join } from "node:path";
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
