/**
 * หน้าที่: the missing 4173 → 8790 leg of the loop (see
 * ./finding-event-gap.ts, which this file resolves). Grounded directly
 * in DNA-LAB-FILE-INTELLIGENCE's real `Warning` type
 * (dependency-map/types.ts: `{ type: WarningType; evidence: string[] }`,
 * confirmed 2026-08-17/18, 14 real `WarningType` values, reproduced
 * verbatim below — never re-invented) and its real `FileRecord`
 * structure (a `Warning` always lives inside exactly one `FileRecord`'s
 * `.warnings` array, which is what makes `owner_folder` a provable fact
 * and `files_involved[0]` well-defined — see field docs below).
 *
 * Input: none (pure type definitions).
 * Output: `FindingEvent`, `FindingStatus`, `FindingClassification`,
 * `FindingToWorkRequestMapping`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never populate `capability_id` from anything other
 * than a real, proven match against
 * `software/capability-registrar/types.ts`'s `CapabilityMetadata.OWNER_FOLDER`
 * — a FindingEvent created straight from File Intelligence always has
 * `capability_id: null`, because File Intelligence has zero Circuit
 * knowledge (Capability Folder Law rule 9 — no cross-capability reach-in).
 * Never confuse this file's `FindingClassification` (triage verdict on
 * ONE finding) with File Intelligence's own real `Classification` type
 * (SOURCE/TEST/PROOF/... — a FILE's kind) — same English word, two
 * unrelated real concepts; do not merge them.
 *
 * NOT_YET_BUILT: no runtime creates a `FindingEvent` yet. This file
 * defines the shape only — see RUNTIME_BACKING below.
 */

/** Real, checkable fact: no runtime anywhere emits a `FindingEvent` yet — same pattern as ./worker-event.ts's WORKER_EVENT_RUNTIME_BACKING. */
export const FINDING_EVENT_RUNTIME_BACKING = "NOT_BUILT" as const;

/**
 * Reproduced verbatim from DNA-LAB-FILE-INTELLIGENCE/dependency-map/types.ts
 * (real, confirmed 2026-08-18) — never edited independently of that file.
 * If the real file ever adds/removes a value, this union must be
 * re-verified against it, not guessed.
 */
export type RealFileIntelligenceWarningType =
  | "ORPHAN"
  | "DUPLICATE"
  | "UNTRACKED_SOURCE"
  | "DEAD_REFERENCE"
  | "CROSS_FOLDER_DEPENDENCY"
  | "CROSS_DOMAIN_REFERENCE"
  | "PUBLIC_CONTRACT_BYPASS"
  | "TRANSITIVE_CROSS_DOMAIN_DEPENDENCY"
  | "DIRECT_DATABASE_ACCESS"
  | "HARDCODED_CREDENTIAL"
  | "UNREGISTERED_SOURCE"
  | "REGISTRY_OWNERSHIP_MISMATCH"
  | "MIXED_COMMIT_SCOPE"
  | "SEMANTIC_DUPLICATE_CANDIDATE";

/**
 * Triage verdict on ONE finding — NOT the same concept as File
 * Intelligence's own `Classification` (a file's kind: SOURCE/TEST/...).
 * No real system produces this today; every FindingEvent created
 * straight from a File Intelligence scan starts `"UNKNOWN"` until a
 * later (not-yet-built) triage step sets it.
 */
export type FindingClassification = "REAL_ISSUE" | "EXPECTED_DEPENDENCY" | "TEST_FIXTURE" | "FALSE_POSITIVE" | "UNKNOWN";

