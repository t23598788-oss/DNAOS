/**
 * หน้าที่: the type contracts for `control/system-reference-resolution/` —
 * pure types, no behavior. See `../../governance/architecture-rules/
 * CAPABILITY_FOLDER_LAW.md` ข้อ 9 — this file is imported only via
 * `./contract.ts`.
 *
 * Input: none (pure type definitions).
 * Output: `SystemReferenceRequest`, `SystemReferenceContext`,
 * `SystemReferenceSource`, `SystemReferenceMatch`,
 * `SystemReferenceResolution`.
 * Dependency ที่อนุญาต: ../../software/registry-database/contract.ts
 * (type only), ../../software/repository-registry/contract.ts (type
 * only).
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller pre-supply
 * `status`/`match` — every field here is only ever produced by
 * `./resolver.ts` actually querying the real registries.
 */

import type { RegistryStore } from "../../software/registry-database/contract";

export interface SystemReferenceRequest {
  /** Free-form intent verb, e.g. "OPEN" | "CHECK" | "STATUS" — not a closed enum; the resolver does not branch on it beyond deciding whether an OS-UI open action applies. */
  request: string;
  /** Plain Owner-facing name, e.g. "DNA_LAB", "dna-os", "github" — never a pre-resolved id. */
  target: string;
}

/**
 * Only `registryStore` needs external injection — same "context
 * consumed, never looked up" discipline as
 * `permissions/write-gate/types.ts`'s `WriteGateContext`, since
 * `software/registry-database/`'s `findCapability` takes an explicit
 * store rather than owning a process-wide singleton. `listCapabilities()`
 * (command-router) and `listRepositories()` (repository-registry) are
 * NOT threaded through here — both already own their own real,
 * process-wide default store internally (same convention
 * `connections/connection-registry/registry.ts` documents for itself),
 * so there is nothing for a caller to inject for those two.
 */
export interface SystemReferenceContext {
  registryStore: RegistryStore;
}

export type SystemReferenceSource = "COMMAND_ROUTER_CAPABILITY" | "REGISTRY_DATABASE_CAPABILITY" | "REPOSITORY_REGISTRY" | "OS_UI_TARGET";

export type SystemReferenceStatus = "RESOLVED" | "AMBIGUOUS" | "UNRESOLVED";

/**
 * One real match, naming which existing registry answered. Every *_ref/
 * *_id field points at an id that already exists in its own registry —
 * this type never carries a value invented here. `api_ref`/`runtime_ref`/
 * `host_ref`/`port_ref` stay `null` on every match today — no
 * authoritative registry exists yet for any of the four (see
 * ../../reports/SYSTEM_ADDRESSABILITY_REPORT.md §PHASE_1) — reported
 * honestly, never fabricated.
 */
export interface SystemReferenceMatch {
  source: SystemReferenceSource;
  entity_id: string;
  capability_id: string | null;
  resource_id: string | null;
  repository_id: string | null;
  ui_ref: string | null;
  api_ref: string | null;
  runtime_ref: string | null;
  host_ref: string | null;
  port_ref: string | null;
  /** Only set when the matched entity has a real, existing action this pipeline can execute for the requested verb — e.g. "connections/os-ui#openOsUi" when the match is an OS_UI_TARGET and request is an open-like verb. Never a made-up action name. */
  action_ref: string | null;
  evidence_refs: readonly string[];
}

export interface SystemReferenceResolution {
  status: SystemReferenceStatus;
  request: string;
  target: string;
  /** Set only when status === "RESOLVED". */
  match: SystemReferenceMatch | null;
  /** Set (length > 1) only when status === "AMBIGUOUS" — every real candidate, so the caller can see exactly what collided. Empty otherwise. */
  candidates: readonly SystemReferenceMatch[];
  reason_code: string;
}
