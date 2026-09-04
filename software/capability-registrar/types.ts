/**
 * หน้าที่: the type contracts for `software/capability-registrar/` —
 * Step 1 only (Owner, 2026-08-17): pure types, no behavior. This is the
 * canonical shape a future discovery pipeline will fill in from real,
 * verified source evidence (File Intelligence scan reports, real
 * `capability-registry.ts` entries, real test-run logs) — never from
 * chat memory, never invented.
 *
 * Design lineage: mirrors and tightens
 * `control/command-router/current-capability-map.json`'s existing
 * (informal, hand-typed, already-stale) inventory schema, adding the two
 * fields that file lacks entirely — `PARENT_CAPABILITY` and
 * `EVIDENCE_SOURCE` — which are what make Circuit attachment and the
 * "never mark VERIFIED from source existence alone" rule mechanically
 * checkable instead of a matter of author discipline.
 *
 * Input: none (pure type definitions).
 * Output: `CapabilityStatus`, `CapabilityMetadata`.
 * Dependency ที่อนุญาต: none — a leaf contract, same discipline as
 * `contracts/identity/envelope-identity.ts` ("sit at the bottom of the
 * dependency graph").
 * สิ่งที่ห้ามแตะ: no discovery/scanning function, no Circuit-writing
 * function, no capability-registry.ts-writing function, no parent-
 * inference function — this file is data shape only. Never add a field
 * that lets `PARENT_CAPABILITY` be set without `EVIDENCE_SOURCE`
 * justifying it (see this file's own field doc below) — that pairing is
 * what stops a future implementation from inventing a parent node.
 *
 * NOT_YET_BUILT: no discovery logic, no File Intelligence wiring, no
 * circuit.json/capability-registry.ts writer, no parent-resolution
 * implementation — all deferred to later, separately Owner-approved
 * rounds. This folder produces and validates `CapabilityMetadata`
 * records; it does not yet produce any.
 */

/**
 * Evidence-based status progression. Deliberately NOT a simple boolean or
 * three-value enum — matches this repo's existing no-silent-failure
 * discipline (`contracts/command/capability-result.ts`,
 * `contracts/command/routing-result.ts`). `FAILED`, `BLOCKED`, and
 * `UNASSIGNED` are three DISTINCT non-success facts, never collapsed into
 * one generic "not working" — a policy stop (BLOCKED), a genuine error
 * (FAILED), and "no proven parent" (UNASSIGNED) each demand a different
 * next action from whoever reads this record.
 */
export type CapabilityStatus =
  | "NOT_BUILT" // folder exists with no real source (e.g. README-only) — see current-capability-map.json's many SOURCE_ONLY/no-source-file entries for real examples of this state
  | "BUILT" // real source + passing tests exist, but no capability-registry.ts entry yet
  | "REGISTERED" // a real capability-registry.ts entry exists
  | "CONNECTED" // capability-registry.ts's own endpoint.kind is "adapter" or "contract" — the router can actually invoke it, not just list it
  | "RUNNING" // a real invocation actually happened (network call made, process spawned, etc.) — not merely "could happen"
  | "VERIFIED" // a real invocation SUCCEEDED with real authenticated/real data — never inferred from source existing, must trace to a real run's evidence
  | "FAILED" // a real verification attempt genuinely errored
  | "BLOCKED" // real code exists and a real attempt was made, but a NAMED real external gap prevents success (e.g. no real credential exists yet)
  | "UNASSIGNED"; // PARENT_CAPABILITY could not be proven — sits outside the Circuit tree, never force-attached to an arbitrary branch

/**
 * One capability's canonical registration record. Every field is meant to
 * be filled from a real, checkable fact — `EVIDENCE_SOURCE` exists so
 * every other field can be traced back to where that fact came from,
 * rather than trusted on the strength of the record alone.
 */
export interface CapabilityMetadata {
  /** Stable id for the software/capability, e.g. "digitalocean" — matches the convention already used as the key in control/command-router/capability-registry.ts. */
  SOFTWARE_ID: string;

  /** The ONE real repo-relative folder this capability lives in, e.g. "connections/digitalocean/" — must be a single, unambiguous folder per governance/architecture-rules/CAPABILITY_FOLDER_LAW.md rule 7 ("Capability หนึ่ง = หนึ่งหน่วยที่ดำเนินการได้ครบทุกอย่างในตัวเอง"). */
  OWNER_FOLDER: string;

