/**
 * หน้าที่: type contracts for `control/owner-command-semantics/` — the layer
 * that sits between `../owner-command/`'s `submitOwnerCommand` and
 * `../entry-context/`'s `resolveEntryContext` (Owner, 2026-08-26).
 *
 * THE ONE RULE THIS FILE ENCODES: the model may say what the Owner's words
 * seem to refer to; only the deterministic resolver may say what they ARE.
 * That is why `AiSemanticInterpretation` has no id field of any kind — no
 * `resource_id`, no `capability_id`, no `task_id`. It carries TEXT
 * (`target_text`, `entity_mentions`, `resource_reference`,
 * `capability_reference`) and nothing that could be mistaken for a verified
 * reference. An id can only appear on a `ResolvedReference`, and only with the
 * evidence that produced it.
 *
 * Input: none (pure type definitions).
 * Output: `AiSemanticInterpretation`, `ResolvedReference`,
 * `StructuredOwnerContext`, `Provenance`, `ResolutionStatus`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่มฟิลด์ id ใดๆ ลงใน `AiSemanticInterpretation` — that is the whole
 *   boundary this file exists to hold.
 * - ห้ามลบ `raw_text` หรือเขียนทับมัน — the Owner's original words survive
 *   every layer unchanged, so any interpretation can always be checked against
 *   what was actually said.
 * - ห้ามรวม `ai` กับ `resolved` เป็นก้อนเดียว — a reader must always be able to
 *   tell a guess from a proof.
 */

/** Where one field's value actually came from. Recorded per resolved reference, never assumed. */
export type Provenance =
  | "OWNER_TEXT"
  | "AI_INTERPRETATION"
  | "REGISTRY"
  | "RESOURCE_GRAPH"
  | "HISTORY"
  | "RUNTIME"
  | "EVIDENCE";

/**
 * The four states a reference can be in. `RESOLVER_MATCHED` requires exactly
 * one real match AND at least one evidence string; anything less is
 * `RESOLVER_UNRESOLVED`, and more than one is `RESOLVER_AMBIGUOUS`. There is
 * deliberately no "probably" state.
 */
export type ResolutionStatus =
  | "AI_INTERPRETED"
  | "RESOLVER_MATCHED"
  | "RESOLVER_UNRESOLVED"
  | "RESOLVER_AMBIGUOUS"
  | "VERIFIED_REFERENCE";

/** What the model said, before anything was checked. Text only — see this file's header. */
export interface AiSemanticInterpretation {
  raw_text: string;
  intent: string;
  action: string;
  target_text: string | null;
  entity_mentions: readonly string[];
  /** A phrase the Owner used that seems to name a resource. NOT a resource_id. */
  resource_reference: string | null;
  /** A phrase that seems to name a capability. NOT a capability_id. */
  capability_reference: string | null;
  parameters: Readonly<Record<string, string>>;
  constraints: readonly string[];
  /** "PREVIOUS_CONTEXT" when the Owner referred to something earlier ("อันเมื่อกี้", "ตัวเดิม"), else null. Never a task_id. */
  continuation_reference: string | null;
  previous_context_reference: string | null;
  requested_result: string | null;
  ambiguities: readonly string[];
}

/** One thing the resolver actually proved — or explicitly failed to prove. */
export interface ResolvedReference {
  /** The Owner's/model's phrase this is about, kept verbatim so the claim stays checkable. */
  mention: string;
  status: ResolutionStatus;
  /** The real id, only when status is RESOLVER_MATCHED/VERIFIED_REFERENCE. Null otherwise — never a placeholder. */
  resolved_id: string | null;
  kind: "capability" | "resource" | "command_policy" | "task" | "identity" | "account" | "workspace";
  provenance: Provenance;
  /** What proves it. Empty is only valid for an UNRESOLVED/AMBIGUOUS status. */
  evidence_refs: readonly string[];
  /** Every candidate considered when status is RESOLVER_AMBIGUOUS. */
  candidates: readonly string[];
}

/** One line of the audit trail: which field, from where, proven by what. */
export interface SourceTraceEntry {
  field: string;
  provenance: Provenance;
  detail: string;
}

export type RelationshipQueryStatus = "RELATIONSHIP_RESOLVED" | "RELATIONSHIP_UNRESOLVED" | "RELATIONSHIP_AMBIGUOUS";

/** Deterministic relationship truth; every id here comes from the registry, never the model. */
export interface ResolvedRelationshipQuery {
  source_mention: string;
  target_mention: string;
  status: RelationshipQueryStatus;
  source_capability_id: string | null;
  target_capability_id: string | null;
  relationship_id: string | null;
  relationship_kind: string | null;
  lock_status: "LOCKED" | "NOT_LOCKED" | "NOT_FOUND";
  runtime_status: "PROVEN_BY_CONNECTION_LOCK_EVIDENCE" | "NOT_MEASURED";
  evidence_refs: readonly string[];
  candidates: readonly string[];
}

/**
 * What the rest of the system receives. `ai` and `resolved_*` are separate on
 * purpose: the model's reading is preserved for inspection, but nothing
 * downstream may act on it — only the resolved half carries ids.
 */
export interface StructuredOwnerContext {
  command_id: string;
  owner_identity: { identity_id: string; kind: string };
  raw_text: string;
  intent: string;
  action: string;
  /** Kept whole and unedited, exactly as the model returned it. Separate from every `resolved_*` field on purpose: a reader must always be able to tell a reading from a proof. */
  semantic_interpretation: AiSemanticInterpretation;
  resolved_resources: readonly ResolvedReference[];
  resolved_capabilities: readonly ResolvedReference[];
  /** Evidence rows the registry really holds for a resolved capability. Empty means the read ran and found none — `source_trace` says which. */
  resolved_evidence: readonly ResolvedReference[];
  /** Document/blueprint references. Always empty today: there is NO runtime contract to DNA-OS-BLUEPRINT (see ./read-paths.ts#readDocumentReferences). Empty here means "could not be looked up", and `source_trace` says so rather than letting it read as "nothing matched". */
  resolved_documents: readonly ResolvedReference[];
  parameters: Readonly<Record<string, string>>;
  constraints: readonly string[];
  resolved_history: ResolvedReference | null;
  resolved_state: string;
  evidence_refs: readonly string[];
  unresolved_refs: readonly ResolvedReference[];
  ambiguities: readonly ResolvedReference[];
  source_trace: readonly SourceTraceEntry[];
  /** The real, registered `command_id` for ../entry-context/, or null when none matched. Never the string "unknown". */
  policy_command_id: string | null;
  relationship_query: ResolvedRelationshipQuery | null;
}
