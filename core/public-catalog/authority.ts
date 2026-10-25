/**
 * Public catalog authority — WHO may publish WHAT. Pure functions, no I/O.
 *
 * Three separate questions, answered in one place:
 *   1. identity      — which real account is acting (profiles.id === auth uid)
 *   2. organization  — which owner key a resource really has (source columns)
 *   3. writer        — which write path that identity is entitled to use
 *
 * Column census of the real database (read-only inspection, 2026-10-25):
 *   pit_profiles     user_id uuid (auth.users.id)       — the ONLY operator link
 *                    line_user_id text                  — chat identity (some values
 *                                                         are placeholders, e.g.
 *                                                         "U-Mock-Pit-KK-001")
 *   pit_materials    pit_profile_id uuid -> pit_profiles.id  — real owner edge
 *   material_types   no owner column
 *   vehicle_types    no owner column
 *   equipment_assets no owner column
 *   companies        organization_id uuid exists but no resource references it
 *   organizations    id, name, created_at, created_by — exists, unlinked
 *
 * Consequences that this module states instead of hiding:
 *   - a price row is owned by its plant: owner key `pit:<pit_profiles.id>`;
 *   - vehicle/equipment/material-type rows have NO owner column in production,
 *     so they can only be published as `platform` (see policy.PLATFORM_OWNER) —
 *     assigning them to an "organization" would be a fabricated relation;
 *   - a pit whose `user_id` is null, or points at a user id that does not exist
 *     in auth.users, has NO verified operator — publishing on its behalf has to
 *     go through the platform (admin) writer, not an operator writer.
 */

import {
  PLATFORM_OWNER,
  pitOwnerKey,
  type PublicationRecord,
  type SourceTable,
} from "./policy"

export type OperatorRole = "super_admin" | "admin" | "employee" | "partner" | "customer" | "ai_service"

export const ADMIN_TIER_ROLES: OperatorRole[] = ["super_admin", "admin", "employee"]

/** The real account behind a request (core/auth/session.AuthedUser, narrowed). */
export interface VerifiedIdentity {
  userId: string
  email: string
  role: OperatorRole
}

/** How a source table can prove ownership at all. */
export interface OwnershipRule {
  /** `pit:<id>` | null (no owner column exists) */
  owner_key_rule: string | null
  /** the column that carries the owning record */
  owner_column: string | null
  /** the column that carries the operator's auth user id, if any */
  identity_column: string | null
  note: string
}

export const RESOURCE_OWNERSHIP: Record<SourceTable, OwnershipRule> = {
  pit_materials: {
    owner_key_rule: "pit:<pit_profiles.id>",
    owner_column: "pit_profile_id",
    identity_column: "pit_profiles.user_id",
    note: "ราคาวัสดุเป็นของบ่อที่มันสังกัด — เจ้าของที่แท้จริงคือ pit_profiles.id ไม่ใช่ค่าที่ Publication ประกาศเอง",
  },
  material_types: {
    owner_key_rule: null,
    owner_column: null,
    identity_column: null,
    note: "material_types เป็นข้อมูลกลาง ไม่มีคอลัมน์เจ้าของ — เผยแพร่ได้เฉพาะในนาม platform",
  },
  vehicle_types: {
    owner_key_rule: null,
    owner_column: null,
    identity_column: null,
    note: "vehicle_types ไม่มีคอลัมน์เจ้าของ (ตรวจ 2026-10-25) — ห้ามผูกกับองค์กรใดโดยเดา",
  },
  equipment_assets: {
    owner_key_rule: null,
    owner_column: null,
    identity_column: null,
    note: "equipment_assets ไม่มีคอลัมน์เจ้าของ (มีเฉพาะ sim_number/imei/box_password ที่เป็นความลับ) — เผยแพร่ได้เฉพาะในนาม platform",
  },
}

/**
 * What the reader/route observed on the source row. `identity_user_id` is only
 * an observation — it is NOT proof that the auth user exists (production has
 * pit_profiles.user_id values that match no auth.users row).
 */
export interface ResourceWitness {
  source_table: SourceTable
  source_record_id: string
  /** `pit:<id>` when the source row has an owner, null when the table has none */
  owner_key: string | null
  /** the owning record id (e.g. pit_profiles.id), for audit only */
  owner_record_id: string | null
  /** pit_profiles.user_id as stored — may reference a deleted auth user */
  identity_user_id: string | null
}

export function witnessForPitMaterial(input: {
  source_record_id: string
  pit_profile_id: string | null
  pit_user_id: string | null
}): ResourceWitness {
  const pit = input.pit_profile_id
  return {
    source_table: "pit_materials",
    source_record_id: input.source_record_id,
    owner_key: pit ? pitOwnerKey(pit) : null,
    owner_record_id: pit,
    identity_user_id: input.pit_user_id,
  }
}

export function witnessWithoutOwner(source_table: SourceTable, source_record_id: string): ResourceWitness {
  return { source_table, source_record_id, owner_key: null, owner_record_id: null, identity_user_id: null }
}

