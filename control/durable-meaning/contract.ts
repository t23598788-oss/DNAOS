/**
 * หน้าที่: make a resource's MEANING as durable as its identity — so that what
 * was learned when it entered the system survives the session, the agent and
 * the wording of the request that caused it (Owner, 2026-09-02).
 *
 * THE DEFECT THIS ADDRESSES, MEASURED. 620 canonical resources; 126 carry any
 * relationship; 0 of 200 sampled can say why they exist. The cause is visible
 * in the contract, not in anyone's behaviour: `RegistrationCandidate` declares
 * `relationships?:` — OPTIONAL — and declares no origin field at all. So a
 * producer that knows exactly why it is registering something has nowhere to
 * put that, and a producer that knows nothing passes validation identically.
 * Identity became durable; meaning did not.
 *
 * WHAT THIS FILE REFUSES TO DO ABOUT IT. It does not fill the gap by inference.
 * An origin that was not supplied is `UNKNOWN`, permanently, and `admitResource`
 * has no branch that can turn an absence into a value. The four binding states
 * exist precisely so a resource can be admitted for inventory while remaining
 * honestly unexplained — completeness theatre would be worse than the orphans.
 *
 * WHY THREE STATES AND NOT TWO. `UNKNOWN` (nobody knows), `NOT_APPLICABLE` (the
 * question does not apply to this kind of resource) and `KNOWN` are different
 * facts. Collapsing the first two makes a resource that legitimately has no
 * runtime look like one whose runtime was never recorded.
 *
 * AND WHY AN AGENT CANNOT WRITE HERE. `Provenance.produced_by` is a closed
 * union with no member meaning "an agent said so". A fact whose only support is
 * a model's reading of a repository cannot be expressed in this contract, so it
 * cannot enter the store — not by policy, by type.
 *
 * Input: a resource identity plus whatever context its producer actually had.
 * Output: the origin/binding/provenance contracts and admitResource.
 * Dependency ที่อนุญาต: none — pure.
 * สิ่งที่ห้ามแตะ: ห้ามเดา origin, ห้ามยุบ UNKNOWN กับ NOT_APPLICABLE, ห้ามให้
 * คำพูดของ agent เป็นหลักฐาน, ห้ามเขียนทับ canonical registry.
 */

/** Three different facts, kept apart. */
export type FactState = "KNOWN" | "UNKNOWN" | "NOT_APPLICABLE";

/**
 * Why a resource entered the network. Reused from the causes that already exist
 * in this repo's own pipelines — discovery, registration, repair, incident,
 * deployment — rather than invented wholesale.
 */
export type OriginKind =
  | "OWNER_REQUIREMENT" | "WORK_ORDER" | "CAPABILITY_REQUIREMENT"
  | "DISCOVERY" | "DEPENDENCY" | "REPAIR" | "INCIDENT"
  | "DEPLOYMENT" | "EXTERNAL_RESOURCE" | "SYSTEM_BOOTSTRAP" | "LEGACY_IMPORT"
  /** Nobody recorded it and nothing can recover it. A value, not an absence. */
  | "UNKNOWN";

/**
 * Who produced a fact. There is deliberately no AGENT_STATEMENT or
 * MODEL_INFERENCE member: a fact that can only cite one of those has no way to
 * be represented here, which is how the "AI may discover, may not define"
 * boundary is enforced by the type system rather than by discipline.
 */
export type ProducedBy =
  | "DETERMINISTIC_PRODUCER"
  | "REGISTRATION_PIPELINE"
  | "RUNTIME_OBSERVATION"
  | "OWNER_AUTHENTICATED_ACTION"
  | "EXISTING_PERSISTED_EVIDENCE";

export interface Provenance {
  produced_by: ProducedBy;
  /** The module or store that produced it — a path, never a description. */
  source: string;
  /** The contract under which it was accepted. */
  under_contract: string;
  /** What verified it. Null only when the fact IS the observation. */
  verified_by: string | null;
  observed_at: string;
  /** The canonical identity this fact is about. */
  canonical_identity: string;
}

export interface ResourceOrigin {
  resource_id: string;
  origin_kind: OriginKind;
  /** A machine identity or pointer. Free-form prose is not provenance and is refused below. */
  origin_reference: string | null;
  /** The producer that introduced it — a module path or a registered identity. */
  introduced_by: string | null;
  evidence_refs: readonly string[];
  provenance: Provenance;
}

/** How much meaning is bound to an identity. Reuses no existing enum because none expressed this. */
export type KnowledgeBindingState =
  | "BOUND_WITH_KNOWN_ORIGIN"
  | "BOUND_WITH_PARTIAL_CONTEXT"
  /** Registered before durable meaning was required. Honest, not shameful. */
  | "UNBOUND_LEGACY"
  | "UNBOUND_UNKNOWN";