  /** May differ from SOFTWARE_ID when one module exposes more than one distinct capability. Equal to SOFTWARE_ID for the common case of one folder = one capability. */
  CAPABILITY_ID: string;

  /**
   * A real, existing dna-os-circuit node id this capability attaches
   * under, or `null`. `null` MUST pair with `STATUS: "UNASSIGNED"` — a
   * future implementation must never fill this field with a guessed or
   * architecturally-plausible-but-unproven node id (see the discovery
   * round's own self-correction: EXECUTION was an unproven placement for
   * the DigitalOcean branch; COMMAND_ROUTER — provable via a real
   * capability-registry.ts entry — was the correct stricter answer).
   */
  PARENT_CAPABILITY: string | null;

  /** Real intents/commands this capability answers, e.g. its own adapter-contract.ts's exported intent constants — never invented, never a paraphrase. */
  INGRESS: readonly string[];

  /** Real external endpoints/systems this capability calls, e.g. sourced from a provider's own definition/actions.json (see providers/digitalocean/definition/actions.json) for a provider connector — never hand-typed from memory. */
  EGRESS: readonly string[];

  /** Repo-relative path to the real contract file (a "contract.ts" or "adapter-contract.ts") this capability publicly exposes — must resolve to a real file on disk. */
  CONTRACT: string;

  /** The real exported function name actually callable as this capability's entry point, or `null` when no real function exists yet, or when a real function exists but its signature does not match the router's calling convention (e.g. requires injected dependencies the router cannot supply — connections/digitalocean/'s current, honest state). */
  RUNTIME_ENTRY: string | null;

  /** What kind of data this capability touches, in the capability's own contract's own stated terms, e.g. "read-only metadata, no business content" — never inferred, always quoting/summarizing the real contract file's own scope statement. */
  DATA_CLASS: string;

  /** Matches control/command-router/types.ts's own PermissionRequirement union today ("none" | "execution-policy") — kept as a plain string here rather than importing that type, since software/capability-registrar/ has no dependency on control/command-router/ (Step 1 scope: types only, no wiring). */
  REQUIRED_PERMISSION: string;

  /** Reference to where this capability's credential requirement is defined, e.g. "credentials/provider-accounts/digitalocean/" — or `null` for a capability that needs no external credential. Never a credential VALUE, never a secret, never a token — reference only, same discipline as credentials/provider-accounts/digitalocean/credential-reference.ts's VaultReference. */
  REQUIRED_CREDENTIAL: string | null;

  /** The real external host/system this capability ultimately reaches, e.g. "api.digitalocean.com" — sourced from the capability's own provider definition (api_hosts), never invented. */
  DESTINATION: string;

  /**
   * Every fact above must trace to one or more entries here — file paths,
   * test-run logs, or live-call evidence records (e.g. a
   * CapabilityResultEvidence[] trail). This is what makes "never mark
   * VERIFIED from source existence alone" mechanically enforceable: a
   * `STATUS: "VERIFIED"` record with no test-run/live-call evidence
   * entry — only file paths — is definitionally incomplete.
   */
  EVIDENCE_SOURCE: readonly string[];

  STATUS: CapabilityStatus;
}

/**
 * รูปทรงของ "capability ที่เส้นทางคำสั่งลงทะเบียนไว้" ที่ผู้เรียกส่งเข้ามา
 *
 * ประกาศไว้ที่นี่โดยตั้งใจ ไม่ import จาก control/command-router — ตัวตัดสินสิทธิ์
 * ต้องไม่พึ่งพา implementation ของสิ่งที่มันตัดสิน มิฉะนั้นแยกออกจากกันไม่ได้
 * และเคยเกิด module-load cycle จริงมาแล้วจากการพึ่งพาทิศนั้น
 *
 * เป็นสัญญาเชิงโครงสร้าง: ผู้เรียกส่งอะไรก็ได้ที่มีรูปนี้
 */
export interface RoutableCapabilityRegistration {
  readonly capability_id: string;
  readonly repo_id: string;
  readonly contract: string;
  readonly endpoint: { readonly kind: string; readonly module?: string; readonly entry?: string; readonly url?: string };
  readonly supported_commands: readonly string[];
  readonly permission_requirement: string;
  readonly health_status: string;
}