/**
 * Stable public slug for a source row: derived from ids only, so the URL is the
 * same before/after a withdraw-and-republish (a permanent public URL), and it
 * matches the registry's `^[a-z0-9]+(-[a-z0-9]+)*$` constraint even when the
 * material/supplier names are Thai.
 */
export function publicSlugFor(
  source_table: SourceTable,
  source_record_id: string,
  owner_record_id: string | null,
): string {
  const prefix = source_table === "pit_materials" ? "mat" : source_table === "vehicle_types" ? "vt" : "eq"
  const owner = (owner_record_id ?? source_record_id).replace(/-/g, "").slice(0, 8)
  const own = source_record_id.replace(/-/g, "").slice(0, 8)
  return `${prefix}-${owner}-${own}`
}

/** True when the publication row names the owner the source row actually has. */
export function publicationOwnerAccepted(
  record: Pick<PublicationRecord, "organization_owner">,
  witness: ResourceWitness,
): boolean {
  if (witness.owner_key === null) return record.organization_owner === PLATFORM_OWNER
  return record.organization_owner === witness.owner_key
}

/** Could this identity be the operator of this resource, ignoring the role? */
export function identityIsLinkedOwner(identity: VerifiedIdentity, witness: ResourceWitness): boolean {
  if (!witness.identity_user_id) return false
  return witness.identity_user_id === identity.userId
}

export type WriterDenial =
  | "NO_IDENTITY"
  | "ROLE_NOT_ENTITLED"
  | "SOURCE_HAS_NO_OWNER_COLUMN"
  | "OWNER_IDENTITY_NOT_LINKED"
  | "NOT_THE_OWNER"
  | "OPERATOR_WRITER_NOT_IMPLEMENTED"

export interface WriterDecision {
  allowed: boolean
  /** the canonical writer this identity may call, or null when denied */
  writer: "publication.admin" | "publication.operator" | null
  reason: "ALLOWED_PLATFORM" | "ALLOWED_OWNER" | WriterDenial
  detail: string
}

/**
 * Which writer is this identity entitled to use for this resource?
 *
 * `publication.admin` is the existing platform writer (ADMIN_TIER, see
 * app/api/admin/publications/route.ts). `publication.operator` is deliberately
 * NOT implemented yet: production contains no verified operator identity
 * (0 of 15 pit_profiles.user_id values resolve to an auth.users row), so an
 * operator writer would be a route nobody can legitimately call.
 */
export function resolveWriter(
  identity: VerifiedIdentity | null,
  witness: ResourceWitness,
): WriterDecision {
  if (!identity) {
    return { allowed: false, writer: null, reason: "NO_IDENTITY", detail: "ไม่มี session ที่ตรวจสอบได้" }
  }

  if (ADMIN_TIER_ROLES.includes(identity.role)) {
    return {
      allowed: true,
      writer: "publication.admin",
      reason: "ALLOWED_PLATFORM",
      detail:
        witness.owner_key === null
          ? "ตารางต้นทางไม่มีคอลัมน์เจ้าของ — ผู้ดูแลระบบเผยแพร่ในนาม platform"
          : `ผู้ดูแลระบบเผยแพร่แทนเจ้าของ ${witness.owner_key} ได้`,
    }
  }

  if (!["partner", "customer"].includes(identity.role)) {
    return {
      allowed: false,
      writer: null,
      reason: "ROLE_NOT_ENTITLED",
      detail: `บทบาท ${identity.role} ไม่มีสิทธิ์เขียนข้อมูลเผยแพร่`,
    }
  }

  if (witness.owner_key === null) {
    return {
      allowed: false,
      writer: null,
      reason: "SOURCE_HAS_NO_OWNER_COLUMN",
      detail: "ตารางต้นทางไม่มีคอลัมน์เจ้าของ — ผู้ประกอบการอ้างความเป็นเจ้าของไม่ได้",
    }
  }

  if (!witness.identity_user_id) {
    return {
      allowed: false,
      writer: null,
      reason: "OWNER_IDENTITY_NOT_LINKED",
      detail: "ทรัพยากรนี้ยังไม่ได้ผูกบัญชีผู้ใช้จริง (pit_profiles.user_id ว่าง)",
    }
  }

  if (witness.identity_user_id !== identity.userId) {
    return {
      allowed: false,
      writer: null,
      reason: "NOT_THE_OWNER",
      detail: "บัญชีนี้ไม่ใช่เจ้าของทรัพยากรนี้",
    }
  }

  return {
    allowed: false,
    writer: null,
    reason: "OPERATOR_WRITER_NOT_IMPLEMENTED",
    detail:
      "เป็นเจ้าของจริง แต่ยังไม่มี writer สำหรับผู้ประกอบการ (ต้องมี route ที่ตรวจ session→เจ้าของก่อน) — ใช้ writer ของผู้ดูแลระบบจนกว่าจะสร้าง",
  }
}

/**
 * Machine-readable ownership census for the audit script: what each source
 * table can prove, without touching a single business row.
 */
export function ownershipCensus(): Array<{ source_table: SourceTable } & OwnershipRule> {
  return (Object.keys(RESOURCE_OWNERSHIP) as SourceTable[]).map((table) => ({
    source_table: table,
    ...RESOURCE_OWNERSHIP[table],
  }))
}
