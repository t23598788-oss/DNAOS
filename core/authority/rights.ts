/**
 * Four SEPARATE data rights (owner directive 2026-10-25, STEP 4).
 *
 *   directory.discover      เห็นว่ามีรายการนี้อยู่ + เผยแพร่ได้เฉพาะฟิลด์สาธารณะ
 *   price.publish           เผยแพร่ "ราคา" ของแหล่งวัสดุ
 *   transaction.create      ทำธุรกรรมในนามเจ้าของ/องค์กร
 *   record.read.internal    อ่านข้อมูลภายในขององค์กร
 *
 * They must not collapse into one "can read" flag:
 *   · internal read does NOT imply discovery outside the tenant
 *   · discovery does NOT imply contact/financial fields
 *   · price publication is NOT granted by internal read
 *   · no platform role can read a tenant record or act for its owner
 *
 * Pure module: no I/O. Callers persist `reason` as evidence.
 */
import { type DataScope } from "./data-scope";

export const DATA_RIGHTS = [
  "directory.discover",
  "price.publish",
  "transaction.create",
  "record.read.internal",
] as const;
export type DataRight = (typeof DATA_RIGHTS)[number];

export type RightFieldSet = "public" | "internal" | "none";

export interface RightActor {
  profileId: string;
  role?: string | null;
  organizationIds?: string[];
}

export interface RightResource {
  kind: "company" | "pit" | "material_price" | "transaction";
  id: string;
  organizationId?: string | null;
  ownerProfileId?: string | null;
  /** true only when the record is explicitly cleared for public discovery */
  discoverable?: boolean | null;
  /** true only when the price row's owner has been verified */
  ownerVerified?: boolean | null;
}

export interface RightDecision {
  allowed: boolean;
  reason: string;
  fields: RightFieldSet;
}

const deny = (reason: string): RightDecision => ({ allowed: false, reason, fields: "none" });
const allow = (reason: string, fields: RightFieldSet): RightDecision => ({ allowed: true, reason, fields });

const orgMatches = (actor: RightActor, organizationId?: string | null): boolean => {
  if (!organizationId) return false;
  return (actor.organizationIds ?? []).includes(organizationId);
};

const owns = (actor: RightActor, resource: RightResource): boolean =>
  Boolean(resource.ownerProfileId) && resource.ownerProfileId === actor.profileId;

/* ------------------------------------------------------------------ */
/* 1. Internal read — the only right a DataScope grants wholesale.      */
/* ------------------------------------------------------------------ */
export function resolveInternalReadRight(actor: RightActor | null, resource: RightResource): RightDecision {
  if (!actor?.profileId) return deny("ACTOR_REQUIRED");
  if (orgMatches(actor, resource.organizationId)) return allow("ORGANIZATION_MEMBER_READ", "internal");
  if (owns(actor, resource)) return allow("RESOURCE_OWNER_READ", "internal");
  return deny("NO_INTERNAL_READ_SCOPE");
}

/* ------------------------------------------------------------------ */
/* 2. Discovery — only explicitly disclosed records, public fields.    */
/* ------------------------------------------------------------------ */
export function resolveDiscoveryRight(actor: RightActor | null, resource: RightResource): RightDecision {
  if (!actor?.profileId) return deny("ACTOR_REQUIRED");
  if (resource.discoverable !== true) return deny("NOT_DISCLOSED_FOR_DISCOVERY");
  return allow("DISCLOSED_PUBLIC_RECORD", "public");
}

/* ------------------------------------------------------------------ */
/* 3. Price publication — owner acceptance, never implied by reading.  */
/* ------------------------------------------------------------------ */
export function resolvePricePublicationRight(actor: RightActor | null, resource: RightResource): RightDecision {
  if (!actor?.profileId) return deny("ACTOR_REQUIRED");
  if (owns(actor, resource)) return allow("PRICE_OWNER", "public");
  if (orgMatches(actor, resource.organizationId) && resource.ownerVerified === true) {
    return allow("ORGANIZATION_VERIFIED_OWNER", "public");
  }
  return deny("PRICE_NOT_OWNED");
}

/* ------------------------------------------------------------------ */
/* 4. Transaction — owner/org only.                                   */
/* ------------------------------------------------------------------ */
export function resolveTransactionRight(actor: RightActor | null, resource: RightResource): RightDecision {
  if (!actor?.profileId) return deny("ACTOR_REQUIRED");
  if (owns(actor, resource)) return allow("TRANSACTION_OWNER", "internal");
  if (orgMatches(actor, resource.organizationId)) return allow("TRANSACTION_ORGANIZATION", "internal");
  return deny("NO_TRANSACTION_RIGHT");
}

export interface DataRightInput {
  actor: RightActor | null;
  right: DataRight;
  resource: RightResource;
}

export function resolveDataRight(input: DataRightInput): RightDecision {
  switch (input.right) {
    case "record.read.internal":
      return resolveInternalReadRight(input.actor, input.resource);
    case "directory.discover":
      return resolveDiscoveryRight(input.actor, input.resource);
    case "price.publish":
      return resolvePricePublicationRight(input.actor, input.resource);
    case "transaction.create":
      return resolveTransactionRight(input.actor, input.resource);
    default:
      return deny("UNKNOWN_RIGHT");
  }
}

/**
 * Evidence that a caller may attach to a write. Same shape discipline as
 * `authorityEvidence`, so no second logging vocabulary appears.
 */
export function rightEvidence(decision: RightDecision) {
  return {
    right_allowed: decision.allowed,
    right_reason: decision.reason,
    right_fields: decision.fields,
  };
}

/** A DataScope is internal-read scope only — it never grants the other rights. */
export function scopeGrantsRight(scope: DataScope | null | undefined, right: DataRight): boolean {
  return right === "record.read.internal" && Boolean(scope && scope.mode !== "none");
}