/**
 * A dedicated state machine for ONE finding's own lifecycle — distinct
 * from all three state machines in ./state-machine-separation.ts (a
 * finding is upstream of a WorkRequest even existing). `DETECTED` is the
 * only state File Intelligence's real output could ever honestly produce
 * by itself.
 *
 * `EVALUATED` added 2026-08-18 (Owner: "DETECTED -> Evaluation Engine ->
 * EVALUATED") — the real, now-built output of
 * `dna-os-circuit/runtime/finding-evaluator.ts`'s deterministic
 * classifier: a finding whose `classification` has moved off `"UNKNOWN"`
 * via a real, evidence-traceable rule. Kept DISTINCT from `TRIAGED`
 * (still reserved, not yet implemented) — `TRIAGED` is meant for a future
 * HUMAN/manual review decision; `EVALUATED` is specifically the automated
 * classifier's real verdict. Do not conflate the two when `TRIAGED` is
 * eventually implemented.
 */
export type FindingStatus = "DETECTED" | "EVALUATED" | "TRIAGED" | "ROUTABLE" | "BLOCKED" | "RESOLVED";

/**
 * The DECISION verdict — added 2026-08-18 (Owner: "EVALUATED ->
 * DECISION... EVALUATED แค่ตอบว่า 'สิ่งที่ตรวจพบคืออะไรและมีหลักฐาน
 * อะไร' ส่วน DECISION ต้องตอบว่าแล้วระบบตัดสินใจทำอะไรกับ finding
 * นั้น"). A SEPARATE axis from `FindingStatus` — status is the finding's
 * lifecycle position; this is the actual verdict a real decision step
 * reaches, recorded in `dna-os-circuit/runtime/finding-decider.ts`'s
 * durable decision-evidence log (never on the `FindingEvent` record
 * itself this round — no contract-shape change was in scope). Each
 * decision maps to exactly one `FindingStatus` consequence, documented
 * in `finding-decider.ts`'s own real rules: REJECT -> RESOLVED,
 * NEEDS_FIX -> ROUTABLE, FORBIDDEN -> BLOCKED. `ACCEPT` and `FORWARD`
 * are defined here for completeness but UNREACHABLE by today's real
 * evaluator (which only ever produces `REAL_ISSUE`/`TEST_FIXTURE`
 * classifications) — same honest gap as `EXPECTED_DEPENDENCY`/
 * `FALSE_POSITIVE` on `FindingClassification` above.
 */
export type FindingDecisionOutcome = "ACCEPT" | "REJECT" | "NEEDS_FIX" | "FORWARD" | "FORBIDDEN";

export interface FindingEvent {
  /** Synthesized identifier for this finding record — NEW_CONTROL_FIELD, no real source (File Intelligence's own Warning type carries no id at all). */
  finding_id: string;

  /** The only real source system today. Kept as a union with a string escape hatch (matches ./evaluation-result.ts's cost_source pattern) so a second real scanner doesn't require re-editing this type later. */
  source_system: "DNA-LAB-FILE-INTELLIGENCE" | string;

  /**
   * NEW_CONTROL_FIELD, UNPROVABLE today — File Intelligence's real scan
   * output (`reports/latest-summary.json`, `src/cli.ts`) has a
   * `scannedAt` TIMESTAMP but no scan `id` anywhere in the codebase
   * (confirmed 2026-08-18, grep for scanId/scan_id: zero hits). A real
   * scan_id would need either a File Intelligence migration to add one,
   * or synthesis from `scannedAt` + scan root by whatever constructs this
   * event — not decided here, not silently assumed to already exist.
   */
  scan_id: string;

  /** Preserved verbatim from the real Warning.type — never re-labeled. */
  warning_type: RealFileIntelligenceWarningType;

  /** Preserved verbatim from the real Warning.evidence array — never summarized or rewritten. */
  evidence: readonly string[];

  /**
   * The containing folder of the ONE real `FileRecord` this Warning is
   * attached to in File Intelligence's own data model (every Warning
   * lives inside exactly one `FileRecord.warnings[]` — a real, provable
   * structural fact, not an inference). For a multi-file finding (e.g.
   * DUPLICATE, CROSS_FOLDER_DEPENDENCY), this is the OWNING file's
   * folder specifically, not a merge of every folder mentioned in
   * `evidence` — other files referenced are captured in
   * `files_involved`/`evidence`, never claimed as shared ownership.
   */
  owner_folder: string;

