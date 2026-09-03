/**
 * หน้าที่: let a domain boundary add the entity types and relationship kinds it
 * needs — PROVIDER_ACCOUNT, CREDENTIAL, EXECUTION_METHOD — WITHOUT Core growing
 * a branch for that domain (Owner, 2026-09-02).
 *
 * THE ARCHITECTURAL PROBLEM THIS SOLVES. Step 17 measured nine schema gaps:
 * concepts the network genuinely needs that neither vocabulary can express.
 * Under the current design each one costs a Core type edit, so every new
 * real-world concept grows Core. That is the wrong direction — Core should know
 * ENTITY, IDENTITY, RELATIONSHIP, CONTRACT, AUTHORITY, STATE, EVIDENCE,
 * PROVENANCE, and nothing about providers.
 *
 * WHAT MAKES THIS SAFE RATHER THAN AN ANY→ANY GRAPH. An extension is not a
 * licence to invent semantics. Each declared relationship kind must name its
 * allowed from-types and to-types, drawn from that extension's own entity types
 * or from Core's; `validateExtension` refuses anything else. So a domain can say
 * "a CAPABILITY may bind to a PROVIDER_ACCOUNT" and cannot say "anything may
 * relate to anything".
 *
 * FAIL CLOSED, THREE WAYS. Unregistered vocabulary is rejected, not tolerated.
 * A duplicate VOCABULARY_ID is rejected rather than merged. And a second
 * extension redefining a kind another already owns is rejected as a semantic
 * conflict — because two definitions of one edge is how a graph silently starts
 * lying.
 *
 * CORE DOES NOT LEARN THE DOMAIN. Nothing below mentions Vercel, Railway or any
 * provider. `validateExtension` and `isKindAllowed` are generic over whatever
 * was declared; the provider knowledge lives entirely in the declaration data.
 *
 * Input: extension declarations + Core's own vocabularies.
 * Output: the extension contract, validateExtension, registerExtension, isKindAllowed.
 * Dependency ที่อนุญาต: none — pure.
 * สิ่งที่ห้ามแตะ: ห้ามใส่ตรรกะเฉพาะผู้ให้บริการลง Core, ห้ามยอมรับ vocabulary
 * ที่ไม่ได้ประกาศ, ห้ามให้สอง extension นิยาม kind เดียวกัน.
 */

/** A relationship kind, with the type pairs it is allowed to connect. Never open-ended. */
export interface DeclaredRelationshipKind {
  relationship_kind: string;
  allowed_from_types: readonly string[];
  allowed_to_types: readonly string[];
  /** What the edge means, in one machine-checkable sentence fragment. */
  semantic_contract: string;
}

export interface VocabularyExtension {
  vocabulary_id: string;
  /** The boundary that owns these semantics — a real module path. */
  owner_boundary: string;
  entity_types: readonly string[];
  relationship_kinds: readonly DeclaredRelationshipKind[];
  /** The module whose deterministic check admits rows of these kinds. */
  validator: string;
  version: string;
  evidence_source: string;
  registration_provenance: string;
}

/** Finite rejection reasons. A refusal is data, not a message. */
export type ExtensionRejection =
  | "MISSING_VOCABULARY_ID"
  | "MISSING_OWNER_BOUNDARY"
  | "NO_ENTITY_TYPES_OR_KINDS"
  | "DUPLICATE_VOCABULARY_ID"
  | "CONFLICTING_RELATIONSHIP_KIND"
  | "TYPE_NOT_DECLARED_OR_CORE"
  | "MISSING_VALIDATOR"
  | "MISSING_SEMANTIC_CONTRACT"
  | "MISSING_PROVENANCE"
  | "COLLIDES_WITH_CORE_KIND";

export type ExtensionValidation =
  | { ok: true }
  | { ok: false; rejections: readonly ExtensionRejection[] };

export interface CoreVocabulary {
  entity_types: readonly string[];
  relationship_kinds: readonly string[];
}

/**
 * Validates one declaration against Core's vocabulary and everything already
 * registered. Pure; every rejection is reported, not just the first, so a
 * producer can fix a declaration in one pass.
 */
