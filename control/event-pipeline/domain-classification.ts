/**
 * หน้าที่: the Domain Classification gate — runs before the Registration
 * Gate (`./registration-contract.ts`'s `evaluateRegistration`) and again,
 * independently, inside the Registry Writer and the Database Port. Its
 * only job is deciding whether a candidate's real content is software
 * control-plane data this pipeline may accept, or business data it must
 * never touch.
 *
 * The critical rule: a candidate's `domain` field is a caller-supplied
 * CLAIM, never trusted on its own. The `resource_type` field is the
 * ground truth this module classifies from — an external agent cannot
 * choose `domain: SOFTWARE_CONTROL_PLANE` to smuggle `resource_type:
 * INVOICE` through, because the domain returned here is always derived
 * from resource_type, not read off the candidate's own claim.
 *
 * Input: `{ domain, resource_type, source_system }` (the five mandatory
 * Registration Candidate fields this module cares about).
 * Output: `DomainClassificationResult` / `BatchClassificationResult`.
 * Dependency ที่อนุญาต: none — a leaf contract, same discipline as
 * `contracts/identity/envelope-identity.ts`.
 * สิ่งที่ห้ามแตะ: never add a business resource_type to
 * SOFTWARE_RESOURCE_TYPE_DOMAIN — every business type must resolve
 * through BUSINESS_RESOURCE_TYPE_SET only. Never inspect or return
 * candidate payload content here, only the five classification fields —
 * this module must work without ever reading business content itself.
 */

export type RegistrationDomain =
  | "SOFTWARE_CONTROL_PLANE"
  | "INFRASTRUCTURE_CONTROL"
  | "SYSTEM_GOVERNANCE"
  | "ENGINEERING_EVIDENCE"
  | "BUSINESS_OPERATIONAL_DATA";

export type SoftwareResourceType =
  | "SOFTWARE_RESOURCE"
  | "CAPABILITY"
  | "MODULE"
  | "SOURCE_REFERENCE"
  | "API"
  | "ADAPTER"
  | "WORKER"
  | "AGENT_RUNTIME"
  | "RUNTIME"
  | "UI_SURFACE"
  | "ROUTE"
  | "SYSTEM_SERVICE"
  | "CONNECTOR"
  | "PROVIDER_REFERENCE"
  | "DEPENDENCY"
  | "RELATIONSHIP"
  | "VERSION"
  | "TEST_RESULT"
  | "EXECUTION_EVIDENCE"
  | "REGISTRATION_EVIDENCE"
  | "TELEMETRY_REFERENCE"
  | "AUTH_POLICY_REFERENCE"
  | "CREDENTIAL_REFERENCE_METADATA"
  /** A standard machine-to-machine entry point external AI/Agent processes use to reach DNA OS — never a human UI, business ingress, worker runtime, or database API. See IngressMetadata below for the mandatory audience=MACHINE_AGENT_ONLY / human_facing=false enforcement. */
  | "AI_INGRESS";

export type BusinessResourceType =
  | "CUSTOMER"
  | "PERSON"
  | "COMPANY_BUSINESS_RECORD"
  | "SALE"
  | "PURCHASE"
  | "JOB"
  | "TRANSPORT_JOB"
  | "INVOICE"
  | "RECEIPT"
  | "PAYMENT"
  | "DEBT"
  | "PRODUCT"
  | "MATERIAL"
  | "ORDER"
  | "BUSINESS_DOCUMENT"
  | "BUSINESS_CHAT"
  | "BUSINESS_EVENT"
  | "GPS_DELIVERY"
  | "TAX_TRANSACTION"
  | "ACCOUNTING_TRANSACTION"
  | "BUSINESS_METRIC";

export type RegistrationResourceType = SoftwareResourceType | BusinessResourceType;

export type DomainRoutingResult = "ACCEPT_SOFTWARE_REGISTRATION" | "REJECT_BUSINESS_DATA" | "ROUTE_TO_OTHER_DOMAIN" | "UNRESOLVED_DOMAIN";

export interface DomainClassificationInput {
  domain: string;
  resource_type: string;
  source_system: string;
}

export interface DomainClassificationResult {
  routing_result: DomainRoutingResult;
  reason_code: string | null;
  expected_domain: RegistrationDomain | null;
  actual_domain: RegistrationDomain | "UNKNOWN";
  /** Only present for ROUTE_TO_OTHER_DOMAIN — an opaque reference, never a forwarded payload. This pipeline never forwards data itself; a caller reads this and submits to the named contract on its own. */
  target_contract?: string;
  target_reference?: string;
}

