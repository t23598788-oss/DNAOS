/**
 * หน้าที่: the type contracts for the Repository Registry — one owner for
 * `RepositoryRegistration` register/read/list/suspend. Fills the
 * boundary this folder's own README already reserved (2026-08-14),
 * naming `dna-os-deadboard`/`DNA-OS-INFRASTRUCTURE` as intended entries.
 *
 * Input: none (pure type definitions).
 * Output: `RepositoryStatus`, `RepositoryRegistration`,
 * `RegisterRepositoryInput`.
 * Dependency ที่อนุญาต: none — leaf contract.
 * สิ่งที่ห้ามแตะ: never add `allowed_capability_class`/
 * `forbidden_asset_class`-style fields here without a real, current
 * consumer — G-ARCH-002. Never store a credential here — see
 * `connection_id` (a reference to `connections/connection-registry/`'s
 * own record, never a token itself).
 */

export type RepositoryStatus = "ACTIVE" | "SUSPENDED" | "RETIRED";

export interface RepositoryRegistration {
  repository_id: string;
  owner: string;
  repository: string;
  /** The real, canonical world/boundary tag this repo belongs to — a plain string reference (same discipline as `resources.resource_type`, which has no DB-level enum either), never a caller-invented guess: derived only from real evidence at registration time. */
  world: string;
  /** The real git remote URL, discovered live — never invented. */
  source_authority: string;
  default_branch: string;
  /** The real local filesystem path this registration was discovered from, if any — a repository registered from real evidence always has one. */
  repository_root: string;
  /** A real, already-registered connections/connection-registry/ connection_id, if one exists for this repo — never fabricated, null when none does. */
  connection_id: string | null;
  status: RepositoryStatus;
  registered_at: string;
}

export interface RegisterRepositoryInput {
  owner: string;
  repository: string;
  world: string;
  source_authority: string;
  default_branch: string;
  repository_root: string;
  connection_id?: string | null;
}