export function validateExtension(
  extension: VocabularyExtension,
  core: CoreVocabulary,
  alreadyRegistered: readonly VocabularyExtension[],
): ExtensionValidation {
  const r: ExtensionRejection[] = [];
  if (!extension.vocabulary_id) r.push("MISSING_VOCABULARY_ID");
  if (!extension.owner_boundary) r.push("MISSING_OWNER_BOUNDARY");
  if (!extension.validator) r.push("MISSING_VALIDATOR");
  if (!extension.registration_provenance || !extension.evidence_source) r.push("MISSING_PROVENANCE");
  if (extension.entity_types.length === 0 && extension.relationship_kinds.length === 0) r.push("NO_ENTITY_TYPES_OR_KINDS");
  if (alreadyRegistered.some((e) => e.vocabulary_id === extension.vocabulary_id)) r.push("DUPLICATE_VOCABULARY_ID");

  // A kind Core already owns cannot be redefined by a domain, and a kind
  // another extension owns cannot be claimed twice — either would give one edge
  // two meanings.
  const claimedElsewhere = new Set(alreadyRegistered.flatMap((e) => e.relationship_kinds.map((k) => k.relationship_kind)));
  for (const k of extension.relationship_kinds) {
    if (core.relationship_kinds.includes(k.relationship_kind)) r.push("COLLIDES_WITH_CORE_KIND");
    if (claimedElsewhere.has(k.relationship_kind)) r.push("CONFLICTING_RELATIONSHIP_KIND");
    if (!k.semantic_contract) r.push("MISSING_SEMANTIC_CONTRACT");
    // Every endpoint type must be declared here or already known to Core.
    const known = [...extension.entity_types, ...core.entity_types];
    const endpoints = [...k.allowed_from_types, ...k.allowed_to_types];
    if (endpoints.length === 0 || endpoints.some((t) => !known.includes(t))) r.push("TYPE_NOT_DECLARED_OR_CORE");
  }
  return r.length === 0 ? { ok: true } : { ok: false, rejections: Object.freeze([...new Set(r)]) };
}

export type RegisterExtensionResult =
  | { ok: true; registered: readonly VocabularyExtension[] }
  | { ok: false; rejections: readonly ExtensionRejection[] };

/** Registers one extension, or refuses. There is no partial acceptance. */
export function registerExtension(
  extension: VocabularyExtension,
  core: CoreVocabulary,
  alreadyRegistered: readonly VocabularyExtension[],
): RegisterExtensionResult {
  const v = validateExtension(extension, core, alreadyRegistered);
  return v.ok ? { ok: true, registered: [...alreadyRegistered, extension] } : { ok: false, rejections: v.rejections };
}

/**
 * The runtime check a relationship row must pass. Unknown vocabulary fails
 * closed: a kind nobody declared is refused, however sensible its name.
 */
export function isKindAllowed(
  relationshipKind: string, fromType: string, toType: string,
  core: CoreVocabulary, registered: readonly VocabularyExtension[],
): { allowed: boolean; reason: "CORE_KIND" | "EXTENSION_KIND" | "UNDECLARED_KIND" | "TYPE_PAIR_NOT_ALLOWED" } {
  if (core.relationship_kinds.includes(relationshipKind)) return { allowed: true, reason: "CORE_KIND" };
  for (const e of registered) {
    const k = e.relationship_kinds.find((x) => x.relationship_kind === relationshipKind);
    if (!k) continue;
    return k.allowed_from_types.includes(fromType) && k.allowed_to_types.includes(toType)
      ? { allowed: true, reason: "EXTENSION_KIND" }
      : { allowed: false, reason: "TYPE_PAIR_NOT_ALLOWED" };
  }
  return { allowed: false, reason: "UNDECLARED_KIND" };
}

/** Everything a joint between two systems must durably know. It maps identities; it does not own either side's truth. */
export interface JointKnowledge {
  joint_id: string;
  side_a_identity: string;
  side_b_identity: string;
  input_contract: string;
  output_contract: string;
  /** Field-to-field identity mapping. Representation only — no value may be redefined. */
  identity_mapping: readonly { from_field: string; to_field: string }[];
  authority_requirement: string;
  execution_method: string;
  observation_method: string | null;
  verification_method: string | null;
  evidence_refs: readonly string[];
}

/**
 * A joint may translate how an identity is written, never what either side says
 * is true. Any mapping that would overwrite a side's own value is refused.
 */
export function jointRedefinesTruth(joint: JointKnowledge): boolean {
  return joint.identity_mapping.some((m) => m.from_field === m.to_field && m.from_field.endsWith("_truth"))
    || joint.input_contract === joint.output_contract && joint.side_a_identity === joint.side_b_identity;
}