/** Ground truth: resource_type -> domain. A candidate's declared `domain` field is checked against this, never trusted instead of it. */
const SOFTWARE_RESOURCE_TYPE_DOMAIN: Readonly<Record<SoftwareResourceType, RegistrationDomain>> = {
  SOFTWARE_RESOURCE: "SOFTWARE_CONTROL_PLANE",
  CAPABILITY: "SOFTWARE_CONTROL_PLANE",
  MODULE: "SOFTWARE_CONTROL_PLANE",
  SOURCE_REFERENCE: "SOFTWARE_CONTROL_PLANE",
  API: "SOFTWARE_CONTROL_PLANE",
  ADAPTER: "SOFTWARE_CONTROL_PLANE",
  WORKER: "SOFTWARE_CONTROL_PLANE",
  AGENT_RUNTIME: "SOFTWARE_CONTROL_PLANE",
  RUNTIME: "SOFTWARE_CONTROL_PLANE",
  UI_SURFACE: "SOFTWARE_CONTROL_PLANE",
  ROUTE: "SOFTWARE_CONTROL_PLANE",
  SYSTEM_SERVICE: "SOFTWARE_CONTROL_PLANE",
  CONNECTOR: "INFRASTRUCTURE_CONTROL",
  PROVIDER_REFERENCE: "INFRASTRUCTURE_CONTROL",
  DEPENDENCY: "INFRASTRUCTURE_CONTROL",
  RELATIONSHIP: "INFRASTRUCTURE_CONTROL",
  VERSION: "INFRASTRUCTURE_CONTROL",
  TEST_RESULT: "ENGINEERING_EVIDENCE",
  EXECUTION_EVIDENCE: "ENGINEERING_EVIDENCE",
  REGISTRATION_EVIDENCE: "ENGINEERING_EVIDENCE",
  TELEMETRY_REFERENCE: "ENGINEERING_EVIDENCE",
  AUTH_POLICY_REFERENCE: "SYSTEM_GOVERNANCE",
  CREDENTIAL_REFERENCE_METADATA: "SYSTEM_GOVERNANCE",
  AI_INGRESS: "SOFTWARE_CONTROL_PLANE",
};

const BUSINESS_RESOURCE_TYPE_SET: ReadonlySet<string> = new Set<BusinessResourceType>([
  "CUSTOMER",
  "PERSON",
  "COMPANY_BUSINESS_RECORD",
  "SALE",
  "PURCHASE",
  "JOB",
  "TRANSPORT_JOB",
  "INVOICE",
  "RECEIPT",
  "PAYMENT",
  "DEBT",
  "PRODUCT",
  "MATERIAL",
  "ORDER",
  "BUSINESS_DOCUMENT",
  "BUSINESS_CHAT",
  "BUSINESS_EVENT",
  "GPS_DELIVERY",
  "TAX_TRANSACTION",
  "ACCOUNTING_TRANSACTION",
  "BUSINESS_METRIC",
]);

const PIPELINE_DOMAINS: ReadonlySet<string> = new Set<RegistrationDomain>(["SOFTWARE_CONTROL_PLANE", "INFRASTRUCTURE_CONTROL", "SYSTEM_GOVERNANCE", "ENGINEERING_EVIDENCE"]);

/**
 * No canonical business ingress is known from inside this repo today —
 * `contracts/operational-bridge/` is Operational -> Infrastructure for
 * software commands only, and its own docstring says it must never carry
 * business data either direction. Business data therefore has nowhere to
 * be routed to and is rejected outright. If a real, reviewed business
 * ingress contract is ever registered here, populate this map and
 * REJECT_BUSINESS_DATA becomes ROUTE_TO_OTHER_DOMAIN for that case — this
 * pipeline still never forwards the payload itself, only names the
 * contract.
 */
const KNOWN_BUSINESS_INGRESS_TARGETS: ReadonlyMap<string, { target_contract: string; target_reference: string }> = new Map();

function asDomain(value: string): RegistrationDomain | "UNKNOWN" {
  return PIPELINE_DOMAINS.has(value) || value === "BUSINESS_OPERATIONAL_DATA" ? (value as RegistrationDomain) : "UNKNOWN";
}

export function classifyRegistrationDomain(input: DomainClassificationInput): DomainClassificationResult {
  if (BUSINESS_RESOURCE_TYPE_SET.has(input.resource_type)) {
    const knownTarget = KNOWN_BUSINESS_INGRESS_TARGETS.get(input.source_system);
    if (knownTarget) {
      return {
        routing_result: "ROUTE_TO_OTHER_DOMAIN",
        reason_code: "BUSINESS_DATA_ROUTED",
        expected_domain: "SOFTWARE_CONTROL_PLANE",
        actual_domain: "BUSINESS_OPERATIONAL_DATA",
        target_contract: knownTarget.target_contract,
        target_reference: knownTarget.target_reference,
      };
    }
    return {
      routing_result: "REJECT_BUSINESS_DATA",
      reason_code: "BUSINESS_DATA_NOT_ALLOWED",
      expected_domain: "SOFTWARE_CONTROL_PLANE",
      actual_domain: "BUSINESS_OPERATIONAL_DATA",
    };
  }

  const derivedDomain = SOFTWARE_RESOURCE_TYPE_DOMAIN[input.resource_type as SoftwareResourceType] as RegistrationDomain | undefined;
  if (derivedDomain === undefined) {
    return { routing_result: "UNRESOLVED_DOMAIN", reason_code: "UNKNOWN_RESOURCE_TYPE", expected_domain: null, actual_domain: "UNKNOWN" };
  }

  // The declared `domain` is checked against the resource_type-derived
  // truth — never trusted on its own (rule: an external agent may not
  // choose `domain` to bypass this classification).
  if (input.domain !== derivedDomain) {
    return { routing_result: "UNRESOLVED_DOMAIN", reason_code: "DOMAIN_RESOURCE_TYPE_MISMATCH", expected_domain: derivedDomain, actual_domain: asDomain(input.domain) };
  }

  return { routing_result: "ACCEPT_SOFTWARE_REGISTRATION", reason_code: null, expected_domain: derivedDomain, actual_domain: derivedDomain };
}