  /**
   * `null` unless a real match has been proven against
   * `software/capability-registrar/types.ts`'s
   * `CapabilityMetadata.OWNER_FOLDER`. A FindingEvent built straight from
   * a File Intelligence scan is ALWAYS `null` here — File Intelligence
   * has no Circuit knowledge (per Capability Folder Law rule 9). Setting
   * this to anything else requires a real, separate resolution step that
   * does not exist yet.
   */
  capability_id: string | null;

  /**
   * Minimum real guarantee: contains the owning FileRecord's `relPath`
   * (always real). Additional files mentioned inside free-text `evidence`
   * strings (e.g. semanticDuplicateChecker.ts's "candidate other file:
   * ...") are NOT reliably parsed into this array — doing so would be
   * real parsing/implementation logic, out of scope for a types-only
   * round. Do not assume this array is exhaustive.
   */
  files_involved: readonly string[];

  /**
   * Real at the whole-SCAN granularity only — File Intelligence's real
   * `Warning` type carries no per-warning timestamp; the closest real
   * fact is the containing scan's `scannedAt`. Every FindingEvent from
   * one scan run shares the same real `detected_at` value.
   */
  detected_at: string;

  /**
   * `null` — File Intelligence's real `Warning` type has no severity
   * field at all (a `severity` string exists only inside SANDBOX TEST
   * MANIFEST fixtures, e.g. `expected_severity: "MEDIUM"` in
   * `sandbox/manifests/*.json` — test-fixture metadata, not production
   * scanner output; never conflate the two). A FindingEvent built
   * straight from a real scan is always `null` here until a later
   * severity-scoring step exists.
   */
  severity: string | null;

  /** Starts `"UNKNOWN"` for any FindingEvent built straight from a scan — see `FindingClassification`'s own doc. */
  classification: FindingClassification;

  /** Starts `"DETECTED"` for any FindingEvent built straight from a scan — see `FindingStatus`'s own doc. */
  status: FindingStatus;
}

/**
 * Pure documentation type: what real facts would need to be true before a
 * `FindingEvent` could honestly become a `./work-request.ts` `WorkRequest`.
 * No function implements this — it exists so a future implementer sees
 * every precondition listed in one place instead of discovering them by
 * trial and error. Field-by-field correspondence, not executable logic.
 */
export interface FindingToWorkRequestMapping {
  /** A FindingEvent may only become a WorkRequest once capability_id is proven — see FindingEvent.capability_id's own doc. Converting a null capability_id is exactly the mistake rule 2/3 of this round exist to prevent. */
  precondition_capability_id_is_non_null: true;

  /** Maps 1:1 once proven — WorkRequest.target_owner_folder := FindingEvent.owner_folder (same OWNER_FOLDER convention, see work-request.ts). */
  maps_owner_folder_to_target_owner_folder: true;

  /** Maps 1:1 once proven — WorkRequest.capability := FindingEvent.capability_id. */
  maps_capability_id_to_capability: true;

  /** FindingEvent.evidence + files_involved become the real basis for a WorkRequest's expected_output description — never invented independently of what File Intelligence actually reported. */
  maps_evidence_and_files_involved_to_expected_output_basis: true;

  /** A WorkRequest should only ever be generated from a finding whose triage verdict is REAL_ISSUE — EXPECTED_DEPENDENCY/TEST_FIXTURE/FALSE_POSITIVE must never auto-generate work, and UNKNOWN must be triaged first. */
  precondition_classification_is_real_issue: true;

  /** A WorkRequest should only be generated once status has reached ROUTABLE — DETECTED and TRIAGED are earlier, incomplete stages; BLOCKED/RESOLVED must never (re-)generate a WorkRequest. */
  precondition_status_is_routable: true;

  /** Not yet defined by this round: how allowed_files/forbidden_files on the resulting WorkRequest would be derived from files_involved — flagged as an open question for whichever round actually implements this conversion. */
  open_question_allowed_forbidden_files_derivation: "NOT_DEFINED";
}
