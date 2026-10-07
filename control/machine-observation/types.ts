/**
 * หน้าที่: type contracts for `control/machine-observation/` — what this Mac
 * can be OBSERVED to be doing, and nothing beyond it (Owner, 2026-08-26).
 *
 * THIS LAYER DOES NOT DECIDE ANYTHING. There is no interrupt, no pause, no
 * command and no policy type in this file, and none may be added: observation
 * that can also act stops being observation. It emits contexts; a controller
 * elsewhere decides what to do with them.
 *
 * EVERY RELATIONSHIP CARRIES ITS OS EVIDENCE. `ObservedRelationship.evidence`
 * names the command and the field the fact came out of (`lsof -p <pid> ftxt`,
 * `ps ppid`). A relationship with no evidence cannot be constructed — there is
 * no code path that produces one.
 *
 * A PROCESS NAME IS NOT EVIDENCE. `executable` is the mapped binary `lsof`
 * reported, never the `comm` string; ownership of an application is decided by
 * the real bundle path that binary sits in. "It is called Code, so it is VS
 * Code" is exactly the inference this file exists to prevent.
 *
 * Input: none (pure type definitions).
 * Output: `ProcessObservation`, `ObservedRelationship`, `CorrelationVerdict`,
 * `MeaningRecord`, `SoftwareTopology`.
 * Dependency ที่อนุญาต: ../realtime-change/contract.ts (ChangeEvent type only).
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่ม type ที่สั่งงาน/หยุด agent ลงในไฟล์นี้.
 * - ห้ามให้ relationship ใดไม่มี evidence.
 * - ห้ามให้ `POSSIBLY_RELATED` ถูกเก็บในฟิลด์เดียวกับ `PROVEN` — ต้องแยกให้เห็นว่า
 *   อันไหนพิสูจน์แล้ว อันไหนแค่ใกล้เคียง.
 */

/** Exactly what `ps` and `lsof` reported for one live process. */
export interface ProcessObservation {
  pid: number;
  ppid: number;
  user: string;
  started_at: string;
  /** From `ps args` — the command line as the kernel holds it. */
  argv: string;
  /** From `lsof ftxt` — the mapped binary. NEVER the `comm` label. `null` when lsof could not read it. */
  executable: string | null;
  /** From `lsof fcwd`. */
  cwd: string | null;
  open_files: readonly string[];
  open_sockets: readonly { fd: string; type: string; name: string }[];
  listening_ports: readonly string[];
  /** The interpreter/runtime binary this process maps, when one is observable. */
  runtime: string | null;
  /** What could not be read, and why — an empty list means everything above was observed. */
  unknown: readonly string[];
}

export type RelationshipKind =
  | "EXECUTES"
  | "CHILD_OF"
  | "WORKING_DIRECTORY"
  | "HOLDS_OPEN"
  | "LISTENS_ON"
  | "USES_RUNTIME"
  | "BUNDLES"
  | "SPAWNS"
  | "WORKS_IN"
  | "RESOLVES_TO"
  | "IMPLEMENTS"
  | "REFERENCED_BY";

/** One directed, evidenced fact. There is no undirected relationship type here. */
export interface ObservedRelationship {
  from: string;
  kind: RelationshipKind;
  to: string;
  /** The command and field this came from, e.g. `lsof -p 656 -Fpftn (ftxt)`. */
  evidence: readonly string[];
  observed_at: string;
}

/**
 * How strongly a filesystem change is tied to a process. `PROVEN` requires the
 * process to hold the file open or to have it inside its cwd AND to have been
 * alive across the observation. Anything weaker stays weaker.
 */
export type CorrelationVerdict = "PROVEN" | "POSSIBLY_RELATED" | "UNKNOWN";

export interface CorrelationCandidate {
  event_id: string;
  path: string;
  pid: number | null;
  verdict: CorrelationVerdict;
  /** Why this verdict and not a stronger one. */
  reason: string;
  evidence: readonly string[];
}

export interface MeaningRecord {
  meaning_type: "RESOURCE_IDENTITY" | "CAPABILITY_RELATION" | "SOFTWARE_RELATION" | "RUNTIME_RELATION" | "DOCUMENT_RELATION" | "STATE" | "UNKNOWN";
  resource_id: string | null;
  source: string;
  /** The concrete proof. A meaning with no proof is recorded as UNKNOWN, never dropped and never asserted. */
  proof: readonly string[];
  observed_at: string;
  /** Which code derived it — never a model. */
  derived_by: string;
}

export interface SoftwareTopology {
  application: string | null;
  application_evidence: readonly string[];
  processes: readonly ProcessObservation[];
  relationships: readonly ObservedRelationship[];
  unknown: readonly string[];
}