export interface BatchClassificationResult {
  routing_result: DomainRoutingResult;
  reason_code: string | null;
  items: readonly DomainClassificationResult[];
}

/**
 * One event carrying multiple candidates must be split before ingress if
 * any of them are business data — never partially accepted. A batch that
 * is entirely software is ACCEPT; a batch that is entirely business is
 * REJECT_BUSINESS_DATA; a batch mixing both is REJECT_BUSINESS_DATA with
 * reason_code MIXED_DOMAIN_SPLIT_REQUIRED, naming every item's own result
 * so the caller knows exactly what to split out.
 */
export function classifyRegistrationBatch(inputs: readonly DomainClassificationInput[]): BatchClassificationResult {
  const items = inputs.map(classifyRegistrationDomain);
  const hasBusiness = items.some((item) => item.routing_result === "REJECT_BUSINESS_DATA" || item.routing_result === "ROUTE_TO_OTHER_DOMAIN");
  const hasSoftware = items.some((item) => item.routing_result === "ACCEPT_SOFTWARE_REGISTRATION");
  const hasUnresolved = items.some((item) => item.routing_result === "UNRESOLVED_DOMAIN");

  if (hasBusiness && hasSoftware) return { routing_result: "REJECT_BUSINESS_DATA", reason_code: "MIXED_DOMAIN_SPLIT_REQUIRED", items };
  if (hasBusiness) return { routing_result: "REJECT_BUSINESS_DATA", reason_code: "BUSINESS_DATA_NOT_ALLOWED", items };
  if (hasUnresolved) return { routing_result: "UNRESOLVED_DOMAIN", reason_code: "UNRESOLVED_DOMAIN_IN_BATCH", items };
  return { routing_result: "ACCEPT_SOFTWARE_REGISTRATION", reason_code: null, items };
}

/**
 * The only audience value AI_INGRESS may declare today — closed on
 * purpose, matching the Owner's explicit constraint that this boundary is
 * machine-to-machine only, never human-facing.
 */
export type IngressAudience = "MACHINE_AGENT_ONLY";

/** The Type Validation contract for resource_type=AI_INGRESS candidates — see ../../contracts/command/output-contract.ts's own canonical-flow framing (INPUT -> DOMAIN CLASSIFICATION -> TYPE VALIDATION -> ...). Required and validated only when resource_type is AI_INGRESS; every other resource_type ignores this entirely. */
export interface IngressMetadata {
  canonical_name: string;
  audience: IngressAudience;
  human_facing: boolean;
  transport: string;
  endpoint: string;
  accepted_callers: readonly string[];
  purpose: string;
}

export interface IngressValidationResult {
  ok: boolean;
  reason: string | null;
}

/**
 * Type Validation gate for AI_INGRESS candidates. A no-op (always ok)
 * for every other resource_type — this never widens what any other type
 * accepts. audience must be exactly MACHINE_AGENT_ONLY and human_facing
 * must be exactly false; there is no other valid combination for an
 * AI_INGRESS resource today.
 */
export function validateIngressMetadata(input: { resource_type: string; ingress_metadata?: IngressMetadata }): IngressValidationResult {
  if (input.resource_type !== "AI_INGRESS") return { ok: true, reason: null };
  const metadata = input.ingress_metadata;
  if (!metadata) return { ok: false, reason: "INGRESS_METADATA_REQUIRED" };
  if (metadata.audience !== "MACHINE_AGENT_ONLY") return { ok: false, reason: "INVALID_AUDIENCE" };
  if (metadata.human_facing !== false) return { ok: false, reason: "HUMAN_FACING_NOT_ALLOWED_FOR_AI_INGRESS" };
  if (!metadata.canonical_name || !metadata.transport || !metadata.endpoint || !metadata.purpose) return { ok: false, reason: "INGRESS_METADATA_INCOMPLETE" };
  if (!Array.isArray(metadata.accepted_callers) || metadata.accepted_callers.length === 0) return { ok: false, reason: "ACCEPTED_CALLERS_REQUIRED" };
  return { ok: true, reason: null };
}