/** Which required fact is absent. Finite, so a gap is queryable rather than narrated. */
export type MissingKnowledge =
  | "ORIGIN_KIND" | "ORIGIN_REFERENCE" | "INTRODUCED_BY"
  | "SUPPORTED_RELATIONSHIP" | "EVIDENCE" | "PROVENANCE" | "SOURCE_AUTHORITY";

export interface AdmissionInput {
  resource_id: string;
  resource_kind: string;
  /** Whatever the producer genuinely had. Absent fields stay absent. */
  origin?: { origin_kind: OriginKind; origin_reference: string | null; introduced_by: string | null };
  /** Relationships the producer can support with evidence — never guesses. */
  supported_relationships?: readonly { relationship_kind: string; to_id: string; evidence_ref: string }[];
  evidence_refs?: readonly string[];
  provenance?: Provenance;
  /** True when this identity predates the durable-meaning requirement. */
  legacy?: boolean;
}

export interface AdmissionResult {
  resource_id: string;
  identity_registered: boolean;
  origin_state: FactState;
  relationship_state: FactState;
  evidence_state: FactState;
  knowledge_binding_state: KnowledgeBindingState;
  missing_knowledge: readonly MissingKnowledge[];
  /** Present only when the producer supplied one that passed validation. */
  origin: ResourceOrigin | null;
  relationship_count: number;
}

/** Prose is not a pointer. An origin_reference must look like a machine identity. */
export function isMachineReference(value: string | null): boolean {
  if (value === null) return false;
  // An identifier, a path, a URI or a prefixed id — never a sentence.
  return /^[A-Za-z0-9][A-Za-z0-9._:/@#-]*$/.test(value) && !value.includes(" ");
}

/**
 * Admits one resource. Deterministic and total.
 *
 * The rule that matters: nothing here can raise a state. An origin the producer
 * did not supply cannot become KNOWN, a relationship without an evidence_ref is
 * not counted, and a `legacy` identity is recorded as UNBOUND_LEGACY rather than
 * quietly rated the same as a fresh unexplained one. Inventory is still allowed
 * — an unexplained resource registers — it simply cannot claim to be understood.
 */
export function admitResource(input: AdmissionInput): AdmissionResult {
  const missing: MissingKnowledge[] = [];

  // ---- origin ----
  let origin: ResourceOrigin | null = null;
  let originState: FactState = "UNKNOWN";
  const o = input.origin;
  if (o && o.origin_kind !== "UNKNOWN") {
    if (!input.provenance) missing.push("PROVENANCE");
    else if (!isMachineReference(o.origin_reference) && o.origin_reference !== null) missing.push("ORIGIN_REFERENCE");
    else {
      originState = "KNOWN";
      origin = {
        resource_id: input.resource_id, origin_kind: o.origin_kind,
        origin_reference: o.origin_reference, introduced_by: o.introduced_by,
        evidence_refs: input.evidence_refs ?? [], provenance: input.provenance,
      };
      if (o.origin_reference === null) missing.push("ORIGIN_REFERENCE");
      if (o.introduced_by === null) missing.push("INTRODUCED_BY");
    }
  } else {
    missing.push("ORIGIN_KIND");
  }

  // ---- relationships: only those carrying an evidence ref count ----
  const supported = (input.supported_relationships ?? []).filter((r) => r.evidence_ref.length > 0 && r.to_id.length > 0);
  const relationshipState: FactState = supported.length > 0 ? "KNOWN" : "UNKNOWN";
  if (supported.length === 0) missing.push("SUPPORTED_RELATIONSHIP");

  // ---- evidence ----
  const evidenceState: FactState = (input.evidence_refs ?? []).length > 0 ? "KNOWN" : "UNKNOWN";
  if (evidenceState === "UNKNOWN") missing.push("EVIDENCE");

  // ---- binding ----
  const binding: KnowledgeBindingState =
    input.legacy === true ? "UNBOUND_LEGACY"
      : originState === "KNOWN" && relationshipState === "KNOWN" ? "BOUND_WITH_KNOWN_ORIGIN"
        : originState === "KNOWN" || relationshipState === "KNOWN" ? "BOUND_WITH_PARTIAL_CONTEXT"
          : "UNBOUND_UNKNOWN";

  return {
    resource_id: input.resource_id,
    // Identity registration is never blocked by missing meaning — inventory is
    // allowed to be honest about what it does not know.
    identity_registered: true,
    origin_state: originState, relationship_state: relationshipState, evidence_state: evidenceState,
    knowledge_binding_state: binding,
    missing_knowledge: Object.freeze([...new Set(missing)]),
    origin, relationship_count: supported.length,
  };
}
